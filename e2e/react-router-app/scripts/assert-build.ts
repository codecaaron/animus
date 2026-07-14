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

const BUILD = resolve(import.meta.dirname, '..', 'build');

async function main(): Promise<void> {
  const cssFiles = await findCssFiles(BUILD);
  if (cssFiles.length === 0)
    throw new AssertionError(`No CSS file found under ${BUILD}`);
  const css = await readAllConcat(cssFiles);
  assertLayerOrder(css, {
    layers: [layerBlock('anm-base'), layerBlock('anm-variants')],
  });
  if (!css.includes(':root'))
    throw new AssertionError('Expected a :root variable block');
  assertNoPlaceholders(css);
  const jsFiles = await findJsFiles(BUILD);
  const js = await readAllConcat(jsFiles);
  assertClassNameFormat(`${css}\n${js}`, { prefix: 'animus-' });
  if (!js.includes('React Router v8 SSR canary'))
    throw new AssertionError('SSR marker missing');
  if (!js.includes('React Router v8 client canary'))
    throw new AssertionError('Client marker missing');
  for (const file of jsFiles)
    assertNoEmotionImports(await readFile(file, 'utf8'));
  console.log(
    `[react-router-app:assert] ${cssFiles.length} CSS, ${jsFiles.length} JS — all assertions passed`
  );
}

main().catch((error) => {
  console.error('[react-router-app:assert] FAIL:', error);
  process.exit(1);
});
