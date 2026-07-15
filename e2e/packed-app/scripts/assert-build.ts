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
} from '@animus-ui/assertions';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Positional assertions over the PACKED consumer's build outputs. Runs in
// workspace context (assertions are a private workspace package); the
// builds themselves ran inside the isolated staging install.
const STAGING = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '.staging'
);
const VITE_DIST = resolve(STAGING, 'dist');
const NEXT_DIR = resolve(STAGING, '.next');

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

async function assertViteOutput(): Promise<void> {
  await assertDir(VITE_DIST, 'Packed Vite build output');

  const cssFiles = await findCssFiles(VITE_DIST);
  if (cssFiles.length === 0) {
    throw new AssertionError(`No CSS file found under ${VITE_DIST}`);
  }
  const css = await readAllConcat(cssFiles);

  // Same relaxed cascade contract as e2e/vite-app (see its assert-build.ts
  // for the `fix-lightningcss-cascade` TODO).
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
      'Expected a :root variable block in the packed Vite CSS output'
    );
  }

  assertNoPlaceholders(css);
  assertClassNameFormat(css, { prefix: 'animus-' });
  assertKeyframesExtracted(css, {
    insideLayer: 'anm-global',
    minBlocks: 2,
    minReferences: 2,
  });

  const jsFiles = await findJsFiles(VITE_DIST);
  for (const jsFile of jsFiles) {
    assertNoEmotionImports(await readFile(jsFile, 'utf8'));
  }

  console.log(
    `[packed-app:assert:vite] ${cssFiles.length} CSS file(s), ${jsFiles.length} JS file(s) validated`
  );
}

async function assertNextOutput(): Promise<void> {
  await assertDir(NEXT_DIR, 'Packed Next build output');

  const cssFiles = await findCssFiles(NEXT_DIR);
  if (cssFiles.length === 0) {
    throw new AssertionError(`No CSS file found under ${NEXT_DIR}`);
  }
  const css = await readAllConcat(cssFiles);

  assertLayerOrder(css, {
    layers: [layerBlock('anm-base'), layerBlock('anm-variants')],
  });

  if (!css.includes(':root')) {
    throw new AssertionError(
      'Expected a :root variable block in the packed Next CSS output'
    );
  }

  assertNoPlaceholders(css);
  assertKeyframesExtracted(css, {
    insideLayer: 'anm-global',
    minBlocks: 2,
    minReferences: 2,
  });

  const jsFiles = await findJsFiles(resolve(NEXT_DIR, 'static'));
  const jsContent = await readAllConcat(jsFiles);
  assertClassNameFormat(`${css}\n${jsContent}`, { prefix: 'animus-' });
  for (const jsFile of jsFiles) {
    assertNoEmotionImports(await readFile(jsFile, 'utf8'));
  }

  await assertDir(resolve(NEXT_DIR, 'server', 'app'), 'App Router output');

  console.log(
    `[packed-app:assert:next] ${cssFiles.length} CSS file(s), ${jsFiles.length} JS file(s) validated`
  );
}

async function main(): Promise<void> {
  await assertViteOutput();
  await assertNextOutput();
  console.log('[packed-app:assert] all assertions passed');
}

main().catch((err) => {
  if (err instanceof AssertionError) {
    console.error(`[packed-app:assert] FAIL: ${err.message}`);
    if (err.details) {
      console.error('  details:', JSON.stringify(err.details, null, 2));
    }
  } else {
    console.error('[packed-app:assert] unexpected error:', err);
  }
  process.exit(1);
});
