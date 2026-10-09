import { parseInternalWire } from './internal-wire';
import { createPropertyNames, renameCustomProperties } from './property-names';

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

export interface PropertyNameArtifacts {
  variableMapJson: string;
  variableCss: string;
  themeJson: string;
  contextualVarsJson: string | null;
  declarationScalesJson: string | null;
}

/** The theme artifacts with final names, and the custom properties the
 *  contextual variables emit. */
export interface ResolvedPropertyNames extends PropertyNameArtifacts {
  contextualProperties: string[];
}

/** A contextual variable under `prefixContextualVars`: the name authors
 *  write and the final name Animus emits, both without `--`. */
export interface ResolvedContextualVar {
  name: string;
  var: string;
}

/**
 * The prefix applied through one map: every variable the theme defines and
 * every declared contextual variable takes `--${prefix}-${name}`, each
 * reference renamed once. Each contextual entry carries its declared and
 * final name, so lookups run on the declared identity and the extractor
 * emits the final name.
 */
export function applyPropertyNames(
  prefix: string,
  artifacts: PropertyNameArtifacts
): ResolvedPropertyNames {
  const byScale = artifacts.contextualVarsJson
    ? parseInternalWire<Record<string, string[]>>(
        artifacts.contextualVarsJson,
        "contextualVarsJson (the theme's contextual variable names)"
      )
    : null;
  const declared = Object.values(byScale ?? {}).flat();
  const variableMap = parseInternalWire<Record<string, string>>(
    artifacts.variableMapJson,
    "variableMapJson (the theme's token variables)"
  );
  const themeDefined = [
    ...Object.values(variableMap).map((name) => name.replace(/^--/, '')),
    ...[...artifacts.variableCss.matchAll(THEME_DEFINITION)].map((m) => m[1]),
  ];
  const managed = createPropertyNames([...themeDefined, ...declared], prefix);
  const rename = (value: string) => renameCustomProperties(value, managed);
  return {
    variableMapJson: JSON.stringify(
      Object.fromEntries(
        Object.entries(variableMap).map(([key, name]) => [key, rename(name)])
      )
    ),
    variableCss: rename(artifacts.variableCss),
    themeJson: renameTokenValues(artifacts.themeJson, rename),
    contextualVarsJson:
      byScale === null
        ? null
        : JSON.stringify(
            Object.fromEntries(
              Object.entries(byScale).map(([scale, names]) => [
                scale,
                names.map((name): ResolvedContextualVar => ({
                  name,
                  var: managed.finalName(name) ?? name,
                })),
              ])
            )
          ),
    declarationScalesJson:
      artifacts.declarationScalesJson === null
        ? null
        : renameDeclarationRecords(artifacts.declarationScalesJson, rename),
    contextualProperties: [...new Set(declared)].map(
      (name) => `--${managed.finalName(name) ?? name}`
    ),
  };
}

/** A custom property the theme's CSS defines or registers. */
const THEME_DEFINITION = /(?:@property\s+|(?:^|[\s;{]))--([\w-]+)(?=\s*[:{])/g;

/** Renames inside the token map's values. */
function renameTokenValues(
  themeJson: string,
  rename: (value: string) => string
): string {
  const tokens = parseInternalWire<Record<string, string>>(
    themeJson,
    "themeJson (the theme's flattened token values)"
  );
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(tokens).map(([path, value]) => [path, rename(value)])
    )
  );
}

interface DeclarationScaleWire {
  kind: string;
  members: string[];
  values: Record<string, Record<string, string>>;
}

/** Renames inside every declaration-scale record value. */
function renameDeclarationRecords(
  declarationScalesJson: string,
  rename: (value: string) => string
): string {
  const scales = parseInternalWire<Record<string, DeclarationScaleWire>>(
    declarationScalesJson,
    "declarationScalesJson (the theme's declaration scales)"
  );
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(scales).map(([name, scale]) => [
        name,
        {
          ...scale,
          values: Object.fromEntries(
            Object.entries(scale.values).map(([key, record]) => [
              key,
              Object.fromEntries(
                Object.entries(record).map(([property, value]) => [
                  property,
                  rename(value),
                ])
              ),
            ])
          ),
        },
      ])
    )
  );
}
