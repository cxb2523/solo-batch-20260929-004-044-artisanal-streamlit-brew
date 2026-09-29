/**
 * Assembles the board payload: parsed snapshot + reconciliation report
 * + measured trade-offs. Serialized once per revision and pushed via SSE.
 */
import { reconcile } from './reconcile.mjs';
import { measureTradeoffs } from './tradeoffs.mjs';
import { sha256 } from './lib.mjs';

export async function buildState(snapshot) {
  const report = reconcile(snapshot);
  const tradeoffs = await measureTradeoffs(snapshot);
  const state = {
    generatedAt: new Date().toISOString(),
    files: ['index.html', 'preview.svg', 'button.svg', 'README.md'],
    report,
    tradeoffs,
    graph: buildGraph(snapshot, report),
    sources: buildSources(snapshot),
  };
  state.revision = sha256(JSON.stringify({
    report: state.report,
    graphLabels: state.graph.nodes.map((node) => `${node.file}:${node.line}:${node.selector}:${node.label}`),
    metrics: [snapshot.index, snapshot.preview, snapshot.button].map((doc) =>
      doc.metrics.map((metricRec) => `${metricRec.key}=${metricRec.value}@${metricRec.line}`)),
  })).slice(0, 16);
  return state;
}

function buildGraph(snapshot, report) {
  // Nodes are clickable references into selectors / inline script / SVG text.
  const nodes = [];
  const edges = [];

  const addNode = (node) => {
    const key = nodeKey(node);
    if (!nodes.some((existing) => nodeKey(existing) === key)) nodes.push(node);
  };

  for (const metricRec of snapshot.index.metrics) {
    addNode({
      id: `idx-metric-${metricRec.key}-${metricRec.line}`,
      kind: metricRec.selector === 'script' ? 'script' : 'dom',
      group: 'index.html',
      file: 'index.html',
      line: metricRec.line,
      selector: metricRec.selector,
      label: `${metricRec.key} = ${metricRec.value}`,
      detail: metricRec.raw,
    });
  }
  for (const scriptRec of snapshot.index.scripts) {
    addNode({
      id: `idx-script-${scriptRec.line}`,
      kind: 'script',
      group: 'index.html',
      file: 'index.html',
      line: scriptRec.line,
      selector: 'script',
      label: scriptRec.redirectTarget ? `inline script → ${scriptRec.redirectTarget}` : 'inline script',
      detail: scriptRec.snippet,
    });
  }
  for (const domRec of snapshot.index.dom) {
    addNode({
      id: `idx-dom-${domRec.line}-${domRec.selector}`,
      kind: 'dom',
      group: 'index.html',
      file: 'index.html',
      line: domRec.line,
      selector: domRec.selector,
      label: domRec.snippet ? String(domRec.snippet).slice(0, 80) : domRec.selector,
      detail: domRec.snippet,
    });
  }
  for (const ref of snapshot.index.payloadRefs || []) {
    addNode({
      id: `idx-payload-${ref.line}`,
      kind: 'bootstrap',
      group: 'index.html',
      file: 'index.html',
      line: ref.line,
      selector: `#${ref.id}`,
      label: `encoded payload chunk ${ref.id}`,
      detail: ref.snippet,
    });
  }
  if (snapshot.index.bootstrap) {
    addNode({
      id: 'idx-bootstrap',
      kind: 'bootstrap',
      group: 'index.html',
      file: 'index.html',
      line: snapshot.index.bootstrap.line,
      selector: 'script#bootstrap',
      label: 'bootstrap decoder (atob + XOR)',
      detail: snapshot.index.bootstrap.snippet,
    });
  }

  for (const svgRec of [snapshot.preview, snapshot.button]) {
    for (const domRec of svgRec.dom) {
      addNode({
        id: `${svgRec.file}-text-${domRec.line}-${domRec.selector}`,
        kind: 'svg',
        group: svgRec.file,
        file: svgRec.file,
        line: domRec.line,
        tagLine: domRec.tagLine,
        selector: domRec.selector,
        label: domRec.snippet,
        detail: domRec.snippet,
      });
    }
    for (const ref of svgRec.refs) {
      addNode({
        id: `${svgRec.file}-ref-${ref.line}-${ref.target}`,
        kind: 'svg-ref',
        group: svgRec.file,
        file: svgRec.file,
        line: ref.line,
        selector: `url(#${ref.target})`,
        label: `reference → #${ref.target}`,
        detail: ref.snippet,
      });
    }
  }

  // README claim nodes, with edges to every check that cites them.
  for (const claim of snapshot.readme.claims) {
    addNode({
      id: `readme-${claim.id}-${claim.line}`,
      kind: 'readme',
      group: 'README.md',
      file: 'README.md',
      line: claim.line,
      selector: `claim:${claim.id}`,
      label: `${claim.id} = ${claim.value}`,
      detail: claim.raw,
    });
  }

  // Edges come from reconciliation refs: failed checks wire README lines to
  // index.html selectors / script snippets / preview.svg / button.svg references.
  for (const check of report.checks) {
    const refs = (check.refs || []).filter(Boolean);
    for (let i = 0; i < refs.length - 1; i++) {
      edges.push({
        from: nodeKey(refs[i]),
        to: nodeKey(refs[i + 1]),
        status: check.status,
        checkId: check.id,
      });
    }
  }

  // README -> embedded SVG reference edges (preview.svg / button.svg links).
  for (const svgRef of snapshot.readme.svgRefs) {
    edges.push({
      from: `README.md:${svgRef.line}:readme`,
      to: `${svgRef.name}:1:svg`,
      status: 'pass',
      checkId: 'readme.svgEmbed',
      externalUrl: svgRef.url,
    });
  }

  return { nodes, edges };
}

function nodeKey(ref) {
  if (ref.file === 'README.md') return `${ref.file}:${ref.line}:readme`;
  if (ref.file === 'index.html') {
    const kind = ref.kind || (ref.selector === 'script' ? 'script' : 'dom');
    return `${ref.file}:${ref.line}:${kind}`;
  }
  return `${ref.file}:${ref.line}:svg`;
}

function buildSources(snapshot) {
  // Lightweight source maps the board fetches on node click.
  return {
    'index.html': {
      decoded: snapshot.index.decodedHtml,
      rawBootstrapLine: snapshot.index.bootstrapLine,
      payloadRefs: snapshot.index.payloadRefs,
    },
  };
}
