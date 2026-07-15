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
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(APP_ROOT, '..', '..');
const DIST = resolve(APP_ROOT, 'dist');

function globalLayerBody(css: string): string | undefined {
  const marker = css.match(/@layer\s+anm-global\s*\{/);
  if (marker?.index === undefined) return undefined;
  const openingBrace = marker.index + marker[0].length - 1;
  let depth = 1;
  for (let index = openingBrace + 1; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] !== '}') continue;
    depth -= 1;
    if (depth === 0) return css.slice(openingBrace + 1, index);
  }
  return undefined;
}

function selectors(selector: string): Set<string> {
  return new Set(
    selector.split(',').map((part) => {
      const compact = part.replace(/\s+/g, '');
      if (/^\*?::?before$/.test(compact)) return ':before';
      if (/^\*?::?after$/.test(compact)) return ':after';
      return compact;
    })
  );
}

function declarations(body: string): Set<string> {
  return new Set(body.replace(/\s+/g, '').split(';'));
}

function assertGlobalBaseline(css: string): void {
  const layer = globalLayerBody(css) ?? '';
  const bodyDeclarations = new Set<string>();
  let hasReset = false;
  for (const match of layer.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectorSet = selectors(match[1]);
    const ruleDeclarations = declarations(match[2]);
    hasReset ||=
      selectorSet.size === 3 &&
      selectorSet.has('*') &&
      selectorSet.has(':before') &&
      selectorSet.has(':after') &&
      ruleDeclarations.has('box-sizing:border-box');
    if (selectorSet.has('body')) {
      for (const declaration of ruleDeclarations)
        bodyDeclarations.add(declaration);
    }
  }
  if (!hasReset) {
    throw new AssertionError(
      'Expected the global border-box reset inside @layer anm-global'
    );
  }

  const required = [
    'margin:0',
    'background-color:var(--color-background)',
    'color:var(--color-text)',
    'font-family:system-ui,sans-serif',
  ];
  const missing = required.filter((value) => !bodyDeclarations.has(value));
  if (missing.length > 0) {
    throw new AssertionError(
      `Expected the global body baseline inside @layer anm-global; missing: ${missing.join(', ')}`,
      { missing }
    );
  }
}

function emitLaneReceipt(): void {
  // Engine facts are MEASURED, not hardcoded (mirrors scripts/verify/packed.sh).
  // The fixture selects its engine via `engine: process.env.ANIMUS_ENGINE ...`
  // in vite.config.ts; confirm that env-driven form is still present so the
  // receipt reads the config rather than assuming it, then mirror the exact
  // expression the config evaluates.
  const config = readFileSync(resolve(APP_ROOT, 'vite.config.ts'), 'utf8');
  const engineExpr = config.match(
    /ANIMUS_ENGINE\s*===\s*['"]v1['"]\s*\?\s*['"](v[12])['"]\s*:\s*['"](v[12])['"]/
  );
  if (!engineExpr) {
    throw new AssertionError(
      'Expected an ANIMUS_ENGINE-driven engine option in vite.config.ts — update the receipt probe'
    );
  }
  // Both arms of the config's engine expression are captured, so the loaded
  // engine is measured from the config that governed the build — a config
  // fallback flip changes the receipt without touching this script.
  const engineOverride = process.env.ANIMUS_ENGINE === 'v1';
  const engineLoaded = (engineOverride ? engineExpr[1] : engineExpr[2]) as
    | 'v1'
    | 'v2';

  // Default engine is measured from the workspace plugin source so a future
  // default flip changes the receipt without touching this script.
  // Symbol: `options.engine ?? 'v2'` in packages/vite-plugin/src/index.ts.
  const pluginSrc = readFileSync(
    resolve(REPO_ROOT, 'packages', 'vite-plugin', 'src', 'index.ts'),
    'utf8'
  );
  const defaultMatch = pluginSrc.match(/engine\s*\?\?\s*['"](v[12])['"]/);
  if (!defaultMatch) {
    throw new AssertionError(
      'Cannot determine default engine from packages/vite-plugin/src/index.ts — update the receipt probe'
    );
  }
  const engineDefault = defaultMatch[1] as 'v1' | 'v2';

  // hostVersion from the fixture's installed host, not the manifest range.
  const hostVersion = (
    JSON.parse(
      readFileSync(
        resolve(APP_ROOT, 'node_modules', 'vite', 'package.json'),
        'utf8'
      )
    ) as { version: string }
  ).version;

  writeLaneReceipt(resolve(APP_ROOT, '.receipts', 'verify-assert-vite.json'), {
    lane: 'verify:assert:vite',
    host: 'vite',
    hostVersion,
    mode: 'production',
    engineLoaded,
    engineDefault,
    engineOverride,
    packageForm: 'workspace',
  });
  console.log(
    `[vite-app:assert] receipt → .receipts/verify-assert-vite.json (engine=${engineLoaded}, default=${engineDefault}, override=${engineOverride})`
  );
}

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
  assertGlobalBaseline(css);

  // Keyframes extracted through the rollup (Vite) adapter — fixture declares
  // `animations = keyframes({ fadeIn, pulse })` in src/ds.ts; the assertion
  // proves both blocks land in @layer anm-global, both animation-name refs
  // resolve to a matching block, and neither got px-mangled by unit-fallback.
  assertKeyframesExtracted(css, {
    insideLayer: 'anm-global',
    minBlocks: 2,
    minReferences: 2,
  });

  const jsFiles = await findJsFiles(DIST);
  for (const jsFile of jsFiles) {
    const js = await readFile(jsFile, 'utf8');
    assertNoEmotionImports(js);
  }

  console.log(
    `[vite-app:assert] ${cssFiles.length} CSS file(s), ${jsFiles.length} JS file(s) validated — all assertions passed`
  );

  emitLaneReceipt();
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
