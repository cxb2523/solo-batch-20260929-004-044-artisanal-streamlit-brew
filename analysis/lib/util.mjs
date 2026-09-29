import { readFile } from "node:fs/promises";

// XOR key hard-coded by the index.html bootstrap (line 13).
export const XOR_KEY_B64 = "H7JPnij/qDB+mbPssTGSn4JcPzmEZaqKsJVITTEVAoY=";
export const PAYLOAD_CHUNKS = 7;

// Split text once and answer char-index / 1-based line questions in O(1-ish).
export class LineMap {
  constructor(text) {
    this.text = text;
    this.starts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\n") this.starts.push(i + 1);
    }
  }
  lineAt(index) {
    let lo = 0, hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= index) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  }
  lineText(line) {
    return this.text.split("\n")[line - 1] ?? "";
  }
  firstLineOf(needle, from = 0) {
    const idx = this.text.indexOf(needle, from);
    return idx < 0 ? null : this.lineAt(idx);
  }
}

// Read with a single retry: editors that write non-atomically briefly expose a
// truncated/partial file. Wait one tick, re-read once, then give up.
export async function readFileOnceRetry(file, delayMs = 120) {
  try {
    return await readFile(file, "utf8");
  } catch (firstErr) {
    await new Promise((r) => setTimeout(r, delayMs));
    try {
      return await readFile(file, "utf8");
    } catch {
      throw firstErr;
    }
  }
}

// Validate that a blob is not a half-written write; same retry policy applies.
export async function readCompleteFile(file, validate, delayMs = 120) {
  let text = await readFileOnceRetry(file, delayMs);
  let verdict = validate(text);
  if (verdict.ok) return text;
  await new Promise((r) => setTimeout(r, delayMs));
  text = await readFileOnceRetry(file, delayMs);
  verdict = validate(text);
  if (!verdict.ok) {
    const err = new Error(`partial read: ${file}: ${verdict.reason}`);
    err.partial = true;
    throw err;
  }
  return text;
}

// Recover the hidden payload exactly like the browser bootstrap does.
export function extractPayload(shellHtml) {
  const key = Buffer.from(XOR_KEY_B64, "base64");
  let b64 = "";
  const chunkLines = [];
  for (let i = 0; i < PAYLOAD_CHUNKS; i++) {
    const m = shellHtml.match(
      new RegExp('id="zxlwhXiv' + i + '"[^>]*>([^<]*)</div>', "i")
    );
    if (!m) return null;
    chunkLines.push(shellLineOfMatch(shellHtml, m.index));
    b64 += m[1];
  }
  let raw;
  try { raw = Buffer.from(b64, "base64"); } catch { return null; }
  const out = Buffer.alloc(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw[i] ^ key[i % key.length];
  const decoded = out.toString("utf8");
  return { decoded, chunkLines };
}

function shellLineOfMatch(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === "\n") line++;
  return line;
}

export const byteLen = (s) => Buffer.byteLength(s, "utf8");

export function stats(samples) {
  const n = samples.length;
  if (!n) return { n: 0, mean: 0, variance: 0, stddev: 0, p95: 0, min: 0, max: 0 };
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const sorted = [...samples].sort((a, b) => a - b);
  const p95 = sorted[Math.min(n - 1, Math.floor(0.95 * n))];
  return { n, mean, variance, stddev: Math.sqrt(variance), p95, min: sorted[0], max: sorted[n - 1] };
}

export function round(x, p = 2) {
  const f = 10 ** p;
  return Math.round(x * f) / f;
}

export function fmtMs(x) {
  if (x >= 1) return `${round(x, 2)} ms`;
  return `${round(x * 1000, 1)} µs`;
}

export const uniq = (arr) => [...new Set(arr)];

// count occurrences, regex never global-created inside hot loops needlessly
export function countAll(text, re) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  return [...text.matchAll(g)];
}
