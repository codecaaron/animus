import { camelToKebab } from './utils';

interface PropConfigEntry {
  property?: string;
  properties?: string[];
  scale?: string;
  transform?: string;
}

/**
 * Resolve {scale.path} and {scale.path/alpha} token aliases in a CSS value string.
 * Mirrors the Rust theme_resolver's resolve_token_aliases logic.
 */
export function resolveTokenAliases(
  value: string,
  flat: Record<string, string>,
  variableMap: Record<string, string>
): string {
  if (!value.includes('{')) return value;

  return value.replace(/\{([^}]+)\}/g, (_match, content: string) => {
    const slashIdx = content.indexOf('/');
    const tokenPath = slashIdx >= 0 ? content.slice(0, slashIdx) : content;
    const alpha =
      slashIdx >= 0 ? Number.parseInt(content.slice(slashIdx + 1), 10) : null;

    // With nested storage, dot paths are the keys — no conversion needed
    const flatKey = tokenPath;

    let resolved: string;
    if (variableMap[flatKey]) {
      resolved = `var(${variableMap[flatKey]})`;
    } else if (flat[flatKey] != null) {
      resolved = flat[flatKey];
    } else {
      return `{${content}}`;
    }

    if (alpha === 0) return 'transparent';
    if (alpha != null && alpha !== 100) {
      return `color-mix(in srgb, ${resolved} ${alpha}%, transparent)`;
    }
    return resolved;
  });
}

/**
 * Resolve a single CSS value through prop config: scale lookup, transform, token aliases.
 */
export function resolveValue(
  raw: unknown,
  config: PropConfigEntry | undefined,
  flat: Record<string, string>,
  variableMap: Record<string, string>,
  transforms: Record<string, (v: unknown) => unknown>
): string {
  let resolved: string = String(raw);

  if (config?.scale) {
    const key = config.scale + '.' + raw;
    if (flat[key] != null) resolved = flat[key];
  }

  if (config?.transform && transforms[config.transform]) {
    const fn = transforms[config.transform];
    const input =
      typeof resolved === 'string' && !Number.isNaN(Number(resolved))
        ? Number(resolved)
        : resolved;
    resolved = String(fn(input));
  }

  return resolveTokenAliases(resolved, flat, variableMap);
}

/**
 * Resolve a block of selectors -> style objects using prop config + theme.
 * @keyframes selectors are resolved with full prop config support.
 */
function resolveBlock(
  selectors: Record<string, Record<string, unknown>>,
  propConfig: Record<string, PropConfigEntry>,
  flat: Record<string, string>,
  variableMap: Record<string, string>,
  transforms: Record<string, (v: unknown) => unknown>
): string {
  const rules: string[] = [];

  for (const [selector, styleObj] of Object.entries(selectors)) {
    if (selector.startsWith('@keyframes')) {
      const frames: string[] = [];
      for (const [pct, frameStyles] of Object.entries(styleObj)) {
        if (typeof frameStyles === 'object' && frameStyles !== null) {
          const decls: string[] = [];
          for (const [prop, raw] of Object.entries(
            frameStyles as Record<string, unknown>
          )) {
            const cfg = propConfig[prop];
            const cssProps: string[] = cfg?.properties?.length
              ? cfg.properties
              : cfg
                ? [cfg.property!]
                : [prop];
            const resolved = resolveValue(
              raw,
              cfg,
              flat,
              variableMap,
              transforms
            );
            for (const cssProp of cssProps) {
              decls.push(`    ${camelToKebab(cssProp)}: ${resolved};`);
            }
          }
          frames.push(`  ${pct} {\n${decls.join('\n')}\n  }`);
        }
      }
      rules.push(`${selector} {\n${frames.join('\n')}\n}`);
      continue;
    }

    const decls: string[] = [];
    for (const [prop, raw] of Object.entries(styleObj)) {
      const config = propConfig[prop];
      const cssProps: string[] = config?.properties?.length
        ? config.properties
        : config
          ? [config.property!]
          : [prop];
      const resolved = resolveValue(raw, config, flat, variableMap, transforms);
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

/**
 * Resolve global style blocks into CSS strings.
 *
 * Takes the global style map (block name -> selectors -> props -> values),
 * resolves prop shorthand, scale lookups, transforms, and token aliases,
 * and returns a map of block name -> resolved CSS string.
 */
export function resolveGlobalStyles(
  globalStyles: Record<string, Record<string, Record<string, unknown>>>,
  propConfig: Record<string, PropConfigEntry>,
  flat: Record<string, string>,
  variableMap: Record<string, string>,
  transforms: Record<string, (v: unknown) => unknown>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, block] of Object.entries(globalStyles)) {
    const resolved = resolveBlock(
      block,
      propConfig,
      flat,
      variableMap,
      transforms
    );
    if (resolved) {
      result[name] = resolved;
    }
  }
  return result;
}
