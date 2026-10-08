/**
 * Runs the custom-property fixtures in headless Chromium and compares computed
 * values with their expectations. It writes the browser it ran on, and every
 * observed value, to `.receipts/browser-fixtures.json`.
 *
 * The showcase case reads the `--current-bg` registration from the built
 * showcase stylesheet, so it needs `packages/showcase/dist`.
 */
import { findCssFiles, readAllConcat } from '@animus-ui/assertions';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

import {
  PLATFORM_CASES,
  showcaseCurrentBg,
  VIEWPORT_WIDTH,
  type FixtureCase,
  type Probe,
} from './cases';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOWCASE_DIST = resolve(ROOT, 'packages', 'showcase', 'dist');
const RECEIPT = resolve(ROOT, '.receipts', 'browser-fixtures.json');

interface ProbeResult extends Probe {
  case: string;
  actual: string;
}

async function showcaseCase(): Promise<FixtureCase> {
  const files = await findCssFiles(SHOWCASE_DIST);
  const registration = /@property\s+--current-bg\s*\{[^}]*\}/.exec(
    await readAllConcat(files)
  )?.[0];
  if (registration === undefined) {
    throw new Error(
      `No @property --current-bg rule under ${SHOWCASE_DIST}. Build the showcase first: vp run @animus-ui/showcase#verify:build`
    );
  }
  return showcaseCurrentBg(registration);
}

async function main(): Promise<void> {
  const cases = [...PLATFORM_CASES, await showcaseCase()];
  const browser = await chromium.launch();
  const browserName = browser.browserType().name();
  const browserVersion = browser.version();
  const results: ProbeResult[] = [];
  try {
    const page = await browser.newPage({
      viewport: { width: VIEWPORT_WIDTH, height: 800 },
    });
    for (const fixture of cases) {
      await page.setContent(
        `<!doctype html><html><head><style>body { margin: 0; } ${fixture.css}</style></head><body>${fixture.body}</body></html>`
      );
      for (const probe of fixture.probes) {
        const actual = await page.evaluate(
          ({ selector, pseudo, property }) => {
            const element = document.querySelector(selector);
            if (element === null) return `missing element ${selector}`;
            return getComputedStyle(element, pseudo ?? null).getPropertyValue(
              property
            );
          },
          {
            selector: probe.selector,
            pseudo: probe.pseudo,
            property: probe.property,
          }
        );
        results.push({ ...probe, case: fixture.name, actual });
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
