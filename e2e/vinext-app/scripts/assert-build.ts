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

const DIST = resolve(import.meta.dirname, '..', 'dist');
// Wrangler serves dist/client; semantic CSS must be proven there independently
// from dist/server (canary delta: Vinext served-client CSS proof).
const CLIENT_ROOT = resolve(DIST, 'client');

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
}

main().catch((error) => {
  console.error('[vinext-app:assert] FAIL:', error);
  process.exit(1);
});
