// Standing asserts for the transform host (openspec:
// standalone-extraction-cli inc 05, specs/bundler-transform-host):
//
//   1. Correctness gate (graduated from prototype/measure.mjs): rendered
//      class attributes ⊆ emitted stylesheet selectors, no empty base
//      class, and the WIDENED dev-marker set absent from the production
//      bundle (inc 04 rider F5 — '[animus:drop]' plus the reachability
//      witness handle).
//   2. Kit coverage: the component imported from the admitted external
//      package renders with classes the emitted sheet contains (the
//      kit-specifier redirect witness).
//   3. CLI-vs-host payload parity over pinned inputs (D6/D10): the host's
//      emitted animus.css byte-equals the CLI's published styles.css.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const lane = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = join(lane, 'dist', 'bundle.mjs');
const sheetPath = join(lane, 'dist', 'animus.css');
const cliSheetPath = join(lane, '.animus', 'styles.css');

const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures.push(name);
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

for (const [label, path] of [
  ['host bundle', bundlePath],
  ['host stylesheet asset', sheetPath],
  ['CLI styles.css', cliSheetPath],
]) {
  if (!existsSync(path)) {
    console.error(
      `ERROR: ${label} missing at ${path}. Run: vp run @animus-ui/rollup-app#verify:build`
    );
    process.exit(1);
  }
}

const sheet = readFileSync(sheetPath, 'utf-8');
const bundleSource = readFileSync(bundlePath, 'utf-8');
const mod = await import(bundlePath + `?v=${Math.random()}`);
const { renderToStaticMarkup } = await import('react-dom/server');
const { createElement } = await import('react');

const classesOf = (html) =>
  [...html.matchAll(/class="([^"]*)"/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter(Boolean);

const assertRendered = (label, html, { minClasses = 1 } = {}) => {
  const classes = classesOf(html);
  check(
    `${label}: renders with class attributes`,
    classes.length >= minClasses,
    `got ${classes.length}`
  );
  for (const cls of classes) {
    if (cls.startsWith('--')) {
      check(`${label}: no empty base class artifact`, false, `'${cls}'`);
    } else if (!sheet.includes(`.${cls}`)) {
      check(
        `${label}: rendered class in the emitted sheet`,
        false,
        `'.${cls}' not found`
      );
    }
  }
  return classes;
};

// ── 1. Correctness gate over the full app tree ───────────────────────
const appHtml = renderToStaticMarkup(createElement(mod.App));
const appClasses = assertRendered('app', appHtml, { minClasses: 2 });
check(
  'app: correctness gate classes matched',
  appClasses.length > 0 &&
    appClasses.every(
      (cls) => !cls.startsWith('--') && sheet.includes(`.${cls}`)
    )
);

// Widened dev-marker set (rider F5): the drop diagnostic AND the
// reachability-witness handle must be compiled out of a production build.
for (const marker of ['[animus:drop]', '__ANIMUS_WITNESS__']) {
  check(
    `production bundle excludes dev marker '${marker}'`,
    !bundleSource.includes(marker)
  );
}

// ── 2. Kit coverage (the kit-specifier redirect, finally exercised) ──
const kitHtml = renderToStaticMarkup(
  createElement(mod.Badge, { color: 'danger' }, 'kit')
);
const kitClasses = assertRendered('kit Badge', kitHtml);
check(
  'kit Badge classes all present in the emitted sheet',
  kitClasses.length > 0 &&
    kitClasses.every(
      (cls) => !cls.startsWith('--') && sheet.includes(`.${cls}`)
    )
);

// ── 3. CLI-vs-host payload parity (pinned mode: production) ──────────
const cliSheet = readFileSync(cliSheetPath, 'utf-8');
check(
  'payload parity: host animus.css byte-equals CLI styles.css',
  sheet === cliSheet
);

// ── 4. Asset reachability: the host published the files its sheet
// references (vacuity-guarded — the lane's ds.ts carries an asset() font
// witness, so zero matches means the scrape broke). ─────────────────────
const hostAssetUrls = [...sheet.matchAll(/url\(\.\/assets\/([^)'"]+)\)/g)].map(
  (match) => match[1]
);
check(
  'host sheet references at least one ./assets/ url (witness present)',
  hostAssetUrls.length > 0
);
for (const name of hostAssetUrls) {
  check(
    `emitted asset resolves beside animus.css: assets/${name}`,
    existsSync(join(dirname(sheetPath), 'assets', name))
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length} host assertion(s) failed`);
  process.exit(1);
}
console.log('\nall transform-host assertions passed');
