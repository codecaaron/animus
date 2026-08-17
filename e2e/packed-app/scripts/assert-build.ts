import {
  AssertionError,
  assertClassNameFormat,
  assertKeyframesExtracted,
  assertLayerOrder,
  assertNoEmotionImports,
  assertNoPlaceholders,
  findCssFiles,
  findJsFiles,
  installedHostVersion,
  layerBlock,
  readAllConcat,
  writeLaneReceipt,
} from '@animus-ui/assertions';
import { readdirSync, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LaneHost } from '@animus-ui/assertions';

// Positional assertions over the PACKED consumer's build outputs. Runs in
// workspace context (assertions are a private workspace package, reached by
// root hoisting — `e2e/packed-app` deliberately declares no workspace
// dependency because its manifest is copied into the isolated npm install);
// the builds themselves ran inside that staging install.
const STAGING = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '.staging'
);
const VITE_DIST = resolve(STAGING, 'dist');
const NEXT_DIR = resolve(STAGING, '.next');

/**
 * The PUBLISHED plugin carries the v1 retirement guard. The guard call is
 * imported from the externalized extract pipeline, so runtime bundles carry the
 * identifier; inlined bundles would carry the message (which names the change).
 * Either marker proves the guard shipped.
 */
function assertRetirementGuard(pluginDir: string): void {
  const dir = resolve(STAGING, pluginDir);
  for (const entry of readdirSync(dir)) {
    if (!/\.(?:cjs|mjs|js)$/.test(entry)) continue;
    const source = readFileSync(resolve(dir, entry), 'utf8');
    if (
      source.includes('assertNoRetiredEngineSelection') ||
      source.includes('retire-extract-v1')
    ) {
      return;
    }
  }
  throw new AssertionError(
    `installed plugin in ${pluginDir} lacks the v1 retirement guard — update the receipt probe`,
    { pluginDir }
  );
}

/**
 * Receipts for the packed dimension (openspec: dual-engine-build — "the packed
 * consumer lane SHALL prove the v2 engine loads"). Engine facts are STRUCTURAL
 * GUARDS over the staged artifacts, never inferred from plugin source
 * (guardrail G3): `writeLaneReceipt` proves the staged consumer config selects
 * no engine, and `assertRetirementGuard` proves the installed plugin still
 * refuses one.
 */
function emitLaneReceipts(): void {
  assertRetirementGuard('node_modules/@animus-ui/vite-plugin/dist');
  assertRetirementGuard('node_modules/@animus-ui/next-plugin/dist');

  const lanes: ReadonlyArray<{
    host: LaneHost;
    lane: string;
    file: string;
    config: string;
  }> = [
    {
      host: 'vite',
      lane: 'verify:packed:vite',
      file: 'packed-vite.json',
      config: 'vite.config.ts',
    },
    {
      host: 'next',
      lane: 'verify:packed:next',
      file: 'packed-next.json',
      config: 'next.config.ts',
    },
  ];

  for (const { host, lane, file, config } of lanes) {
    const receipt = writeLaneReceipt(resolve(STAGING, 'receipts', file), {
      lane,
      host,
      hostVersion: installedHostVersion(STAGING, host),
      mode: 'production',
      packageForm: 'packed',
      engineConfigPath: resolve(STAGING, config),
      engineConfigLabel: `.staging/${config}`,
    });
    console.log(
      `[packed-app:assert] receipt → .staging/receipts/${file} (${receipt.lane}=${receipt.engineLoaded}, default=${receipt.engineDefault}, override=${receipt.engineOverride})`
    );
  }
}

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

  emitLaneReceipts();
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
