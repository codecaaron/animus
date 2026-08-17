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
  // Engine identity comes from writeLaneReceipt's retirement guard over the
  // fixture config (openspec: retire-extract-v1) — never spelled here, and
  // never inferred from plugin source (guardrail G3).
  //
  // hostVersion from the fixture's installed host, not the manifest range.
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

  // Cascade order (relaxed) — same contract as vite-app and showcase. See
  // `e2e/vite-app/scripts/assert-build.ts` for the TODO on re-enabling the
  // stricter :root-before-@layer order post `fix-lightningcss-cascade`.
  //
  // §11.8 carry-forward from sessions 75/76: the previous shell script
  // grepped for `@layer base` / `@layer variants`, but Animus actually emits
  // `@layer anm-base` / `@layer anm-variants`. The layerBlock() helper uses
  // the correct `anm-` prefix so that gap closes here.
  assertLayerOrder(css, {
    layers: [layerBlock('anm-base'), layerBlock('anm-variants')],
  });

  if (!css.includes(':root')) {
    throw new AssertionError(
      'Expected a :root variable block in the CSS output'
    );
  }

  assertNoPlaceholders(css);

  // Keyframes extracted through the Turbopack orchestration path — the
  // fixture declares `animations = keyframes({ fadeIn, pulse })` in
  // src/ds.ts; the assertion proves both blocks land in @layer anm-global,
  // both animation-name refs resolve to a matching block, and neither got
  // px-mangled by unit-fallback.
  assertKeyframesExtracted(css, {
    insideLayer: 'anm-global',
    minBlocks: 2,
    minReferences: 2,
  });

  // Class-name assertion runs on the full build output (JS + HTML emitted by
  // Next may include the class names, not just the CSS).
  const jsFiles = await findJsFiles(STATIC_JS);
  const jsContent = await readAllConcat(jsFiles);
  assertClassNameFormat(`${css}\n${jsContent}`, { prefix: 'animus-' });

  for (const jsFile of jsFiles) {
    const js = await readFile(jsFile, 'utf8');
    assertNoEmotionImports(js);
  }

  // Router coverage — app router only (Turbopack build mode evidence; the
  // pages router on Next 16 is deferred, openspec change
  // next16-fixture-peer-range DEF-2).
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
