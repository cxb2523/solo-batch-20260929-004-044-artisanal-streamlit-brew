/**
 * Resident incremental watcher for index.html, preview.svg, button.svg
 * (README.md is watched as the reconciliation contract).
 *
 * Guarantees:
 *  - a torn/partial read is retried exactly once before being reported as failed;
 *  - duplicate change events with the same mtimeMs + size collapse into one;
 *  - a parse is emitted only when the content signature actually changes;
 *  - incremental: only files whose signature changed are re-parsed.
 */
import { watch } from 'node:fs';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { readTextWithRetry, sha256 } from './lib.mjs';
import { parseIndex, parseSvg, parseReadme } from './parse.mjs';

export const WATCHED = ['index.html', 'preview.svg', 'button.svg', 'README.md'];

const PARSERS = {
  'index.html': (text) => parseIndex(text),
  'preview.svg': (text) => parseSvg('preview.svg', text),
  'button.svg': (text) => parseSvg('button.svg', text),
  'README.md': (text) => parseReadme(text),
};

export class PipelineWatcher extends EventEmitter {
  constructor(root = process.cwd(), { pollFallbackMs = 300, retryDelayMs = 120 } = {}) {
    super();
    this.root = root;
    this.pollFallbackMs = pollFallbackMs;
    this.retryDelayMs = retryDelayMs;
    this.signatures = new Map(); // file -> { mtimeMs, size, hash }
    this.documents = new Map(); // file -> parsed result
    this.pending = new Map(); // file -> coalesce timer
    this.stopped = false;
    this.fsWatcher = null;
    this.pollTimer = null;
    this.stats = { events: 0, reparses: 0, duplicatesSuppressed: 0, retries: 0, failures: 0 };
  }

  file(fileName) {
    return path.isAbsolute(fileName) ? fileName : path.join(this.root, fileName);
  }

  async scanFile(fileName) {
    let read;
    try {
      read = await readTextWithRetry(this.file(fileName), { retryDelayMs: this.retryDelayMs });
    } catch (err) {
      this.stats.failures++;
      this.emit('readError', { file: fileName, error: err.message, retried: true });
      return null;
    }
    const signature = {
      mtimeMs: Math.round(read.mtimeMs),
      size: read.size,
      hash: sha256(read.text),
    };
    const previous = this.signatures.get(fileName);

    // Same mtime + size event: collapse, even before hashing (that is the dedup rule).
    if (previous && previous.mtimeMs === signature.mtimeMs && previous.size === signature.size) {
      this.stats.duplicatesSuppressed++;
      this.emit('duplicate', { file: fileName, ...signature });
      return null;
    }

    // mtime/size differ but content is byte-identical: do not reparse or push.
    if (previous && previous.hash === signature.hash) {
      this.signatures.set(fileName, signature);
      this.stats.duplicatesSuppressed++;
      this.emit('unchanged', { file: fileName, ...signature });
      return null;
    }

    let parsed;
    try {
      parsed = PARSERS[fileName](read.text);
    } catch (err) {
      this.stats.failures++;
      this.emit('parseError', { file: fileName, error: err.message });
      return null;
    }

    this.signatures.set(fileName, signature);
    this.documents.set(fileName, parsed);
    this.stats.reparses++;
    return { file: fileName, signature, parsed };
  }

  async initialScan() {
    for (const fileName of WATCHED) {
      const result = await this.scanFile(fileName);
      if (result) this.emit('file', result);
    }
    return this.snapshot();
  }

  schedule(fileName) {
    if (!WATCHED.includes(fileName) || this.stopped) return;
    this.stats.events++;
    if (this.pending.has(fileName)) return; // debounce editor save storms
    this.pending.set(fileName, setTimeout(() => {
      this.pending.delete(fileName);
      this.scanFile(fileName)
        .then((result) => {
          if (result) this.emit('change', result);
        })
        .catch((err) => this.emit('error', err));
    }, 60));
  }

  snapshot() {
    return {
      generatedAt: new Date().toISOString(),
      index: this.documents.get('index.html'),
      preview: this.documents.get('preview.svg'),
      button: this.documents.get('button.svg'),
      readme: this.documents.get('README.md'),
    };
  }

  start() {
    try {
      this.fsWatcher = watch(this.root, { persistent: true }, (_event, filename) => {
        if (filename) this.schedule(path.basename(filename));
      });
      this.fsWatcher.on('error', (err) => this.emit('error', err));
    } catch {
      // Polling fallback for platforms without native fs events.
      this.pollTimer = setInterval(() => this.poll(), this.pollFallbackMs);
    }
    // Always run a cheap stat poll as belt-and-braces on Windows editors,
    // but scanFile's signature dedup guarantees a single push.
    this.pollTimer = setInterval(() => this.poll(), this.pollFallbackMs * 4);
    return this;
  }

  async poll() {
    for (const fileName of WATCHED) {
      try {
        const { stat } = await import('node:fs/promises');
        const info = await stat(this.file(fileName));
        const previous = this.signatures.get(fileName);
        if (!previous || Math.round(info.mtimeMs) !== previous.mtimeMs || info.size !== previous.size) {
          this.schedule(fileName);
        }
      } catch (err) {
        this.emit('readError', { file: fileName, error: err.message, retried: false });
      }
    }
  }

  stop() {
    this.stopped = true;
    if (this.fsWatcher) this.fsWatcher.close();
    if (this.pollTimer) clearInterval(this.pollTimer);
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }
}

// CLI: `node analysis/watch.mjs` prints a JSON line per real change.
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  const watcher = new PipelineWatcher().start();
  watcher.on('file', ({ file }) => console.log(`[initial] ${file}`));
  watcher.on('change', ({ file, signature }) => {
    console.log(JSON.stringify({ event: 'change', file, size: signature.size, mtimeMs: signature.mtimeMs, hash: signature.hash.slice(0, 12) }));
  });
  watcher.on('duplicate', ({ file }) => console.log(JSON.stringify({ event: 'duplicate-suppressed', file })));
  watcher.on('readError', (payload) => console.log(JSON.stringify({ event: 'read-error', ...payload })));
  await watcher.initialScan();
  console.log('[watch] pipeline resident — edit index.html / preview.svg / button.svg / README.md');
}
