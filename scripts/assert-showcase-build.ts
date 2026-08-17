import {
  AssertionError,
  assertClassNameFormat,
  assertHeadInjectionContract,
  assertKeyframesExtracted,
  assertLayerOrder,
  assertNoEmotionImports,
  assertNoPlaceholders,
  assertSystemSchemeGuard,
  findCssFiles,
  findJsFiles,
  installedHostVersion,
  layerBlock,
  readAllConcat,
  writeLaneReceipt,
} from '@animus-ui/assertions';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOWCASE_ROOT = resolve(REPO_ROOT, 'packages', 'showcase');
const DIST = resolve(SHOWCASE_ROOT, 'dist');

function emitLaneReceipt(): void {
  // Engine identity comes from writeLaneReceipt's retirement guard over the
  // showcase config (openspec: retire-extract-v1) — never spelled here.
  // hostVersion from the fixture's installed host, not the manifest range.
  const receipt = writeLaneReceipt(
    resolve(SHOWCASE_ROOT, '.receipts', 'verify-assert-showcase.json'),
    {
      lane: '@animus-ui/showcase#verify:assert',
      host: 'vite',
      hostVersion: installedHostVersion(SHOWCASE_ROOT, 'vite'),
      mode: 'production',
      packageForm: 'workspace',
      engineConfigPath: resolve(SHOWCASE_ROOT, 'vite.config.ts'),
      engineConfigLabel: 'packages/showcase/vite.config.ts',
    }
  );
  console.log(
    `[showcase:assert] receipt → packages/showcase/.receipts/verify-assert-showcase.json (engine=${receipt.engineLoaded}, default=${receipt.engineDefault}, override=${receipt.engineOverride})`
  );
}

async function main(): Promise<void> {
  const cssFiles = await findCssFiles(DIST);
  if (cssFiles.length === 0) {
    throw new AssertionError(`No CSS file found under ${DIST}`, { dir: DIST });
  }
  for (const cssFile of cssFiles) {
    const stat = (await readFile(cssFile, 'utf8')).length;
    if (stat === 0) {
      throw new AssertionError(`CSS file is empty: ${cssFile}`);
    }
  }
  const css = await readAllConcat(cssFiles);

  // Cascade order for showcase — the same relaxed pattern we use for vite-app
  // (see note there; blocked on `fix-lightningcss-cascade`).
  assertLayerOrder(css, {
    layers: [
      layerBlock('anm-global'),
      layerBlock('anm-base'),
      layerBlock('anm-variants'),
    ],
  });

  if (!css.includes(':root')) {
    throw new AssertionError(
      'Expected a :root variable block in the CSS output'
    );
  }

  // Registered @property wire pin (modern-css-surface inc 08, closing the
  // inc-07 V9 gap): the showcase theme registers `current-bg` with
  // registration metadata, so the dist MUST carry its @property rule in the
  // variables part — before the first @layer block. If the ds.ts → NAPI →
  // dist registration wire breaks, this fails loud.
  const propertyIdx = css.indexOf('@property --current-bg');
  if (propertyIdx === -1) {
    throw new AssertionError(
      'registered @property pin: expected `@property --current-bg` in the dist CSS (theme registers it with metadata)'
    );
  }
  const firstLayerBlockIdx = css.search(/@layer [\w-]+\s*\{/);
  if (firstLayerBlockIdx !== -1 && propertyIdx > firstLayerBlockIdx) {
    throw new AssertionError(
      'registered @property pin: `@property --current-bg` must precede the first @layer block (variables part)'
    );
  }

  assertNoPlaceholders(css);
  assertClassNameFormat(css, { prefix: 'animus-' });

  // Keyframes extracted through the Vite plugin — packages/showcase/src/ds.ts
  // exports an `animations` collection from §3B. Thresholds are intentionally
  // minimal so upstream fixture edits don't require assertion updates; the
  // dangling-reference + px-mangling guards remain the load-bearing checks.
  assertKeyframesExtracted(css, { insideLayer: 'anm-global' });

  // ── Appearance bootstrap + system-preference pins ────────────────────
  // (openspec: system-color-scheme). The showcase is the reference consumer:
  // it generates the bootstrap artifact config-time and lets the plugin inject
  // it. Each check below is a regression the pipeline can produce silently —
  // the page still builds and renders, it just flashes the wrong mode.
  const html = await readFile(resolve(DIST, 'index.html'), 'utf8');

  // (a) The head-injection contract: the snippet exists, precedes every
  // stylesheet reference (link, style preload, or inline <style> — including
  // the plugin's own @layer tag), and the injection has not pushed the app's
  // <meta charset> past the HTML spec's silent 1024-byte cliff. Non-vacuous by
  // design: a document with no stylesheet reference at all FAILS, because "the
  // script came first" is unwitnessable there. (vite.config.ts passes
  // `appearanceBootstrap`, so the script must exist.)
  assertHeadInjectionContract(html);

  // (b) The OS-preference fallback must be GUARDED by attribute absence — an
  // unguarded root-targeting `prefers-color-scheme` rule would beat explicit
  // modes and silently override the user's choice. `expectSchemes` makes it
  // non-vacuous in the other direction: both guarded blocks must exist and
  // assign custom properties (ds.ts declares `systemPreference` on both axes).
  // Author-level `_osDark`/`_osLight` component blocks in the same sheet are
  // accepted — only root-targeting rules owe the guard.
  assertSystemSchemeGuard(css, { expectSchemes: ['light', 'dark'] });

  // (c) Following the OS is a CSS fact, never a scripted one. A `matchMedia`
  // call in the document means someone reintroduced a hand-rolled pre-paint
  // script — the exact pattern this capability replaced.
  if (html.includes('matchMedia')) {
    throw new AssertionError(
      'system preference pin: dist/index.html must not call `matchMedia` — OS preference is followed by attribute absence plus emitted CSS, not by script'
    );
  }

  const jsFiles = await findJsFiles(DIST);
  for (const jsFile of jsFiles) {
    const js = await readFile(jsFile, 'utf8');
    assertNoEmotionImports(js);
  }

  console.log(
    '[showcase:assert] appearance bootstrap precedes stylesheets; guarded prefers-color-scheme block present; no matchMedia in HTML'
  );

  console.log(
    `[showcase:assert] ${cssFiles.length} CSS file(s), ${jsFiles.length} JS file(s) validated — all assertions passed`
  );

  emitLaneReceipt();
}

main().catch((err) => {
  if (err instanceof AssertionError) {
    console.error(`[showcase:assert] FAIL: ${err.message}`);
    if (err.details) {
      console.error('  details:', JSON.stringify(err.details, null, 2));
    }
  } else {
    console.error('[showcase:assert] unexpected error:', err);
  }
  process.exit(1);
});
