import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

async function main(): Promise<void> {
  const cssFiles = await findCssFiles(DIST);
  if (cssFiles.length === 0) {
    throw new AssertionError(`No CSS file found under ${DIST}`, { dir: DIST });
  }
  const css = await readAllConcat(cssFiles);

  // Cascade order — check the @layer BLOCKS present in the output in their
  // cascade-declared order. anm-global / anm-compounds / anm-custom are
  // currently declaration-only (empty blocks elided by the minifier) so they
  // are excluded here.
  //
  // TODO(fix-lightningcss-cascade): re-enable the stricter default order that
  // requires `:root` to precede the first @layer block. Today `:root` trails
  // the layer blocks due to the open Lightning CSS cascade bug.
  assertLayerOrder(css, {
    layers: [
      layerBlock('anm-base'),
      layerBlock('anm-variants'),
      layerBlock('anm-states'),
      layerBlock('anm-system'),
    ],
  });

  if (!css.includes(':root')) {
    throw new AssertionError(
      'Expected a :root variable block in the CSS output'
    );
  }

  assertNoPlaceholders(css);
  assertClassNameFormat(css, { prefix: 'animus-' });

  const jsFiles = await findJsFiles(DIST);
  for (const jsFile of jsFiles) {
    const js = await readFile(jsFile, 'utf8');
    assertNoEmotionImports(js);
  }

  console.log(
    `[vite-app:assert] ${cssFiles.length} CSS file(s), ${jsFiles.length} JS file(s) validated — all assertions passed`
  );
}

main().catch((err) => {
  if (err instanceof AssertionError) {
    console.error(`[vite-app:assert] FAIL: ${err.message}`);
    if (err.details) {
      console.error('  details:', JSON.stringify(err.details, null, 2));
    }
  } else {
    console.error('[vite-app:assert] unexpected error:', err);
  }
  process.exit(1);
});
