import {
  AssertionError,
  assertClassNameFormat,
  assertLayerOrder,
  assertNoEmotionImports,
  assertNoPlaceholders,
  findCssFiles,
  findJsFiles,
  layerBlock,
  readAllConcat,
} from '@animus-ui/assertions';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DIST = resolve(import.meta.dirname, '..', 'dist');

async function main(): Promise<void> {
  const cssFiles = await findCssFiles(DIST);
  if (cssFiles.length === 0) {
    throw new AssertionError(`No CSS file found under ${DIST}`);
  }
  const css = await readAllConcat(cssFiles);
  assertLayerOrder(css, {
    layers: [layerBlock('anm-base'), layerBlock('anm-variants')],
  });
  if (!css.includes(':root')) {
    throw new AssertionError('Expected a :root variable block in Vinext CSS');
  }
  assertNoPlaceholders(css);

  const jsFiles = await findJsFiles(DIST);
  const js = await readAllConcat(jsFiles);
  assertClassNameFormat(`${css}\n${js}`, { prefix: 'animus-' });
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
    `[vinext-app:assert] ${cssFiles.length} CSS file(s), ${jsFiles.length} JS file(s), App+Pages routers present — all assertions passed`
  );
}

main().catch((error) => {
  console.error('[vinext-app:assert] FAIL:', error);
  process.exit(1);
});
