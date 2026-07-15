import {
  AssertionError,
  assertClassNameFormat,
  assertKeyframesExtracted,
  assertLayerOrder,
  assertNoEmotionImports,
  assertNoPlaceholders,
  findCssFiles,
  findJsFiles,
  layerBlock,
  readAllConcat,
  writeLaneReceipt,
} from '@animus-ui/assertions';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOWCASE_ROOT = resolve(REPO_ROOT, 'packages', 'showcase');
const DIST = resolve(SHOWCASE_ROOT, 'dist');

function emitLaneReceipt(): void {
  // Engine facts are MEASURED, not hardcoded (mirrors scripts/verify/packed.sh).
  // The showcase fixture selects its engine via
  // `engine: process.env.ANIMUS_ENGINE ...` in packages/showcase/vite.config.ts;
  // confirm that env-driven form is still present so the receipt reads the
  // config rather than assuming it, then mirror the expression it evaluates.
  const config = readFileSync(resolve(SHOWCASE_ROOT, 'vite.config.ts'), 'utf8');
  const engineExpr = config.match(
    /ANIMUS_ENGINE\s*===\s*['"]v1['"]\s*\?\s*['"](v[12])['"]\s*:\s*['"](v[12])['"]/
  );
  if (!engineExpr) {
    throw new AssertionError(
      'Expected an ANIMUS_ENGINE-driven engine option in packages/showcase/vite.config.ts — update the receipt probe'
    );
  }
  // Both arms of the config's engine expression are captured, so the loaded
  // engine is measured from the config that governed the build — a config
  // fallback flip changes the receipt without touching this script.
  const engineOverride = process.env.ANIMUS_ENGINE === 'v1';
  const engineLoaded = (engineOverride ? engineExpr[1] : engineExpr[2]) as
    | 'v1'
    | 'v2';

  // Default engine is measured from the workspace vite plugin source (showcase
  // builds through the vite plugin) so a future default flip changes the
  // receipt without touching this script. Symbol: `options.engine ?? 'v2'` in
  // packages/vite-plugin/src/index.ts.
  const pluginSrc = readFileSync(
    resolve(REPO_ROOT, 'packages', 'vite-plugin', 'src', 'index.ts'),
    'utf8'
  );
  const defaultMatch = pluginSrc.match(/engine\s*\?\?\s*['"](v[12])['"]/);
  if (!defaultMatch) {
    throw new AssertionError(
      'Cannot determine default engine from packages/vite-plugin/src/index.ts — update the receipt probe'
    );
  }
  const engineDefault = defaultMatch[1] as 'v1' | 'v2';

  // hostVersion from the fixture's installed host, not the manifest range.
  const hostVersion = (
    JSON.parse(
      readFileSync(
        resolve(SHOWCASE_ROOT, 'node_modules', 'vite', 'package.json'),
        'utf8'
      )
    ) as { version: string }
  ).version;

  writeLaneReceipt(
    resolve(SHOWCASE_ROOT, '.receipts', 'verify-assert-showcase.json'),
    {
      lane: 'verify:assert:showcase',
      host: 'vite',
      hostVersion,
      mode: 'production',
      engineLoaded,
      engineDefault,
      engineOverride,
      packageForm: 'workspace',
    }
  );
  console.log(
    `[showcase:assert] receipt → packages/showcase/.receipts/verify-assert-showcase.json (engine=${engineLoaded}, default=${engineDefault}, override=${engineOverride})`
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

  assertNoPlaceholders(css);
  assertClassNameFormat(css, { prefix: 'animus-' });

  // Keyframes extracted through the Vite plugin — packages/showcase/src/ds.ts
  // exports an `animations` collection from §3B. Thresholds are intentionally
  // minimal so upstream fixture edits don't require assertion updates; the
  // dangling-reference + px-mangling guards remain the load-bearing checks.
  assertKeyframesExtracted(css, { insideLayer: 'anm-global' });

  const jsFiles = await findJsFiles(DIST);
  for (const jsFile of jsFiles) {
    const js = await readFile(jsFile, 'utf8');
    assertNoEmotionImports(js);
  }

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
