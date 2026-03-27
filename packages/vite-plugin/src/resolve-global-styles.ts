/**
 * Standalone script executed via `bun run` to resolve global styles.
 *
 * Usage: bun run resolve-global-styles.ts <system-path> <theme-json> <output-file>
 *
 * Imports the system module, extracts globalStyles from .serialize(),
 * resolves prop shorthand (bg → background-color, etc.) using the full
 * prop config + theme + transforms, and writes the resolved CSS to output.
 *
 * @keyframes blocks are serialized as raw CSS (no prop resolution needed).
 */

import { readFileSync, writeFileSync } from 'fs';

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
const gs = cfg.globalStyles || {};

// Build variable map: token paths that resolve to CSS variables
const variableMap: Record<string, string> = {};
for (const [tokenPath, value] of Object.entries(flat)) {
  if (
    typeof value === 'string' &&
    value.startsWith('var(') &&
    value.endsWith(')')
  ) {
    variableMap[tokenPath] = value.slice(4, -1); // "var(--color-ember)" → "--color-ember"
  }
}

// ─── Helpers ────────────────────────────────────────────────

function camelToKebab(s: string): string {
  if (s.startsWith('Webkit')) return '-webkit-' + camelToKebab(s.slice(6));
  return s.replace(/[A-Z]/g, (m, i) => (i > 0 ? '-' : '') + m.toLowerCase());
}

/**
 * Serialize a raw nested block (e.g. @keyframes) without prop resolution.
 * Just camelToKebab on property names — no scale lookups, no transforms.
 */
function serializeRawBlock(
  obj: Record<string, Record<string, string>>,
  indent: string
): string {
  const lines: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'object' && val !== null) {
      lines.push(`${indent}${key} {`);
      for (const [p, v] of Object.entries(val)) {
        lines.push(`${indent}  ${camelToKebab(p)}: ${v};`);
      }
      lines.push(`${indent}}`);
    }
  }
  return lines.join('\n');
}

/**
 * Resolve {scale.path} and {scale.path/alpha} token aliases in a CSS value string.
 * Mirrors the Rust theme_resolver's resolve_token_aliases logic.
 */
function resolveTokenAliases(value: string): string {
  if (!value.includes('{')) return value;

  return value.replace(/\{([^}]+)\}/g, (_match, content: string) => {
    // Split alpha modifier: {colors.ember/40} → path="colors.ember", alpha=40
    const slashIdx = content.indexOf('/');
    const tokenPath = slashIdx >= 0 ? content.slice(0, slashIdx) : content;
    const alpha =
      slashIdx >= 0 ? parseInt(content.slice(slashIdx + 1), 10) : null;

    // Convert dot path to flat key: colors.pink.600 → colors.pink-600
    const dotIdx = tokenPath.indexOf('.');
    const flatKey =
      dotIdx >= 0
        ? tokenPath.slice(0, dotIdx) +
          '.' +
          tokenPath.slice(dotIdx + 1).replace(/\./g, '-')
        : tokenPath;

    // Resolve: variable map first, then flat theme, else passthrough
    let resolved: string;
    if (variableMap[flatKey]) {
      resolved = `var(${variableMap[flatKey]})`;
    } else if (flat[flatKey] != null) {
      resolved = flat[flatKey];
    } else {
      return `{${content}}`; // unresolved — pass through
    }

    // Apply alpha modifier via color-mix
    if (alpha === 0) return 'transparent';
    if (alpha != null && alpha !== 100) {
      return `color-mix(in srgb, ${resolved} ${alpha}%, transparent)`;
    }
    return resolved;
  });
}

/**
 * Resolve a block of selectors → style objects using prop config + theme.
 * @keyframes selectors are delegated to serializeRawBlock.
 */
function resolveBlock(selectors: Record<string, Record<string, any>>): string {
  const rules: string[] = [];

  for (const [selector, styleObj] of Object.entries(selectors)) {
    // @keyframes: raw structural serialization, no prop resolution
    if (selector.startsWith('@keyframes')) {
      rules.push(`${selector} {\n${serializeRawBlock(styleObj, '  ')}\n}`);
      continue;
    }

    const decls: string[] = [];
    for (const [prop, raw] of Object.entries(styleObj)) {
      const config = propConfig[prop];
      const cssProps: string[] = config?.properties?.length
        ? config.properties
        : config
          ? [config.property]
          : [prop];

      let resolved: string = raw;

      // Scale lookup
      if (config?.scale) {
        const key = config.scale + '.' + raw;
        if (flat[key] != null) resolved = flat[key];
      }

      // Transform application
      if (config?.transform && transforms[config.transform]) {
        const fn = transforms[config.transform];
        const input =
          typeof resolved === 'string' && !isNaN(Number(resolved))
            ? Number(resolved)
            : resolved;
        resolved = String(fn(input));
      } else {
        resolved = String(resolved);
      }

      // Resolve token aliases: {colors.ember/40} → color-mix(...)
      resolved = resolveTokenAliases(resolved);

      for (const cssProp of cssProps) {
        decls.push(`  ${camelToKebab(cssProp)}: ${resolved};`);
      }
    }

    if (decls.length) {
      rules.push(`${selector} {\n${decls.join('\n')}\n}`);
    }
  }

  return rules.join('\n\n');
}

// ─── Main ───────────────────────────────────────────────────

const result: { reset?: string; global?: string } = {};
if (gs.reset) result.reset = resolveBlock(gs.reset);
if (gs.global) result.global = resolveBlock(gs.global);

writeFileSync(outputFile, JSON.stringify(result));

export {};
