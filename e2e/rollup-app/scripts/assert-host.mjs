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

const appHtml = renderToStaticMarkup(createElement(mod.App));
const appClasses = assertRendered('app', appHtml, { minClasses: 2 });
check(
  'app: correctness gate classes matched',
  appClasses.length > 0 &&
    appClasses.every(
      (cls) => !cls.startsWith('--') && sheet.includes(`.${cls}`)
    )
);

for (const marker of ['[animus:drop]', '__ANIMUS_WITNESS__']) {
  check(
    `production bundle excludes dev marker '${marker}'`,
    !bundleSource.includes(marker)
  );
}

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

const cliSheet = readFileSync(cliSheetPath, 'utf-8');
check(
  'payload parity: host animus.css byte-equals CLI styles.css',
  sheet === cliSheet
);

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
