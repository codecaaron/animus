import {
  AssertionError,
  assertClassNameFormat,
  assertColorSchemeEmission,
  assertConditionsInsideLayers,
  assertHeadInjectionContract,
  assertKeyframesExtracted,
  assertLayerOrder,
  assertNoBootstrapScript,
  assertNoDevDiagnostics,
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
import nextManifest from 'next/package.json' with { type: 'json' };
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
  // Engine identity is derived by writeLaneReceipt from the fixture config,
  // never spelled here; hostVersion is the installed host, not a range.
  const receipt = writeLaneReceipt(
    resolve(APP_ROOT, '.receipts', 'verify-assert-next.json'),
    {
      lane: '@animus-ui/next-app#verify:assert',
      host: 'next',
      hostVersion: nextManifest.version,
      mode: 'production',
      packageForm: 'workspace',
      engineConfigPath: resolve(APP_ROOT, 'next.config.ts'),
    }
  );
  console.log(
    `[next-app:assert] receipt → .receipts/verify-assert-next.json (engine=${receipt.engineLoaded}, default=${receipt.engineDefault}, override=${receipt.engineOverride})`
  );
}

async function main(): Promise<void> {
  await assertDir(NEXT_DIR, 'Next build output');

  const cssFiles = await findCssFiles(NEXT_DIR);
  if (cssFiles.length === 0) {
    throw new AssertionError(`No CSS file found under ${NEXT_DIR}`);
  }
  const css = await readAllConcat(cssFiles);

  // Lightning CSS emits `:root` after the layer blocks, so the stricter
  // :root-first order is not asserted here.
  assertLayerOrder(css, {
    layers: [layerBlock('anm-base'), layerBlock('anm-variants')],
  });

  if (!css.includes(':root')) {
    throw new AssertionError(
      'Expected a :root variable block in the CSS output'
    );
  }

  assertNoPlaceholders(css);

  // The theme's system-fallback blocks stay unlayered beside `:root` so an
  // explicit mode can override the OS fallback at the same cascade level.
  assertConditionsInsideLayers(css, {
    exemptSpans: systemSchemeVariableSpans(css),
  });

  assertKeyframesExtracted(css, {
    insideLayer: 'anm-global',
    minBlocks: 2,
    minReferences: 2,
  });

  assertSystemSchemeGuard(css, { expectSchemes: ['light', 'dark'] });

  assertColorSchemeEmission(css, {
    root: 'dark',
    modes: { dark: 'dark', light: 'light' },
    system: { light: 'light', dark: 'dark' },
  });

  assertSystemFallbackParity(css, {
    mapping: { light: 'light', dark: 'dark' },
  });

  // Next can emit class names into JS as well as CSS, so both are scanned.
  const jsFiles = await findJsFiles(STATIC_JS);
  const jsContent = await readAllConcat(jsFiles);
  assertClassNameFormat(`${css}\n${jsContent}`, { prefix: 'animus-' });

  for (const jsFile of jsFiles) {
    const js = await readFile(jsFile, 'utf8');
    assertNoEmotionImports(js);

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

    assertNoDevDiagnostics(js);
  }

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

  // The plugin injects nothing: `_document.tsx` places the artifact, and the
  // App Router places none, so its documents must stay marker-free.
  const legacyHtml = await readFile(resolve(pagesDir, 'legacy.html'), 'utf8');
  assertHeadInjectionContract(legacyHtml, {
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
