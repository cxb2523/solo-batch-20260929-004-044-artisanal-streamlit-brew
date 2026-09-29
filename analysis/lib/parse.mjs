import { LineMap, extractPayload, byteLen, countAll, uniq } from "./util.mjs";

const HEX_RE = /#[0-9a-fA-F]{6}\b/g;

function excerpt(text, index, len = 140) {
  const lineStart = text.lastIndexOf("\n", index) + 1;
  let lineEnd = text.indexOf("\n", index);
  if (lineEnd < 0) lineEnd = text.length;
  let line = text.slice(lineStart, lineEnd);
  if (line.length > len) {
    const offset = Math.max(0, index - lineStart - 40);
    line = "…" + line.slice(offset, offset + len) + "…";
  }
  return line.trim();
}

// index.html: parse BOTH layers — the static shell and the decoded payload.
export function parseIndex(shell) {
  const shellMap = new LineMap(shell);
  const titleM = shell.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const chunkCount = (shell.match(/id="zxlwhXiv\d+"/g) || []).length;
  const keyM = shell.match(/atob\('([A-Za-z0-9+/=]+)'\)/);

  const payload = extractPayload(shell);
  if (!payload) {
    return {
      kind: "index", ok: false, reason: "payload chunks missing or unreadable",
      shellBytes: byteLen(shell), shellTitle: titleM ? titleM[1] : "",
    };
  }
  const { decoded, chunkLines } = payload;
  const map = new LineMap(decoded);
  const at = (needle) => {
    const idx = decoded.indexOf(needle);
    if (idx < 0) return null;
    return { line: map.lineAt(idx), excerpt: excerpt(decoded, idx) };
  };
  const atAll = (needle) => {
    const out = [];
    let from = 0, idx;
    while ((idx = decoded.indexOf(needle, from)) >= 0) {
      out.push({ line: map.lineAt(idx), excerpt: excerpt(decoded, idx) });
      from = idx + needle.length;
    }
    return out;
  };

  const m1 = decoded.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDesc = decoded.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
  const langM = decoded.match(/<html[^>]*\blang="([^"]+)"/i);
  const h1M = decoded.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const stripTags = (s) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

  const statBlocks = [...decoded.matchAll(
    /<div class="stat">\s*<div class="label">([^<]+)<\/div>\s*<div class="value">([\s\S]*?)<\/div>\s*<\/div>/g
  )].map((mm) => ({
    label: mm[1],
    raw: mm[2],
    text: stripTags(mm[2]),
    line: map.lineAt(mm.index),
    excerpt: excerpt(decoded, mm.index),
  }));

  const anchors = [...decoded.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((mm) => ({
    href: mm[1],
    text: stripTags(mm[2]),
    line: map.lineAt(mm.index),
    excerpt: excerpt(decoded, mm.index),
  }));
  const externalHref = uniq(anchors.map((a) => a.href).filter((h) => /^https?:/.test(h)));

  const inlineScripts = [...decoded.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((mm) => {
    const targetM = mm[2].match(/TARGET\s*=\s*"([^"]+)"/);
    const delayM = mm[2].match(/REDIRECT_MS\s*=\s*(\d+)/);
    return {
      line: map.lineAt(mm.index),
      bytes: byteLen(mm[2]),
      target: targetM ? targetM[1] : null,
      redirectMs: delayM ? Number(delayM[1]) : null,
      excerpt: excerpt(decoded, mm.index),
    };
  });

  // Inline SVG icons (whole document uses stroke=currentColor icon fragments).
  const inlineSvgs = [...decoded.matchAll(/<svg\b/g)].map((mm) => ({
    line: map.lineAt(mm.index),
    excerpt: excerpt(decoded, mm.index),
  }));

  // CSS variable tokens declared in :root.
  const rootM = decoded.match(/:root\s*\{([\s\S]*?)\}/);
  const cssVars = [];
  if (rootM) {
    for (const mm of rootM[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      cssVars.push({
        name: mm[1],
        value: mm[2].trim(),
        line: map.lineAt(rootM.index + mm.index),
      });
    }
  }
  const hardHex = [...decoded.matchAll(HEX_RE)].map((mm) => ({
    color: mm[0].toLowerCase(), line: map.lineAt(mm.index),
  }));

  // Visible security/marketing claims (h3 + p pairs inside cards).
  const cards = [...decoded.matchAll(/<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)].map((mm) => ({
    title: stripTags(mm[1]),
    body: stripTags(mm[2]),
    line: map.lineAt(mm.index),
    excerpt: excerpt(decoded, mm.index),
  }));

  const textVisible = decoded
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  const hashM = decoded.match(/([a-f0-9]{64})/i);
  const fileM = decoded.match(/release-[A-Za-z0-9._-]+\.zip/);

  return {
    kind: "index",
    ok: true,
    shellBytes: byteLen(shell),
    payloadBytes: byteLen(decoded),
    shell: {
      title: titleM ? titleM[1] : "",
      titleLine: titleM ? shellMap.lineAt(titleM.index) : null,
      titleExcerpt: titleM ? excerpt(shell, titleM.index) : "",
      chunkCount,
      chunkLines,
      keyLine: keyM ? shellMap.lineAt(keyM.index) : null,
      decoderLine: shellMap.firstLineOf("new TextDecoder"),
      evalLine: shellMap.firstLineOf("new Function"),
      innerHtmlLine: shellMap.firstLineOf("document.body.innerHTML=_b"),
      bootstrapBytes: [...shell.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
        .reduce((a, mm) => a + byteLen(mm[1]), 0),
    },
    doc: {
      title: m1 ? stripTags(m1[1]) : "",
      titleAt: m1 ? at(m1[0].slice(0, 10)) : null,
      description: metaDesc ? metaDesc[1] : "",
      lang: langM ? langM[1] : "",
      langAt: langM ? at(`lang="${langM[1]}"`) : null,
      h1: h1M ? stripTags(h1M[1]) : "",
      h1At: h1M ? at("<h1") : null,
      stats: statBlocks,
      anchors,
      externalHref,
      inlineScripts,
      inlineSvgCount: inlineSvgs.length,
      inlineSvgLines: inlineSvgs,
      cssVars,
      hardHexColors: uniq(hardHex.map((h) => h.color)),
      cards,
      sha256: hashM ? { value: hashM[1], line: map.lineAt(hashM.index), excerpt: excerpt(decoded, hashM.index) } : null,
      file: fileM ? { name: fileM[0], line: map.lineAt(fileM.index), excerpt: excerpt(decoded, fileM.index) } : null,
      leadAt: at('class="lead"'),
      pillAt: at('class="pill"'),
      textVisible,
      bytes: byteLen(decoded),
      lineCount: decoded.split("\n").length,
    },
  };
}

// Generic SVG parse used for both preview.svg and button.svg.
export function parseSvg(name, text) {
  const map = new LineMap(text);
  const find = (needle) => {
    const idx = text.indexOf(needle);
    return idx < 0 ? null : { line: map.lineAt(idx), excerpt: excerpt(text, idx) };
  };

  const vb = text.match(/viewBox="([^"]+)"/);
  const width = text.match(/\bwidth="([^"]+)"/);
  const height = text.match(/\bheight="([^"]+)"/);
  const texts = [...text.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)].map((mm) => {
    const idM = mm[1].match(/id="([^"]+)"/);
    return {
      id: idM ? idM[1] : null,
      text: mm[2].replace(/<[^>]+>/g, "").trim(),
      line: map.lineAt(mm.index),
      excerpt: excerpt(text, mm.index),
    };
  });
  const colors = uniq([...text.matchAll(HEX_RE)].map((m) => m[0].toLowerCase()));
  const colorSites = [...text.matchAll(HEX_RE)].map((mm) => ({
    color: mm[0].toLowerCase(), line: map.lineAt(mm.index),
  }));
  const defsVarRefs = (text.match(/var\(--[\w-]+\)/g) || []).length;
  const gradients = [...text.matchAll(/<linearGradient\s+id="([^"]+)"/g)].map((mm) => ({
    id: mm[1], line: map.lineAt(mm.index),
  }));
  const elementCount = (text.match(/<(rect|circle|path|line|polyline|polygon|ellipse|text|g|pattern)\b/g) || []).length;
  const refs = (needle) => {
    const out = [];
    let from = 0, idx;
    while ((idx = text.indexOf(needle, from)) >= 0) {
      out.push({ line: map.lineAt(idx), excerpt: excerpt(text, idx) });
      from = idx + needle.length;
    }
    return out;
  };

  return {
    kind: "svg",
    name,
    ok: text.trim().startsWith("<svg") && text.includes("</svg>"),
    bytes: byteLen(text),
    lineCount: text.split("\n").length,
    viewBox: vb ? vb[1] : "",
    width: width ? width[1] : "",
    height: height ? height[1] : "",
    texts,
    colors,
    colorSites,
    varRefs: defsVarRefs,
    gradients,
    elementCount,
    projectName: find("artisanal-streamlit-brew-metrics"),
    installerWord: find(">Installer<"),
    oneClick: find("One-click installer"),
    installSh: find("install.sh"),
    completeLine: find("Installation complete"),
    windows: find(">Windows<"),
    macos: find(">macOS<"),
    mit: find(">MIT<"),
    autoUpdate: find("Auto-Update"),
    openSource: find("Open Source"),
    downloadLatest: find("Download Latest"),
    refs,
  };
}

// README claim extraction: every claim keeps its line so diffs can cite it.
export function parseReadme(text) {
  const map = new LineMap(text);
  const claim = (re, transform = (m) => m[1]) => {
    const m = text.match(re);
    if (!m) return null;
    return {
      value: transform(m),
      line: map.lineAt(m.index),
      excerpt: excerpt(text, m.index),
    };
  };
  const allClaims = (re, transform = (m) => m[0]) =>
    [...text.matchAll(re)].map((m) => ({
      value: transform(m),
      line: map.lineAt(m.index),
      excerpt: excerpt(text, m.index),
    }));

  const links = allClaims(/(!?)\[[^\]]*\]\((https:\/\/[^)]+)\)/g, (m) => ({
    embed: m[1] === "!",
    url: m[2],
  }));
  const svgLinks = links.filter((l) => l.value.url.endsWith(".svg") || l.value.url.includes(".svg"));

  return {
    kind: "readme",
    bytes: byteLen(text),
    lineCount: text.split("\n").length,
    title: claim(/#\s+(.+)/),
    product: claim(/Welcome to \*\*([^*]+)\*\*/),
    forecastAccuracy: claim(/forecasts[^.]*?with (\d+)%\s*accuracy/i, (m) => Number(m[1])),
    wasteReduction: claim(/reduce waste by up to (\d+)%/i, (m) => Number(m[1])),
    forecastDays: claim(/forecasts customer count (\d+) days? ahead/i, (m) => Number(m[1])),
    languages: claim(/Multilingual UI \(([^)]+)\)/i, (m) =>
      m[1].split(",").map((s) => s.trim())),
    noJsLibraries: claim(/(no JavaScript libraries)/i),
    pythonVersion: claim(/Python (\d+\.\d+\+?)/),
    localOnly: claim(/(zero cloud uploads by default)/i),
    noWizard: claim(/(No installation wizards)/i),
    offline: claim(/\| (Offline Mode) \|/),
    bot: claim(/(24\/7 automated support bot)/i),
    license: claim(/Licensed under the \*\*(MIT License)\*\*/),
    busiestHour: claim(/busiest hour is (\d+ ?[AP]M)/i),
    svgLinks,
    links,
    metrics: allClaims(/\b(\d+(?:\.\d+)?)(?:%| days?| MB| minutes?)\b/gi, (m) => m[0]),
  };
}

export { countAll };
