/**
 * Apply namespace prefix to a variable map and CSS variable declarations.
 *
 * Variable map: `{ "colors.ember": "--color-ember" }` -> `{ "colors.ember": "--prefix-color-ember" }`
 * Variable CSS: `--color-ember: #FF2800` -> `--prefix-color-ember: #FF2800`
 *               `var(--color-ember)` -> `var(--prefix-color-ember)`
 */
export function applyPrefix(
  prefix: string,
  variableMapJson: string,
  variableCss: string
): { variableMapJson: string; variableCss: string } {
  if (!prefix) return { variableMapJson, variableCss };

  const map: Record<string, string> = JSON.parse(variableMapJson);
  const prefixed: Record<string, string> = {};
  for (const [key, varName] of Object.entries(map)) {
    prefixed[key] = varName.startsWith('--')
      ? `--${prefix}-${varName.slice(2)}`
      : varName;
  }

  let css = variableCss;
  css = css.replace(/--([a-zA-Z][\w-]*)\s*:/g, `--${prefix}-$1:`);
  css = css.replace(/var\(--([a-zA-Z][\w-]*)\)/g, `var(--${prefix}-$1)`);

  return {
    variableMapJson: JSON.stringify(prefixed),
    variableCss: css,
  };
}
