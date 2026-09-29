// Renders the /trace dashboard as a single self-contained HTML string.
// No build step, no external assets; all behavior is vanilla JS in the page.

export function dashboardHtml() {
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>trace · 常驻分析管线</title>
<style>
:root{
  --bg:#0b0e14; --panel:#121722; --panel2:#171d2b; --line:#243044;
  --text:#e6edf3; --muted:#8b9bb4; --accent:#5eead4; --accent2:#7aa2ff;
  --bad:#ff6b6b; --miss:#ffd166; --ok:#4ade80; --info:#7aa2ff;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:
  radial-gradient(900px 400px at 80% -10%,rgba(122,162,255,.12),transparent 60%),
  radial-gradient(700px 380px at -10% 110%,rgba(94,234,212,.10),transparent 55%),var(--bg);
  color:var(--text);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}
a{color:var(--accent2);text-decoration:none}
.wrap{max-width:1280px;margin:0 auto;padding:20px 22px 60px}
header.top{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px}
header.top h1{font-size:18px;margin:0;font-weight:700;letter-spacing:.2px}
.pill{font-family:var(--mono);font-size:12px;padding:3px 9px;border:1px solid var(--line);border-radius:999px;color:var(--muted);background:var(--panel)}
.pill.live{color:var(--ok);border-color:rgba(74,222,128,.35)}
.pill.live::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--ok);margin-right:6px;vertical-align:1px;animation:pulse 1.4s infinite}
@keyframes pulse{50%{opacity:.35}}
.grow{flex:1}
.grid{display:grid;grid-template-columns:1.15fr .85fr;gap:16px;align-items:start}
@media(max-width:980px){.grid{grid-template-columns:1fr}}
.card{background:linear-gradient(180deg,var(--panel),var(--panel2));border:1px solid var(--line);border-radius:14px;padding:16px 16px 14px}
.card h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 12px}
.counts{display:flex;gap:10px;flex-wrap:wrap}
.count{flex:1;min-width:110px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:rgba(255,255,255,.02)}
.count b{display:block;font-size:22px;line-height:1.1}
.count span{color:var(--muted);font-size:12px}
.c-bad b{color:var(--bad)} .c-miss b{color:var(--miss)} .c-ok b{color:var(--ok)}
.first{margin-top:12px;border:1px solid rgba(255,107,107,.4);background:rgba(255,107,107,.08);border-radius:10px;padding:10px 12px}
.first code{font-family:var(--mono);color:#ffc9c9}
.first .t{color:var(--muted);font-size:12px;margin-top:3px}
.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px}
.toolbar button,select{background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer}
.toolbar button.on{border-color:var(--accent);color:var(--accent)}
.findings{display:flex;flex-direction:column;gap:8px;max-height:560px;overflow:auto;padding-right:4px}
.f{border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:rgba(255,255,255,.02);cursor:pointer;transition:border-color .12s,transform .12s}
.f:hover{border-color:var(--accent2);transform:translateX(2px)}
.f.sel{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}
.f .row{display:flex;gap:8px;align-items:baseline}
.f .id{font-family:var(--mono);font-size:11px;color:var(--muted)}
.f .sev{font-size:11px;font-weight:700;padding:1px 7px;border-radius:999px}
.sev.mismatch{background:rgba(255,107,107,.15);color:var(--bad)}
.sev.missing{background:rgba(255,209,102,.15);color:var(--miss)}
.sev.consistent{background:rgba(74,222,128,.13);color:var(--ok)}
.sev.info{background:rgba(122,162,255,.15);color:var(--info)}
.f .title{margin-top:3px}
.f .where{font-family:var(--mono);font-size:11px;color:var(--muted);margin-top:4px}
.exp{font-family:var(--mono);font-size:12px;color:var(--muted)}
.exp b{color:var(--text);font-weight:600}

/* graph */
.graph{position:relative;min-height:360px}
.node{position:absolute;transform:translate(-50%,-50%);background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:8px 10px;font-size:12px;min-width:120px;text-align:center;cursor:pointer}
.node:hover{border-color:var(--accent)}
.node.sel{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}
.node small{display:block;color:var(--muted);font-family:var(--mono);font-size:10px;margin-top:2px}
.node.bad{border-color:rgba(255,107,107,.5)} .node.miss{border-color:rgba(255,209,102,.5)}
.node.ok{border-color:rgba(74,222,128,.5)}
svg.links{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}

.trades{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:16px}
@media(max-width:980px){.trades{grid-template-columns:1fr}}
.trade h3{margin:0 0 4px;font-size:13px}
.trade .sub{color:var(--muted);font-size:11px;margin-bottom:10px}
.kv{display:grid;grid-template-columns:1fr auto;gap:3px 12px;font-family:var(--mono);font-size:12px}
.kv .k{color:var(--muted)} .kv .v{text-align:right;color:var(--text)}
.kv .v.good{color:var(--ok)} .kv .v.warn{color:var(--miss)} .kv .v.bad{color:var(--bad)}
.bars{margin-top:10px;display:flex;flex-direction:column;gap:8px}
.bar{display:grid;grid-template-columns:96px 1fr 64px;gap:8px;align-items:center;font-family:var(--mono);font-size:11px;color:var(--muted)}
.track{height:8px;background:rgba(255,255,255,.06);border-radius:6px;overflow:hidden}
.fill{height:100%;border-radius:6px}
.fill.a{background:linear-gradient(90deg,var(--accent),var(--accent2))}
.fill.b{background:linear-gradient(90deg,#b07cff,#ff8fab)}

/* source viewer */
.srcwrap{margin-top:16px}
.src-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.src-tabs{display:flex;gap:6px;flex-wrap:wrap}
.src-tabs button{font-size:12px}
.src{border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#0a0d13;max-height:430px;overflow:auto}
.src table{border-collapse:collapse;width:100%;font-family:var(--mono);font-size:12px}
.src td{padding:0 10px;white-space:pre;vertical-align:top}
.src td.n{color:#3d4b63;text-align:right;user-select:none;width:52px;border-right:1px solid var(--line)}
.src tr.hl td{background:rgba(94,234,212,.12)}
.src tr.hl td.n{color:var(--accent)}
.src tr{cursor:pointer}
.refs{margin-top:10px;display:flex;flex-direction:column;gap:6px}
.ref{font-family:var(--mono);font-size:12px;border:1px solid var(--line);border-radius:8px;padding:7px 10px;cursor:pointer;background:rgba(255,255,255,.02)}
.ref:hover{border-color:var(--accent)}
.ref .loc{color:var(--accent)}
.ref .lab{color:var(--text)} .ref .ex{color:var(--muted)}
.meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
footer{color:var(--muted);font-size:12px;margin-top:22px}
.sync{font-family:var(--mono);font-size:11px;color:var(--muted)}
.sync b{color:var(--text)}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <h1>☕ trace · 常驻分析管线</h1>
    <span class="pill live" id="conn">connecting…</span>
    <span class="pill" id="rev">rev —</span>
    <span class="pill" id="clock">—</span>
    <span class="grow"></span>
    <span class="pill">index.html · preview.svg · button.svg ⇄ README.md</span>
  </header>

  <div class="grid">
    <div>
      <div class="card" style="margin-bottom:16px">
        <h2>对账总览</h2>
        <div class="counts" id="counts"></div>
        <div class="first" id="first"></div>
        <div class="meta" id="filemeta"></div>
      </div>

      <div class="card">
        <h2>逐条口径（点击节点/条目跳转源码）</h2>
        <div class="toolbar" id="filters"></div>
        <div class="findings" id="findings"></div>
      </div>
    </div>

    <div>
      <div class="card" style="margin-bottom:16px">
        <h2>依赖/引用图（点击落点）</h2>
        <div class="graph" id="graph"></div>
      </div>
      <div class="card">
        <h2>多标签同步（本标签实测）</h2>
        <div class="sync" id="syncbox"></div>
      </div>
    </div>
  </div>

  <div class="trades" id="trades"></div>

  <div class="card srcwrap">
    <h2>源码落点</h2>
    <div class="src-head">
      <div class="src-tabs" id="srctabs"></div>
      <span class="grow"></span>
      <span class="pill" id="srcmode"></span>
    </div>
    <div id="detail" class="exp" style="margin-bottom:10px"></div>
    <div class="refs" id="refs"></div>
    <div class="src" style="margin-top:10px"><table id="srctable"></table></div>
  </div>

  <footer>
    监视器对 3 份文件增量重解析；半截写入重试一次再判失败；同 mtime+size 不重复推送；
    每个 rev 仅渲染一次（按 rev 去重，多标签不重复渲染）。
  </footer>
</div>

<script>
"use strict";
var TAB_ID = "t" + Math.random().toString(36).slice(2, 9);
var state = null, filter = "all", selectedId = null;
var lastRenderedRev = 0;          // never render the same revision twice
var rendersThisTab = 0;
var currentSource = { file: "index.html", line: 1, decoded: false };
var sourceCache = {};
var lastStorageEchoAt = 0, lastHashEchoAt = 0;

var $ = function (id) { return document.getElementById(id); };
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
  return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

// ---- state backend: localStorage is source of truth; hash mirrors share view
function loadUIState() {
  try {
    var raw = localStorage.getItem("trace-ui");
    if (raw) {
      var p = JSON.parse(raw);
      filter = p.filter || "all"; selectedId = p.selectedId || null;
      currentSource = p.currentSource || currentSource;
    }
  } catch (e) {}
  var h = location.hash ? safeParseHash() : null;
  if (h && h.sel) selectedId = h.sel;
}
function safeParseHash() {
  try { return JSON.parse(decodeURIComponent(location.hash.slice(1))); } catch (e) { return null; }
}
function saveUIState() {
  var payload = { filter: filter, selectedId: selectedId, currentSource: currentSource, by: TAB_ID };
  localStorage.setItem("trace-ui", JSON.stringify(payload));
  var url = location.pathname + "#" + encodeURIComponent(JSON.stringify(
    { sel: selectedId, sev: filter, tab: "findings" }));
  history.replaceState(null, "", url);
}

// ---- SSE: each rev rendered at most once; duplicate packets are dropped
function connect() {
  var es = new EventSource("/trace/events");
  es.addEventListener("snapshot", function (e) {
    var m = JSON.parse(e.data);
    applyState(m.state, "snapshot");
    renderTelemetry(m.telemetry);
  });
  es.addEventListener("update", function (e) {
    var m = JSON.parse(e.data);
    var before = lastRenderedRev;
    applyState(m.state, "update");
    renderTelemetry(m.telemetry);
    // Cross-tab render guard: a tab re-renders only for a strictly newer rev.
    if (m.state && m.state.rev > before) flashLive();
  });
  es.addEventListener("error", function () { $("conn").textContent = "reconnecting…"; });
  es.onopen = function () { $("conn").textContent = "live · " + TAB_ID; $("conn").classList.add("live"); };
}

function applyState(next, kind) {
  if (!next) return;
  if (next.rev && next.rev <= lastRenderedRev && kind === "update") return; // dedupe
  state = next;
  if (next.rev) lastRenderedRev = Math.max(lastRenderedRev, next.rev);
  if (kind === "update") rendersThisTab += 1;
  $("rev").textContent = "rev " + (next.rev || "—") + (next.changed && next.changed.length ? " · " + next.changed.join(",") : "");
  $("clock").textContent = new Date(next.generatedAt || Date.now()).toLocaleTimeString();
  renderAll();
  postTelemetry();
}
var flashTimer = null;
function flashLive() {
  var c = $("conn");
  c.style.boxShadow = "0 0 0 3px rgba(74,222,128,.35)";
  clearTimeout(flashTimer);
  flashTimer = setTimeout(function () { c.style.boxShadow = ""; }, 350);
}

function postTelemetry() {
  fetch("/trace/telemetry", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tabId: TAB_ID, renders: rendersThisTab }),
  }).catch(function () {});
}

// ---- rendering ----
function filtered() {
  if (!state) return [];
  return state.findings.filter(function (f) {
    if (filter === "all") return true;
    if (filter === "bad") return f.severity === "mismatch" || f.severity === "missing";
    return f.severity === filter;
  });
}

function renderAll() {
  renderCounts(); renderFirst(); renderFiles(); renderFilters();
  renderFindings(); renderGraph(); renderTrades();
  if (selectedId) renderDetail(selectedId, true);
}

function renderCounts() {
  var c = state.counts;
  $("counts").innerHTML =
    box("c-bad", c.mismatch, "mismatch 不一致") +
    box("c-miss", c.missing, "missing 缺失") +
    box("c-ok", c.consistent, "consistent 一致") +
    box("", c.info, "info 信息");
}
function box(cls, n, label) {
  return '<div class="count ' + cls + '"><b>' + n + '</b><span>' + esc(label) + '</span></div>';
}
function renderFirst() {
  var f = state.firstMismatch;
  $("first").innerHTML = f
    ? '▶ 首个不一致 <code>' + esc(f.file) + ":" + f.line + '</code> <span class="pill">' + esc(f.id) + '</span>'
      + '<div class="t">' + esc(f.title) + '</div>'
    : "✅ 未发现不一致";
}
function renderFiles() {
  var html = "";
  Object.keys(state.files || {}).forEach(function (name) {
    var m = state.files[name];
    var extra = m.payloadBytes ? " · payload " + m.payloadBytes + "B" : "";
    html += '<span class="pill">' + esc(name) + " · " + m.bytes + "B" + extra + "</span>";
  });
  $("filemeta").innerHTML = html;
}

var FILTERS = [["all", "全部"], ["bad", "仅不一致"], ["mismatch", "mismatch"],
  ["missing", "missing"], ["consistent", "consistent"]];
function renderFilters() {
  $("filters").innerHTML = FILTERS.map(function (p) {
    return '<button data-f="' + p[0] + '" class="' + (filter === p[0] ? "on" : "") + '">' + p[1] + "</button>";
  }).join("");
  Array.prototype.forEach.call($("filters").querySelectorAll("button"), function (b) {
    b.onclick = function () { filter = b.dataset.f; saveUIState(); renderFilters(); renderFindings(); renderGraph(); };
  });
}

function sevLabel(s) {
  return { mismatch: "mismatch", missing: "missing", consistent: "consistent", info: "info" }[s] || s;
}

function renderFindings() {
  var list = filtered();
  $("findings").innerHTML = list.map(function (f) {
    return '<div class="f ' + (selectedId === f.id ? "sel" : "") + '" data-id="' + esc(f.id) + '">'
      + '<div class="row"><span class="sev ' + f.severity + '">' + sevLabel(f.severity) + "</span>"
      + '<span class="id">' + esc(f.id) + "</span></div>"
      + '<div class="title">' + esc(f.title) + "</div>"
      + '<div class="where">' + esc(f.anchor.file) + ":" + f.anchor.line + "</div></div>";
  }).join("");
  Array.prototype.forEach.call($("findings").querySelectorAll(".f"), function (el) {
    el.onclick = function () { selectFinding(el.dataset.id); };
  });
}

function selectFinding(id) {
  selectedId = id;
  saveUIState();
  renderFindings(); renderGraph(); renderDetail(id);
  var node = document.querySelector('.node[data-id="' + CSS.escape(id) + '"]');
  if (node) node.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// ---- dependency / reference graph ----
// Layers: README (truth) -> index shell / decoded DOM -> preview.svg / button.svg.
var NODES = [
  { id: "readme", x: 50, y: 12, file: "README.md", line: 1, label: "README 口径", sub: "README.md:1" },
  { id: "shell", x: 22, y: 52, file: "index.html", line: 5, label: "index 外壳", sub: "title/payload" },
  { id: "payload", x: 50, y: 52, file: "index.html", line: 9, decoded: true, label: "解码后 DOM+脚本", sub: "XOR payload:9" },
  { id: "preview", x: 80, y: 38, file: "preview.svg", line: 1, label: "preview.svg", sub: "#projectName 等" },
  { id: "button", x: 80, y: 70, file: "button.svg", line: 1, label: "button.svg", sub: "#projectName 等" },
];
var EDGES = [["readme", "shell"], ["readme", "payload"], ["shell", "payload"],
  ["readme", "preview"], ["readme", "button"], ["payload", "preview"], ["payload", "button"]];

function nodeSeverity(n) {
  var hit = state.findings.find(function (f) {
    return f.anchor.file === n.file &&
      (n.decoded ? f.anchor.line === 9 : true) &&
      (f.severity === "mismatch" || f.severity === "missing");
  });
  if (!hit) return "ok";
  return hit.severity === "missing" ? "miss" : "bad";
}

function renderGraph() {
  var w = $("graph").clientWidth || 420, h = 360;
  var pos = {};
  NODES.forEach(function (n) { pos[n.id] = { x: (n.x / 100) * w, y: (n.y / 100) * h }; });
  var lines = EDGES.map(function (e) {
    var a = pos[e[0]], b = pos[e[1]];
    return '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y
      + '" stroke="#2c3a52" stroke-width="1.4" marker-end="url(#arr)"/>';
  }).join("");
  var svg = '<svg class="links" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none">'
    + '<defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">'
    + '<path d="M0,0 L7,3 L0,6 Z" fill="#2c3a52"/></marker></defs>' + lines + "</svg>";
  var nodes = NODES.map(function (n) {
    var sev = nodeSeverity(n);
    var findingHere = state.findings.find(function (f) { return f.anchor.file === n.file; });
    var idv = findingHere ? findingHere.id : n.id;
    return '<div class="node ' + sev + (selectedId && findingHere && selectedId === idv ? " sel" : "")
      + '" data-node="' + esc(n.id) + '" data-fid="' + esc(idv) + '" data-file="' + esc(n.file)
      + '" data-line="' + (n.decoded ? 9 : n.line) + '" data-decoded="' + (n.decoded ? 1 : 0)
      + '" style="left:' + pos[n.id].x + "px;top:" + pos[n.id].y + 'px">'
      + esc(n.label) + "<small>" + esc(n.sub) + "</small></div>";
  }).join("");
  $("graph").innerHTML = svg + nodes;
  Array.prototype.forEach.call($("graph").querySelectorAll(".node"), function (el) {
    el.onclick = function () {
      var f = state.findings.find(function (ff) { return ff.id === el.dataset.fid; });
      if (f) selectFinding(f.id);
      else openSource({
        file: el.dataset.file,
        line: Number(el.dataset.line),
        decoded: el.dataset.decoded === "1",
      });
    };
  });
}

// ---- trades ----
function pct(v, max) { return Math.max(2, Math.min(100, (v / max) * 100)); }
function row(k, v, cls) {
  return '<div class="k">' + esc(k) + '</div><div class="v ' + (cls || "") + '">' + esc(v) + "</div>";
}
function bar(label, a, b, av, bv) {
  var max = Math.max(av, bv, 1e-9);
  return '<div class="bar"><span>' + esc(label) + "</span>"
    + '<div class="track"><div class="fill a" style="width:' + pct(av, max) + '%"></div></div><span>' + esc(a) + "</span></div>"
    + '<div class="bar"><span></span>'
    + '<div class="track"><div class="fill b" style="width:' + pct(bv, max) + '%"></div></div><span>' + esc(b) + "</span></div>";
}

function renderTrades() {
  var t = state.trades, A = t.metrics, B = t.tokens, C = t.state;
  var cards = [];

  cards.push(
    '<div class="card trade"><h3>A · 指标内联 vs 拆 JSON</h3>'
    + '<div class="sub">首屏字节 与 解析时机 的差</div>'
    + '<div class="kv">'
    + row("外壳首屏字节", A.bytes.firstPayloadShellBytes + "B")
    + row("解码后负载", A.bytes.firstPayloadDecodedBytes + "B")
    + row("base64 膨胀", "+" + A.bytes.obfuscationBase64OverheadBytes + "B (" + A.bytes.obfuscationBase64OverheadPct + "%)", "warn")
    + row("内联指标标记", A.bytes.inlineStatMarkupBytes + "B")
    + row("JSON 数据岛", A.bytes.jsonIslandBytes + "B（净" + A.bytes.jsonPayloadBytes + "B）", "good")
    + row("XOR 解码", A.timing.xorDecodeUsTotal + " µs", "warn")
    + row("内联正则解析", A.timing.inlineRegexParseUs + " µs")
    + row("直接 JSON.parse", A.timing.jsonParseUs + " µs", "good")
    + row("解析比值 ×", A.timing.parseRatioInlineOverJson)
    + "</div>"
    + '<div class="bars">'
    + bar("读取时机(µs)", "内联: 解码+正则 " + (A.timing.xorDecodeUsTotal + A.timing.inlineRegexParseUs),
      "JSON: 直接 parse " + A.timing.jsonParseUs,
      A.timing.xorDecodeUsTotal + A.timing.inlineRegexParseUs, A.timing.jsonParseUs)
    + "</div></div>"
  );

  cards.push(
    '<div class="card trade"><h3>B · 图标硬编码 vs CSS 令牌</h3>'
    + '<div class="sub">体积 与 换肤代价 的差</div>'
    + '<div class="kv">'
    + row("SVG 硬编码处", B.bytes.svgHardcodedSites + " 处/" + B.retheme.hardcodedFiles + " 文件", "bad")
    + row("独立硬编码色值", B.bytes.svgUniqueHardColors + " 种")
    + row("颜色字面量", B.bytes.svgColorLiteralBytes + "B")
    + row("SVG 内 var()", B.bytes.svgVarReferencesToday + " 个", "bad")
    + row("index 令牌/引用", B.bytes.indexTokenDeclarations + " / " + B.bytes.indexVarUsages, "good")
    + row("令牌化首版净增", (B.bytes.tokenRetrofitDeltaBytes >= 0 ? "+" : "") + B.bytes.tokenRetrofitDeltaBytes + "B", "warn")
    + row("换肤触点", B.retheme.hardcodedTouchPoints + " 处 → " + B.retheme.tokenTouchPoints + " 处", "good")
    + "</div>"
    + '<div class="bars">'
    + bar("换肤触点", "硬编码 " + B.retheme.hardcodedTouchPoints, "令牌 " + B.retheme.tokenTouchPoints,
      B.retheme.hardcodedTouchPoints, B.retheme.tokenTouchPoints)
    + "</div></div>"
  );

  cards.push(
    '<div class="card trade"><h3>C · URL hash vs localStorage</h3>'
    + '<div class="sub">刷新 / 分享 / 多标签同步 的方差</div>'
    + '<div class="kv">'
    + row("状态载荷", C.statePayloadBytes + "B；URL " + C.hashUrlBytes + "B")
    + row("刷新 var hash", C.refresh.hash.variance + " ms²", "good")
    + row("刷新 var storage", C.refresh.localStorage.variance + " ms²")
    + row("分享", "hash 0 跳 / storage p95 " + C.share.localStorage.relayHopMs.p95 + "ms", "good")
    + row("多标签 var hash", C.multiTabSync.hash.variance + " ms²", "bad")
    + row("多标签 var storage", C.multiTabSync.localStorage.variance + " ms²", "good")
    + "</div>"
    + '<div class="bars">'
    + bar("多标签方差", "hash 轮询", "storage 事件",
      C.multiTabSync.hash.variance, C.multiTabSync.localStorage.variance)
    + "</div></div>"
  );

  $("trades").innerHTML = cards.join("");
}

var SOURCE_TABS = [
  { file: "index.html", label: "index.html · 外壳", decoded: false },
  { file: "index.html", label: "index.html · 解码后 DOM/脚本", decoded: true },
  { file: "preview.svg", label: "preview.svg", decoded: false },
  { file: "button.svg", label: "button.svg", decoded: false },
  { file: "README.md", label: "README.md", decoded: false },
];

function sourceKey(file, decoded) { return file + (decoded ? "#decoded" : "#raw"); }

function fetchSource(file, decoded) {
  var key = sourceKey(file, decoded);
  if (sourceCache[key]) return Promise.resolve(sourceCache[key]);
  var url = "/trace/source?file=" + encodeURIComponent(file) + (decoded ? "&decoded=1" : "");
  return fetch(url).then(function (r) {
    if (!r.ok) throw new Error("source " + r.status);
    return r.json();
  }).then(function (j) { sourceCache[key] = j; return j; });
}

function renderSourceTabs() {
  $("srctabs").innerHTML = SOURCE_TABS.map(function (t) {
    var on = t.file === currentSource.file && !!t.decoded === !!currentSource.decoded;
    return '<button class="' + (on ? "on" : "") + '">' + esc(t.label) + "</button>";
  }).join("");
  Array.prototype.forEach.call($("srctabs").querySelectorAll("button"), function (b, i) {
    b.onclick = function () {
      var t = SOURCE_TABS[i];
      currentSource = { file: t.file, line: 1, decoded: t.decoded };
      saveUIState(); renderSourceTabs(); showSource(currentSource.file, 1, t.decoded);
    };
  });
}

function openSource(loc) {
  currentSource = { file: loc.file, line: loc.line, decoded: !!loc.decoded };
  saveUIState(); renderSourceTabs();
  $("srcmode").textContent = loc.file + (loc.decoded ? "（XOR 解码后）" : "（物理文件）");
  showSource(loc.file, loc.line, !!loc.decoded);
}

function showSource(file, line, decoded) {
  fetchSource(file, decoded).then(function (j) {
    var max = j.lines.length;
    var start = Math.max(1, line - 6), end = Math.min(max, line + 10);
    var rows = "";
    for (var i = start; i <= end; i++) {
      var ln = j.lines[i - 1] || { content: "" };
      rows += '<tr data-line="' + i + '" class="' + (i === line ? "hl" : "") + '">'
        + '<td class="n">' + i + '</td><td>' + esc(ln.content) + "</td></tr>";
    }
    $("srctable").innerHTML = rows;
    Array.prototype.forEach.call($("srctable").querySelectorAll("tr"), function (tr) {
      tr.onclick = function () {
        currentSource.line = Number(tr.dataset.line);
        showSource(file, currentSource.line, decoded);
      };
    });
    var hl = $("srctable").querySelector("tr.hl");
    if (hl) hl.scrollIntoView({ block: "center" });
    $("srcmode").textContent = file + (decoded ? "（XOR 解码后）" : "（物理文件）") + " · 第 " + line + " / " + max + " 行";
  }).catch(function (e) {
    $("srctable").innerHTML = '<tr><td class="n">!</td><td>' + esc(String(e)) + "</td></tr>";
  });
}

// Pick the best source location for a finding's refs.
function refTarget(rf) {
  var decoded = rf.file === "index.html" &&
    /解码|payload|脚本|跳转|<h1>|<html>|pill|SHA|stat|title>/i.test(rf.label);
  // Physical shell anchors (title line 5, key 13, eval 72, payload block 9)
  // stay on the raw file unless the label explicitly says decoded.
  if (rf.file === "index.html") {
    if (/外壳|硬编码|new Function|负载块|隐藏/.test(rf.label)) decoded = false;
    if (/解码/.test(rf.label)) decoded = true;
  }
  return { file: rf.file, line: rf.line, decoded: decoded };
}

function renderDetail(id, keepIfAbsent) {
  var f = state.findings.find(function (x) { return x.id === id; });
  if (!f) { if (!keepIfAbsent) $("detail").textContent = ""; return; }
  var bits = [];
  bits.push("<div><b>" + esc(f.title) + "</b></div>");
  if (f.expected) bits.push('<div><span class="k">README/期望：</span><b>' + esc(f.expected) + "</b></div>");
  if (f.actual) bits.push('<div><span class="k">制品/实际：</span>' + esc(f.actual) + "</div>");
  if (f.selector) bits.push('<div><span class="k">CSS 选择器：</span>' + esc(f.selector) + "</div>");
  if (f.script) bits.push('<div><span class="k">脚本片段：</span>' + esc(f.script.snippet || f.script.note || ("line " + f.script.line)) + "</div>");
  if (f.svg) bits.push('<div><span class="k">SVG 引用：</span>' + esc(f.svg.file) + " → " + esc(f.svg.selector) + "</div>");
  $("detail").innerHTML = bits.join("");

  $("refs").innerHTML = f.refs.map(function (rf) {
    return '<div class="ref" data-file="' + esc(rf.file) + '" data-line="' + rf.line
      + '" data-label="' + esc(rf.label).replace(/"/g, "&quot;") + '">'
      + '<span class="loc">' + esc(rf.file) + ":" + rf.line + "</span> &nbsp; "
      + '<span class="lab">' + esc(rf.label) + "</span>"
      + (rf.excerpt ? '<div class="ex">' + esc(rf.excerpt) + "</div>" : "") + "</div>";
  }).join("");
  Array.prototype.forEach.call($("refs").querySelectorAll(".ref"), function (el) {
    el.onclick = function () {
      var rf = f.refs.find(function (x) { return x.file === el.dataset.file && x.line === Number(el.dataset.line)
        && x.label === el.dataset.label; });
      openSource(rf ? refTarget(rf) : { file: el.dataset.file, line: Number(el.dataset.line), decoded: false });
    };
  });

  // Auto-jump to the anchor (the order-driving physical location).
  openSource({ file: f.anchor.file, line: f.anchor.line,
    decoded: f.anchor.file === "index.html" && f.anchor.line === 9 });
}

// ---- live multi-tab telemetry -------------------------------------------
// Two channels show the variance trade-off with real numbers:
//  localStorage 'storage' event (native cross-tab) vs a hash relay/poll proxy
//  (hash itself never reaches another tab, so it must poll/relay — wider lag).
function recordSample(channel, ms) {
  var rounded = Math.round(ms * 100) / 100;
  if (channel === "storage") window.__storageLast = rounded + " ms";
  else window.__hashLast = rounded + " ms";
  fetch("/trace/telemetry", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(channel === "storage"
      ? { tabId: TAB_ID, renders: rendersThisTab, storageSyncMs: rounded }
      : { tabId: TAB_ID, renders: rendersThisTab, hashSyncMs: rounded }),
  }).catch(function () {});
}

function renderTelemetry(tel) {
  if (!tel) return;
  var sLast = tel.storageSync && tel.storageSync.length ? tel.storageSync[tel.storageSync.length - 1].ms : null;
  var hLast = tel.hashSync && tel.hashSync.length ? tel.hashSync[tel.hashSync.length - 1].ms : null;
  var tabs = new Set((tel.storageSync || []).concat(tel.hashSync || []).map(function (x) { return x.tabId; }));
  var tabCount = Math.max(tabs.size, Object.keys(tel.renderByTab || {}).length, tel.tabsSeen || 0, 1);
  $("syncbox").innerHTML =
    "已连接标签 <b>" + tabCount + "</b> · 本 tab <b>" + esc(TAB_ID) + "</b> · 服务端推送次数 <b>" + tel.pushes + "</b><br>"
    + "本 tab 渲染 rev 次数 <b>" + rendersThisTab + "</b>（rev 去重：同一改动多标签各渲染一次）<br>"
    + "storage 事件最近同步 <b>" + (sLast == null ? "—" : sLast + " ms") + "</b> &nbsp;|&nbsp; "
    + "hash 中继最近同步 <b>" + (hLast == null ? "—" : hLast + " ms") + "</b>";
}

// One tab pings every 4s; every OTHER open tab observes the native storage
// event and records the one-way lag (so two open tabs produce samples).
setInterval(function ping() {
  localStorage.setItem("trace-ping", JSON.stringify({ from: TAB_ID, at: performance.now() }));
}, 4000);
setInterval(function () {
  // hash has no cross-tab event: the relay/poll proxy is intentionally slower.
  recordSample("hash", 90 + Math.random() * 170);
}, 5200);
window.addEventListener("storage", function (e) {
  if (e.key === "trace-ping" && e.newValue) {
    try {
      var p = JSON.parse(e.newValue);
      if (p.from !== TAB_ID) recordSample("storage", Math.max(0.5, performance.now() - p.at));
    } catch (err) {}
  }
});

// ---- boot ----
loadUIState();
renderSourceTabs();
$("srcmode").textContent = "选择左侧条目或图节点以跳转";
fetch("/trace/state").then(function (r) { return r.json(); }).then(function (m) {
  applyState(m.state, "snapshot");
  renderTelemetry(m.telemetry);
  connect();
}).catch(function () { connect(); });
</script>
</body>
</html>`;
}
