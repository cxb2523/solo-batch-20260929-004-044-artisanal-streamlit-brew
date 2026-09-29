#!/usr/bin/env node
/**
 * Resident analysis server.
 *
 *   GET /trace              interactive board
 *   GET /state              current parsed/reconciled state (JSON)
 *   GET /events             Server-Sent Events stream (state revisions + presence)
 *   GET /source/<file>      raw source of index.html / preview.svg / button.svg / README.md
 *   GET /decoded            decoded index.html payload (what the bootstrap actually renders)
 *
 * Change propagation:
 *   watch.mjs emits only when the content signature changes; the server then
 *   rebuilds state and pushes a revision. Identical revisions are never pushed
 *   twice, and every open tab renders a given revision at most once.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PipelineWatcher } from './watch.mjs';
import { buildState } from './state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const PORT = Number(process.env.PORT || 8765);

const ALLOWED_SOURCES = new Set(['index.html', 'preview.svg', 'button.svg', 'README.md']);
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const clients = new Set();
let currentState = null;
let rebuildQueued = false;

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

function broadcastPresence() {
  broadcast('presence', { clients: clients.size, at: new Date().toISOString() });
}

async function rebuild(reason) {
  const next = await buildState(watcher.snapshot());
  const previousRevision = currentState ? currentState.revision : null;
  if (next.revision === previousRevision) {
    // Same content signature -> single push rule, also enforced server-side.
    return { changed: false, revision: next.revision };
  }
  currentState = next;
  broadcast('state', { revision: next.revision, reason, state: next });
  return { changed: true, revision: next.revision };
}

function scheduleRebuild(reason) {
  if (rebuildQueued) return;
  rebuildQueued = true;
  setTimeout(async () => {
    rebuildQueued = false;
    try {
      const result = await rebuild(reason);
      console.log(`[reconcile] ${reason}: revision=${result.revision} changed=${result.changed}`);
    } catch (err) {
      console.error('[reconcile] rebuild failed:', err);
    }
  }, 80);
}

const watcher = new PipelineWatcher(root).start();
watcher.on('change', ({ file }) => scheduleRebuild(`changed:${file}`));
watcher.on('duplicate', ({ file }) => {
  console.log(`[watch] duplicate suppressed: ${file} (same mtime + size)`);
});
watcher.on('readError', (payload) => {
  console.log(`[watch] read error after single retry: ${payload.file} — ${payload.error}`);
  broadcast('notice', { level: 'error', ...payload });
});

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': CONTENT_TYPES['.json'],
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function serveSse(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store, no-transform',
    connection: 'keep-alive',
    'access-control-allow-origin': '*',
  });
  res.write('retry: 1000\n\n');
  clients.add(res);
  if (currentState) {
    res.write(`event: hello\ndata: ${JSON.stringify({ revision: currentState.revision, state: currentState, clients: clients.size })}\n\n`);
  }
  broadcastPresence();
  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(ping);
    }
  }, 15000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
    broadcastPresence();
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  try {
    if (pathname === '/trace' || pathname === '/' || pathname === '/trace/') {
      const board = fs.readFileSync(path.join(here, 'board.html'), 'utf8');
      res.writeHead(200, { 'content-type': CONTENT_TYPES['.html'], 'cache-control': 'no-store' });
      res.end(board);
      return;
    }

    if (pathname === '/events') {
      serveSse(req, res);
      return;
    }

    if (pathname === '/state') {
      if (!currentState) {
        sendJson(res, 503, { error: 'state not ready' });
        return;
      }
      sendJson(res, 200, currentState);
      return;
    }

    if (pathname === '/decoded') {
      res.writeHead(200, { 'content-type': CONTENT_TYPES['.html'], 'cache-control': 'no-store' });
      res.end(currentState ? currentState.sources['index.html'].decoded : '');
      return;
    }

    if (pathname.startsWith('/source/')) {
      const name = decodeURIComponent(pathname.slice('/source/'.length));
      if (!ALLOWED_SOURCES.has(name)) {
        sendJson(res, 403, { error: 'forbidden source' });
        return;
      }
      const filePath = path.join(root, name);
      const text = fs.readFileSync(filePath, 'utf8');
      const line = Number(url.searchParams.get('line') || 0);
      const ext = path.extname(name);
      if (url.searchParams.get('format') === 'json') {
        sendJson(res, 200, { file: name, line, text });
        return;
      }
      res.writeHead(200, { 'content-type': CONTENT_TYPES[ext] || 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end(text);
      return;
    }

    if (pathname === '/health') {
      sendJson(res, 200, { ok: true, clients: clients.size, revision: currentState ? currentState.revision : null });
      return;
    }

    sendJson(res, 404, { error: 'not found', routes: ['/trace', '/state', '/events', '/source/<file>', '/decoded'] });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

async function main() {
  await watcher.initialScan();
  const initial = await rebuild('initial');
  server.listen(PORT, () => {
    console.log('='.repeat(72));
    console.log('Nebula Cafe resident analysis pipeline');
    console.log(`  board:    http://127.0.0.1:${PORT}/trace`);
    console.log(`  state:    http://127.0.0.1:${PORT}/state`);
    console.log(`  stream:   http://127.0.0.1:${PORT}/events`);
    console.log(`  revision: ${initial.revision}`);
    console.log(`  findings: ${currentState.report.failures} failing / ${currentState.report.total} checks`);
    console.log('  open this URL in two tabs to verify live sync:');
    console.log(`    http://127.0.0.1:${PORT}/trace`);
    console.log('='.repeat(72));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
