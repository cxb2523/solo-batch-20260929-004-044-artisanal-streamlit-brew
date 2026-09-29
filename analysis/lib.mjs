/**
 * Shared helpers for the resident analysis pipeline:
 * robust file reads (one mid-write retry), byte/UTF8 handling,
 * line lookup, and small statistics helpers.
 */
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

/**
 * Read a UTF-8 file. If the first read looks truncated or errors,
 * wait once and retry a single time before declaring failure.
 */
export async function readTextWithRetry(file, { retryDelayMs = 120 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const stat = await fs.stat(file);
      const handle = await fs.open(file, 'r');
      try {
        const buf = Buffer.alloc(stat.size);
        const { bytesRead } = await handle.read(buf, 0, stat.size, 0);
        if (bytesRead !== stat.size) {
          lastError = new Error(`short read for ${file}: ${bytesRead}/${stat.size}`);
          await sleep(retryDelayMs);
          continue;
        }
        const text = buf.toString('utf8');
        if (text.includes('\uFFFD')) {
          lastError = new Error(`undecodable bytes in ${file}`);
          await sleep(retryDelayMs);
          continue;
        }
        return { text, size: stat.size, mtimeMs: stat.mtimeMs };
      } finally {
        await handle.close();
      }
    } catch (err) {
      lastError = err;
      await sleep(retryDelayMs);
    }
  }
  throw lastError;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 1-based line number of a character offset inside text. */
export function lineAt(text, offset) {
  let line = 1;
  const end = Math.max(0, Math.min(offset, text.length));
  for (let i = 0; i < end; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

export function lineSlice(text, lineNo) {
  const lines = text.split(/\r?\n/);
  return (lines[lineNo - 1] ?? '').trim();
}

/** Find the 1-based line number of the first line matching a predicate. */
export function findLine(text, predicate) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (predicate(lines[i], i + 1)) return i + 1;
  }
  return null;
}

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Population standard deviation in ms (shown as the "variance" figure). */
export function stddev(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - avg) ** 2)));
}

export function hrtimeMs(start) {
  const [seconds, nanos] = process.hrtime(start);
  return seconds * 1000 + nanos / 1e6;
}

export function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
