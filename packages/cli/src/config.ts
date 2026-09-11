import {
  AnimusConfigError,
  assertKnownOptionKeys,
  assertNoRetiredEngineSelection,
  createExcludeMatcher,
  resolveMode,
} from '@animus-ui/extract/pipeline';
import { ANIMUS_ARTIFACT_DIR } from '@animus-ui/extract/session';
import { existsSync, readFileSync } from 'fs';
import { dirname, isAbsolute, resolve } from 'path';
import { pathToFileURL } from 'url';

import type {
  AnimusCoreOptions,
  AnimusMode,
  OptionProvenance,
  StaticCssComponentOverride,
  StaticCssConfig,
} from '@animus-ui/extract/pipeline';

export const CONFIG_FILENAMES = [
  'animus.config.json',
  'animus.config.mjs',
  'animus.config.js',
  'animus.config.ts',
] as const;

export interface CliNamespaceOptions {
  /** Artifact output directory, relative to the root. @default '.animus' */
  outDir?: string;
}

export interface CliFlags {
  system?: string;
  root?: string;
  config?: string;
  outDir?: string;
  strict?: boolean;
  verbose?: boolean;
  mode?: string;
  targets?: string;
  exclude?: string[];
}

export type CliRootSource = 'flag' | 'config-file' | 'config-dir' | 'cwd';

export interface ResolvedCliConfig {
  driver: 'cli';
  /** Absolute root every relative input resolves against. */
  root: string;
  rootSource: CliRootSource;
  configFile: string | null;
  options: AnimusCoreOptions;
  /** Absolute artifact output directory. */
  outDir: string;
  excludePatterns: readonly string[];
  mode: AnimusMode;
  provenance: Record<string, OptionProvenance>;
}

interface ConfigRecord {
  [key: string]: ConfigValue;
}

type ConfigValue =
  | null
  | undefined
  | boolean
  | number
  | string
  | bigint
  | symbol
  | ConfigRecord
  | readonly ConfigValue[]
  | Function;

interface LoadedCliConfig {
  core: Partial<AnimusCoreOptions>;
  cli: CliNamespaceOptions;
}

const isConfigReference = <Value>(
  value: Value
): value is Value & (ConfigRecord | Function) => Object(value) === value;

const isConfigCallable = <Value>(value: Value): value is Value & Function => {
  if (!isConfigReference(value)) return false;
  try {
    Function.prototype.toString.call(value);
    return true;
  } catch {
    return false;
  }
};

const isConfigRecord = <Value>(value: Value): value is Value & ConfigRecord =>
  isConfigReference(value) && !Array.isArray(value) && !isConfigCallable(value);

type ReadConfigPrimitive = () => ConfigValue;

const acceptsConfigPrimitive = <Value>(
  value: Value,
  read: ReadConfigPrimitive
): boolean => {
  if (isConfigReference(value)) return false;
  try {
    read();
    return true;
  } catch {
    return false;
  }
};

const isConfigString = <Value>(value: Value): value is Value & string =>
  acceptsConfigPrimitive(value, () => String.prototype.valueOf.call(value));

const isConfigBoolean = <Value>(value: Value): value is Value & boolean =>
  acceptsConfigPrimitive(value, () => Boolean.prototype.valueOf.call(value));

const isConfigNumber = <Value>(value: Value): value is Value & number =>
  acceptsConfigPrimitive(value, () => Number.prototype.valueOf.call(value));

const isConfigStringArray = <Value>(value: Value): value is Value & string[] =>
  Array.isArray(value) && value.every((entry) => isConfigString(entry));

function isStaticCssComponentOverride<Value>(
  value: Value
): value is Value & StaticCssComponentOverride {
  if (!isConfigRecord(value)) return false;
  const variants = value.variants;
  if (
    variants !== undefined &&
    variants !== '*' &&
    (!isConfigRecord(variants) ||
      Object.values(variants).some(
        (entry) => entry !== '*' && !isConfigStringArray(entry)
      ))
  ) {
    return false;
  }
  const states = value.states;
  if (states !== undefined && states !== '*' && !isConfigStringArray(states)) {
    return false;
  }
  return (
    value.dynamicProps === undefined || isConfigStringArray(value.dynamicProps)
  );
}

function isStaticCssConfig<Value>(
  value: Value
): value is Value & StaticCssConfig {
  if (!isConfigRecord(value)) return false;
  if (
    value.components !== undefined &&
    (!isConfigRecord(value.components) ||
      Object.values(value.components).some(
        (component) => !isStaticCssComponentOverride(component)
      ))
  ) {
    return false;
  }
  if (value.systemProps === undefined) return true;
  if (!isConfigRecord(value.systemProps)) return false;
  return Object.values(value.systemProps).every(
    (values) =>
      Array.isArray(values) &&
      values.every(
        (entry) =>
          isConfigString(entry) ||
          isConfigNumber(entry) ||
          (isConfigRecord(entry) &&
            Object.values(entry).every(
              (responsiveValue) =>
                isConfigString(responsiveValue) ||
                isConfigNumber(responsiveValue)
            ))
      )
  );
}

function configObject<Value>(value: Value, message: string): ConfigRecord {
  if (isConfigRecord(value)) return value;
  throw new AnimusConfigError(message);
}

function configStaticCss(value: ConfigValue): StaticCssConfig | undefined {
  if (value === undefined) return undefined;
  if (isStaticCssConfig(value)) return value;
  throw new AnimusConfigError(
    `Invalid value for "staticCss" — expected a static CSS declaration object, got ` +
      `${JSON.stringify(value)}.`
  );
}

function parseLoadedCliConfig(raw: ConfigRecord): LoadedCliConfig {
  // This projection drops `engine`, so without this gate a config asking
  // for the retired v1 engine would silently run v2.
  assertNoRetiredEngineSelection(
    isConfigString(raw.engine) ? raw.engine : undefined
  );
  // Runs before the projection, so the shared validator's key and
  // primitive error precedence is what the user sees.
  assertKnownOptionKeys(raw);
  const cliValue = raw.cli;
  const cli = isConfigRecord(cliValue) ? cliValue : {};
  if (cli.outDir !== undefined && !isConfigString(cli.outDir)) {
    throw new AnimusConfigError(
      `Invalid value for "cli.outDir" — expected a string path, got ` +
        `${JSON.stringify(cli.outDir)}.`
    );
  }
  return {
    core: {
      system: isConfigString(raw.system) ? raw.system : undefined,
      root: isConfigString(raw.root) ? raw.root : undefined,
      exclude: isConfigStringArray(raw.exclude) ? raw.exclude : undefined,
      extensions: isConfigStringArray(raw.extensions)
        ? raw.extensions
        : undefined,
      strict: isConfigBoolean(raw.strict) ? raw.strict : undefined,
      verbose: isConfigBoolean(raw.verbose) ? raw.verbose : undefined,
      prefix: isConfigString(raw.prefix) ? raw.prefix : undefined,
      targets:
        isConfigString(raw.targets) || isConfigStringArray(raw.targets)
          ? raw.targets
          : undefined,
      minify: isConfigBoolean(raw.minify) ? raw.minify : undefined,
      staticCss: configStaticCss(raw.staticCss),
      layers: isConfigStringArray(raw.layers) ? raw.layers : undefined,
      mode:
        raw.mode === 'development' || raw.mode === 'production'
          ? raw.mode
          : undefined,
    },
    cli: {
      outDir: cli.outDir,
    },
  };
}

async function loadConfigFile(path: string): Promise<ConfigRecord> {
  if (path.endsWith('.json')) {
    try {
      return configObject(
        JSON.parse(readFileSync(path, 'utf-8')),
        `${path} must contain a config object`
      );
    } catch (error) {
      throw new AnimusConfigError(`Failed to parse ${path}: ${String(error)}`);
    }
  }
  try {
    const mod = configObject(
      await import(pathToFileURL(path).href),
      `${path} must evaluate to a module object`
    );
    const value = mod.default ?? mod;
    return configObject(value, `${path} must default-export a config object`);
  } catch (error) {
    if (error instanceof AnimusConfigError) throw error;
    const code =
      isConfigRecord(error) && isConfigString(error.code)
        ? error.code
        : undefined;
    if (path.endsWith('.ts') && code === 'ERR_UNKNOWN_FILE_EXTENSION') {
      throw new AnimusConfigError(
        `${path}: this Node runtime cannot evaluate TypeScript config files ` +
          `(native type stripping requires Node >= 23.6 unflagged; the ` +
          `supported floor for .ts configs). Use animus.config.mjs or ` +
          `animus.config.json instead.`
      );
    }
    throw new AnimusConfigError(
      `Failed to load config ${path}: ${String(error)}`
    );
  }
}

export async function resolveCliConfig(
  flags: CliFlags,
  cwd: string
): Promise<ResolvedCliConfig> {
  const flagRoot = flags.root ? resolve(cwd, flags.root) : null;

  let configFile: string | null = null;
  if (flags.config) {
    configFile = resolve(cwd, flags.config);
    if (!existsSync(configFile)) {
      throw new AnimusConfigError(`Config file not found: ${configFile}`);
    }
  } else {
    for (const name of CONFIG_FILENAMES) {
      const candidate = resolve(flagRoot ?? cwd, name);
      if (existsSync(candidate)) {
        configFile = candidate;
        break;
      }
    }
  }

  const loaded = parseLoadedCliConfig(
    configFile ? await loadConfigFile(configFile) : {}
  );
  const raw = loaded.core;
  const fileRoot = raw.root;
  const configDir = configFile ? dirname(configFile) : cwd;
  let rootSource: CliRootSource;
  let effectiveRoot: string;
  if (flagRoot !== null) {
    rootSource = 'flag';
    effectiveRoot = flagRoot;
  } else if (fileRoot !== undefined) {
    rootSource = 'config-file';
    effectiveRoot = resolve(configDir, fileRoot);
  } else if (configFile) {
    rootSource = 'config-dir';
    effectiveRoot = configDir;
  } else {
    rootSource = 'cwd';
    effectiveRoot = cwd;
  }

  const provenance: Record<string, OptionProvenance> = {};
  const pick = <K extends keyof AnimusCoreOptions>(
    key: K,
    flagValue: AnimusCoreOptions[K] | undefined
  ): AnimusCoreOptions[K] | undefined => {
    if (flagValue !== undefined) {
      provenance[key] = 'explicit';
      return flagValue;
    }
    const fileValue = raw[key];
    if (fileValue !== undefined) {
      provenance[key] = 'explicit';
      return fileValue;
    }
    provenance[key] = 'default';
    return undefined;
  };

  const system = pick('system', flags.system);
  if (system === undefined || system.length === 0) {
    throw new AnimusConfigError(
      'Missing required option `system` — pass --system ./src/ds.ts or set ' +
        '"system" in animus.config.'
    );
  }

  // `exclude: []` states "exclude nothing" and only the config file can
  // express it; decaying it to undefined restores the replaceable defaults.
  const fileExclude = raw.exclude;
  const flagExclude = flags.exclude;
  const excludeIsExplicit =
    fileExclude !== undefined ||
    (flagExclude !== undefined && flagExclude.length > 0);
  const exclude = [...(fileExclude ?? []), ...(flagExclude ?? [])];
  provenance['exclude'] = excludeIsExplicit ? 'explicit' : 'default';

  if (
    flags.mode !== undefined &&
    flags.mode !== 'development' &&
    flags.mode !== 'production'
  ) {
    throw new AnimusConfigError(
      `Invalid --mode "${flags.mode}" — expected "development" or "production".`
    );
  }
  const resolvedMode = resolveMode(
    flags.mode ?? raw.mode,
    // Production by default; the CLI never sniffs NODE_ENV.
    () => 'production'
  );
  provenance['mode'] = resolvedMode.provenance;

  const outDirSetting =
    flags.outDir ?? loaded.cli.outDir ?? ANIMUS_ARTIFACT_DIR;
  const outDir = isAbsolute(outDirSetting)
    ? outDirSetting
    : resolve(effectiveRoot, outDirSetting);
  provenance['outDir'] =
    flags.outDir !== undefined || loaded.cli.outDir !== undefined
      ? 'explicit'
      : 'driver-default';

  const options: AnimusCoreOptions = {
    system,
    exclude: excludeIsExplicit ? exclude : undefined,
    extensions: pick('extensions', undefined),
    strict: pick('strict', flags.strict),
    verbose: pick('verbose', flags.verbose),
    prefix: pick('prefix', undefined),
    targets: pick('targets', flags.targets),
    minify: pick('minify', undefined),
    staticCss: pick('staticCss', undefined),
    layers: pick('layers', undefined),
    mode: resolvedMode.mode,
  };

  const excludePatterns = createExcludeMatcher(options.exclude).patterns;

  return {
    driver: 'cli',
    root: effectiveRoot,
    rootSource,
    configFile,
    options,
    outDir,
    excludePatterns,
    mode: resolvedMode.mode,
    provenance,
  };
}

/** Announced only for the root authority the invocation does not state:
 *  `--root` and a config-file `root` are the user's own words. */
export function inferredRootNotice(
  config: ResolvedCliConfig,
  cwd: string
): string | null {
  if (config.rootSource !== 'config-dir' || config.root === cwd) return null;
  return (
    `root ${config.root} was inferred from the directory of ${config.configFile} ` +
    `— every relative path resolves against it, not against ${cwd}. ` +
    `Pass --root to choose the root yourself.`
  );
}

export function projectResolvedConfig(config: ResolvedCliConfig) {
  return {
    driver: config.driver,
    root: config.root,
    configFile: config.configFile,
    outDir: config.outDir,
    mode: config.mode,
    system: config.options.system,
    strict: config.options.strict ?? false,
    verbose: config.options.verbose ?? false,
    targets: config.options.targets ?? null,
    minify: config.options.minify ?? null,
    prefix: config.options.prefix ?? null,
    layers: config.options.layers ?? null,
    extensions: config.options.extensions ?? null,
    staticCss: config.options.staticCss ?? null,
    exclude: config.excludePatterns,
    provenance: config.provenance,
  };
}
