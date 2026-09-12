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
import nextManifest from 'next/package.json' with { type: 'json' };
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    resolve(APP_ROOT, '.receipts', 'verify-assert-next16.json'),
    {
      lane: '@animus-ui/next16-app#verify:assert',
      host: 'next',
      hostVersion: nextManifest.version,
      mode: 'production',
      packageForm: 'workspace',
      engineConfigPath: resolve(APP_ROOT, 'next.config.ts'),
    }
  );
  console.log(
    `[next16-app:assert] receipt → .receipts/verify-assert-next16.json (engine=${receipt.engineLoaded}, default=${receipt.engineDefault}, override=${receipt.engineOverride})`
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

  assertKeyframesExtracted(css, {
    insideLayer: 'anm-global',
    minBlocks: 2,
    minReferences: 2,
  });

  // Next can emit class names into JS as well as CSS, so both are scanned.
  const jsFiles = await findJsFiles(STATIC_JS);
  const jsContent = await readAllConcat(jsFiles);
  assertClassNameFormat(`${css}\n${jsContent}`, { prefix: 'animus-' });

  for (const jsFile of jsFiles) {
    const js = await readFile(jsFile, 'utf8');
    assertNoEmotionImports(js);
  }

  // App Router only: this lane's fixture ships no Pages Router.
  await assertDir(resolve(NEXT_DIR, 'server', 'app'), 'App Router output');

  console.log(
    `[next16-app:assert] ${cssFiles.length} CSS file(s), ${jsFiles.length} JS file(s), App Router present — all assertions passed`
  );

  emitLaneReceipt();
}

main().catch((err) => {
  if (err instanceof AssertionError) {
    console.error(`[next16-app:assert] FAIL: ${err.message}`);
    if (err.details) {
      console.error('  details:', JSON.stringify(err.details, null, 2));
    }
  } else {
    console.error('[next16-app:assert] unexpected error:', err);
  }
  process.exit(1);
});
