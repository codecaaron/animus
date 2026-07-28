import {
  AssertionError,
  assertBootstrapScriptFirst,
  assertClassNameFormat,
  assertColorSchemeEmission,
  assertConditionsInsideLayers,
  assertKeyframesExtracted,
  assertLayerOrder,
  assertNoBootstrapScript,
  assertNoEmotionImports,
  assertNoPlaceholders,
  assertSystemFallbackParity,
  assertSystemSchemeGuard,
  findBuildAssets,
  findCssFiles,
  findJsFiles,
  layerBlock,
  readAllConcat,
  systemSchemeVariableSpans,
  writeLaneReceipt,
} from '@animus-ui/assertions';
import { readFileSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { appearanceBootstrap } from '../appearance-bootstrap';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NEXT_DIR = resolve(APP_ROOT, '.next');
const STATIC_JS = resolve(NEXT_DIR, 'static');

async function assertDir(path: string, label: string): Promise<void> {
  try {
    const s = await stat(path);
    if (!s.isDirectory()) throw new Error('not a directory');
  } catch {
    throw new AssertionError(
      `${label}: ${path} does not exist or is not a directory`
    );
  }
}

function emitLaneReceipt(): void {
  // Retirement regression guard (openspec: retire-extract-v1): v2 is the only
  // engine. The fixture config MUST NOT reference ANIMUS_ENGINE or set the
  // engine option — either would reintroduce a retired v1 selection path.
  const config = readFileSync(resolve(APP_ROOT, 'next.config.ts'), 'utf8');
  if (config.includes('ANIMUS_ENGINE') || /\bengine\s*:/.test(config)) {
    throw new AssertionError(
      'next.config.ts must not reference ANIMUS_ENGINE or set the engine ' +
        'option — the v1 engine was retired (openspec: retire-extract-v1)'
    );
  }

  // v1 is retired (openspec: retire-extract-v1): v2 is the only engine, so the
  // receipt records v2 as both default and loaded, with no override. Engine
  // identity is never inferred from plugin/config source (guardrail G3).
  const engineDefault = 'v2' as const;
  const engineLoaded = 'v2' as const;
  const engineOverride = false;

  // hostVersion from the fixture's installed host, not the manifest range.
  const hostVersion = (
    JSON.parse(
      readFileSync(
        resolve(APP_ROOT, 'node_modules', 'next', 'package.json'),
        'utf8'
      )
    ) as { version: string }
  ).version;

  writeLaneReceipt(resolve(APP_ROOT, '.receipts', 'verify-assert-next.json'), {
    lane: '@animus-ui/next-app#verify:assert',
    host: 'next',
    hostVersion,
    mode: 'production',
    engineLoaded,
    engineDefault,
    engineOverride,
    packageForm: 'workspace',
  });
  console.log(
    `[next-app:assert] receipt → .receipts/verify-assert-next.json (engine=${engineLoaded}, default=${engineDefault}, override=${engineOverride})`
  );
}

async function main(): Promise<void> {
  await assertDir(NEXT_DIR, 'Next build output');

  const cssFiles = await findCssFiles(NEXT_DIR);
  if (cssFiles.length === 0) {
    throw new AssertionError(`No CSS file found under ${NEXT_DIR}`);
  }
  const css = await readAllConcat(cssFiles);

  // Cascade order (relaxed) — same contract as vite-app and showcase. See
  // `e2e/vite-app/scripts/assert-build.ts` for the TODO on re-enabling the
  // stricter :root-before-@layer order post `fix-lightningcss-cascade`.
  //
  // §11.8 carry-forward from sessions 75/76: the previous shell script
  // grepped for `@layer base` / `@layer variants`, but Animus actually emits
  // `@layer anm-base` / `@layer anm-variants`. The layerBlock() helper uses
  // the correct `anm-` prefix so that gap closes here.
  assertLayerOrder(css, {
    layers: [layerBlock('anm-base'), layerBlock('anm-variants')],
  });

  if (!css.includes(':root')) {
    throw new AssertionError(
      'Expected a :root variable block in the CSS output'
    );
  }

  assertNoPlaceholders(css);

  // Guardrail G2 (modern-css-surface): condition at-rules must nest inside a
  // named @layer block. Non-vacuous here — the imported test-ds Card emits raw
  // @container / @media / @supports rules into this build's CSS.
  //
  // Exempt: the theme's variable-level system fallback blocks (openspec:
  // system-color-scheme), which live in the UNLAYERED variables part beside
  // `:root`. The exemption is earned per block — see
  // `systemSchemeVariableSpans`.
  assertConditionsInsideLayers(css, {
    exemptSpans: systemSchemeVariableSpans(css),
  });

  // Keyframes extracted through the webpack adapter — the fixture declares
  // `animations = keyframes({ fadeIn, pulse })` in src/ds.ts; the assertion
  // proves both blocks land in @layer anm-global, both animation-name refs
  // resolve to a matching block, and neither got px-mangled by unit-fallback.
  assertKeyframesExtracted(css, {
    insideLayer: 'anm-global',
    minBlocks: 2,
    minReferences: 2,
  });

  // ── System color scheme (openspec: system-color-scheme, D2/D6) ──────────
  //
  // Guardrail G2: every root-targeting rule inside a prefers-color-scheme
  // block carries the `:root:not([data-color-mode])` guard, and both guarded
  // blocks actually exist with custom properties (non-vacuous).
  assertSystemSchemeGuard(css, { expectSchemes: ['light', 'dark'] });

  // Classification reaches `:root` (initial mode `dark`), each explicit mode
  // block, and each guarded block, so native surfaces follow the active mode
  // including the OS-driven one.
  assertColorSchemeEmission(css, {
    root: 'dark',
    modes: { dark: 'dark', light: 'light' },
    system: { light: 'light', dark: 'dark' },
  });

  // OS path and explicit path are the same rendering: the guarded block's
  // declarations equal the mapped mode block's, and `:root` precedes both.
  assertSystemFallbackParity(css, {
    mapping: { light: 'light', dark: 'dark' },
  });

  // Class-name assertion runs on the full build output (JS + HTML emitted by
  // Next may include the class names, not just the CSS).
  const jsFiles = await findJsFiles(STATIC_JS);
  const jsContent = await readAllConcat(jsFiles);
  assertClassNameFormat(`${css}\n${jsContent}`, { prefix: 'animus-' });

  for (const jsFile of jsFiles) {
    const js = await readFile(jsFile, 'utf8');
    assertNoEmotionImports(js);

    // Bootstrap entry-point isolation: `_document.tsx` is server-only, so
    // neither the generator nor the storage key it embeds may appear in a
    // CLIENT chunk under .next/static. The snippet reaches the browser as HTML
    // text and nothing else.
    for (const identifier of [
      'createAppearanceBootstrap',
      'animus:appearance',
    ]) {
      const offset = js.indexOf(identifier);
      if (offset !== -1) {
        throw new AssertionError(
          `bootstrap entry-point isolation: client chunk ${jsFile} contains '${identifier}' at offset ${offset}`,
          { jsFile, identifier, offset }
        );
      }
    }
  }

  // Router coverage — same checks as the prior shell script.
  await assertDir(resolve(NEXT_DIR, 'server', 'app'), 'App Router output');

  const pagesDir = resolve(NEXT_DIR, 'server', 'pages');
  let pagesEntries: string[];
  try {
    pagesEntries = await readdir(pagesDir);
  } catch {
    throw new AssertionError(`Pages Router directory not found: ${pagesDir}`);
  }
  const hasLegacy = pagesEntries.some((name) => name.startsWith('legacy'));
  if (!hasLegacy) {
    throw new AssertionError(
      `Pages Router legacy page output not found under ${pagesDir}`,
      { entries: pagesEntries }
    );
  }

  // ── No-flash delivery, application-owned (D6) ───────────────────────────
  //
  // The Animus Next plugin injects nothing. `pages/_document.tsx` places the
  // artifact itself, so this lane witnesses BOTH halves of that contract in a
  // single build:
  //
  //  • Pages Router — the script is present in <head> and precedes the first
  //    stylesheet reference (Next emits `<link as="style">` before the
  //    stylesheet link, so the preload is the real bar to clear). Comparing the
  //    emitted text to `appearanceBootstrap.code` and re-hashing it proves the
  //    delivery path did not re-encode the snippet: a CSP assembled from
  //    `cspHash` authorizes exactly these bytes.
  //
  //  • App Router — `app/layout.tsx` deliberately places nothing, so its
  //    prerendered documents must come out with no bootstrap marker at all.
  //    That is the live negative witness for "no automatic injection"; without
  //    it, a plugin that started injecting would still pass every check above.
  const legacyHtml = await readFile(resolve(pagesDir, 'legacy.html'), 'utf8');
  assertBootstrapScriptFirst(legacyHtml, {
    code: appearanceBootstrap.code,
    cspHash: appearanceBootstrap.cspHash,
  });

  const appHtmlFiles = await findBuildAssets({
    dir: resolve(NEXT_DIR, 'server', 'app'),
    extensions: ['.html'],
  });
  if (appHtmlFiles.length === 0) {
    throw new AssertionError(
      'no App Router HTML found — the no-automatic-injection witness would be vacuous',
      { dir: resolve(NEXT_DIR, 'server', 'app') }
    );
  }
  for (const htmlFile of appHtmlFiles) {
    assertNoBootstrapScript(await readFile(htmlFile, 'utf8'));
  }

  console.log(
    `[next-app:assert] ${cssFiles.length} CSS file(s), ${jsFiles.length} JS file(s), App+Pages routers present, bootstrap placed in Pages Router only (${appHtmlFiles.length} App Router document(s) clean) — all assertions passed`
  );

  emitLaneReceipt();
}

main().catch((err) => {
  if (err instanceof AssertionError) {
    console.error(`[next-app:assert] FAIL: ${err.message}`);
    if (err.details) {
      console.error('  details:', JSON.stringify(err.details, null, 2));
    }
  } else {
    console.error('[next-app:assert] unexpected error:', err);
  }
  process.exit(1);
});
