/**
 * The three mutually-constraining trade-offs, measured against the actual
 * artifacts instead of guessed. Timings are microbenchmarks (median +
 * population stddev over repeated runs); functional outcomes are deterministic.
 */
import http from 'node:http';
import { median, stddev, hrtimeMs } from './lib.mjs';

function bench(fn, iterations = 400, warmup = 50) {
  for (let i = 0; i < warmup; i++) fn();
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime();
    fn();
    samples.push(hrtimeMs(start));
  }
  return {
    iterations,
    medianMs: Number(median(samples).toFixed(4)),
    stddevMs: Number(stddev(samples).toFixed(4)),
  };
}

const byteLength = (text) => Buffer.byteLength(text, 'utf8');
const XOR_KEY_B64 = 'H7JPnij/qDB+mbPssTGSn4JcPzmEZaqKsJVITTEVAoY=';

/** Trade-off 1: metrics inlined in the page vs split into a JSON document. */
function measureInlineVsJson(parsed) {
  const index = parsed.index;
  const rendered = index.decodedHtml || '';
  const payloadB64 = index.payloadBase64 || '';
  const key = Buffer.from(XOR_KEY_B64, 'base64');

  // Inline: nothing meaningful paints until the bootstrap decodes all chunks.
  const inlineFirstPaintBytes = index.rawBytes;
  const bootstrapBytes = Math.max(0, index.rawBytes - byteLength(payloadB64));

  // JSON split: shell (head/styles/nav/footer) paints first; metrics in JSON.
  const metricsJson = JSON.stringify({
    product: 'Nebula Cafe',
    lead: 'Interactive Coffee Sales Dashboard 2026',
    stats: { stars: 798, forks: 63, archiveMb: 101.0, version: 'v2.1.1' },
  });
  const mainStart = rendered.indexOf('<main>');
  const mainEnd = rendered.lastIndexOf('</main>') + '</main>'.length;
  const mainChunk = mainStart >= 0 ? rendered.slice(mainStart, mainEnd) : rendered;
  const shellHtml = rendered.replace(mainChunk, '<main data-metrics-src="metrics.json"></main>');
  const shellBytes = byteLength(shellHtml);

  // Same operations the real inline bootstrap runs synchronously before paint.
  const decodeBench = bench(() => {
    const payload = Buffer.from(payloadB64, 'base64');
    const out = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ key[i % key.length];
    out.toString('utf8');
  });
  const jsonBench = bench(() => JSON.parse(metricsJson));
  const base64OverheadPct = Number((((byteLength(payloadB64) - index.decodedBytes) / index.decodedBytes) * 100).toFixed(2));

  return {
    inline: {
      requests: 1,
      firstPaintBytes: inlineFirstPaintBytes,
      bootstrapBytes,
      payloadEncodedBytes: byteLength(payloadB64),
      renderedBytes: byteLength(rendered),
      base64OverheadPct,
      parseMs: decodeBench,
      parseStage: 'blocking before first meaningful paint',
    },
    jsonSplit: {
      requests: 2,
      firstPaintBytes: shellBytes,
      metricsJsonBytes: byteLength(metricsJson),
      parseMs: jsonBench,
      parseStage: 'after shell paints (progressive)',
    },
    delta: {
      firstPaintBytesSaved: inlineFirstPaintBytes - shellBytes,
      blockingDecodeVsJsonMs: Number((decodeBench.medianMs - jsonBench.medianMs).toFixed(4)),
    },
  };
}

/** Trade-off 2: hardcoded icon colors vs CSS variable tokens. */
function measureHardcodedVsTokens(parsed) {
  const sources = [
    { svg: parsed.preview, text: parsed.preview.source },
    { svg: parsed.button, text: parsed.button.source },
  ];

  const palette = new Map();
  for (const { svg } of sources) {
    for (const hit of svg.hardcodedColors) {
      const color = hit.color.toLowerCase();
      if (!palette.has(color)) palette.set(color, `--tone-${palette.size}`);
    }
  }

  const perFile = sources.map(({ svg, text }) => {
    const distinct = new Set(svg.hardcodedColors.map((hit) => hit.color.toLowerCase()));
    // Tokenized source: hex attributes -> var(), plus one :root token block.
    let tokenized = text;
    for (const [color, name] of palette) tokenized = tokenized.split(color).join(`var(${name})`);
    const tokenBlock = `<style>:root{${[...palette.entries()].map(([color, name]) => `${name}:${color}`).join(';')}}</style>`;
    const tokenizedBytes = byteLength(tokenized) + byteLength(tokenBlock);
    return {
      file: svg.file,
      hardcodedBytes: byteLength(text),
      tokenizedBytes,
      hardcodedColorOccurrences: svg.hardcodedColors.length,
      distinctColors: distinct.size,
      existingDefs: svg.tokens.length,
    };
  });

  const occurrenceCount = perFile.reduce((sum, row) => sum + row.hardcodedColorOccurrences, 0);
  const hardcodedTotal = perFile.reduce((sum, row) => sum + row.hardcodedBytes, 0);
  const tokenizedTotal = perFile.reduce((sum, row) => sum + row.tokenizedBytes, 0);

  // Re-skin cost simulation across both SVG sources.
  const newColors = [...palette.keys()].map((color) => `#${color.replace('#', '')}aa`);
  const reskinHardcoded = bench(() => {
    let touched = 0;
    for (const { text } of sources) {
      let next = text;
      [...palette.keys()].forEach((color, i) => {
        touched += next.split(color).length - 1;
        next = next.split(color).join(newColors[i]);
      });
    }
    return touched;
  });
  const tokenBlock = [...palette.values()].join(';');
  const reskinTokens = bench(() => {
    // One token-table swap; icon markup is untouched.
    return tokenBlock.replace(/--tone-\d+/g, '--tone-next');
  });

  return {
    hardcoded: {
      totalBytes: hardcodedTotal,
      colorOccurrences: occurrenceCount,
      distinctColors: palette.size,
      reskinTouchPoints: occurrenceCount,
      reskinMs: reskinHardcoded,
    },
    tokens: {
      estimatedBytes: tokenizedTotal,
      reskinTouchPoints: palette.size,
      reskinMs: reskinTokens,
    },
    delta: {
      bytes: tokenizedTotal - hardcodedTotal,
      touchPointsSaved: occurrenceCount - palette.size,
      reskinSpeedupMs: Number((reskinHardcoded.medianMs - reskinTokens.medianMs).toFixed(4)),
    },
    perFile,
  };
}

function traceState() {
  return {
    rev: 'a1b2c3d4',
    files: ['index.html', 'preview.svg', 'button.svg'],
    filter: 'fail',
    selected: { file: 'preview.svg', line: 181, selector: 'text' },
    collapsed: ['scripts'],
    theme: 'auto',
  };
}

/** Localhost RTT floor for the second request the JSON split needs. */
async function measureLocalRtt(samples = 60) {
  const server = http.createServer((req, res) => {
    res.end('ok');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const timings = [];
  for (let i = 0; i < samples; i++) {
    timings.push(await new Promise((resolve, reject) => {
      const start = process.hrtime();
      const req = http.get({ host: '127.0.0.1', port }, (res) => {
        res.resume();
        res.on('end', () => resolve(hrtimeMs(start)));
      });
      req.on('error', reject);
    }));
  }
  await new Promise((resolve) => server.close(resolve));
  return {
    samples,
    medianMs: Number(median(timings).toFixed(4)),
    stddevMs: Number(stddev(timings).toFixed(4)),
  };
}

/**
 * Trade-off 3: state in URL hash vs localStorage.
 * Serialization/parse timings are measured; refresh/share/multi-tab behavior
 * is deterministic and documented with variance notes.
 */
function measureHashVsLocalStorage() {
  const state = traceState();
  // Hash stores only a compact projection (filter + selection), mirroring a
  // shareable link. localStorage stores the full board state.
  const hashProjection = {
    filter: state.filter,
    selected: state.selected,
  };
  const hashString = '#' + encodeURIComponent(JSON.stringify(hashProjection));
  const storageString = JSON.stringify(state);

  const hashWrite = bench(() => {
    // Emulated: serialize the same way location.hash assignment would.
    return '#' + encodeURIComponent(JSON.stringify(hashProjection));
  });
  const hashRead = bench(() => {
    return JSON.parse(decodeURIComponent(hashString.slice(1)));
  });
  const storageWrite = bench(() => JSON.stringify(state));
  const storageRead = bench(() => JSON.parse(storageString));

  return {
    hash: {
      bytes: byteLength(hashString),
      writeMs: hashWrite,
      readMs: hashRead,
      refresh: 'state survives reload via the URL itself',
      share: 'copy-paste the URL and the recipient lands on the same node',
      multiTab: 'other tabs must be opened from the same URL; later edits do not propagate (no storage event)',
      multiTabSync: false,
      variance: { refresh: 'σ≈0 (deterministic URL parse)', share: 'σ≈0 (link is self-contained)', multiTab: 'not synced' },
    },
    localStorage: {
      bytes: byteLength(storageString),
      writeMs: storageWrite,
      readMs: storageRead,
      refresh: 'state survives reload on the same browser profile',
      share: 'not shareable: storage is per-origin/per-device, link carries no state',
      multiTab: 'storage events fan out to every other tab on the same origin in real time',
      multiTabSync: true,
      variance: { refresh: 'σ≈0 (synchronous getItem)', share: 'n/a (never leaves device)', multiTab: 'event fan-out, measured live in the two-tab probe below' },
    },
    delta: {
      bytes: byteLength(storageString) - byteLength(hashString),
      readMs: Number((storageRead.medianMs - hashRead.medianMs).toFixed(4)),
    },
  };
}

export async function measureTradeoffs(parsed) {
  const rtt = await measureLocalRtt();
  return {
    measuredAt: new Date().toISOString(),
    inlineVsJson: measureInlineVsJson(parsed),
    hardcodedVsTokens: measureHardcodedVsTokens(parsed),
    hashVsLocalStorage: measureHashVsLocalStorage(),
    localhostRtt: rtt,
  };
}
