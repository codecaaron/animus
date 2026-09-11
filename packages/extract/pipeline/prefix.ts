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
