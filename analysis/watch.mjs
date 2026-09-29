// Resident incremental watcher.
//
// Guarantees required by the pipeline:
//  * only the changed file is re-read + re-parsed (others served from cache);
//  * a half-written file is retried once before the change is judged failed;
//  * identical (mtimeMs,size) signatures are pushed at most once;
//  * a burst of fs events is coalesced into a single update.

import { watch, statSync } from "node:fs";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { readCompleteFile, extractPayload } from "./lib/util.mjs";
import { parseIndex, parseSvg, parseReadme } from "./lib/parse.mjs";
import { reconcile } from "./lib/reconcile.mjs";
import { computeTrades } from "./lib/trades.mjs";

const DEBOUNCE_MS = 70;
const RETRY_MS = 150;

const SPECS = {
  "index.html": { parse: (t) => parseIndex(t), validate: (t) =>
    (extractPayload(t) ? { ok: true } : { ok: false, reason: "payload not decodable yet" }) },
  "preview.svg": { parse: (t) => parseSvg("preview.svg", t), validate: (t) =>
    (t.trim().startsWith("<svg>") || t.trim().startsWith("<svg ")) && t.includes("</svg>")
      ? { ok: true } : { ok: false, reason: "svg incomplete" } },
  "button.svg": { parse: (t) => parseSvg("button.svg", t), validate: (t) =>
    (t.trim().startsWith("<svg>") || t.trim().startsWith("<svg ")) && t.includes("</svg>")
      ? { ok: true } : { ok: false, reason: "svg incomplete" } },
  "README.md": { parse: (t) => parseReadme(t), validate: (t) =>
    /Nebula Cafe/.test(t) ? { ok: true } : { ok: false, reason: "readme incomplete" } },
};

const signatureOf = (root, name, text) => {
  let mtimeMs = 0, size = Buffer.byteLength(text, "utf8");
  try { ({ mtimeMs, size } = statSync(join(root, name))); } catch {}
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
  // Identity for change-delivery is the CONTENT hash + size; mtime is carried
  // for display but never alone causes a push (so an mtime touch/revert after
  // an identical rewrite cannot be re-broadcast).
  return { key: `${size}:${hash}`, mtimeMs, size, hash };
};

export function createWatcher(root) {
  const bus = new EventEmitter();
  const cache = new Map();       // name -> { text, parsed, sig }
  const pushedSigs = new Map();  // name -> last pushed signature
  let rev = 0;
  let timer = null;
  let pending = new Set();
  let scanning = false;

  const build = (changedFiles) => {
    const model = {
      index: cache.get("index.html").parsed,
      preview: cache.get("preview.svg").parsed,
      button: cache.get("button.svg").parsed,
      readme: cache.get("README.md").parsed,
    };
    const raw = {
      index: cache.get("index.html").text,
      indexDecoded: extractPayload(cache.get("index.html").text)?.decoded ?? "",
      preview: cache.get("preview.svg").text,
      button: cache.get("button.svg").text,
    };
    const findings = reconcile(model);
    const trades = computeTrades(model, raw);
    const counts = {
      mismatch: findings.filter((f) => f.severity === "mismatch").length,
      missing: findings.filter((f) => f.severity === "missing").length,
      consistent: findings.filter((f) => f.severity === "consistent").length,
      info: findings.filter((f) => f.severity === "info").length,
    };
    const firstBad = findings.find((f) => f.severity === "mismatch" || f.severity === "missing");
    return {
      rev,
      generatedAt: new Date().toISOString(),
      changed: [...changedFiles].sort(),
      files: Object.fromEntries([...cache.entries()].map(([name, c]) => [
        name,
        { signature: c.sig.key, mtimeMs: Math.round(c.sig.mtimeMs), bytes: c.sig.size },
      ])),
      counts,
      firstMismatch: firstBad ? {
        id: firstBad.id, file: firstBad.anchor.file, line: firstBad.anchor.line, title: firstBad.title,
      } : null,
      findings,
      trades,
    };
  };

  const refreshFile = async (name, { tolerateFail = false } = {}) => {
    const spec = SPECS[name];
    let text;
    try {
      text = await readCompleteFile(join(root, name), spec.validate, RETRY_MS);
    } catch (err) {
      // Half-written and still broken after the one retry: report once, keep cache.
      if (!tolerateFail) {
        bus.emit("error", { file: name, message: err.message, retried: true });
      }
      return false;
    }
    // A successfully validated read is authoritative: replace whatever is
    // cached (a previous failed/transient read must never poison the model).
    const sig = signatureOf(root, name, text);
    const prev = cache.get(name);
    cache.set(name, { text, parsed: spec.parse(text), sig });
    return !prev || prev.sig.key !== sig.key;
  };

  const flush = async () => {
    timer = null;
    if (scanning) return;
    scanning = true;
    const batch = pending;
    pending = new Set();

    // README is reconciliation truth: always refresh it alongside the 3 watched
    // files so a claim change is reflected, but only the actually-changed files
    // are re-read when nothing moved.
    const targets = new Set(batch);
    if ([...targets].some((n) => n !== "README.md")) targets.add("README.md");

    const changed = [];
    for (const name of ["index.html", "preview.svg", "button.svg", "README.md"]) {
      if (!targets.has(name)) continue;
      const before = cache.get(name)?.sig.key ?? null;
      const ok = await refreshFile(name);
      const after = cache.get(name)?.sig ?? null;
      // Emit when the parsed content actually differs from what we currently
      // hold, AND it is not identical to the last delivered revision (the
      // mtime+size/content duplicate guard).
      const contentMoved = ok && after != null && after.key !== before;
      const duplicateDelivery = after != null && after.key === pushedSigs.get(name);
      if (contentMoved && !duplicateDelivery) {
        changed.push(name);
        pushedSigs.set(name, after.key);
      }
    }

    if (changed.length === 0) {
      scanning = false;
      if (pending.size) schedule();
      return;
    }

    rev += 1;
    const state = build(changed);
    bus.state = state;
    bus.emit("update", state);
    scanning = false;
    if (pending.size) schedule();
  };

  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; flush(); }, DEBOUNCE_MS);
  };

  const onFsEvent = (_evt, filename) => {
    if (!filename || !SPECS[filename]) return;
    pending.add(filename);
    schedule();
  };

  let fsWatcher = null;

  const seed = async () => {
    for (const name of ["index.html", "preview.svg", "button.svg", "README.md"]) {
      // Initial seed: a missing/partial file gets the same single retry.
      // eslint-disable-next-line no-await-in-loop
      const ok = await refreshFile(name, { tolerateFail: true });
      if (ok) pushedSigs.set(name, cache.get(name).sig.key);
    }
    rev = 1;
    bus.state = build(["index.html", "preview.svg", "button.svg", "README.md"]);
    return bus.state;
  };

  const start = () => {
    if (!fsWatcher) fsWatcher = watch(root, { persistent: true }, onFsEvent);
    return bus;
  };
  const stop = () => {
    if (fsWatcher) { fsWatcher.close(); fsWatcher = null; }
    if (timer) { clearTimeout(timer); timer = null; }
  };

  Object.assign(bus, { start, stop, seed,
    getState: () => bus.state,
    // force a rescan (used by tests / manual ping)
    ping: () => { for (const n of ["index.html", "preview.svg", "button.svg"]) pending.add(n); schedule(); },
  });

  return bus;
}
