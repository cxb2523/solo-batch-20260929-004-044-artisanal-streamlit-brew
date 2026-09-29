import { readCompleteFile, extractPayload } from "./util.mjs";
import { parseIndex, parseSvg, parseReadme } from "./parse.mjs";
import { reconcile } from "./reconcile.mjs";
import { computeTrades } from "./trades.mjs";

export const WATCHED = ["index.html", "preview.svg", "button.svg"];

function validators() {
  return {
    "index.html": (t) => {
      if (!/<html/i.test(t)) return { ok: false, reason: "no <html>" };
      if (!extractPayload(t)) return { ok: false, reason: "payload not decodable yet" };
      return { ok: true };
    },
    "preview.svg": (t) =>
      t.trim().startsWith("<svg") && t.includes("</svg>")
        ? { ok: true } : { ok: false, reason: "svg incomplete" },
    "button.svg": (t) =>
      t.trim().startsWith("<svg") && t.includes("</svg>")
        ? { ok: true } : { ok: false, reason: "svg incomplete" },
    "README.md": (t) =>
      /Nebula Cafe/.test(t) ? { ok: true } : { ok: false, reason: "readme incomplete" },
  };
}

// Read one file: if it is half-written, wait and retry once before failing.
export async function readSource(root, name) {
  const path = `${root}/${name}`;
  const v = validators();
  return readCompleteFile(path, v[name] || (() => ({ ok: true })), 120);
}

export async function analyze(root, { readmeName = "README.md" } = {}) {
  const [indexText, previewText, buttonText, readmeText] = await Promise.all([
    readSource(root, "index.html"),
    readSource(root, "preview.svg"),
    readSource(root, "button.svg"),
    readCompleteFile(`${root}/${readmeName}`,
      validators()[readmeName] || (() => ({ ok: true })), 120),
  ]);

  const index = parseIndex(indexText);
  const preview = parseSvg("preview.svg", previewText);
  const button = parseSvg("button.svg", buttonText);
  const readme = parseReadme(readmeText);

  const model = { index, preview, button, readme };
  const decoded = extractPayload(indexText);
  const raw = {
    index: indexText,
    indexDecoded: decoded ? decoded.decoded : "",
    preview: previewText,
    button: buttonText,
  };
  const findings = reconcile(model);
  const trades = computeTrades(model, raw);

  const counts = {
    mismatch: findings.filter((f) => f.severity === "mismatch").length,
    missing: findings.filter((f) => f.severity === "missing").length,
    consistent: findings.filter((f) => f.severity === "consistent").length,
    info: findings.filter((f) => f.severity === "info").length,
  };
  const first = findings.find((f) => f.severity === "mismatch" || f.severity === "missing") || null;

  return {
    generatedAt: new Date().toISOString(),
    root,
    files: {
      "index.html": { bytes: index.shellBytes, payloadBytes: index.payloadBytes, ok: index.ok, lines: index.doc ? index.doc.lineCount : 0 },
      "preview.svg": { bytes: preview.bytes, lines: preview.lineCount, texts: preview.texts.length },
      "button.svg": { bytes: button.bytes, lines: button.lineCount, texts: button.texts.length },
      "README.md": { bytes: readme.bytes, lines: readme.lineCount },
    },
    counts,
    firstMismatch: first ? {
      id: first.id,
      file: first.anchor.file,
      line: first.anchor.line,
      title: first.title,
    } : null,
    findings,
    trades,
    model,
  };
}
