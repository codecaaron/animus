import { readFileSync } from 'fs';

import {
  engineModuleParser,
  unimportedCreateSystemCall,
} from './discover-packages';
import { parseInternalWire } from './internal-wire';
import { warnLine } from './manifest-diagnostics';
import {
  applyPrefix,
  applyPropertyNames,
  prefixVariableReferences,
} from './prefix';
import { splitInvalidPropertyRegistrations } from './property-registrations';

import type { EngineApi } from './engine-adapter';
import type { PrefixNameConflict } from './prefix';
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
  /** One record per declared custom property, sorted by name, with authored
   *  names: the prefix is not applied. Absent when the theme declares none. */
  propertyRecordsJson?: string;
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
  /** The custom properties the declared contextual variables emit. */
  contextualProperties?: string[];
  /** Final names that would collide under `prefixContextualVars`. */
  prefixNameConflicts?: PrefixNameConflict[];
  /** Contextual variables a prefix renamed without `prefixContextualVars`,
   *  so their declared names no longer resolve. */
  legacyPrefixedContextualVars?: string[];
}

/** The loader's evaluation of the system file. A failure on a file that
 *  calls `createSystem` with no binding leads with discovery's warning line
 *  for it, then keeps the loader's own error. */
function evaluateSystemModule(
  engine: Pick<EngineApi, 'loadSystemModule' | 'extractFacts'>,
  systemPath: string,
  rootDir: string
) {
  try {
    return engine.loadSystemModule(systemPath, rootDir);
  } catch (error) {
    let source: string;
    try {
      source = readFileSync(systemPath, 'utf-8');
    } catch {
      throw error;
    }
    const record = engineModuleParser(engine)?.(source, systemPath);
    const call = record && unimportedCreateSystemCall(systemPath, record);
    if (!call) throw error;
    throw new Error(`${warnLine(call)}\n${String(error)}`, { cause: error });
  }
}

/**
 * Load and normalize a SystemInstance; `prefix` namespaces every CSS
 * variable name. Error handling stays at the call site.
 */
export function loadSystemConfig(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engineApi: () => any,
  opts: {
    systemPath: string;
    rootDir: string;
    prefix?: string;
    prefixContextualVars?: boolean;
  }
): SystemConfig {
  const config = evaluateSystemModule(
    engineApi(),
    opts.systemPath,
    opts.rootDir
  );

  let scalesJson: string = config.scalesJson;
  let variableMapJson: string = config.variableMapJson;
  const registrations = splitInvalidPropertyRegistrations(config.variableCss);
  let variableCss: string = registrations.css;
  let contextualVarsJson: string | null = config.contextualVarsJson || null;
  let declarationScalesJson: string | null =
    config.declarationScalesJson || null;

  const declaredNames = Object.values(
    parseInternalWire<Record<string, string[]>>(
      contextualVarsJson ?? '{}',
      "contextualVarsJson (the theme's contextual variable names)"
    )
  ).flat();
  let contextualProperties = declaredNames.map((name) => `--${name}`);
  let legacyPrefixedContextualVars: string[] = [];
  let prefixNameConflicts: PrefixNameConflict[] = [];
  if (opts.prefix && opts.prefixContextualVars) {
    const resolved = applyPropertyNames(opts.prefix, {
      variableMapJson,
      variableCss,
      themeJson: scalesJson,
      contextualVarsJson,
      declarationScalesJson,
    });
    variableMapJson = resolved.variableMapJson;
    variableCss = resolved.variableCss;
    scalesJson = resolved.themeJson;
    contextualVarsJson = resolved.contextualVarsJson;
    contextualProperties = resolved.contextualProperties;
    prefixNameConflicts = resolved.nameConflicts;
    declarationScalesJson = resolved.declarationScalesJson;
  } else if (opts.prefix) {
    legacyPrefixedContextualVars = declaredNames;
    contextualProperties = declaredNames.map(
      (name) => `--${opts.prefix}-${name}`
    );
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
    contextualProperties: [...new Set(contextualProperties)],
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
  if (config.propertyRecordsJson) {
    system.propertyRecordsJson = config.propertyRecordsJson;
  }
  if (registrations.invalid.length > 0) {
    system.invalidPropertyRegistrations = registrations.invalid;
  }
  if (prefixNameConflicts.length > 0) {
    system.prefixNameConflicts = prefixNameConflicts;
  }
  if (legacyPrefixedContextualVars.length > 0) {
    system.legacyPrefixedContextualVars = [
      ...new Set(legacyPrefixedContextualVars),
    ];
  }
  return system;
}
