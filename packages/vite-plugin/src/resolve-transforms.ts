/**
 * Standalone script executed via `bun run` to apply transform placeholders.
 *
 * Usage: bun run resolve-transforms.ts <input-file> <output-file> [config-path]
 *
 * Reads CSS from input file containing __TRANSFORM__name__rawValue__ placeholders,
 * loads transform functions from @animus-ui/core (and optionally a custom config),
 * applies them, and writes the resolved CSS to the output file.
 *
 * When config-path is provided, transforms from that module are loaded IN ADDITION
 * to core transforms. Custom transforms take precedence on name collisions.
 */

import { readFileSync, writeFileSync } from 'fs';

import {
  background,
  border,
  color,
  flex,
  grid,
  layout,
  positioning,
  shadows,
  space,
  transitions,
  typography,
} from '@animus-ui/core';

const [inputFile, outputFile, configPath] = process.argv.slice(2);
if (!inputFile || !outputFile) {
  process.stderr.write(
    'Usage: bun run resolve-transforms.ts <input> <output> [config-path]\n'
  );
  process.exit(1);
}

// Build transform registry from core prop groups
const allGroups: Record<string, any> = {
  ...color,
  ...border,
  ...flex,
  ...grid,
  ...space,
  ...layout,
  ...typography,
  ...shadows,
  ...background,
  ...positioning,
  ...transitions,
};

const fns: Record<string, (value: string | number) => any> = {};
for (const [, entry] of Object.entries(allGroups)) {
  if (entry.transform && typeof entry.transform === 'function') {
    const key = entry.transform.transformName || entry.transform.name;
    if (key && !fns[key]) {
      fns[key] = entry.transform;
    }
  }
}

// Load custom transforms from configPath if provided
if (configPath) {
  try {
    const customModule = require(configPath);
    // Walk all exports looking for objects with .transform functions
    for (const [, exported] of Object.entries(customModule)) {
      if (
        exported &&
        typeof exported === 'object' &&
        !Array.isArray(exported)
      ) {
        // Check if it's a prop entry with a transform
        if (
          (exported as any).transform &&
          typeof (exported as any).transform === 'function'
        ) {
          const key =
            (exported as any).transform.transformName ||
            (exported as any).transform.name;
          if (key) {
            fns[key] = (exported as any).transform;
          }
        }
        // Check if it's a group object containing prop entries
        for (const [, prop] of Object.entries(
          exported as Record<string, any>
        )) {
          if (prop?.transform && typeof prop.transform === 'function') {
            const key = prop.transform.transformName || prop.transform.name;
            if (key) {
              fns[key] = prop.transform;
            }
          }
        }
      }
      // Check if it's a standalone transform function (exported directly)
      if (typeof exported === 'function' && (exported as any).transformName) {
        fns[(exported as any).transformName] = exported as any;
      }
    }
  } catch (e) {
    process.stderr.write(
      `[animus-extract] Failed to load custom transforms from ${configPath}: ${e}\n`
    );
  }
}

const css = readFileSync(inputFile, 'utf8');
const resolved = css.replace(
  /__TRANSFORM__(\w+)__(.+?)__/g,
  (_match: string, name: string, rawValue: string) => {
    const fn = fns[name];
    if (!fn) {
      process.stderr.write(
        `[animus-extract] Unknown transform: "${name}" — using raw value\n`
      );
      return rawValue;
    }
    const value =
      rawValue !== '' && !isNaN(Number(rawValue)) ? Number(rawValue) : rawValue;
    const result = fn(value);
    return typeof result === 'object' ? JSON.stringify(result) : String(result);
  }
);
writeFileSync(outputFile, resolved);
