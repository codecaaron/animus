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
  // Retirement regression guard (openspec: retire-extract-v1): v2 is the only
  // engine. The showcase config MUST NOT reference ANIMUS_ENGINE or set the
  // engine option — either would reintroduce a retired v1 selection path.
  const config = readFileSync(resolve(SHOWCASE_ROOT, 'vite.config.ts'), 'utf8');
  if (config.includes('ANIMUS_ENGINE') || /\bengine\s*:/.test(config)) {
    throw new AssertionError(
      'packages/showcase/vite.config.ts must not reference ANIMUS_ENGINE or ' +
        'set the engine option — the v1 engine was retired (openspec: retire-extract-v1)'
    );
  }

  // v1 is retired (openspec: retire-extract-v1): v2 is the only engine, so the
  // receipt records v2 as both default and loaded, with no override.
  const engineDefault = 'v2' as const;
  const engineLoaded = 'v2' as const;
  const engineOverride = false;

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
      lane: '@animus-ui/showcase#verify:assert',
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
