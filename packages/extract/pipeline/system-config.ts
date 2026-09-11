import { applyPrefix } from './prefix';

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
  selectorAliasesJson: string | null;
  /** Condition alias map JSON; `null` when the system registers none.
   *  Optional only so the pre-load empty default need not restate it. */
  conditionAliasesJson?: string | null;
  /** `{ transformName: sourceText }` — the only channel by which transforms
   *  shipped inside a package reach the build-time evaluator. */
  transformSourcesJson?: string | null;
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
  let variableCss: string = config.variableCss;
  let contextualVarsJson: string | null = config.contextualVarsJson || null;

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
  }

  return {
    propConfigJson: config.propConfig,
    groupRegistryJson: config.groupRegistry,
    scalesJson,
    variableMapJson,
    variableCss,
    contextualVarsJson,
    selectorAliasesJson: config.selectorAliases || null,
    conditionAliasesJson: config.conditionAliases || null,
    transformSourcesJson: config.transformSources || null,
    globalStyleBlocksJson: config.globalStyleBlocks || null,
    keyframesJson: config.keyframesBlocks || null,
    vocabularyWitnessesJson: config.vocabularyWitnesses || null,
    dependencies: config.dependencies ?? [],
    sourceThemeManifestsJson: config.sourceThemeManifests || null,
  };
}
