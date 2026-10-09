/**
 * Runs the custom-property fixtures in headless Chromium and compares computed
 * values with their expectations. It writes the browser it ran on, and every
 * observed value, to `.receipts/browser-fixtures.json`.
 *
 * The showcase cases read the built showcase stylesheet, so they need
 * `packages/showcase/dist` (or `ANIMUS_SHOWCASE_DIST`). The runtime keyword
 * cases analyze a fixture through the native engine (`vp run
 * build:extract-v2`), and the runner imports the built `@animus-ui/assertions`
 * package (`vp run build:ts`).
 */
import { findCssFiles, readAllConcat } from '@animus-ui/assertions';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

import { resolveClasses } from '../../packages/system/src/runtime/resolveClasses';
import {
  PLATFORM_CASES,
  SHOWCASE_BG_SLOT,
  showcaseCurrentBg,
  showcaseRuntimeCurrentBg,
  PAGE_URL,
  STYLESHEET_URL,
  VIEWPORT_WIDTH,
  type FixtureCase,
} from './cases';
import { runtimeKeywordCases } from './runtime-keywords';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOWCASE_DIST =
  process.env.ANIMUS_SHOWCASE_DIST ??
  resolve(ROOT, 'packages', 'showcase', 'dist');
const RECEIPT = resolve(ROOT, '.receipts', 'browser-fixtures.json');

interface ProbeResult {
  case: string;
  label: string;
  selector: string;
  property: string;
  expected: string;
  actual: string;
}

function runtimeBg(value: string) {
  const { classes, dynamicStyle } = resolveClasses(
    '',
    { bg: value },
    { systemPropNames: ['bg'] },
    {},
    { bg: SHOWCASE_BG_SLOT }
  );
  return {
    className: classes.join(' ').trim(),
    style: Object.entries(dynamicStyle ?? {})
      .map(([name, css]) => `${name}: ${css}`)
      .join('; '),
  };
}

async function showcaseCases(): Promise<FixtureCase[]> {
  const css = await readAllConcat(await findCssFiles(SHOWCASE_DIST));
  const registration = /@property\s+--current-bg\s*\{[^}]*\}/.exec(css)?.[0];
  const staticBg =
    /\.(animus-u-[0-9a-f]{8})\{background-color:(var\(--color-[\w-]+\));--current-bg:\2\}/.exec(
      css
    );
  if (registration === undefined || staticBg === null) {
    throw new Error(
      `No @property --current-bg rule or static bg utility under ${SHOWCASE_DIST}. Build the showcase first: vp run @animus-ui/showcase#verify:build`
    );
  }
  return [
    showcaseCurrentBg(registration),
    showcaseRuntimeCurrentBg(
      css,
      { className: staticBg[1], value: staticBg[2] },
      runtimeBg
    ),
  ];
}

async function main(): Promise<void> {
  const cases = [
    ...PLATFORM_CASES,
    ...runtimeKeywordCases(),
    ...(await showcaseCases()),
  ];
  const browser = await chromium.launch();
  const browserName = browser.browserType().name();
  const browserVersion = browser.version();
  const results: ProbeResult[] = [];
  try {
    const page = await browser.newPage({
      viewport: { width: VIEWPORT_WIDTH, height: 800 },
    });
    let served: FixtureCase | undefined;
    await page.route(`${new URL(PAGE_URL).origin}/**`, (route) => {
      const url = route.request().url();
      if (served !== undefined && url === PAGE_URL) {
        const head =
          served.serve === 'linked'
            ? `<link rel="stylesheet" href="${STYLESHEET_URL}">`
            : `<style>body { margin: 0; } ${served.css}</style>`;
        return route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html><head>${head}</head><body>${served.body}</body></html>`,
        });
      }
      if (served !== undefined && url === STYLESHEET_URL) {
        return route.fulfill({
          contentType: 'text/css',
          body: `body { margin: 0; } ${served.css}`,
        });
      }
      return route.fulfill({ status: 404, body: '' });
    });
    for (const fixture of cases) {
      if (fixture.serve !== undefined) {
        served = fixture;
        await page.goto(PAGE_URL);
      } else {
        await page.setContent(
          `<!doctype html><html><head><style>body { margin: 0; } ${fixture.css}</style></head><body>${fixture.body}</body></html>`
        );
      }
      const computed = (selector: string, property: string, pseudo?: string) =>
        page.evaluate(
          (read) => {
            const element = document.querySelector(read.selector);
            if (element === null) return `missing element ${read.selector}`;
            return getComputedStyle(
              element,
              read.pseudo ?? null
            ).getPropertyValue(read.property);
          },
          { selector, property, pseudo }
        );
      for (const probe of fixture.probes) {
        const actual = await computed(
          probe.selector,
          probe.property,
          probe.pseudo
        );
        const expected =
          'sameAs' in probe
            ? await computed(
                probe.sameAs,
                probe.sameAsProperty ?? probe.property
              )
            : probe.expected;
        results.push({
          case: fixture.name,
          label: probe.label,
          selector: probe.selector,
          property: probe.property,
          expected,
          actual,
        });
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`[browser-fixtures] ${browserName} ${browserVersion}`);
  let currentCase = '';
  for (const result of results) {
    if (result.case !== currentCase) {
      currentCase = result.case;
      console.log(`\n${currentCase}`);
    }
    const pass = result.actual === result.expected;
    const detail = pass
      ? result.actual
      : `expected ${result.expected}, got ${result.actual}`;
    console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${result.label}: ${detail}`);
  }

  mkdirSync(dirname(RECEIPT), { recursive: true });
  writeFileSync(
    RECEIPT,
    `${JSON.stringify({ browser: { name: browserName, version: browserVersion }, results }, null, 2)}\n`
  );
  console.log(`\n[browser-fixtures] receipt → .receipts/browser-fixtures.json`);

  const failures = results.filter(
    (result) => result.actual !== result.expected
  );
  if (failures.length > 0) {
    console.error(
      `[browser-fixtures] ${failures.length} of ${results.length} probes failed`
    );
    process.exitCode = 1;
  }
}

await main();
