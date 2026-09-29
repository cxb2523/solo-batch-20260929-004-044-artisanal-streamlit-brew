// Resident analysis dashboard server.
//   GET  /trace                 dashboard UI
//   GET  /trace/state           latest analysis snapshot (JSON)
//   GET  /trace/events          Server-Sent Events stream (one push per change)
//   POST /trace/telemetry       real browser timings from open tabs
//   GET  /trace/source?file=..  raw source (for the click-to-source view)
//   GET  /preview.svg|button.svg|index.html|README.md   the artifacts themselves
//
// Duplicate-render guarantees:
//  * the watcher pushes at most once per distinct (mtime,size) change;
//  * each revision is broadcast to every SSE client exactly once;
//  * clients render a revision only if rev > lastRenderedRev (server echoes
//    the same monotonic rev to every tab, so N tabs never double-render).

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createWatcher } from "./watch.mjs";
import { dashboardHtml } from "./lib/dashboard.mjs";
import { extractPayload } from "./lib/util.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = process.env.TRACE_ROOT ? normalize(process.env.TRACE_ROOT) : process.cwd();
const PORT = Number(process.env.TRACE_PORT || 8787);
const HOST = process.env.TRACE_HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".md": "text/markdown; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const ALLOWED_SOURCE = new Set(["index.html", "preview.svg", "button.svg", "README.md"]);

const clients = new Set();
let telemetry = {
  tabsSeen: 0,
  renderByTab: {}, // tabId -> count of rendered revisions
  storageSync: [], // {tabId, ms} measured cross-tab storage-event lag
  hashSync: [],    // {tabId, ms} measured hash relay/poll lag
  pushes: 0,
};

function sseBroadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (c) => { buf += c; if (buf.length > 1e6) req.destroy(); });
    req.on("end", () => {
      try { resolve(JSON.parse(buf || "{}")); } catch { resolve({}); }
    });
  });
}

async function serveSource(fileName, res, query) {
  if (!ALLOWED_SOURCE.has(fileName)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  let text = await readFile(join(ROOT, fileName), "utf8");
  if (fileName === "index.html" && query.get("decoded") !== null) {
    const payload = extractPayload(text);
    if (!payload) {
      res.writeHead(409).end("payload not decodable");
      return;
    }
    text = payload.decoded;
  }
  if (query.get("raw") !== null) {
    res.writeHead(200, { "content-type": MIME[extname(fileName)] || "text/plain" });
    res.end(text);
    return;
  }
  // JSON envelope with per-line array so the dashboard can highlight + jump.
  const lines = text.split("\n").map((content, i) => ({ n: i + 1, content }));
  res.writeHead(200, { "content-type": MIME[".json"], "cache-control": "no-store" });
  res.end(JSON.stringify({ file: fileName, lines }));
}

async function handle(req, res) {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;

  if (p === "/trace" || p === "/trace/") {
    res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" });
    res.end(dashboardHtml({ port: PORT, state: watcher.getState(), telemetry }));
    return;
  }

  if (p === "/trace/state") {
    res.writeHead(200, { "content-type": MIME[".json"], "cache-control": "no-store" });
    res.end(JSON.stringify({ state: watcher.getState(), telemetry }));
    return;
  }

  if (p === "/trace/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    });
    res.write(`retry: 2000\n\n`);
    // Newly opened tab immediately gets the current revision once.
    res.write(`event: snapshot\ndata: ${JSON.stringify({ state: watcher.getState(), telemetry })}\n\n`);
    clients.add(res);
    const ka = setInterval(() => res.write(": ka\n\n"), 25000);
    req.on("close", () => { clearInterval(ka); clients.delete(res); });
    return;
  }

  if (p === "/trace/telemetry" && req.method === "POST") {
    const body = await readBody(req);
    if (body.tabId) {
      telemetry.tabsSeen = Math.max(telemetry.tabsSeen, Object.keys(telemetry.renderByTab).length + 1);
      if (typeof body.renders === "number") telemetry.renderByTab[body.tabId] = body.renders;
      if (typeof body.storageSyncMs === "number") telemetry.storageSync.push({ tabId: body.tabId, ms: body.storageSyncMs });
      if (typeof body.hashSyncMs === "number") telemetry.hashSync.push({ tabId: body.tabId, ms: body.hashSyncMs });
      // Keep the rolling window bounded.
      if (telemetry.storageSync.length > 200) telemetry.storageSync.shift();
      if (telemetry.hashSync.length > 200) telemetry.hashSync.shift();
    }
    res.writeHead(204).end();
    return;
  }

  if (p === "/trace/source") {
    try {
      await serveSource(u.searchParams.get("file") || "", res, u.searchParams);
    } catch {
      res.writeHead(404).end("not found");
    }
    return;
  }

  // Serve the watched artifacts themselves so the page can show live previews.
  if (ALLOWED_SOURCE.has(p.replace(/^\//, ""))) {
    const name = p.replace(/^\//, "");
    try {
      const text = await readFile(join(ROOT, name), "utf8");
      res.writeHead(200, { "content-type": MIME[extname(name)] || "text/plain", "cache-control": "no-store" });
      res.end(text);
    } catch {
      res.writeHead(404).end("not found");
    }
    return;
  }

  if (p === "/" || p === "/index.html") {
    res.writeHead(302, { location: "/trace" }).end();
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" }).end("not found");
}

const watcher = createWatcher(ROOT);
watcher.on("update", (state) => {
  telemetry.pushes += 1;
  // One broadcast per revision. Identical mtime+size never produced a new rev.
  sseBroadcast("update", { state, telemetry });
});
watcher.on("error", (e) => sseBroadcast("error", e));

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(String(err && err.stack || err));
  });
});

await watcher.seed();
watcher.start();
server.listen(PORT, HOST, () => {
  const fm = watcher.getState().firstMismatch;
  console.log(`[trace] watching ${ROOT}`);
  console.log(`[trace] http://${HOST}:${PORT}/trace`);
  if (fm) console.log(`[trace] first mismatch -> ${fm.file}:${fm.line} (${fm.id})`);
});
