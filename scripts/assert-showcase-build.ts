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

  assertKeyframesExtracted(css, { insideLayer: 'anm-global' });

  const html = await readFile(resolve(DIST, 'index.html'), 'utf8');

  assertHeadInjectionContract(html);

  assertSystemSchemeGuard(css, { expectSchemes: ['light', 'dark'] });

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
