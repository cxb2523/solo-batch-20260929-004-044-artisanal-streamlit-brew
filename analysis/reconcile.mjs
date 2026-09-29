/**
 * Reconcile parsed artifacts against README.md claims.
 * Every check returns a stable id, status, human message and, on failure,
 * concrete file + line references for both sides of the disagreement.
 */

function claimIndex(readme) {
  const byId = new Map();
  for (const claim of readme.claims) {
    if (!byId.has(claim.id)) byId.set(claim.id, claim);
  }
  return byId;
}

function metricIndex(parsed) {
  const out = new Map();
  for (const rec of parsed.index.metrics) {
    if (!out.has(rec.key)) out.set(rec.key, rec);
  }
  return out;
}

function svgTextRef(svg, predicate) {
  for (const metricRec of svg.metrics) {
    if (predicate(metricRec)) return { file: svg.file, line: metricRec.line, selector: metricRec.selector, text: metricRec.value };
  }
  return null;
}

function containsAny(text, needles) {
  const lower = String(text).toLowerCase();
  return needles.some((needle) => lower.includes(String(needle).toLowerCase()));
}

export function reconcile(parsed) {
  const claims = claimIndex(parsed.readme);
  const metrics = metricIndex(parsed);
  const checks = [];
  const fail = (id, title, expected, actual, refs) =>
    checks.push({ id, title, status: 'fail', expected, actual, refs });
  const pass = (id, title, detail, refs = []) =>
    checks.push({ id, title, status: 'pass', detail, refs });

  const readmeRef = (id) => {
    const claim = claims.get(id);
    return claim ? { file: 'README.md', line: claim.line, selector: `claim:${id}`, text: claim.raw } : null;
  };
  const compact = (value) => (value == null ? '' : String(value));

  // 1. Installer claim: README says "no installation wizards"; preview.svg ships one.
  {
    const claim = claims.get('delivery.installer');
    const installer = svgTextRef(parsed.preview, (m) => m.key === 'svg.text' && /one-click installer/i.test(m.value));
    const installSh = svgTextRef(parsed.preview, (m) => m.key === 'svg.text' && /install\.sh/i.test(m.value));
    if (claim && (installer || installSh)) {
      const where = installer || installSh;
      fail('delivery.installer.svg', 'preview.svg advertises an installer the README forbids',
        'README: no installation wizards, pure Python source',
        `preview.svg: "${where.text}"`,
        [readmeRef('delivery.installer'), where].filter(Boolean));
    } else {
      pass('delivery.installer.svg', 'No installer advertised in preview.svg', 'matches README', claim ? [readmeRef('delivery.installer')] : []);
    }
  }

  // 2. Product name: README "Nebula Cafe" vs page title/h1 "Zayfern • Release".
  {
    const claim = claims.get('product.name');
    const title = metrics.get('page.title');
    const h1 = metrics.get('page.h1');
    const expected = claim ? String(claim.value) : null;
    const badTitle = title && expected && !String(title.value).toLowerCase().includes(expected.toLowerCase());
    if (claim && badTitle) {
      fail('product.name.title', 'index.html <title> is a different product',
        expected, compact(title?.value),
        [readmeRef('product.name'), { file: 'index.html', line: title.line, selector: 'title', text: title.raw }]);
    } else {
      pass('product.name.title', '<title> matches README product', compact(title?.value), title ? [{ file: 'index.html', line: title.line, selector: 'title' }] : []);
    }
    if (claim && h1 && !containsAny(h1.value, [expected, 'nebula'])) {
      fail('product.name.h1', 'index.html <h1> is a different product',
        expected, compact(h1.value),
        [readmeRef('product.name'), { file: 'index.html', line: h1.line, selector: 'h1', text: h1.raw }]);
    }
  }

  // 3. Version: README roadmap v1.0 vs page v2.1.1.
  {
    const claim = claims.get('roadmap.nextVersion');
    const version = metrics.get('release.version');
    if (claim && version && String(claim.value) !== String(version.value)) {
      fail('release.version', 'Released version contradicts README roadmap',
        compact(claim.value), compact(version.value),
        [readmeRef('roadmap.nextVersion'), { file: 'index.html', line: version.line, selector: '.pill strong', text: version.raw }]);
    }
  }

  // 4. Platforms: README = Python (Streamlit); preview.svg = Windows/macOS binary installer.
  {
    const claim = claims.get('tech.frontend');
    const win = svgTextRef(parsed.preview, (m) => m.key === 'svg.text' && /^windows$/i.test(m.value.trim()));
    const mac = svgTextRef(parsed.preview, (m) => m.key === 'svg.text' && /^macos$/i.test(m.value.trim()));
    if (claim && (win || mac)) {
      fail('tech.platforms', 'preview.svg ships desktop binaries instead of the Python/Streamlit app',
        compact(claim.value),
        `Windows/macOS badges + install.sh`,
        [readmeRef('tech.frontend'), win, mac].filter(Boolean));
    }
  }

  // 5. Forecast accuracy 94% missing on page.
  {
    const claim = claims.get('forecast.accuracyPct');
    const found = parsed.index.metrics.some((m) => m.key === 'forecast.accuracyPct') ||
      /forecast|lstm|accuracy/i.test(parsed.index.decodedHtml || '');
    if (claim && !found) {
      fail('forecast.accuracyPct', '94% forecast accuracy from README is absent from index.html',
        `${claim.value}% accuracy`, 'no forecast/accuracy claim on page',
        [readmeRef('forecast.accuracyPct')]);
    }
  }

  // 6. Forecast horizon 7 days missing on page.
  {
    const claim = claims.get('forecast.horizonDays');
    const found = parsed.index.metrics.some((m) => m.key === 'forecast.horizonDays') ||
      /7[- ]day|7 days|lstm/i.test(parsed.index.decodedHtml || '');
    if (claim && !found) {
      fail('forecast.horizonDays', '7-day forecast horizon from README is absent from index.html',
        `${claim.value} days`, 'no horizon claim on page',
        [readmeRef('forecast.horizonDays')]);
    }
  }

  // 7. 30% waste reduction missing on page.
  {
    const claim = claims.get('inventory.wasteReductionPct');
    const found = parsed.index.metrics.some((m) => m.key === 'inventory.wasteReductionPct') ||
      /waste|inventory/i.test(parsed.index.decodedHtml || '');
    if (claim && !found) {
      fail('inventory.wasteReductionPct', '30% waste-reduction claim from README is absent from index.html',
        `${claim.value}% reduction`, 'no inventory/waste claim on page',
        [readmeRef('inventory.wasteReductionPct')]);
    }
  }

  // 8. Four languages missing on page.
  {
    const claim = claims.get('i18n.languageCount');
    const found = parsed.index.metrics.some((m) => m.key === 'i18n.languageCount') ||
      /multilingual|spanish|mandarin|arabic/i.test(parsed.index.decodedHtml || '');
    if (claim && !found) {
      fail('i18n.languageCount', '4-language support from README is absent from index.html',
        `${claim.value} languages`, 'no language claim on page',
        [readmeRef('i18n.languageCount')]);
    }
  }

  // 9. Unbacked stats: stars/forks/archive size appear on page but nowhere in README.
  for (const key of ['stat.stars', 'stat.forks', 'artifact.sizeMb']) {
    const metricRec = metrics.get(key);
    if (!metricRec) continue;
    const label = metricRec.label || key;
    const inReadme = new RegExp(String(metricRec.value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(parsed.readme.html || '');
    if (!inReadme) {
      fail(`unbacked.${key}`, `Page metric "${label}" is not backed by README.md`,
        'must be sourced from README', `${label} = ${metricRec.value}`,
        [{ file: 'index.html', line: metricRec.line, selector: '.stats .stat', text: metricRec.raw }]);
    }
  }

  // 10. Forced external redirect: README is a local, zero-upload, consent-first tool.
  {
    const target = metrics.get('script.redirectTarget');
    const redirectMs = metrics.get('script.redirectMs');
    const noCloud = claims.get('privacy.cloudUploads');
    if (target) {
      const host = String(target.value);
      const githubish = /github|zayfern/i.test(host);
      const refs = [{ file: 'index.html', line: target.line, selector: 'script', text: target.raw }];
      if (noCloud) refs.unshift(readmeRef('privacy.cloudUploads'));
      fail('behavior.redirect', `Inline script force-redirects to ${host} after ${redirectMs ? redirectMs.value : '?'}ms`,
        'README: local processing, no third-party contact without consent',
        `window.location.href = ${target.detail?.href || host}`,
        refs.filter(Boolean));
    }
  }

  // 11. Repository slug stays consistent (passing anchor, also links the SVGs).
  {
    const repo = metrics.get('artifact.repo');
    const slugInSvg = /artisanal-streamlit-brew-metrics/i.test(
      parsed.preview.metrics.map((m) => m.value).join(' ') + parsed.button.metrics.map((m) => m.value).join(' '));
    if (repo && slugInSvg && /artisanal-streamlit-brew-metrics/i.test(repo.value)) {
      const name = svgTextRef(parsed.preview, (m) => m.id === 'projectName') ||
        svgTextRef(parsed.button, (m) => m.id === 'projectName');
      pass('identity.repoSlug', 'Repository slug matches across README, page and SVGs', repo.value,
        name ? [{ file: name.file, line: name.line, selector: name.selector, text: name.value }] : []);
    }
  }

  // 12. License consistency.
  {
    const claim = claims.get('license');
    const mitOnPage = /MIT Licensed/i.test(parsed.index.decodedHtml || '');
    const mitSvg = parsed.preview.metrics.some((m) => /^MIT$/i.test(m.value.trim()));
    if (claim && mitOnPage && mitSvg) {
      const ref = svgTextRef(parsed.preview, (m) => /^MIT$/i.test(m.value.trim()));
      pass('license.mit', 'MIT license consistent across README, page and preview.svg', 'MIT',
        [readmeRef('license'), ref].filter(Boolean));
    } else if (claim) {
      fail('license.mit', 'MIT license not present on all surfaces', 'MIT everywhere',
        `page=${mitOnPage} svg=${mitSvg}`, [readmeRef('license')]);
    }
  }

  const failures = checks.filter((check) => check.status === 'fail');
  return {
    generatedAt: parsed.generatedAt,
    total: checks.length,
    failures: failures.length,
    passed: checks.length - failures.length,
    first: failures[0] || null,
    checks,
  };
}
