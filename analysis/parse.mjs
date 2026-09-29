/**
 * Incremental parser for the three artifacts (index.html, preview.svg, button.svg)
 * plus the README contract. index.html ships its real page XOR-encoded inside
 * hidden <div>s; we decode it so metrics/DOM/inline-script references point at
 * the rendered source, while raw bootstrap references keep index.html line numbers.
 */
import { lineAt, findLine, lineSlice } from './lib.mjs';

export const ARTIFACTS = ['index.html', 'preview.svg', 'button.svg'];

function matches(text, regex) {
  const out = [];
  let m;
  while ((m = regex.exec(text)) !== null) {
    out.push({ value: m[0], groups: m.slice(1), index: m.index, line: lineAt(text, m.index) });
  }
  return out;
}

function firstMatch(text, regex) {
  const m = regex.exec(text);
  if (!m) return null;
  return { value: m[0], groups: m.slice(1), index: m.index, line: lineAt(text, m.index) };
}

export function decodeIndex(rawHtml) {
  const keyMatch = /atob\('([^']+)'\)/.exec(rawHtml);
  if (!keyMatch) return { ok: false, reason: 'XOR key not found' };
  const key = Buffer.from(keyMatch[1], 'base64');
  const chunks = {};
  const divRe = /id="(zxlwhXiv(\d))"[^>]*>([^<]*)<\/div>/g;
  let m;
  while ((m = divRe.exec(rawHtml))) chunks[Number(m[2])] = m[3];
  const ids = Object.keys(chunks).map(Number).sort((a, b) => a - b);
  if (!ids.length) return { ok: false, reason: 'encoded payload divs not found' };
  const joined = ids.map((id) => chunks[id]).join('');
  const payload = Buffer.from(joined, 'base64');
  const out = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ key[i % key.length];
  return {
    ok: true,
    html: out.toString('utf8'),
    chunkIds: ids,
    chunkCount: ids.length,
    encodedBytes: joined.length,
    payloadBase64: joined,
    decodedBytes: out.length,
    bootstrapLine: findLine(rawHtml, (line) => line.includes('atob(')),
  };
}

export function parseIndex(rawHtml) {
  const decoded = decodeIndex(rawHtml);
  const result = {
    file: 'index.html',
    source: rawHtml,
    rawBytes: Buffer.byteLength(rawHtml, 'utf8'),
    rawLines: rawHtml.split(/\r?\n/).length,
    decodedOk: decoded.ok,
    metrics: [],
    dom: [],
    scripts: [],
  };
  if (!decoded.ok) {
    result.decodeError = decoded.reason;
    return result;
  }
  const html = decoded.html;
  Object.assign(result, {
    decodedHtml: html,
    decodedBytes: decoded.decodedBytes,
    encodedBytes: decoded.encodedBytes,
    payloadBase64: decoded.payloadBase64,
    chunkCount: decoded.chunkCount,
    bootstrapLine: decoded.bootstrapLine,
  });

  const metric = (kind, key, value, raw, selector, line, detail = {}) =>
    result.metrics.push({ file: 'index.html', kind, key, value: value ?? raw, raw, selector, line, ...detail });
  const node = (selector, tag, line, snippet, refs = []) =>
    result.dom.push({ file: 'index.html', selector, tag, line, snippet, refs });

  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) metric('string', 'page.title', title.groups[0].trim(), title.value, 'title', title.line);

  const desc = firstMatch(html, /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i)
    || firstMatch(html, /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
  if (desc) metric('string', 'page.description', desc.groups[0], desc.value, 'meta[name=description]', desc.line);

  const h1 = firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) {
    const text = h1.groups[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    metric('string', 'page.h1', text, h1.groups[0], 'h1', h1.line);
  }

  const version = firstMatch(html, /<strong>\s*(v\d+\.\d+\.\d+)\s*<\/strong>/);
  if (version) metric('version', 'release.version', version.groups[0], version.groups[0], '.pill strong', version.line);

  const pill = firstMatch(html, /<span class="pill">[\s\S]*?<\/span>/);
  if (pill) {
    const channel = /stable\/([\w.]+)/.exec(pill.value);
    if (channel) metric('string', 'release.channel', channel[0], pill.value, '.pill', pill.line);
    const updated = /updated\s+([^<]+?)</.exec(pill.value);
    if (updated) metric('string', 'release.updated', updated[1].trim(), pill.value, '.pill', pill.line);
  }

  const fileName = firstMatch(html, /<div class="file-name">\s*([^<\n]+)/);
  if (fileName) metric('string', 'artifact.name', fileName.groups[0].trim(), fileName.groups[0].trim(), '.file-name', fileName.line);

  const fileSub = firstMatch(html, /<div class="file-sub">([^<]+)<\/div>/);
  if (fileSub) {
    metric('string', 'artifact.publisher', (fileSub.groups[0].split('/')[0] || '').trim(), fileSub.groups[0], '.file-sub', fileSub.line);
    const repo = /\/\s*([a-z0-9._-]+)\s*·/i.exec(fileSub.groups[0]);
    if (repo) metric('string', 'artifact.repo', repo[1], fileSub.groups[0], '.file-sub', fileSub.line);
    const size = /([\d.]+)\s*(MB|KB|GB)/i.exec(fileSub.groups[0]);
    if (size) metric('bytes', 'artifact.sizeMb', Number(size[1]), fileSub.groups[0], '.file-sub', fileSub.line, { unit: size[2] });
  }

  const hash = firstMatch(html, /<span class="hash">\s*([0-9a-f]{64})\s*<\/span>/i);
  if (hash) metric('hash', 'artifact.sha256', hash.groups[0], hash.groups[0], '.file-hash .hash', hash.line, { length: hash.groups[0].length });

  for (const stat of matches(html, /<div class="stat"><div class="label">([^<]+)<\/div><div class="value">([\s\S]*?)<\/div>/g)) {
    const label = stat.groups[0].trim();
    const valueHtml = stat.groups[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const numeric = /([\d.]+)/.exec(valueHtml);
    metric(numeric ? 'number' : 'string', `stat.${label.toLowerCase()}`, numeric ? Number(numeric[1]) : valueHtml, valueHtml, '.stats .stat', stat.line, { label });
  }

  const lead = firstMatch(html, /<p class="lead">([^<]+)<\/p>/);
  if (lead) metric('string', 'marketing.lead', lead.groups[0].trim(), lead.groups[0], '.lead', lead.line);

  for (const link of matches(html, /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>/g)) {
    const href = link.groups[0];
    try {
      metric('url', 'link.href', new URL(href).hostname, href, 'a[href]', link.line, { href });
    } catch { /* malformed */ }
  }

  // Inline scripts in the rendered document (the payload's own behavior).
  for (const block of matches(html, /<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = block.groups[0] || '';
    const code = block.groups[1] || '';
    if (!code.trim()) continue;
    const target = /TARGET\s*=\s*["']([^"']+)["']/.exec(code);
    const redirect = /REDIRECT_MS\s*=\s*(\d+)/.exec(code);
    const scriptRec = {
      file: 'index.html',
      line: block.line,
      selector: 'script',
      snippet: code.trim().split(/\r?\n/).slice(0, 14).join('\n'),
      chars: code.length,
      external: /\bsrc\s*=/.test(attrs),
      redirectTarget: target ? target[1] : null,
      redirectMs: redirect ? Number(redirect[1]) : null,
    };
    result.scripts.push(scriptRec);
    if (target) {
      metric('url', 'script.redirectTarget', target[1], target[0], 'script',
        lineAt(html, block.index + code.indexOf(target[0])), { scriptLine: scriptRec.line });
    }
    if (redirect) {
      metric('number', 'script.redirectMs', Number(redirect[1]), redirect[0], 'script',
        lineAt(html, block.index + code.indexOf(redirect[0])), { scriptLine: scriptRec.line });
    }
  }

  // Clickable DOM nodes: selectors map to rendered source lines.
  node('title', 'title', title ? title.line : 1, title ? title.value.trim() : '');
  node('.pill', 'span', pill ? pill.line : 1, pill ? pill.value : '');
  if (fileName) node('.file-name', 'div', fileName.line, fileName.groups[0].trim());
  if (fileSub) node('.file-sub', 'div', fileSub.line, fileSub.groups[0].trim());
  if (hash) node('.file-hash .hash', 'span', hash.line, hash.groups[0]);
  for (const statMetric of result.metrics.filter((rec) => rec.selector === '.stats .stat')) {
    node(`.stat[data-label="${statMetric.label}"]`, 'div', statMetric.line,
      `${statMetric.label}: ${statMetric.value}`);
  }
  const navLine = findLine(html, (line) => line.includes('class="nav"'));
  node('.nav', 'header', navLine || 1, 'navigation links');

  // CSS custom-property tokens defined in the rendered page.
  const rootBlock = firstMatch(html, /:root\s*\{([\s\S]*?)\}/);
  result.tokens = [];
  if (rootBlock) {
    for (const tok of matches(rootBlock.groups[0], /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
      result.tokens.push({
        file: 'index.html',
        name: tok.groups[0],
        value: tok.groups[1].trim(),
        line: lineAt(html, rootBlock.index + tok.index),
        selector: ':root',
      });
    }
  }
  result.hardcodedColors = matches(html, /(?:fill|stroke|flood-color|stop-color)=["'](#[0-9a-fA-F]{3,8})["']/g)
    .map((hit) => ({ file: 'index.html', color: hit.groups[0], line: hit.line, snippet: hit.value }));

  // Encoded payload references in the raw bootstrap file.
  result.payloadRefs = [];
  const payloadDivRe = /id="(zxlwhXiv(\d))"[^>]*>/g;
  let pm;
  while ((pm = payloadDivRe.exec(rawHtml))) {
    result.payloadRefs.push({ file: 'index.html', id: pm[1], line: lineAt(rawHtml, pm.index), snippet: pm[0] });
  }
  result.bootstrap = {
    file: 'index.html',
    line: decoded.bootstrapLine,
    snippet: decoded.bootstrapLine ? lineSlice(rawHtml, decoded.bootstrapLine) : '',
  };
  return result;
}

export function parseSvg(file, text) {
  const result = {
    file,
    source: text,
    rawBytes: Buffer.byteLength(text, 'utf8'),
    metrics: [],
    dom: [],
    tokens: [],
    hardcodedColors: [],
    refs: [],
  };
  const metric = (kind, key, value, raw, selector, line, detail = {}) =>
    result.metrics.push({ file, kind, key, value: value ?? raw, raw, selector, line, ...detail });

  const viewBox = firstMatch(text, /viewBox=["']([^"']+)["']/);
  if (viewBox) metric('string', 'svg.viewBox', viewBox.groups[0], viewBox.value, 'svg', viewBox.line);

  for (const t of matches(text, /<text\b([^>]*)>([\s\S]*?)<\/text>/gi)) {
    const attrs = t.groups[0] || '';
    const content = (t.groups[1] || '').replace(/<[^>]+>/g, '').trim();
    const id = /id=["']([^"']+)["']/.exec(attrs);
    const selector = id ? `text#${id[1]}` : 'text';
    // For multi-line <text> elements, land on the line carrying the visible copy.
    const contentOffset = t.groups[1] ? t.value.indexOf(t.groups[1]) : -1;
    const contentLine = contentOffset >= 0 ? lineAt(text, t.index + contentOffset) : t.line;
    metric('string', 'svg.text', content, t.value, selector, contentLine, { id: id ? id[1] : null, tagLine: t.line });
    result.dom.push({ file, selector, tag: 'text', line: contentLine, tagLine: t.line, snippet: content, id: id ? id[1] : null });
  }

  for (const def of matches(text, /<(linearGradient|radialGradient|filter|clipPath|pattern)\b[^>]*id=["']([^"']+)["'][^>]*>/gi)) {
    result.tokens.push({ file, name: `#${def.groups[1]}`, value: def.groups[0], line: def.line, selector: `${def.groups[0]}#${def.groups[1]}` });
  }
  for (const hit of matches(text, /(?:fill|stroke|flood-color|stop-color)=["'](#[0-9a-fA-F]{3,8})["']/g)) {
    result.hardcodedColors.push({ file, color: hit.groups[0], line: hit.line, snippet: hit.value });
  }
  for (const hit of matches(text, /url\(#([A-Za-z0-9_-]+)\)/g)) {
    result.refs.push({ file, line: hit.line, target: hit.groups[0], snippet: hit.value });
  }

  const size = /width=["'](\d+)["']/.exec(text);
  if (size) metric('number', 'svg.width', Number(size[1]), size[0], 'svg', lineAt(text, size.index), { unit: 'px' });

  return result;
}

export function parseReadme(text) {
  const claims = [];
  const add = (id, expectation, value, line, raw) =>
    claims.push({ file: 'README.md', id, expectation, value: value ?? raw, line, raw: (raw || '').trim() });

  const h1 = firstMatch(text, /^#\s+(.+)$/m);
  if (h1) add('product.name', 'title in <title>/<h1>', h1.groups[0].replace(/^[^\w]+/, '').split('—')[0].trim(), h1.line, h1.groups[0]);

  const stack = firstMatch(text, /\*\*Frontend:\*\*\s*([^\n]+)/);
  if (stack) add('tech.frontend', 'frontend stack string', stack.groups[0].trim(), stack.line, stack.groups[0]);

  const accuracy = firstMatch(text, /(\d+)%\s+accuracy/);
  if (accuracy) add('forecast.accuracyPct', 'forecast accuracy %', Number(accuracy.groups[0]), accuracy.line, accuracy.value);
  const horizon = firstMatch(text, /(\d+)\s+days?\s+ahead/);
  if (horizon) add('forecast.horizonDays', 'forecast horizon days', Number(horizon.groups[0]), horizon.line, horizon.value);
  const horizonRow = firstMatch(text, /(\d+)-day\s+horizon/);
  if (horizonRow) add('forecast.horizonDays', 'forecast horizon days', Number(horizonRow.groups[0]), horizonRow.line, horizonRow.value);
  const waste = firstMatch(text, /(\d+)%\s+reduction in perishable waste/);
  if (waste) add('inventory.wasteReductionPct', 'perishable waste reduction %', Number(waste.groups[0]), waste.line, waste.value);
  const wasteUp = firstMatch(text, /reduce waste by up to\s+(\d+)%/);
  if (wasteUp) add('inventory.wasteReductionPct', 'perishable waste reduction %', Number(wasteUp.groups[0]), wasteUp.line, wasteUp.value);
  const languages = firstMatch(text, /(\d+)\s+languages?\b/);
  if (languages) add('i18n.languageCount', 'supported language count', Number(languages.groups[0]), languages.line, languages.value);

  const roadmapV1 = firstMatch(text, /Release\s+(v\d+\.\d+\.\d+)/);
  if (roadmapV1) add('roadmap.nextVersion', 'roadmap release version', roadmapV1.groups[0], roadmapV1.line, roadmapV1.value);

  const noWizard = firstMatch(text, /No installation wizards[^.\n]*/i);
  if (noWizard) add('delivery.installer', 'must NOT advertise an installer/wizard', 'none', noWizard.line, noWizard.value);

  const offline = firstMatch(text, /Offline Mode\s*\|[^|]*\|\s*([^|]+)/);
  if (offline) add('privacy.offline', 'offline capability', offline.groups[0].trim(), offline.line, offline.groups[0]);
  const noCloud = firstMatch(text, /zero cloud uploads by default/i);
  if (noCloud) add('privacy.cloudUploads', 'cloud upload default', 'none', noCloud.line, noCloud.value);
  const noKeys = firstMatch(text, /No authentication keys/i);
  if (noKeys) add('privacy.authKeys', 'auth keys required', 'none', noKeys.line, noKeys.value);

  const mit = firstMatch(text, /MIT License/);
  if (mit) add('license', 'license badge/string', 'MIT', mit.line, mit.value);

  // SVG references embedded in README (image links to preview.svg / button.svg).
  const svgRefs = [];
  for (const hit of matches(text, /!\[[^\]]*\]\((https?:\/\/[^)\s]+\/(preview|button)\.svg)\)/g)) {
    svgRefs.push({ file: 'README.md', line: hit.line, url: hit.groups[0], name: `${hit.groups[1]}.svg` });
  }

  return {
    file: 'README.md',
    rawBytes: Buffer.byteLength(text, 'utf8'),
    claims,
    svgRefs,
    html: text,
  };
}

export async function parseAll(readFile) {
  const reader = readFile || (async (name) => {
    const { readTextWithRetry } = await import('./lib.mjs');
    return readTextWithRetry(name);
  });
  const [indexRaw, previewRaw, buttonRaw, readmeRaw] = await Promise.all(
    ['index.html', 'preview.svg', 'button.svg', 'README.md'].map((name) => reader(name))
  );
  return {
    generatedAt: new Date().toISOString(),
    index: parseIndex(indexRaw.text),
    preview: parseSvg('preview.svg', previewRaw.text),
    button: parseSvg('button.svg', buttonRaw.text),
    readme: parseReadme(readmeRaw.text),
  };
}
