/**
 * Apply namespace prefix to a variable map, CSS variable declarations, and theme JSON.
 *
 * Variable map: `{ "colors.ember": "--color-ember" }` -> `{ "colors.ember": "--prefix-color-ember" }`
 * Variable CSS: `--color-ember: #FF2800` -> `--prefix-color-ember: #FF2800`
 *               `var(--color-ember)` -> `var(--prefix-color-ember)`
 * Theme JSON:   `{ "colors.ember": "var(--color-ember)" }` -> `{ "colors.ember": "var(--prefix-color-ember)" }`
 */
/**
 * The prefixed slice of a system's serialized artifacts. `themeJson` and
 * `contextualVarsJson` are absent exactly when the caller supplied none —
 * `applyPrefix` never invents an input it was not given.
 */
export interface PrefixedSystemArtifacts {
  variableMapJson: string;
  variableCss: string;
  themeJson?: string;
  contextualVarsJson?: string;
}

export function applyPrefix(
  prefix: string,
  variableMapJson: string,
  variableCss: string,
  themeJson?: string,
  contextualVarsJson?: string
): PrefixedSystemArtifacts {
  if (!prefix)
    return { variableMapJson, variableCss, themeJson, contextualVarsJson };

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

  const result: PrefixedSystemArtifacts = {
    variableMapJson: JSON.stringify(prefixed),
    variableCss: css,
  };

  if (themeJson) {
    result.themeJson = themeJson.replace(varRefRe, `var(--${prefix}-$1)`);
  }

  if (contextualVarsJson) {
    const ctxVars: Record<string, string[]> = JSON.parse(contextualVarsJson);
    const prefixedCtx: Record<string, string[]> = {};
    for (const [scale, names] of Object.entries(ctxVars)) {
      prefixedCtx[scale] = names.map((name) => `${prefix}-${name}`);
    }
    result.contextualVarsJson = JSON.stringify(prefixedCtx);
  }

  return result;
}
