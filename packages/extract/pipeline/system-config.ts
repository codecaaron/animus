import { applyPrefix, prefixVariableReferences } from './prefix';
import { splitInvalidPropertyRegistrations } from './property-registrations';

import type { InvalidPropertyRegistration } from './property-registrations';

/**
 * The deserialized `loadSystemModule()` result, prefix transformation
 * already applied. Field names are `AnalyzeProjectInputs`' own.
 */
export interface SystemConfig {
  propConfigJson: string;
  groupRegistryJson: string;
  scalesJson: string;
  variableMapJson: string;
  variableCss: string;
  contextualVarsJson: string | null;
  /** The theme's declaration scales; absent when it declares none. */
  declarationScalesJson?: string | null;
  selectorAliasesJson: string | null;
  /** Condition alias map JSON; `null` when the system registers none.
   *  Optional only so the pre-load empty default need not restate it. */
  conditionAliasesJson?: string | null;
  /** `{ definitionId: sourceText }` — the only channel by which transforms
   *  shipped inside a package reach the build-time evaluator. Sources that
   *  pass admission there become the manifest's `admitted_transforms`. */
  transformSourcesJson?: string | null;
  /** `{ definitionId: { hostGlobals } | { rejection } }` — which `btoa` /
   *  `atob` each configured callable reads as the host function, located
   *  from the callable itself; without it such a source is not admitted. */
  transformProvenanceJson?: string | null;
  globalStyleBlocksJson: string | null;
  keyframesJson: string | null;
  /** Coded witness entries from the sealed system's registration record —
   *  the witness channel, since the evaluation host's console is a no-op. */
  vocabularyWitnessesJson?: string | null;
  /** Canonical absolute paths of every module the loader evaluated (sorted;
   *  runtime stubs excluded) — the system-reload membership set. */
  dependencies?: string[];
  /** `{ modulePath: { exportName: [token paths] } }` — the source-token
   *  witness for correlation. Null when no module exports a built theme. */
  sourceThemeManifestsJson?: string | null;
  /** Registrations removed from `variableCss`; absent when all are valid. */
  invalidPropertyRegistrations?: InvalidPropertyRegistration[];
}

/**
 * Load and normalize a SystemInstance; `prefix` namespaces every CSS
 * variable name. Error handling stays at the call site.
 */
export function loadSystemConfig(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engineApi: () => any,
  opts: { systemPath: string; rootDir: string; prefix?: string }
): SystemConfig {
  const { loadSystemModule } = engineApi();
  const config = loadSystemModule(opts.systemPath, opts.rootDir);

  let scalesJson: string = config.scalesJson;
  let variableMapJson: string = config.variableMapJson;
  const registrations = splitInvalidPropertyRegistrations(config.variableCss);
  let variableCss: string = registrations.css;
  let contextualVarsJson: string | null = config.contextualVarsJson || null;
  let declarationScalesJson: string | null =
    config.declarationScalesJson || null;

  if (opts.prefix) {
    const prefixed = applyPrefix(
      opts.prefix,
      variableMapJson,
      variableCss,
      scalesJson,
      contextualVarsJson || undefined
    );
    variableMapJson = prefixed.variableMapJson;
    variableCss = prefixed.variableCss;
    if (prefixed.themeJson) scalesJson = prefixed.themeJson;
    if (prefixed.contextualVarsJson) {
      contextualVarsJson = prefixed.contextualVarsJson;
    }
    // Records hold resolved `var()` references, rewritten like scale values.
    if (declarationScalesJson) {
      declarationScalesJson = prefixVariableReferences(
        opts.prefix,
        declarationScalesJson
      );
    }
  }

  const system: SystemConfig = {
    propConfigJson: config.propConfig,
    groupRegistryJson: config.groupRegistry,
    scalesJson,
    variableMapJson,
    variableCss,
    contextualVarsJson,
    selectorAliasesJson: config.selectorAliases || null,
    conditionAliasesJson: config.conditionAliases || null,
    transformSourcesJson: config.transformSources || null,
    transformProvenanceJson: config.transformProvenance || null,
    globalStyleBlocksJson: config.globalStyleBlocks || null,
    keyframesJson: config.keyframesBlocks || null,
    vocabularyWitnessesJson: config.vocabularyWitnesses || null,
    dependencies: config.dependencies ?? [],
    sourceThemeManifestsJson: config.sourceThemeManifests || null,
  };
  if (declarationScalesJson)
    system.declarationScalesJson = declarationScalesJson;
  if (registrations.invalid.length > 0) {
    system.invalidPropertyRegistrations = registrations.invalid;
  }
  return system;
}
