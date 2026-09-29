// Reconcile README claims against what the three shipped artifacts actually say.
// Each finding carries an order anchor {file,line} = where the offending text
// physically is (decoded payload cites index.html line 9), plus `refs` used by
// the dashboard to jump onto the exact selector / script fragment / SVG node.

export const FILES = {
  INDEX: "index.html",
  PREVIEW: "preview.svg",
  BUTTON: "button.svg",
  README: "README.md",
};

// "First mismatch" priority: index.html physical lines, then preview.svg,
// button.svg, README. The anchor drives ordering; refs drive navigation.
const FILE_ORDER = { "index.html": 0, "preview.svg": 1, "button.svg": 2, "README.md": 3 };
const PAYLOAD_LINE = 9; // all seven hidden chunks physically live on this line

const ref = (file, line, label, excerpt = "") => ({ file, line, label, excerpt });

export function reconcile(model) {
  const { index, preview, button, readme } = model;
  const findings = [];
  let seq = 0;
  const push = (f) => findings.push({
    id: f.id || `R${String(++seq).padStart(3, "0")}`,
    severity: f.severity, // mismatch | missing | consistent | info
    anchor: f.anchor, // { file, line }
    title: f.title,
    expected: f.expected ?? "",
    actual: f.actual ?? "",
    refs: f.refs ?? [],
    selector: f.selector ?? null,
    script: f.script ?? null,
    svg: f.svg ?? null,
    metric: f.metric ?? null,
  });

  if (!index || !index.ok) {
    push({
      anchor: { file: FILES.INDEX, line: 9 },
      severity: "mismatch",
      title: "index.html 负载无法解码",
      actual: index ? index.reason : "not parsed",
      refs: [ref(FILES.INDEX, 9, "XOR/base64 payload chunks")],
    });
    return order(findings);
  }

  const d = index.doc;
  const sh = index.shell;
  const product = readme.product ? readme.product.value : "Nebula Cafe";
  const target = d.inlineScripts.find((s) => s.target)
    || { target: "?", redirectMs: null, line: PAYLOAD_LINE, excerpt: "" };
  const firstAnchor = d.anchors.find((a) => /pandoramods/.test(a.href))
    || { line: PAYLOAD_LINE, excerpt: "" };

  // ============ index.html ============
  push({
    id: "R001",
    anchor: { file: FILES.INDEX, line: sh.titleLine },
    severity: "mismatch",
    title: "静态外壳 <title> 是占位符，与 README 产品名不一致",
    expected: product,
    actual: sh.title,
    refs: [
      ref(FILES.INDEX, sh.titleLine, "外壳 <title>", sh.titleExcerpt),
      ref(FILES.README, readme.title.line, "README 标题", readme.title.excerpt),
    ],
    selector: "head > title",
    metric: { claim: "product-name", layer: "shell" },
  });

  push({
    id: "R002",
    anchor: { file: FILES.INDEX, line: PAYLOAD_LINE },
    severity: "mismatch",
    title: `真实页面被 XOR+base64 藏进 ${sh.chunkCount} 个 display:none 块，首屏 HTML 不含任何 README 内容`,
    expected: "README 描述的 Nebula Cafe 看板内容直接出现在 HTML 中",
    actual: `${sh.chunkCount} 个隐藏 div + ${sh.bootstrapBytes}B 引导器，运行期解码注入`,
    refs: [
      ref(FILES.INDEX, PAYLOAD_LINE, `#zxlwhXiv0..${sh.chunkCount - 1} 隐藏负载块`),
      ref(FILES.INDEX, sh.keyLine, "硬编码 XOR 密钥"),
      ref(FILES.INDEX, sh.evalLine, "new Function 静默执行解码脚本"),
      ref(FILES.README, readme.title.line, "README 产品", readme.title.excerpt),
    ],
    selector: "div#zxlwhXiv0",
    script: { layer: "shell", line: sh.evalLine, snippet: "try{ (new Function(PYACqI[1]))(); }catch(e){}" },
    metric: { claim: "payload-delivery", chunkCount: sh.chunkCount, bootstrapBytes: sh.bootstrapBytes },
  });

  push({
    id: "R003",
    anchor: { file: FILES.INDEX, line: PAYLOAD_LINE },
    severity: "mismatch",
    title: "解码后 <title> 是第三方 Release 页，不是 Nebula Cafe",
    expected: product,
    actual: d.title,
    refs: [
      ref(FILES.INDEX, d.titleAt.line, `解码负载第 ${d.titleAt.line} 行（物理第 ${PAYLOAD_LINE} 行）`, d.titleAt.excerpt),
      ref(FILES.README, readme.product.line, "README 口径", readme.product.excerpt),
    ],
    selector: "html > head > title",
    metric: { claim: "product-name", layer: "payload", decodedLine: d.titleAt.line },
  });

  push({
    id: "R004",
    anchor: { file: FILES.INDEX, line: PAYLOAD_LINE },
    severity: "mismatch",
    title: "首屏 H1 是 Release，README 卖的是咖啡客流预测看板",
    expected: product,
    actual: d.h1,
    refs: [
      ref(FILES.INDEX, d.h1At.line, `解码后 <h1>（第 ${d.h1At.line} 行）`, d.h1At.excerpt),
      ref(FILES.README, readme.title.line, "README H1", readme.title.excerpt),
    ],
    selector: "main section.hero h1",
  });

  push({
    id: "R005",
    anchor: { file: FILES.INDEX, line: sh.keyLine },
    severity: "mismatch",
    title: "README 宣称 Streamlit + 无 JavaScript 库，制品却是混淆 JS 引导并 new Function 执行负载",
    expected: "Streamlit (custom CSS, no JavaScript libraries)",
    actual: `XOR/base64 引导器 ${sh.bootstrapBytes}B，运行期 new Function() eval`,
    refs: [
      ref(FILES.INDEX, sh.keyLine, "硬编码 XOR 密钥"),
      ref(FILES.INDEX, sh.evalLine, "new Function 执行解码脚本"),
      ref(FILES.README, readme.noJsLibraries.line, "README 技术栈", readme.noJsLibraries.excerpt),
    ],
    selector: "body > script",
    script: { layer: "shell", line: sh.evalLine, snippet: "(new Function(PYACqI[1]))();", note: "异常被空 catch 吞掉" },
    metric: { claim: "tech-stack", bootstrapBytes: sh.bootstrapBytes },
  });

  push({
    id: "R006",
    anchor: { file: FILES.INDEX, line: PAYLOAD_LINE },
    severity: "mismatch",
    title: "全部外链与自动跳转指向第三方 pandoramods.top，违背 README 本地/无第三方承诺",
    expected: "zero cloud uploads by default；no third-party services without consent",
    actual: `${d.externalHref.length} 个外链 → ${target.target}；REDIRECT_MS=${target.redirectMs}`,
    refs: [
      ref(FILES.INDEX, target.line, `解码脚本第 ${target.line} 行：定时跳转`, target.excerpt),
      ref(FILES.INDEX, firstAnchor.line, `解码 DOM 第 ${firstAnchor.line} 行：外链锚点`, firstAnchor.excerpt),
      ref(FILES.README, readme.localOnly.line, "README 本地优先", readme.localOnly.excerpt),
    ],
    selector: `a[href="${target.target}"]`,
    script: {
      layer: "payload", decodedLine: target.line,
      snippet: `var TARGET="${target.target}"; var REDIRECT_MS=${target.redirectMs}; setTimeout(…,REDIRECT_MS);`,
    },
    metric: { claim: "third-party", externalLinks: d.externalHref.length, redirectMs: target.redirectMs },
  });

  push({
    id: "R007",
    anchor: { file: FILES.INDEX, line: PAYLOAD_LINE },
    severity: "mismatch",
    title: "README 承诺完全离线可用，落地页定时强跳在线第三方域名",
    expected: "Offline Mode — Full functionality without internet",
    actual: `setTimeout redirect ${target.redirectMs}ms -> ${target.target}`,
    refs: [
      ref(FILES.INDEX, target.line, "跳转脚本"),
      ref(FILES.README, readme.offline.line, "README 离线特性", readme.offline.excerpt),
    ],
    script: { layer: "payload", decodedLine: target.line, snippet: `redirect after ${target.redirectMs}ms` },
    metric: { claim: "offline", redirectMs: target.redirectMs },
  });

  push({
    id: "R008",
    anchor: { file: FILES.INDEX, line: PAYLOAD_LINE },
    severity: "mismatch",
    title: `README 称 ${readme.languages.value.length} 语言，页面只有 lang="${d.lang}" 且无切换控件`,
    expected: readme.languages.value.join(", "),
    actual: `lang="${d.lang}"，0 个语言切换 UI`,
    refs: [
      ref(FILES.INDEX, d.langAt.line, `解码后 <html>（第 ${d.langAt.line} 行）`, d.langAt.excerpt),
      ref(FILES.README, readme.languages.line, "README 多语言", readme.languages.excerpt),
    ],
    selector: "html[lang]",
    metric: { claim: "languages", expected: readme.languages.value.length, actual: 1 },
  });

  push({
    id: "R009",
    anchor: { file: FILES.INDEX, line: PAYLOAD_LINE },
    severity: "missing",
    title: "README 的 24/7 自动支持 bot 在三份制品中均不存在",
    expected: "24/7 automated support bot embedded in sidebar",
    actual: "index.html / preview.svg / button.svg 中 0 个 bot/chat/sidebar 元素",
    refs: [
      ref(FILES.INDEX, PAYLOAD_LINE, "整份解码 DOM 无 bot 节点（负载物理第 9 行）"),
      ref(FILES.README, readme.bot.line, "README bot 口径", readme.bot.excerpt),
    ],
    metric: { claim: "support-bot", present: false },
  });

  const corpus = `${d.textVisible} ${preview.texts.map((t) => t.text).join(" ")} ${button.texts.map((t) => t.text).join(" ")}`;
  const metricChecks = [
    ["forecast-accuracy", `${readme.forecastAccuracy.value}%`, readme.forecastAccuracy, "预测准确率指标"],
    ["forecast-days", `${readme.forecastDays.value} days`, readme.forecastDays, "预测窗口指标"],
    ["waste-reduction", `${readme.wasteReduction.value}%`, readme.wasteReduction, "减损指标"],
    ["busiest-hour", readme.busiestHour.value, readme.busiestHour, "最忙时段指标"],
  ];
  for (const [claim, needle, src, labelCn] of metricChecks) {
    const present = corpus.includes(needle);
    push({
      id: `M-${claim}`,
      anchor: { file: FILES.INDEX, line: PAYLOAD_LINE },
      severity: present ? "consistent" : "missing",
      title: present
        ? `${labelCn} ${needle} 能在制品中找到`
        : `${labelCn} “${needle}” 在页面与两张 SVG 中全部缺失`,
      expected: needle,
      actual: present ? needle : "0 处出现",
      refs: [
        ref(FILES.README, src.line, "README 指标原文", src.excerpt),
        ref(FILES.INDEX, d.stats[0] ? d.stats[0].line : PAYLOAD_LINE, "解码后指标区仅 Stars/Forks/Size/Version"),
      ],
      metric: { claim, expected: needle, present },
    });
  }

  const fabricated = {
    Stars: "README 无 star 口径",
    Forks: "README 无 fork 口径",
    "Archive size": "README 指示 Download ZIP 获取 Python 源码，无 101.0 MB 归档",
    Latest: "README Roadmap 中 v1.0 计划于 Q1 2026，无 v2.1.1",
  };
  for (const st of d.stats) {
    const isFab = Object.prototype.hasOwnProperty.call(fabricated, st.label);
    push({
      id: `STAT-${st.label.replace(/\W+/g, "").toLowerCase()}`,
      anchor: { file: FILES.INDEX, line: PAYLOAD_LINE },
      severity: isFab ? "mismatch" : "info",
      title: isFab
        ? `页面指标 “${st.label} = ${st.text}” 在 README 无口径支撑（${fabricated[st.label]}）`
        : `页面指标 ${st.label}=${st.text}`,
      expected: "README 可核对口径（94% / 30% / 7 days 等）",
      actual: `${st.label}: ${st.text}`,
      refs: [
        ref(FILES.INDEX, st.line, `解码负载第 ${st.line} 行 .stat`, st.excerpt),
        ref(FILES.README, readme.forecastAccuracy.line, "README 业务指标", readme.forecastAccuracy.excerpt),
      ],
      selector: "div.stats .stat",
      metric: { claim: "on-page-metric", label: st.label, value: st.text },
    });
  }

  push({
    id: "R012",
    anchor: { file: FILES.INDEX, line: PAYLOAD_LINE },
    severity: "mismatch",
    title: "Hero pill 伪造发布事实 v2.1.1 · stable/3.3 · updated 43 mins ago",
    expected: "README：v1.0 尚在 Q1 2026 Roadmap，无 release channel",
    actual: "v2.1.1 / stable/3.3 / 43 mins ago",
    refs: [
      ref(FILES.INDEX, d.pillAt.line, `解码负载第 ${d.pillAt.line} 行 pill`, d.pillAt.excerpt),
      ref(FILES.README, 79, "README Roadmap Q1 2026: Release v1.0"),
    ],
    selector: "span.pill",
    metric: { claim: "release-facts" },
  });

  push({
    id: "R013",
    anchor: { file: FILES.INDEX, line: PAYLOAD_LINE },
    severity: "mismatch",
    title: "页面给出 SHA-256 / GitHub Verified / SLSA 3 / ClamAV 等供应链断言，README 无任何对应口径",
    expected: "README 仅声明 MIT 与本地处理，无哈希 / provenance / 杀毒断言",
    actual: d.sha256 ? d.sha256.value : "(hash not found)",
    refs: [
      ...(d.sha256 ? [ref(FILES.INDEX, d.sha256.line, `解码负载第 ${d.sha256.line} 行 SHA-256`, d.sha256.excerpt)] : []),
      ref(FILES.INDEX, d.cards[0] ? d.cards[0].line : PAYLOAD_LINE, "ClamAV / SLSA 卡片"),
      ref(FILES.README, readme.license.line, "README 许可证", readme.license.excerpt),
    ],
    selector: "div.file-hash .hash",
    metric: { claim: "supply-chain-claims" },
  });

  // ============ preview.svg ============
  // README 把 preview.svg 当项目头图（第 1 行），但图里没有任何咖啡/看板元素。
  push({
    id: "S001",
    anchor: { file: FILES.PREVIEW, line: preview.projectName ? preview.projectName.line : 1 },
    severity: "mismatch",
    title: "preview.svg 主标题是工程名 + “Installer”，README 产品是 Nebula Cafe 预测看板",
    expected: product,
    actual: "artisanal-streamlit-brew-metrics / Installer / One-click installer",
    refs: [
      ref(FILES.PREVIEW, preview.projectName.line, "preview.svg #projectName", preview.projectName.excerpt),
      ref(FILES.PREVIEW, preview.installerWord.line, "preview.svg Installer", preview.installerWord.excerpt),
      ref(FILES.README, 1, "README 第 1 行把 preview.svg 当项目头图"),
      ref(FILES.README, readme.title.line, "README 产品名", readme.title.excerpt),
    ],
    svg: { file: FILES.PREVIEW, selector: "text#projectName" },
  });

  push({
    id: "S002",
    anchor: { file: FILES.PREVIEW, line: preview.installSh ? preview.installSh.line : 1 },
    severity: "mismatch",
    title: "preview.svg 画的是 install.sh 终端安装流程，README 交付物是纯 Python + Download ZIP（无安装向导）",
    expected: "No installation wizards — just pure Python code",
    actual: "$ ./install.sh … Installation complete!",
    refs: [
      ref(FILES.PREVIEW, preview.installSh.line, "终端标题 install.sh", preview.installSh.excerpt),
      ref(FILES.PREVIEW, preview.completeLine.line, "Installation complete", preview.completeLine.excerpt),
      ref(FILES.README, readme.noWizard.line, "README 无安装向导", readme.noWizard.excerpt),
    ],
    svg: { file: FILES.PREVIEW, selector: "g text" },
  });

  push({
    id: "S003",
    anchor: { file: FILES.PREVIEW, line: preview.windows.line },
    severity: "mismatch",
    title: "preview.svg 宣称 Windows + macOS 桌面安装，README 技术栈是 Python 3.10 / Streamlit（Web，无桌面安装）",
    expected: "Backend Python 3.10+；Frontend Streamlit（浏览器内）",
    actual: "badge: Windows + macOS；terminal: [OK] Windows / macOS",
    refs: [
      ref(FILES.PREVIEW, preview.windows.line, "Windows 徽标", preview.windows.excerpt),
      ref(FILES.PREVIEW, preview.macos.line, "macOS 徽标", preview.macos.excerpt),
      ref(FILES.README, readme.pythonVersion.line, "README 技术栈", readme.pythonVersion.excerpt),
    ],
    svg: { file: FILES.PREVIEW, selector: "g[transform='translate(222, 465)']" },
  });

  push({
    id: "S004",
    anchor: { file: FILES.PREVIEW, line: preview.autoUpdate.line },
    severity: "mismatch",
    title: "preview.svg 的 “Auto-Update CI” 与 README 的 Offline Mode / 本地处理冲突",
    expected: "Offline Mode — Full functionality without internet",
    actual: "badge “Auto-Update CI”",
    refs: [
      ref(FILES.PREVIEW, preview.autoUpdate.line, "Auto-Update CI 徽章", preview.autoUpdate.excerpt),
      ref(FILES.README, readme.offline.line, "README 离线特性", readme.offline.excerpt),
    ],
    svg: { file: FILES.PREVIEW, selector: "g[transform='translate(566, 465)'] text" },
  });

  push({
    id: "S005",
    anchor: { file: FILES.PREVIEW, line: 1 },
    severity: "missing",
    title: "preview.svg 没有任何 README 核心可视化元素（客流热图、LSTM 预测带、库存红绿黄）",
    expected: "adaptive color-coded heatmaps / confidence bands / inventory reorder colors",
    actual: "图形仅含包装盒、齿轮、终端、4 枚平台/许可证徽章",
    refs: [
      ref(FILES.PREVIEW, 1, "preview.svg 根节点（无图表/热图元素）"),
      ref(FILES.README, readme.forecastDays.line, "README 预测特性", readme.forecastDays.excerpt),
    ],
    svg: { file: FILES.PREVIEW, selector: "svg" },
  });

  // ============ button.svg ============
  push({
    id: "B001",
    anchor: { file: FILES.BUTTON, line: button.downloadLatest.line },
    severity: "mismatch",
    title: "button.svg 动作文案 “Download Latest” 暗示持续更新的二进制，README 只说下载源码 ZIP",
    expected: "locate the green button … select “Download ZIP” … pull the source",
    actual: "Download Latest",
    refs: [
      ref(FILES.BUTTON, button.downloadLatest.line, "button.svg 动作文案", button.downloadLatest.excerpt),
      ref(FILES.README, readme.noWizard.line, "README 下载说明", readme.noWizard.excerpt),
    ],
    svg: { file: FILES.BUTTON, selector: "text" },
  });

  push({
    id: "B002",
    anchor: { file: FILES.BUTTON, line: button.projectName.line },
    severity: "consistent",
    title: "button.svg 上的工程名与 README 链接路径中的仓库名一致",
    expected: "artisanal-streamlit-brew-metrics",
    actual: "artisanal-streamlit-brew-metrics",
    refs: [
      ref(FILES.BUTTON, button.projectName.line, "button.svg #projectName", button.projectName.excerpt),
      ref(FILES.README, 48, "README 按钮链接", "raw.githubusercontent.com/Zayfern/artisanal-streamlit-brew-metrics/main/button.svg"),
    ],
    svg: { file: FILES.BUTTON, selector: "text#projectName" },
  });

  // SVG 配色与 index 调色板不一致（SVG 用 GitHub 暗色硬编码，页面用 HSL 令牌紫调）
  push({
    id: "B003",
    anchor: { file: FILES.BUTTON, line: 8 },
    severity: "mismatch",
    title: "两张 SVG 硬编码 #39d353/#0ea5e9 绿色系，index 主题令牌是 hsl(300,…) 紫色系，三者非同一套皮肤",
    expected: "统一的设计令牌（同一 accent 色）",
    actual: `SVG 硬编码 ${preview.colors.length} 色 / ${preview.colorSites.length} 处；index :root 用 ${d.cssVars.length} 个 CSS 变量且 0 个 var() 引用进 SVG`,
    refs: [
      ref(FILES.BUTTON, 8, "button.svg 渐变停靠点 #39d353"),
      ref(FILES.PREVIEW, 8, "preview.svg 渐变停靠点 #39d353"),
      ref(FILES.INDEX, PAYLOAD_LINE, `index :root 令牌 --hue:300（解码负载第 10 行）`),
    ],
    svg: { file: FILES.BUTTON, selector: "linearGradient stop" },
    metric: {
      claim: "theme-tokens",
      svgHardcodedSites: preview.colorSites.length + button.colorSites.length,
      svgUniqueColors: new Set([...preview.colors, ...button.colors]).size,
      svgVarRefs: preview.varRefs + button.varRefs,
      indexCssVars: d.cssVars.length,
    },
  });

  return order(findings);
}

function order(findings) {
  return findings.sort((a, b) => {
    const fa = FILE_ORDER[a.anchor.file] ?? 9;
    const fb = FILE_ORDER[b.anchor.file] ?? 9;
    if (fa !== fb) return fa - fb;
    if (a.anchor.line !== b.anchor.line) return a.anchor.line - b.anchor.line;
    return a.id.localeCompare(b.id);
  });
}
