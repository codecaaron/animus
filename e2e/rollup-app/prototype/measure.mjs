// DEF-1 decider (increment 04): build both prototype arms, gate each on
// CORRECTNESS (rendered classes ⊆ stylesheet selectors, no empty base
// class, dev diagnostics compiled out), then measure cold wall-clock —
// T0 = one in-process rollup build; T2 = `animus build` precondition +
// rollup build whose hydration replays analysis in-process. Three runs
// each, medians reported.
import { execFileSync, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const lane = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rollupBin = join(lane, 'node_modules', '.bin', 'rollup');
const animusBin = join(lane, 'node_modules', '.bin', 'animus');
const RUNS = 3;

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function timed(fn) {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

function rollupBuild(config) {
  // spawnSync so the T2 shim's stderr hydration report is CAPTURED, not
  // discarded (inc 04 entropy audit F1).
  const res = spawnSync(rollupBin, ['-c', join(lane, 'prototype', config)], {
    cwd: lane,
    encoding: 'utf-8',
  });
  if (res.status !== 0) {
    throw new Error(`rollup ${config} failed:\n${res.stderr}`);
  }
  const m = /hydration \(full re-analysis\): (\d+)ms/.exec(res.stderr ?? '');
  return m ? Number(m[1]) : null;
}

function animusBuild() {
  execFileSync(
    animusBin,
    ['build', '--root', '.', '--system', './src/ds.ts', '--strict'],
    { cwd: lane, stdio: ['ignore', 'ignore', 'pipe'] }
  );
}

async function correctnessGate(bundlePath, label) {
  const failures = [];
  const mod = await import(bundlePath + `?v=${Math.random()}`);
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createElement } = await import('react');
  const html = renderToStaticMarkup(createElement(mod.App));
  const sheet = mod.stylesheet;

  const classAttrs = [...html.matchAll(/class="([^"]*)"/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter(Boolean);
  if (classAttrs.length === 0) {
    failures.push('no class attributes rendered at all');
  }
  for (const cls of classAttrs) {
    if (cls.startsWith('--')) {
      failures.push(`empty base class artifact rendered: '${cls}'`);
    } else if (!sheet.includes(`.${cls}`)) {
      failures.push(`rendered class '.${cls}' not found in the stylesheet`);
    }
  }
  const bundleSource = (await import('node:fs')).readFileSync(
    bundlePath,
    'utf-8'
  );
  if (bundleSource.includes('[animus:drop]')) {
    failures.push('dev diagnostic strings survived into the production bundle');
  }
  if (failures.length > 0) {
    console.error(`  ✗ ${label} correctness:`);
    for (const f of failures) console.error(`      - ${f}`);
    return false;
  }
  console.error(
    `  ✓ ${label} correctness (${classAttrs.length} classes matched, dev strings absent)`
  );
  return true;
}

// ── T0: in-process ───────────────────────────────────────────────────
const t0Times = [];
for (let i = 0; i < RUNS; i++) {
  t0Times.push(timed(() => rollupBuild('rollup.t0.config.mjs')));
}
const t0Ok = await correctnessGate(
  join(lane, 'prototype', 'out', 't0-bundle.mjs'),
  'T0 (in-process)'
);

// ── T2: artifact-fed (CLI precondition + consumer build) ─────────────
const cliTimes = [];
const t2Times = [];
const hydrationTimes = [];
for (let i = 0; i < RUNS; i++) {
  rmSync(join(lane, '.animus'), { recursive: true, force: true });
  cliTimes.push(timed(() => animusBuild()));
  let hydration = null;
  t2Times.push(
    timed(() => {
      hydration = rollupBuild('rollup.t2.config.mjs');
    })
  );
  if (hydration !== null) hydrationTimes.push(hydration);
}
const t2Ok = await correctnessGate(
  join(lane, 'prototype', 'out', 't2-bundle.mjs'),
  'T2 (artifact-fed)'
);

// Payload parity, CLI vs in-process host (same fixture, same session
// composition — the pinned frame inc 03's [~] deferred to): the T0
// bundle's stylesheet must byte-equal the CLI's published styles.css.
// (The vite-plugin leg of parity lands with inc 05's emitter decision.)
const { readFileSync } = await import('node:fs');
const t0Mod = await import(
  join(lane, 'prototype', 'out', 't0-bundle.mjs') + `?p=${Math.random()}`
);
const cliSheet = readFileSync(join(lane, '.animus', 'styles.css'), 'utf-8');
const parityOk = t0Mod.stylesheet === cliSheet;
console.error(
  `  ${parityOk ? '✓' : '✗'} payload parity: T0 in-process sheet ${parityOk ? 'byte-equals' : 'DIFFERS FROM'} CLI styles.css`
);
if (!parityOk) process.exit(1);

console.error('\n── DEF-1 measurement (medians over ' + RUNS + ' runs) ──');
console.error(
  `  T0 rollup build (analysis in-process): ${median(t0Times).toFixed(0)}ms`
);
console.error(
  `  T2 animus build precondition:          ${median(cliTimes).toFixed(0)}ms`
);
console.error(
  `  T2 rollup build (incl. hydration):     ${median(t2Times).toFixed(0)}ms`
);
console.error(
  `  T2 hydration ISOLATED (shim-reported): ${hydrationTimes.length ? median(hydrationTimes).toFixed(0) + 'ms' : 'NOT CAPTURED'}`
);
console.error(
  `  T2 total (precondition + build):       ${(median(cliTimes) + median(t2Times)).toFixed(0)}ms`
);
console.error(
  `  correctness: T0=${t0Ok ? 'PASS' : 'FAIL'} T2=${t2Ok ? 'PASS' : 'FAIL'}`
);

if (!t0Ok || !t2Ok) process.exit(1);
