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
} from '@animus-ui/assertions';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const BUILD = resolve(import.meta.dirname, '..', 'build');
// Wrangler serves build/client; semantic CSS must be proven there independently
// from build/server (canary delta: React Router served-client CSS proof).
const CLIENT_ROOT = resolve(BUILD, 'client');

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
}

main().catch((error) => {
  console.error('[react-router-app:assert] FAIL:', error);
  process.exit(1);
});
