// One-shot reconciliation check.
// Usage: node analysis/verify.mjs [--json] [--root PATH]
// Exit code 1 when at least one mismatch/missing is found.

import { resolve } from "node:path";
import { analyze } from "./lib/pipeline.mjs";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const rootArg = args[args.indexOf("--root") + 1];
const root = resolve(rootArg || process.cwd());

const pad = (n) => String(n).padStart(2, " ");

function printHuman(r) {
  const line = "─".repeat(72);
  console.log(line);
  console.log("Nebula Cafe / artisanal-streamlit-brew-metrics — 常驻分析管线 · 对账结果");
  console.log(line);
  for (const [name, meta] of Object.entries(r.files)) {
    const extra = meta.payloadBytes ? ` payload=${meta.payloadBytes}B` : "";
    console.log(`  ${name.padEnd(13)} ${String(meta.bytes).padStart(7)}B  ${meta.lines} lines${extra}`);
  }
  console.log(line);
  console.log(`  不一致 mismatch : ${r.counts.mismatch}`);
  console.log(`  缺失   missing  : ${r.counts.missing}`);
  console.log(`  一致   consistent: ${r.counts.consistent}`);
  console.log(`  信息   info     : ${r.counts.info}`);
  console.log(line);

  if (r.firstMismatch) {
    console.log("▶ 首个不一致 FIRST MISMATCH");
    console.log(`    文件 file : ${r.firstMismatch.file}`);
    console.log(`    行号 line : ${r.firstMismatch.line}`);
    console.log(`    规则 rule : ${r.firstMismatch.id}`);
    console.log(`    说明      : ${r.firstMismatch.title}`);
  } else {
    console.log("✅ 未发现不一致");
  }
  console.log(line);

  r.findings.forEach((f, i) => {
    const tag = { mismatch: "✗", missing: "?", consistent: "✓", info: "·" }[f.severity] || "·";
    const where = `${f.anchor.file}:${f.anchor.line}`.padEnd(15);
    console.log(`${pad(i + 1)} ${tag} ${where} ${f.id.padEnd(18)} ${f.title}`);
    if (f.severity !== "consistent") {
      for (const rf of f.refs.slice(0, 3)) {
        console.log(`       └ ${rf.file}:${rf.line}  ${rf.label}${rf.excerpt ? `  | ${rf.excerpt.slice(0, 90)}` : ""}`);
      }
    }
  });

  const t = r.trades;
  console.log(line);
  console.log("三个互相牵制的取舍（数字来自当前制品）");
  console.log(line);
  console.log("A 指标内联 vs JSON");
  console.log(`   首屏外壳 ${t.metrics.bytes.firstPayloadShellBytes}B，解码负载 ${t.metrics.bytes.firstPayloadDecodedBytes}B；base64 膨胀 +${t.metrics.bytes.obfuscationBase64OverheadBytes}B (${t.metrics.bytes.obfuscationBase64OverheadPct}%)`);
  console.log(`   指标内联标记 ${t.metrics.bytes.inlineStatMarkupBytes}B vs JSON 岛 ${t.metrics.bytes.jsonIslandBytes}B（净 JSON ${t.metrics.bytes.jsonPayloadBytes}B）`);
  console.log(`   解析时机：XOR 解码 ${t.metrics.timing.xorDecodeUsTotal}µs 后，正则剥标签 ${t.metrics.timing.inlineRegexParseUs}µs；直接 JSON.parse ${t.metrics.timing.jsonParseUs}µs（比值 ×${t.metrics.timing.parseRatioInlineOverJson}）`);
  console.log("B 硬编码图标/配色 vs CSS 变量令牌");
  console.log(`   两张 SVG：${t.tokens.bytes.svgHardcodedSites} 处硬编码颜色 / ${t.tokens.bytes.svgUniqueHardColors} 种色值 / ${t.tokens.bytes.svgVarReferencesToday} 个 var()`);
  console.log(`   index 解码页：${t.tokens.bytes.indexTokenDeclarations} 个令牌 / ${t.tokens.bytes.indexVarUsages} 处 var()；SVG 令牌化首版净 ${t.tokens.bytes.tokenRetrofitDeltaBytes}B`);
  console.log(`   换肤触点：硬编码改 ${t.tokens.retheme.hardcodedTouchPoints} 处/${t.tokens.retheme.hardcodedFiles} 文件 vs 令牌改 ${t.tokens.retheme.tokenTouchPoints} 处`);
  console.log("C URL hash vs localStorage");
  console.log(`   状态载荷 ${t.state.statePayloadBytes}B；带 hash 的 URL ${t.state.hashUrlBytes}B`);
  console.log(`   刷新方差 var：hash ${t.state.refresh.hash.variance} ms² vs localStorage ${t.state.refresh.localStorage.variance} ms²`);
  console.log(`   分享：hash 状态随链接（0 额外跳数）vs localStorage 额外中转 p95 ${t.state.share.localStorage.relayHopMs.p95} ms`);
  console.log(`   多标签同步方差 var：hash ${t.state.multiTabSync.hash.variance} ms² vs storage 事件 ${t.state.multiTabSync.localStorage.variance} ms²`);
  console.log(line);
}

const result = await analyze(root);
if (asJson) {
  console.log(JSON.stringify({
    root,
    counts: result.counts,
    firstMismatch: result.firstMismatch,
    findings: result.findings,
    trades: result.trades,
  }, null, 2));
} else {
  printHuman(result);
}

const bad = result.counts.mismatch + result.counts.missing;
process.exitCode = bad > 0 ? 1 : 0;
