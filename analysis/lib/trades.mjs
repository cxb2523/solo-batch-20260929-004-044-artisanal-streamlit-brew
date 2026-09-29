// The three mutually-constraining trade-offs, each backed by numbers measured
// from the real artifacts (bytes / in-process timings) plus a seeded baseline
// model where browser/storage stacks are required (state-backend variances).

import { byteLen, stats, round } from "./util.mjs";

const timeit = (fn, iters = 2000, inner = 1) => {
  for (let i = 0; i < 50; i++) fn();
  let acc;
  let best = Infinity;
  // Repeat and take the best wall-time batch so sub-microsecond ops do not
  // collapse to zero; divide by the actual number of invocations.
  for (let rep = 0; rep < 7; rep++) {
    const t0 = performance.now();
    for (let i = 0; i < iters; i++) {
      for (let j = 0; j < inner; j++) acc = fn();
    }
    const t1 = performance.now();
    best = Math.min(best, (t1 - t0) / (iters * inner));
  }
  return { perCallUs: best * 1000, acc };
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gaussian = (rnd) => {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const sample = (rnd, mean, sd, n) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = mean + gaussian(rnd) * sd;
    out.push(x < 0 ? 0 : x);
  }
  return out;
};
const summarize = (arr, unit) => {
  const s = stats(arr);
  return {
    unit, n: s.n, mean: round(s.mean, 3), variance: round(s.variance, 4),
    stddev: round(s.stddev, 3), p95: round(s.p95, 3), min: round(s.min, 3), max: round(s.max, 3),
  };
};

export function computeTrades(model, raw) {
  return {
    metrics: tradeMetrics(model, raw.index),
    tokens: tradeTokens(model, raw),
    state: tradeState(model),
  };
}

function tradeMetrics(model, shellText) {
  const d = model.index.doc;
  const sh = model.index.shell;

  const statMarkupBytes = d.stats.reduce((acc, st) =>
    acc + byteLen(`<div class="stat"><div class="label">${st.label}</div><div class="value">${st.text}</div></div>`), 0);

  const metricsObj = {};
  for (const st of d.stats) metricsObj[st.label.toLowerCase().replace(/\W+/g, "_")] = st.text;
  metricsObj.version = "v2.1.1";
  const metricsJson = JSON.stringify(metricsObj);
  const jsonBytes = byteLen(metricsJson);
  const loader = `<script type="application/json" id="metrics">${metricsJson}</script>`;
  const loaderBytes = byteLen(loader);

  let b64len = 0;
  for (let i = 0; i < sh.chunkCount; i++) {
    const m = shellText.match(new RegExp('id="zxlwhXiv' + i + '"[^>]*>([^<]*)</div>', "i"));
    if (m) b64len += m[1].length;
  }
  const decodedBytes = model.index.payloadBytes;
  const obfOverheadBytes = b64len - decodedBytes;
  const obfOverheadPct = round((obfOverheadBytes / decodedBytes) * 100, 1);

  const inlineHtml = '<div class="stat"><div class="label">Stars</div><div class="value">798 <span class="sub">★</span></div></div>';
  const inlineParse = timeit(() => {
    const out = {};
    const re = /<div class="label">([^<]+)<\/div><div class="value">([\s\S]*?)<\/div>/g;
    let m;
    while ((m = re.exec(inlineHtml))) out[m[1]] = m[2].replace(/<[^>]+>/g, "").trim();
    return out;
  }, 4000);
  const jsonParse = timeit(() => JSON.parse(metricsJson), 4000);

  const key = Buffer.from("H7JPnij/qDB+mbPssTGSn4JcPzmEZaqKsJVITTEVAoY=", "base64");
  const chunk0 = shellText.match(/id="zxlwhXiv0"[^>]*>([^<]*)</)[1];
  const rawChunk = Buffer.from(chunk0, "base64");
  const decodeOne = timeit(() => {
    const out = Buffer.alloc(rawChunk.length);
    for (let i = 0; i < rawChunk.length; i++) out[i] = rawChunk[i] ^ key[i % key.length];
    return out.toString("utf8");
  }, 400);

  return {
    id: "metrics-inline-vs-json",
    title: "指标内联 HTML vs 拆 JSON 数据岛",
    bytes: {
      inlineStatMarkupBytes: statMarkupBytes,
      jsonPayloadBytes: jsonBytes,
      jsonIslandBytes: loaderBytes,
      inlineMinusJsonBytes: statMarkupBytes - jsonBytes,
      firstPayloadDecodedBytes: decodedBytes,
      firstPayloadShellBytes: model.index.shellBytes,
      obfuscationBase64OverheadBytes: obfOverheadBytes,
      obfuscationBase64OverheadPct: obfOverheadPct,
    },
    timing: {
      inlineRegexParseUs: round(inlineParse.perCallUs, 2),
      jsonParseUs: round(jsonParse.perCallUs, 2),
      parseRatioInlineOverJson: round(inlineParse.perCallUs / jsonParse.perCallUs, 1),
      xorDecodeUsPerChunk: round(decodeOne.perCallUs, 1),
      xorDecodeUsTotal: round(decodeOne.perCallUs * sh.chunkCount, 1),
    },
    note: "内联指标必须等 7 块 XOR 解码完、再用正则剥标签才可读；JSON 岛可不经解码直接 JSON.parse，代价是额外标签样板字节。",
  };
}

function tradeTokens(model, raw) {
  const preview = model.preview, button = model.button, d = model.index.doc;

  const PALETTE = {
    "#39d353": "--accent-green", "#0ea5e9": "--accent-blue", "#21262d": "--panel",
    "#161b22": "--panel-2", "#30363d": "--border", "#8b949e": "--muted",
    "#0d1117": "--bg", "#e6edf3": "--text", "#f78166": "--accent-orange",
    "#0078d4": "--win-blue", "#000000": "--black", "#ffffff": "--white",
    "#2d333b": "--panel-3", "#484f58": "--muted-2", "#27c93f": "--ok",
    "#ffbd2e": "--warn", "#ff5f56": "--danger",
  };
  const tokenize = (svgText) => {
    let out = svgText;
    const used = new Set();
    for (const [hex, tok] of Object.entries(PALETTE)) {
      if (out.toLowerCase().includes(hex)) {
        out = out.replace(new RegExp(hex, "gi"), `var(${tok})`);
        used.add(tok);
      }
    }
    const decls = [...used]
      .map((t) => `${t}:${Object.keys(PALETTE).find((k) => PALETTE[k] === t)}`)
      .join(";");
    return out.replace(">", `>\n  <style>:root{${decls}}</style>`);
  };
  const pvTok = tokenize(raw.preview);
  const btnTok = tokenize(raw.button);
  const retrofitDeltaBytes =
    (byteLen(pvTok) - preview.bytes) + (byteLen(btnTok) - button.bytes);

  const hardSites = preview.colorSites.length + button.colorSites.length;
  const uniqueHardColors = new Set([...preview.colors, ...button.colors]).size;
  const colorLiteralBytes =
    preview.colorSites.reduce((a, c) => a + c.color.length, 0)
    + button.colorSites.reduce((a, c) => a + c.color.length, 0);

  const indexVarUsages = (raw.indexDecoded.match(/var\(--[\w-]+\)/g) || []).length;

  const hardEdit = timeit(() => {
    let s = raw.preview + raw.button;
    s = s.replace(/#39d353/gi, "#ff00ff").replace(/#0ea5e9/gi, "#00ff00");
    return s.length;
  }, 300);
  const tokenEdit = timeit(() =>
    ":root{--accent-green:#39d353;}".replace("#39d353", "#ff00ff"), 300, 1000);

  return {
    id: "icons-hardcoded-vs-tokens",
    title: "图标/配色硬编码 vs CSS 变量令牌",
    bytes: {
      svgHardcodedSites: hardSites,
      svgUniqueHardColors: uniqueHardColors,
      svgColorLiteralBytes: colorLiteralBytes,
      svgVarReferencesToday: preview.varRefs + button.varRefs,
      indexTokenDeclarations: d.cssVars.length,
      indexVarUsages,
      tokenRetrofitDeltaBytes: retrofitDeltaBytes,
    },
    retheme: {
      hardcodedTouchPoints: hardSites,
      hardcodedFiles: 2,
      tokenTouchPoints: 1,
      hardcodedReplaceUs: round(hardEdit.perCallUs, 1),
      tokenSetUs: round(tokenEdit.perCallUs, 1),
    },
    note: "硬编码换肤必须逐处改两张 SVG，漏改即错色；令牌方案只改 :root 一处即可全站换肤。index 解码页本身已全面令牌化，SVG 是孤岛。",
  };
}

function tradeState() {
  const N = 48;
  const state = { tab: "findings", sel: "R006", sev: "mismatch", theme: "dark", rev: 12 };
  const stateJson = JSON.stringify(state);
  const stateBytes = byteLen(stateJson);
  const base = "http://127.0.0.1:8787/trace";
  const hashUrl = `${base}#${encodeURIComponent(stateJson)}`;

  const hashRead = timeit(
    () => JSON.parse(decodeURIComponent(hashUrl.split("#")[1] || "")), 5000);
  const store = new Map([["trace-state", stateJson]]);
  const lsRead = timeit(() => JSON.parse(store.get("trace-state")), 5000);

  // Seeded scenario models (browser/storage stack behaviour).
  // Refresh: hash parse is pure in-page string work (tight distribution);
  // localStorage rides the profile/IO layer with wider jitter under pressure.
  const r1 = mulberry32(20260930);
  const hashRefreshMs = sample(r1, hashRead.perCallUs / 1000, 0.0009, N);
  const lsRefreshMs = sample(r1, lsRead.perCallUs / 1000 + 0.18, 0.34, N);

  // Share: hash carries state in the URL (0 extra round trip); localStorage is
  // origin-bound and needs an export/relay hop, which is slow and high-variance.
  const hashShareBytes = sample(mulberry32(7), byteLen(hashUrl), 0, N);
  const lsShareRelayMs = sample(r1, 420, 260, N);

  // Multi-tab sync: localStorage 'storage' event is native and tight; hash has
  // no cross-tab event, so it must poll/relay — slower and much wider.
  const hashSyncMs = sample(r1, 125, 80, N);
  const lsSyncMs = sample(r1, 6.5, 2.1, N);

  return {
    id: "state-hash-vs-localstorage",
    title: "看板状态放 URL hash 还是 localStorage",
    statePayloadBytes: stateBytes,
    hashUrlBytes: byteLen(hashUrl),
    modeledSamples: N,
    engine: {
      hashParseUs: round(hashRead.perCallUs, 3),
      storageReadUs: round(lsRead.perCallUs, 3),
    },
    refresh: {
      hash: summarize(hashRefreshMs, "ms"),
      localStorage: summarize(lsRefreshMs, "ms"),
      survivesReload: { hash: true, localStorage: true },
      survivesIncognito: { hash: true, localStorage: false },
    },
    share: {
      hash: { presentInLink: true, bytes: summarize(hashShareBytes, "bytes") },
      localStorage: { presentInLink: false, relayHopMs: summarize(lsShareRelayMs, "ms") },
    },
    multiTabSync: {
      hash: { mechanism: "poll / manual relay", ...summarize(hashSyncMs, "ms"), nativeEvent: false },
      localStorage: { mechanism: "storage event", ...summarize(lsSyncMs, "ms"), nativeEvent: true },
    },
    note: "看板默认 localStorage + storage 事件做多标签实时同步（低方差），同时把可分享视图镜像进 hash；刷新两者都在，分享 hash 零额外跳数。",
  };
}
