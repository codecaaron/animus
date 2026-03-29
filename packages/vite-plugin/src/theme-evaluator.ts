/**
 * Evaluate a theme object that has already been loaded/imported.
 *
 * If the theme has a `.manifest` property (from ThemeBuilder.build()),
 * reads structured data directly — no re-flattening or var() pattern-matching.
 * Falls back to legacy path for themes without manifests.
 */
export function evaluateThemeObject(theme: Record<string, any>): {
  scalesJson: string;
  variableMapJson: string;
  variableCss: string;
  contextualVarsJson: string;
} {
  // Manifest path — read structured data directly
  if (theme.manifest && typeof theme.manifest === 'object') {
    const manifest = theme.manifest;
    return {
      scalesJson: JSON.stringify(manifest.tokenMap),
      variableMapJson: JSON.stringify(manifest.variableMap),
      variableCss: manifest.variableCss,
      contextualVarsJson: JSON.stringify(manifest.contextualVars ?? {}),
    };
  }

  // Legacy fallback — re-flatten and scan for var() patterns
  console.warn(
    '[animus] Theme has no .manifest property — using legacy evaluation. ' +
      'Update to @animus-ui/system >=0.2.0 for structured manifest support.'
  );
  return evaluateThemeObjectLegacy(theme);
}

/** Legacy theme evaluation — flattens theme and pattern-matches var() strings. */
function evaluateThemeObjectLegacy(theme: Record<string, any>): {
  scalesJson: string;
  variableMapJson: string;
  variableCss: string;
  contextualVarsJson: string;
} {
  const flat: Record<string, string> = {};

  for (const [scaleName, scaleValue] of Object.entries(theme)) {
    if (scaleName.startsWith('_')) continue;
    if (scaleName === 'breakpoints') {
      flattenScale(flat, 'breakpoints', scaleValue);
      continue;
    }

    if (
      typeof scaleValue === 'object' &&
      scaleValue !== null &&
      !Array.isArray(scaleValue)
    ) {
      flattenScale(flat, scaleName, scaleValue);
    }
  }

  const variableMap: Record<string, string> = {};
  for (const [tokenPath, value] of Object.entries(flat)) {
    if (value.startsWith('var(') && value.endsWith(')')) {
      variableMap[tokenPath] = value.slice(4, -1);
    }
  }

  const variableCss = buildVariableCss(theme);

  // Read contextual vars from _contextualVars if present
  const contextualVars =
    theme._contextualVars &&
    typeof theme._contextualVars === 'object' &&
    Object.keys(theme._contextualVars).length > 0
      ? theme._contextualVars
      : {};

  return {
    scalesJson: JSON.stringify(flat),
    variableMapJson: JSON.stringify(variableMap),
    variableCss,
    contextualVarsJson: JSON.stringify(contextualVars),
  };
}

/**
 * Evaluate a theme module and flatten all scales to a JSON map.
 * Format: { "scale_name.key": "css_value" }
 *
 * Uses Vite's ssrLoadModule to evaluate the theme at build start,
 * so all computed scales (shadows, gradients that depend on colors)
 * are resolved to their final values.
 */
export async function evaluateTheme(
  ssrLoadModule: (url: string) => Promise<Record<string, any>>,
  themePath: string
): Promise<{
  scalesJson: string;
  variableMapJson: string;
  variableCss: string;
  contextualVarsJson: string;
}> {
  const mod = await ssrLoadModule(themePath);
  const theme = mod.theme || mod.default;

  if (!theme) {
    throw new Error(
      `Theme module at ${themePath} must export 'theme' or a default export`
    );
  }

  return evaluateThemeObject(theme);
}

/**
 * Build the full CSS variable block from a theme's _variables and _tokens.
 *
 * Produces:
 *   :root { --color-navy-500: #282a36; ... }
 *   [data-color-mode="dark"] { --color-primary: #ff80bf; ... }
 */
function buildVariableCss(theme: Record<string, any>): string {
  const parts: string[] = [];

  // --- :root block from theme._variables ---
  if (theme._variables != null && typeof theme._variables === 'object') {
    const rootLines: string[] = [];

    for (const categoryValue of Object.values(theme._variables)) {
      if (categoryValue == null || typeof categoryValue !== 'object') continue;

      for (const [cssVar, cssValue] of Object.entries(
        categoryValue as Record<string, unknown>
      )) {
        // Only emit string values — object values represent nested structures
        // (e.g. breakpoint-responsive vars) that we cannot flatten into :root
        if (typeof cssValue === 'string') {
          rootLines.push(`  ${cssVar}: ${cssValue};`);
        }
      }
    }

    if (rootLines.length > 0) {
      parts.push(`:root {\n${rootLines.join('\n')}\n}`);
    }
  }

  // --- [data-color-mode] blocks from theme._tokens.modes ---
  if (theme._tokens?.modes != null && typeof theme._tokens.modes === 'object') {
    for (const [modeName, modeTokens] of Object.entries(
      theme._tokens.modes as Record<string, unknown>
    )) {
      // Every mode gets an explicit [data-color-mode] selector — including the
      // default — so nested elements can override the page-level mode.
      if (modeTokens == null || typeof modeTokens !== 'object') continue;

      const modeLines: string[] = [];
      flattenModeTokens(modeLines, modeTokens as Record<string, unknown>, '');

      if (modeLines.length > 0) {
        parts.push(
          `[data-color-mode="${modeName}"] {\n${modeLines.join('\n')}\n}`
        );
      }
    }
  }

  return parts.join('\n\n');
}

/**
 * Recursively flatten mode token objects into CSS variable declarations.
 *
 * Examples:
 *   { primary: '#ff80bf' }           → '  --color-primary: #ff80bf;'
 *   { background: { _: '#fff', muted: '#f5f5f5' } }
 *     → '  --color-background: #fff;'
 *        '  --color-background-muted: #f5f5f5;'
 *
 * The special key `_` maps to the base name (no suffix).
 */
function flattenModeTokens(
  lines: string[],
  obj: Record<string, unknown>,
  prefix: string
): void {
  for (const [key, value] of Object.entries(obj)) {
    // Compute the CSS property name suffix
    let namePart: string;
    if (key === '_') {
      // `_` is a sentinel for the base value — no suffix added
      namePart = prefix;
    } else {
      namePart = prefix ? `${prefix}-${key}` : key;
    }

    if (typeof value === 'string' || typeof value === 'number') {
      lines.push(`  --color-${namePart}: ${value};`);
    } else if (
      value != null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      flattenModeTokens(lines, value as Record<string, unknown>, namePart);
    }
  }
}

function flattenScale(
  flat: Record<string, string>,
  prefix: string,
  obj: any,
  parentKey = ''
): void {
  if (typeof obj !== 'object' || obj === null) {
    const key = parentKey ? `${prefix}.${parentKey}` : prefix;
    flat[key] = String(obj);
    return;
  }

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = parentKey ? `${parentKey}-${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      flattenScale(flat, prefix, value, fullKey);
    } else {
      flat[`${prefix}.${fullKey}`] = String(value);
    }
  }
}

// ---------------------------------------------------------------------------
// Global style resolution
// ---------------------------------------------------------------------------

interface PropConfigEntry {
  property: string;
  properties?: string[];
  scale?: string;
  transform?: string;
}

function camelToKebab(s: string): string {
  if (s.startsWith('Webkit')) return `-webkit-${camelToKebab(s.slice(6))}`;
  if (s.startsWith('Moz')) return `-moz-${camelToKebab(s.slice(3))}`;
  return s.replace(/[A-Z]/g, (m, i) => (i > 0 ? '-' : '') + m.toLowerCase());
}

function resolveValue(
  raw: any,
  config: PropConfigEntry | undefined,
  flat: Record<string, string>,
  transforms: Record<string, (v: any) => any>
): string | null {
  if (raw == null) return null;

  let resolved: string | undefined;

  // Scale lookup
  if (config?.scale) {
    const key = `${config.scale}.${raw}`;
    if (flat[key] != null) resolved = flat[key];
  }

  const value =
    resolved ?? (typeof raw === 'number' ? String(raw) : String(raw));

  // Apply transform directly (not as placeholder)
  if (config?.transform && transforms[config.transform]) {
    const fn = transforms[config.transform];
    const input = resolved != null ? resolved : raw;
    const result = fn(
      typeof input === 'string' && !isNaN(Number(input)) ? Number(input) : input
    );
    return typeof result === 'object' ? JSON.stringify(result) : String(result);
  }

  return value;
}

/**
 * Resolve global style objects to a CSS string.
 *
 * Each key in `globalStyles` is a CSS selector, each value is a style object
 * using the same prop shorthand as component `.styles()` blocks.
 */
export function resolveGlobalStyles(
  globalStyles: Record<string, Record<string, any>>,
  propConfigJson: string,
  flat: Record<string, string>,
  transforms: Record<string, (v: any) => any>
): string {
  const propConfig: Record<string, PropConfigEntry> =
    JSON.parse(propConfigJson);
  const rules: string[] = [];

  for (const [selector, styleObj] of Object.entries(globalStyles)) {
    const declarations: string[] = [];

    for (const [prop, value] of Object.entries(styleObj)) {
      const config = propConfig[prop];

      // Determine CSS properties to emit
      const cssProps =
        config?.properties && config.properties.length > 0
          ? config.properties
          : config
            ? [config.property]
            : [prop]; // pass-through

      const resolved = resolveValue(value, config, flat, transforms);
      if (resolved == null) continue;

      for (const cssProp of cssProps) {
        declarations.push(`  ${camelToKebab(cssProp)}: ${resolved};`);
      }
    }

    if (declarations.length > 0) {
      rules.push(`${selector} {\n${declarations.join('\n')}\n}`);
    }
  }

  return rules.join('\n\n');
}
