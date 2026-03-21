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
): Promise<string> {
  const mod = await ssrLoadModule(themePath);
  const theme = mod.theme || mod.default;

  if (!theme) {
    throw new Error(
      `Theme module at ${themePath} must export 'theme' or a default export`
    );
  }

  const flat: Record<string, string> = {};

  // Flatten all scale maps
  for (const [scaleName, scaleValue] of Object.entries(theme)) {
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

  return JSON.stringify(flat);
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
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    ) {
      flattenScale(flat, prefix, value, fullKey);
    } else {
      flat[`${prefix}.${fullKey}`] = String(value);
    }
  }
}
