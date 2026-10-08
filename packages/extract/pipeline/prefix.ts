export interface PrefixedSystemArtifacts {
  variableMapJson: string;
  variableCss: string;
  themeJson?: string;
  contextualVarsJson?: string;
}

/** Prefix variable references without changing their matching rules. */
export function prefixVariableReferences(
  prefix: string,
  value: string
): string {
  if (!prefix) return value;
  return value.replace(/var\(--([a-zA-Z][\w-]*)\)/g, `var(--${prefix}-$1)`);
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

  const map: Record<string, string> = JSON.parse(variableMapJson);
  const prefixed: Record<string, string> = {};
  for (const [key, varName] of Object.entries(map)) {
    prefixed[key] = varName.startsWith('--')
      ? `--${prefix}-${varName.slice(2)}`
      : varName;
  }

  let css = variableCss;
  css = css.replace(/--([a-zA-Z][\w-]*)\s*:/g, `--${prefix}-$1:`);
  css = prefixVariableReferences(prefix, css);
  css = css.replace(
    /@property(\s+)--([a-zA-Z][\w-]*)/g,
    `@property$1--${prefix}-$2`
  );

  const result: PrefixedSystemArtifacts = {
    variableMapJson: JSON.stringify(prefixed),
    variableCss: css,
  };

  if (themeJson) {
    result.themeJson = prefixVariableReferences(prefix, themeJson);
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
