import { readFileSync } from 'fs';

import {
  engineModuleParser,
  unimportedCreateSystemCall,
} from './discover-packages';
import { extensionPolicyJson } from './host-extensions';
import { parseInternalWire } from './internal-wire';
import { loadFindingDiagnostics, warnLine } from './manifest-diagnostics';
import { applyPrefix, applyPropertyNames } from './prefix';
import { splitInvalidPropertyRegistrations } from './property-registrations';
import { cachedSystemLoad } from './system-load-cache';

import type { EngineApi } from './engine-adapter';
import type { HostExtensionPolicy } from './host-extensions';
import type { PrefixNameConflict } from './prefix';
import type { InvalidPropertyRegistration } from './property-registrations';
import type { WorkspacePackages } from './workspace-packages';

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
  /** Registered position-try collections; absent when none are. */
  positionTryJson?: string;
  /** Registered view-transition collections; absent when none are. */
  viewTransitionsJson?: string;
  /** Coded witness entries from the sealed system's registration record —
   *  the witness channel, since the evaluation host's console is a no-op. */
  vocabularyWitnessesJson?: string | null;
  /** The loader's findings about owned code the system does not reach, as
   *  one JSON array (`loadFindingDiagnostics` reads it). */
  loadFindingsJson?: string | null;
  /** Canonical absolute paths of every file the loader read: each module it
   *  ran, routed through or audited, and each `package.json` it consulted
   *  (sorted; runtime stubs excluded) — the system-reload membership set. */
  dependencies?: string[];
  /** Paths the loader looked for and found absent, ahead of the file it
   *  chose: creating one changes what the system loads. */
  missing?: string[];
  /** `{ modulePath: { exportName: [token paths] } }` — the source-token
   *  witness for correlation. Null when no module exports a built theme. */
  sourceThemeManifestsJson?: string | null;
  /** Registrations removed from `variableCss`; absent when all are valid. */
  invalidPropertyRegistrations?: InvalidPropertyRegistration[];
  /** The custom properties the declared contextual variables emit. */
  contextualProperties?: string[];
  /** Final names that would collide under `prefixContextualVars`. */
  prefixNameConflicts?: PrefixNameConflict[];
  /** Under a prefix, each name the theme generates and its final name,
   *  without `--`: the extractor renames those names in authored styles. */
  generatedNamesJson?: string;
}

/** What a failed system load read and looked for: the engine carries them
 *  on its error, here or on a wrapping error's cause. Empty when it carries
 *  none. */
export interface SystemLoadReads {
  dependencies: string[];
  missing: string[];
}

/** What the engine's load error carries, directly or as a wrapping
 *  error's cause. */
interface EngineLoadError {
  dependencies?: string[];
  missing?: string[];
  loadFindingsJson?: string;
  cause?: EngineLoadError;
}

export function systemLoadReads<Thrown>(error: Thrown): SystemLoadReads {
  // SAFETY: a failed load throws the engine's `Error`, whose `dependencies`
  // and `missing` are string lists (the loadSystemModule binding), or an
  // error wrapping it as `cause`; any other throw carries neither.
  const thrown = error as EngineLoadError | null | undefined;
  const carrier = thrown?.dependencies ? thrown : thrown?.cause;
  return {
    dependencies: carrier?.dependencies ?? [],
    missing: carrier?.missing ?? [],
  };
}

/** A failed load keeps the findings it made before failing: each joins the
 *  error's message, so the failure reports them too. */
function reportFindingsOn<Thrown>(error: Thrown): void {
  // SAFETY: the engine's load error is an `Error` whose `loadFindingsJson`
  // is the findings wire (the loadSystemModule binding); any other throw
  // carries none.
  const thrown = error as (Error & EngineLoadError) | null | undefined;
  if (!(thrown instanceof Error) || !thrown.loadFindingsJson) return;
  const reasons = loadFindingDiagnostics(thrown.loadFindingsJson).map(
    (diagnostic) => diagnostic.message
  );
  thrown.message = [thrown.message, ...reasons].join('\n');
}

/** The loader's evaluation of the system file. A failure on a file that
 *  calls `createSystem` with no binding leads with discovery's warning line
 *  for it, then keeps the loader's own error. */
function evaluateSystemModule(
  engine: Pick<
    EngineApi,
    'loadSystemModule' | 'extractFacts' | 'extractModuleFacts' | 'engineBuildId'
  >,
  systemPath: string,
  systemExport: string | undefined,
  rootDir: string,
  conditions: readonly string[] | undefined,
  workspaces: WorkspacePackages | undefined,
  extensions: HostExtensionPolicy | undefined,
  instances: Readonly<Record<string, string>> | undefined
) {
  const args = [
    systemPath,
    rootDir,
    systemExport,
    conditions,
    workspaces,
    extensions && extensionPolicyJson(extensions),
    instances,
  ];
  try {
    return cachedSystemLoad(engine.engineBuildId?.(), rootDir, args, () =>
      engine.loadSystemModule(...args)
    );
  } catch (error) {
    reportFindingsOn(error);
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
    /** The system's export name; the loader infers it when absent. */
    systemExport?: string;
    rootDir: string;
    prefix?: string;
    prefixContextualVars?: boolean;
    /** The host's export conditions, in its order; the loader tries them
     *  with `import` and `default`. */
    conditions?: readonly string[];
    /** The session root's declared workspaces, which the loader consults
     *  after a `node_modules` lookup misses. */
    workspaces?: WorkspacePackages;
    /** The host's extension order; the built-in policy when absent. */
    extensions?: HostExtensionPolicy;
    /** The host's instance of each kit the system reaches, by package name
     *  (C8): the loader evaluates that instance from every importer. */
    instances?: Readonly<Record<string, string>>;
  }
): SystemConfig {
  const config = evaluateSystemModule(
    engineApi(),
    opts.systemPath,
    opts.systemExport,
    opts.rootDir,
    opts.conditions,
    opts.workspaces,
    opts.extensions,
    opts.instances
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
  let prefixNameConflicts: PrefixNameConflict[] = [];
  let generatedNamesJson: string | null | undefined;
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
    generatedNamesJson = resolved.generatedNamesJson;
  } else if (opts.prefix) {
    // Contextual variables keep their declared names; only the names Animus
    // generates take the prefix.
    const prefixed = applyPrefix(
      opts.prefix,
      variableMapJson,
      variableCss,
      scalesJson,
      contextualVarsJson || undefined,
      declarationScalesJson || undefined
    );
    variableMapJson = prefixed.variableMapJson;
    variableCss = prefixed.variableCss;
    if (prefixed.themeJson) scalesJson = prefixed.themeJson;
    // Records hold resolved `var()` references, rewritten like scale values.
    if (prefixed.declarationScalesJson) {
      declarationScalesJson = prefixed.declarationScalesJson;
    }
    generatedNamesJson = prefixed.generatedNamesJson;
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
    loadFindingsJson: config.loadFindingsJson || null,
    dependencies: config.dependencies ?? [],
    missing: config.missing ?? [],
    sourceThemeManifestsJson: config.sourceThemeManifests || null,
  };
  if (declarationScalesJson)
    system.declarationScalesJson = declarationScalesJson;
  if (config.propertyRecordsJson) {
    system.propertyRecordsJson = config.propertyRecordsJson;
  }
  if (config.positionTryBlocks) {
    system.positionTryJson = config.positionTryBlocks;
  }
  if (config.viewTransitionBlocks) {
    system.viewTransitionsJson = config.viewTransitionBlocks;
  }
  if (registrations.invalid.length > 0) {
    system.invalidPropertyRegistrations = registrations.invalid;
  }
  if (prefixNameConflicts.length > 0) {
    system.prefixNameConflicts = prefixNameConflicts;
  }
  if (generatedNamesJson) system.generatedNamesJson = generatedNamesJson;
  return system;
}
