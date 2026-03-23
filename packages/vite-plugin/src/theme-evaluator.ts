/**
 * Evaluate a theme object that has already been loaded/imported.
 *
 * This is the pure logic: takes a theme object, flattens scales, builds variable CSS.
 * Use this when you have already loaded the module yourself.
 */
export function evaluateThemeObject(theme: Record<string, any>): {
  scalesJson: string;
  variableCss: string;
} {
  const flat: Record<string, string> = {};

  // Flatten all scale maps
  for (const [scaleName, scaleValue] of Object.entries(theme)) {
    // Skip private keys
    if (scaleName.startsWith('_')) continue;
    if (scaleName === 'breakpoints') {
      // Breakpoints are special — keep as numbers
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

  const variableCss = buildVariableCss(theme);

  return { scalesJson: JSON.stringify(flat), variableCss };
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
): Promise<{ scalesJson: string; variableCss: string }> {
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
    // Determine the default mode name
    const defaultMode: string =
      typeof theme.mode === 'string'
        ? theme.mode
        : Object.keys(theme._tokens.modes)[0];

    for (const [modeName, modeTokens] of Object.entries(
      theme._tokens.modes as Record<string, unknown>
    )) {
      // Skip the default mode — its values are already in :root via _variables.mode
      if (modeName === defaultMode) continue;
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
