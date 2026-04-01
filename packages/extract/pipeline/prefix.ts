/**
 * Apply namespace prefix to a variable map, CSS variable declarations, and theme JSON.
 *
 * Variable map: `{ "colors.ember": "--color-ember" }` -> `{ "colors.ember": "--prefix-color-ember" }`
 * Variable CSS: `--color-ember: #FF2800` -> `--prefix-color-ember: #FF2800`
 *               `var(--color-ember)` -> `var(--prefix-color-ember)`
 * Theme JSON:   `{ "colors.ember": "var(--color-ember)" }` -> `{ "colors.ember": "var(--prefix-color-ember)" }`
 */
export function applyPrefix(
  prefix: string,
  variableMapJson: string,
  variableCss: string,
  themeJson?: string
): { variableMapJson: string; variableCss: string; themeJson?: string } {
  if (!prefix) return { variableMapJson, variableCss, themeJson };

  const varRefRe = /var\(--([a-zA-Z][\w-]*)\)/g;

  const map: Record<string, string> = JSON.parse(variableMapJson);
  const prefixed: Record<string, string> = {};
  for (const [key, varName] of Object.entries(map)) {
    prefixed[key] = varName.startsWith('--')
      ? `--${prefix}-${varName.slice(2)}`
      : varName;
  }

  let css = variableCss;
  css = css.replace(/--([a-zA-Z][\w-]*)\s*:/g, `--${prefix}-$1:`);
  css = css.replace(varRefRe, `var(--${prefix}-$1)`);

  const result: { variableMapJson: string; variableCss: string; themeJson?: string } = {
    variableMapJson: JSON.stringify(prefixed),
    variableCss: css,
  };

  if (themeJson) {
    result.themeJson = themeJson.replace(varRefRe, `var(--${prefix}-$1)`);
  }

  return result;
}
