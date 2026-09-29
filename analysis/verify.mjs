#!/usr/bin/env node
/**
 * One-shot verification: parse the three artifacts, reconcile them against
 * README.md and print every disagreement with file + line references.
 *
 * Exit code:
 *   0 -> every check passed
 *   1 -> at least one inconsistency (the first is printed explicitly)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTextWithRetry } from './lib.mjs';
import { parseIndex, parseSvg, parseReadme } from './parse.mjs';
import { reconcile } from './reconcile.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

async function main() {
  const read = (name) => readTextWithRetry(path.join(root, name));
  const [indexHtml, previewSvg, buttonSvg, readmeMd] = await Promise.all(
    ['index.html', 'preview.svg', 'button.svg', 'README.md'].map(read)
  );

  const parsed = {
    generatedAt: new Date().toISOString(),
    index: parseIndex(indexHtml.text),
    preview: parseSvg('preview.svg', previewSvg.text),
    button: parseSvg('button.svg', buttonSvg.text),
    readme: parseReadme(readmeMd.text),
  };
  const report = reconcile(parsed);

  console.log('='.repeat(78));
  console.log('Nebula Cafe artifact/report consistency verification');
  console.log('='.repeat(78));
  console.log(`checks: ${report.total}   passed: ${report.passed}   failed: ${report.failures}`);
  console.log('');

  for (const check of report.checks) {
    const tag = check.status === 'pass' ? 'PASS' : 'FAIL';
    console.log(`[${tag}] ${check.id}  ${check.title}`);
    if (check.status === 'fail') {
      console.log(`        expected: ${check.expected}`);
      console.log(`        actual  : ${check.actual}`);
      for (const ref of check.refs || []) {
        if (!ref) continue;
        console.log(`        at ${ref.file}:${ref.line}${ref.selector ? `  (${ref.selector})` : ''}`);
      }
    }
  }

  console.log('');
  if (report.first) {
    const firstRefs = (report.first.refs || []).filter(Boolean);
    console.log('-'.repeat(78));
    console.log(`FIRST INCONSISTENCY: ${report.first.id}`);
    console.log(`  ${report.first.title}`);
    console.log(`  expected: ${report.first.expected}`);
    console.log(`  actual  : ${report.first.actual}`);
    for (const ref of firstRefs) {
      console.log(`  -> ${ref.file}:${ref.line}${ref.selector ? ` [${ref.selector}]` : ''}${ref.text ? `  ${String(ref.text).trim()}` : ''}`);
    }
    if (firstRefs.length) {
      console.log(`FIRST MISMATCH LOCATION: ${firstRefs[0].file}:${firstRefs[0].line}`);
    }
    console.log('-'.repeat(78));
    process.exitCode = 1;
  } else {
    console.log('All artifact claims reconcile with README.md.');
  }
}

main().catch((err) => {
  console.error('verify failed to run:', err);
  process.exit(2);
});
