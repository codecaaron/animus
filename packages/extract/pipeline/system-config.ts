import { applyPrefix } from './prefix';

/**
 * The system-derived configuration bundle every extraction run needs —
 * the deserialized result of the NAPI `loadSystemModule()` call, with the
 * optional variable-prefix transformation already applied. Field names
 * mirror `AnalyzeProjectInputs` so the bundle feeds `runProjectAnalysis`
 * without renaming.
 */
export interface SystemConfig {
  propConfigJson: string;
  groupRegistryJson: string;
  scalesJson: string;
  variableMapJson: string;
  variableCss: string;
  contextualVarsJson: string | null;
  selectorAliasesJson: string | null;
  /** Condition alias map JSON (modern-css-surface inc 03), mirroring
   *  `selectorAliasesJson` — `null` when the system registers none.
   *  Optional so the plugins' pre-load `emptySystemConfig()` default need not
   *  restate it; `loadSystemConfig` always populates it after a real load. */
  conditionAliasesJson?: string | null;
  globalStyleBlocksJson: string | null;
  keyframesJson: string | null;
}

/**
 * Load a SystemInstance via the engine's `loadSystemModule` and normalize
 * it into a SystemConfig. When `prefix` is set, CSS variable names in the
 * variable map/css (and theme + contextual vars when affected) are
 * namespaced via the shared `applyPrefix`.
 *
 * Error handling stays at the call site — the Vite plugin warns (or throws
 * in strict mode) and keeps its previous config, the Next plugin lets the
 * failure propagate.
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
    globalStyleBlocksJson: config.globalStyleBlocks || null,
    keyframesJson: config.keyframesBlocks || null,
  };
}
