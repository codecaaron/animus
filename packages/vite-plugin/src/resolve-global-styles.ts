/**
 * Standalone script executed via `bun run` to resolve global styles.
 *
 * Usage: bun run resolve-global-styles.ts <system-path> <theme-json-path> <output-file>
 *
 * Imports the system module for live transform functions (ESM isolation),
 * then delegates all resolution logic to @animus-ui/extract/pipeline.
 */

import { readFileSync, writeFileSync } from 'fs';

import { resolveGlobalStyles } from '@animus-ui/extract/pipeline';

const [systemPath, themeJsonPath, outputFile] = process.argv.slice(2);
if (!systemPath || !themeJsonPath || !outputFile) {
  process.stderr.write(
    'Usage: bun run resolve-global-styles.ts <system-path> <theme-json-path> <output-file>\n'
  );
  process.exit(1);
}

// Load system module (dynamic import for ESM compatibility)
const mod = await import(systemPath);
const ds = mod.ds || mod.default || mod.system;
if (!ds || !ds.serialize) {
  throw new Error('Module does not export a SystemInstance with .serialize()');
}

const cfg = ds.serialize();
const flat: Record<string, string> = JSON.parse(
  readFileSync(themeJsonPath, 'utf-8')
);
const propConfig: Record<string, any> = JSON.parse(cfg.propConfig);
const transforms: Record<string, (v: any) => any> = cfg.transforms || {};

// Discover global style blocks from module exports
const globalStyleBlocks: Record<
  string,
  Record<string, Record<string, any>>
> = {};
for (const [key, val] of Object.entries(mod)) {
  if (
    val &&
    typeof val === 'object' &&
    (val as any).__brand === 'GlobalStyleBlock'
  ) {
    globalStyleBlocks[key] = (val as any).styles;
  }
}

// Build variable map: token paths that resolve to CSS variables
const variableMap: Record<string, string> = {};
for (const [tokenPath, value] of Object.entries(flat)) {
  if (
    typeof value === 'string' &&
    value.startsWith('var(') &&
    value.endsWith(')')
  ) {
    variableMap[tokenPath] = value.slice(4, -1);
  }
}

// Delegate resolution to extract pipeline — single source of truth
const result = resolveGlobalStyles(
  globalStyleBlocks,
  propConfig,
  flat,
  variableMap,
  transforms
);

writeFileSync(outputFile, JSON.stringify(result));

export {};
