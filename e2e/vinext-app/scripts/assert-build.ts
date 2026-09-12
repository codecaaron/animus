import {
  AssertionError,
  assertClassNameFormat,
  assertLayerOrder,
  assertNoEmotionImports,
  assertNoPlaceholders,
  findJsFiles,
  installedHostVersion,
  layerBlock,
  readAllConcat,
  readRequiredCss,
  writeLaneReceipt,
} from '@animus-ui/assertions';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const APP_ROOT = resolve(import.meta.dirname, '..');
const DIST = resolve(APP_ROOT, 'dist');
// Wrangler serves dist/client, so the CSS proof must run there rather than
// over dist/server.
const CLIENT_ROOT = resolve(DIST, 'client');

function emitLaneReceipt(): void {
  // Engine identity is derived by writeLaneReceipt from the fixture config;
  // `vinext` hides its package.json, so the version comes from the install.
  const receipt = writeLaneReceipt(
    resolve(APP_ROOT, '.receipts', 'verify-assert-vinext.json'),
    {
      lane: '@animus-ui/vinext-app#verify:assert',
      host: 'vinext',
      hostVersion: installedHostVersion(APP_ROOT, 'vinext'),
      mode: 'production',
      packageForm: 'workspace',
      engineConfigPath: resolve(APP_ROOT, 'vite.config.ts'),
    }
  );
  console.log(
    `[vinext-app:assert] receipt → .receipts/verify-assert-vinext.json (engine=${receipt.engineLoaded}, default=${receipt.engineDefault}, override=${receipt.engineOverride})`
  );
}

async function main(): Promise<void> {
  const css = await readRequiredCss(
    CLIENT_ROOT,
    'vinext served-client CSS (dist/client)'
  );
  assertLayerOrder(css, {
    layers: [layerBlock('anm-base'), layerBlock('anm-variants')],
  });
  if (!css.includes(':root')) {
    throw new AssertionError(
      'Expected a :root variable block in Vinext served-client CSS (dist/client)'
    );
  }
  assertNoPlaceholders(css);
  assertClassNameFormat(css, { prefix: 'animus-' });

  // JS/hydration discovery keeps its own scope over the whole build root.
  const jsFiles = await findJsFiles(DIST);
  const js = await readAllConcat(jsFiles);
  if (!js.includes('Vinext RSC canary')) {
    throw new AssertionError('App Router RSC marker missing from build');
  }
  if (!js.includes('Vinext Pages Router canary')) {
    throw new AssertionError('Pages Router marker missing from build');
  }
  for (const file of jsFiles) {
    assertNoEmotionImports(await readFile(file, 'utf8'));
  }

  console.log(
    `[vinext-app:assert] served-client CSS (dist/client) + ${jsFiles.length} JS file(s), App+Pages routers present — all assertions passed`
  );

  emitLaneReceipt();
}

main().catch((error) => {
  console.error('[vinext-app:assert] FAIL:', error);
  process.exit(1);
});
