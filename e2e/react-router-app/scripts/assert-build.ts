import {
  AssertionError,
  assertClassNameFormat,
  assertLayerOrder,
  assertNoEmotionImports,
  assertNoPlaceholders,
  findJsFiles,
  layerBlock,
  readAllConcat,
  readRequiredCss,
  writeLaneReceipt,
} from '@animus-ui/assertions';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import routerManifest from 'react-router/package.json' with { type: 'json' };

const APP_ROOT = resolve(import.meta.dirname, '..');
const BUILD = resolve(APP_ROOT, 'build');
// Wrangler serves build/client; semantic CSS must be proven there independently
// from build/server (canary delta: React Router served-client CSS proof).
const CLIENT_ROOT = resolve(BUILD, 'client');

function emitLaneReceipt(): void {
  // Engine identity comes from writeLaneReceipt's retirement guard over the
  // fixture config (openspec: retire-extract-v1) — never spelled here.
  //
  // hostVersion from the fixture's installed host, not the manifest range.
  const receipt = writeLaneReceipt(
    resolve(APP_ROOT, '.receipts', 'verify-assert-react-router.json'),
    {
      lane: '@animus-ui/react-router-app#verify:assert',
      host: 'react-router',
      hostVersion: routerManifest.version,
      mode: 'production',
      packageForm: 'workspace',
      engineConfigPath: resolve(APP_ROOT, 'vite.config.ts'),
    }
  );
  console.log(
    `[react-router-app:assert] receipt → .receipts/verify-assert-react-router.json (engine=${receipt.engineLoaded}, default=${receipt.engineDefault}, override=${receipt.engineOverride})`
  );
}

async function main(): Promise<void> {
  const css = await readRequiredCss(
    CLIENT_ROOT,
    'react-router served-client CSS (build/client)'
  );
  assertLayerOrder(css, {
    layers: [layerBlock('anm-base'), layerBlock('anm-variants')],
  });
  if (!css.includes(':root'))
    throw new AssertionError(
      'Expected a :root variable block in React Router served-client CSS (build/client)'
    );
  assertNoPlaceholders(css);
  assertClassNameFormat(css, { prefix: 'animus-' });

  // JS/hydration discovery keeps its own scope over the whole build root.
  const jsFiles = await findJsFiles(BUILD);
  const js = await readAllConcat(jsFiles);
  if (!js.includes('React Router v8 SSR canary'))
    throw new AssertionError('SSR marker missing');
  if (!js.includes('React Router v8 client canary'))
    throw new AssertionError('Client marker missing');
  for (const file of jsFiles)
    assertNoEmotionImports(await readFile(file, 'utf8'));
  console.log(
    `[react-router-app:assert] served-client CSS (build/client) + ${jsFiles.length} JS — all assertions passed`
  );

  emitLaneReceipt();
}

main().catch((error) => {
  console.error('[react-router-app:assert] FAIL:', error);
  process.exit(1);
});
