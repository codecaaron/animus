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
import { readFileSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(APP_ROOT, '..', '..');
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
  // Retirement regression guard (openspec: retire-extract-v1): v2 is the only
  // engine. The fixture config MUST NOT reference ANIMUS_ENGINE or set the
  // engine option — either would reintroduce a retired v1 selection path.
  const config = readFileSync(resolve(APP_ROOT, 'next.config.ts'), 'utf8');
  if (config.includes('ANIMUS_ENGINE') || /\bengine\s*:/.test(config)) {
    throw new AssertionError(
      'next.config.ts must not reference ANIMUS_ENGINE or set the engine ' +
        'option — the v1 engine was retired (openspec: retire-extract-v1)'
    );
  }

  // Default engine is still MEASURED from the workspace plugin source so a
  // future default change is reflected without touching this script. Symbol:
  // `getSharedEngine()` fallback `... || 'v2'` in
  // packages/next-plugin/src/singleton.ts.
  const pluginSrc = readFileSync(
    resolve(REPO_ROOT, 'packages', 'next-plugin', 'src', 'singleton.ts'),
    'utf8'
  );
  const defaultMatch = pluginSrc.match(/\|\|\s*['"](v[12])['"]/);
  if (!defaultMatch) {
    throw new AssertionError(
      'Cannot determine default engine from packages/next-plugin/src/singleton.ts — update the receipt probe'
    );
  }
  const engineDefault = defaultMatch[1] as 'v1' | 'v2';

  // v1 is retired: no override path remains, so the loaded engine is always the
  // workspace default and no ANIMUS_ENGINE override is possible.
  const engineOverride = false;
  const engineLoaded: 'v1' | 'v2' = engineDefault;

  // hostVersion from the fixture's installed host, not the manifest range.
  const hostVersion = (
    JSON.parse(
      readFileSync(
        resolve(APP_ROOT, 'node_modules', 'next', 'package.json'),
        'utf8'
      )
    ) as { version: string }
  ).version;

  writeLaneReceipt(resolve(APP_ROOT, '.receipts', 'verify-assert-next.json'), {
    lane: '@animus-ui/next-app#verify:assert',
    host: 'next',
    hostVersion,
    mode: 'production',
    engineLoaded,
    engineDefault,
    engineOverride,
    packageForm: 'workspace',
  });
  console.log(
    `[next-app:assert] receipt → .receipts/verify-assert-next.json (engine=${engineLoaded}, default=${engineDefault}, override=${engineOverride})`
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

  // Keyframes extracted through the webpack adapter — the fixture declares
  // `animations = keyframes({ fadeIn, pulse })` in src/ds.ts; the assertion
  // proves both blocks land in @layer anm-global, both animation-name refs
  // resolve to a matching block, and neither got px-mangled by unit-fallback.
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

  // Router coverage — same checks as the prior shell script.
  await assertDir(resolve(NEXT_DIR, 'server', 'app'), 'App Router output');

  const pagesDir = resolve(NEXT_DIR, 'server', 'pages');
  let pagesEntries: string[];
  try {
    pagesEntries = await readdir(pagesDir);
  } catch {
    throw new AssertionError(`Pages Router directory not found: ${pagesDir}`);
  }
  const hasLegacy = pagesEntries.some((name) => name.startsWith('legacy'));
  if (!hasLegacy) {
    throw new AssertionError(
      `Pages Router legacy page output not found under ${pagesDir}`,
      { entries: pagesEntries }
    );
  }

  console.log(
    `[next-app:assert] ${cssFiles.length} CSS file(s), ${jsFiles.length} JS file(s), App+Pages routers present — all assertions passed`
  );

  emitLaneReceipt();
}

main().catch((err) => {
  if (err instanceof AssertionError) {
    console.error(`[next-app:assert] FAIL: ${err.message}`);
    if (err.details) {
      console.error('  details:', JSON.stringify(err.details, null, 2));
    }
  } else {
    console.error('[next-app:assert] unexpected error:', err);
  }
  process.exit(1);
});
