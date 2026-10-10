import { parseInternalWire } from './internal-wire';
import { createPropertyNames, renameCustomProperties } from './property-names';

export interface PrefixedSystemArtifacts {
  variableMapJson: string;
  variableCss: string;
  themeJson?: string;
  contextualVarsJson?: string;
  declarationScalesJson?: string;
}

/**
 * The prefix without `prefixContextualVars`: every name Animus generates (a
 * variable the theme's map or variable CSS defines) takes `--${prefix}-`
 * wherever it is defined, registered or read, `var()` fallbacks at any depth
 * included. Every other name stays as written: each declared contextual
 * variable, and any custom property an author writes.
 */
export function applyPrefix(
  prefix: string,
  variableMapJson: string,
  variableCss: string,
  themeJson?: string,
  contextualVarsJson?: string,
  declarationScalesJson?: string
): PrefixedSystemArtifacts {
  if (!prefix) {
    return {
      variableMapJson,
      variableCss,
      themeJson,
      contextualVarsJson,
      declarationScalesJson,
    };
  }

  const contextual = new Set(
    contextualVarsJson
      ? Object.values(
          parseInternalWire<Record<string, string[]>>(
            contextualVarsJson,
            "contextualVarsJson (the theme's contextual variable names)"
          )
        ).flat()
      : []
  );
  const variableMap = parseInternalWire<Record<string, string>>(
    variableMapJson,
    "variableMapJson (the theme's token variables)"
  );
  const generated = [
    ...Object.values(variableMap).map((name) => name.replace(/^--/, '')),
    ...[...variableCss.matchAll(THEME_DEFINITION)].map((m) => m[1]),
  ].filter((name) => !contextual.has(name));
  const names = createPropertyNames([], prefix, generated);
  const rename = (value: string) => renameCustomProperties(value, names);

  const result: PrefixedSystemArtifacts = {
    variableMapJson: JSON.stringify(
      Object.fromEntries(
        Object.entries(variableMap).map(([key, name]) => [key, rename(name)])
      )
    ),
    variableCss: rename(variableCss),
  };
  if (themeJson) result.themeJson = renameTokenValues(themeJson, rename);
  if (contextualVarsJson) result.contextualVarsJson = contextualVarsJson;
  if (declarationScalesJson) {
    result.declarationScalesJson = renameDeclarationRecords(
      declarationScalesJson,
      rename
    );
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
  nameConflicts: PrefixNameConflict[];
}

/** A final name the prefix cannot give without a collision. */
export interface PrefixNameConflict {
  /** The contextual variable, or the theme variable spelled like its final
   *  name, without `--`. */
  name: string;
  final: string;
  reason: 'transport' | 'theme-variable';
}

/** The runtime's transport variables are `--animus-<prop>`. */
const TRANSPORT_NAMESPACE = 'animus-';

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
  const managed = createPropertyNames(declared, prefix, themeDefined);
  const nameConflicts: PrefixNameConflict[] = [
    ...[...new Set(declared)].flatMap((name): PrefixNameConflict[] => {
      const final = managed.finalName(name) ?? name;
      return final.startsWith(TRANSPORT_NAMESPACE)
        ? [{ name, final, reason: 'transport' }]
        : [];
    }),
    ...managed.ambiguous().map(({ name, contextual }): PrefixNameConflict => ({
      name,
      final: contextual,
      reason: 'theme-variable',
    })),
  ];
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
    nameConflicts,
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
