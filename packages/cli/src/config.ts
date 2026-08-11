/**
 * CLI config resolution — the third driver over the shared option core
 * (shared-driver-config): documented precedence flags > config file >
 * defaults, one root authority, explicit emission mode (the CLI never
 * sniffs NODE_ENV), and a fully inspectable resolved projection for
 * `--print-config`.
 */

import {
  AnimusConfigError,
  assertKnownOptionKeys,
  createExcludeMatcher,
  resolveMode,
} from '@animus-ui/extract/pipeline';
import { existsSync, readFileSync } from 'fs';
import { dirname, isAbsolute, resolve } from 'path';
import { pathToFileURL } from 'url';

import type {
  AnimusCoreOptions,
  AnimusMode,
  OptionProvenance,
} from '@animus-ui/extract/pipeline';

/** Config filenames probed in order under the config-search root. */
export const CONFIG_FILENAMES = [
  'animus.config.json',
  'animus.config.mjs',
  'animus.config.js',
  'animus.config.ts',
] as const;

/** The `cli:` driver namespace of the shared config schema. */
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

export interface ResolvedCliConfig {
  driver: 'cli';
  /** Absolute root every relative input resolves against. */
  root: string;
  /** Absolute path of the config file consulted, or null. */
  configFile: string | null;
  /** The effective core options handed to the session. */
  options: AnimusCoreOptions;
  /** Absolute artifact output directory. */
  outDir: string;
  /** Effective merged exclusion pattern list (defaults ∪ user). */
  excludePatterns: readonly string[];
  mode: AnimusMode;
  provenance: Record<string, OptionProvenance>;
}

async function loadConfigFile(path: string): Promise<Record<string, unknown>> {
  if (path.endsWith('.json')) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    } catch (error) {
      throw new AnimusConfigError(`Failed to parse ${path}: ${String(error)}`);
    }
  }
  try {
    const mod = (await import(pathToFileURL(path).href)) as {
      default?: unknown;
    };
    const value = mod.default ?? mod;
    if (typeof value !== 'object' || value === null) {
      throw new AnimusConfigError(
        `${path} must default-export a config object`
      );
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AnimusConfigError) throw error;
    const code = (error as { code?: string }).code;
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

/**
 * Resolve the effective CLI configuration. Precedence: flags > config file
 * > documented defaults. Scalar flags override; `--exclude` values merge
 * (exclusion semantics are merge-only by contract).
 */
export async function resolveCliConfig(
  flags: CliFlags,
  cwd: string
): Promise<ResolvedCliConfig> {
  // Root authority, stated ONCE: --root wins; else the config file's
  // `root` (resolved against the file's directory); else the config
  // file's directory; else cwd. A --config path is honored from anywhere.
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

  const raw = configFile ? await loadConfigFile(configFile) : {};
  // The CLI honors every core key including `root`.
  assertKnownOptionKeys(raw);
  const fileRoot = raw['root'];
  const configDir = configFile ? dirname(configFile) : cwd;
  const effectiveRoot =
    flagRoot ??
    (typeof fileRoot === 'string'
      ? resolve(configDir, fileRoot)
      : configFile
        ? configDir
        : cwd);

  const provenance: Record<string, OptionProvenance> = {};
  const pick = <K extends keyof AnimusCoreOptions>(
    key: K,
    flagValue: AnimusCoreOptions[K] | undefined
  ): AnimusCoreOptions[K] | undefined => {
    if (flagValue !== undefined) {
      provenance[key as string] = 'explicit';
      return flagValue;
    }
    const fileValue = raw[key as string] as AnimusCoreOptions[K] | undefined;
    if (fileValue !== undefined) {
      provenance[key as string] = 'explicit';
      return fileValue;
    }
    provenance[key as string] = 'default';
    return undefined;
  };

  const system = pick('system', flags.system);
  if (typeof system !== 'string' || system.length === 0) {
    throw new AnimusConfigError(
      'Missing required option `system` — pass --system ./src/ds.ts or set ' +
        '"system" in animus.config.'
    );
  }

  const fileExclude = Array.isArray(raw['exclude'])
    ? (raw['exclude'] as string[])
    : [];
  const exclude = [...fileExclude, ...(flags.exclude ?? [])];
  if (exclude.length > 0) provenance['exclude'] = 'explicit';
  else provenance['exclude'] = 'default';

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
    (flags.mode as AnimusMode | undefined) ??
      (raw['mode'] as AnimusMode | undefined),
    // The CLI's documented default: production emission. Never NODE_ENV.
    () => 'production'
  );
  provenance['mode'] = resolvedMode.provenance;

  const cliNamespace = (raw['cli'] ?? {}) as CliNamespaceOptions;
  const outDirSetting = flags.outDir ?? cliNamespace.outDir ?? '.animus';
  const outDir = isAbsolute(outDirSetting)
    ? outDirSetting
    : resolve(effectiveRoot, outDirSetting);
  provenance['outDir'] =
    flags.outDir !== undefined || cliNamespace.outDir !== undefined
      ? 'explicit'
      : 'driver-default';

  const options: AnimusCoreOptions = {
    system,
    exclude: exclude.length > 0 ? exclude : undefined,
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
    configFile,
    options,
    outDir,
    excludePatterns,
    mode: resolvedMode.mode,
    provenance,
  };
}

/** The `--print-config` projection: everything effective, nothing hidden. */
export function projectResolvedConfig(
  config: ResolvedCliConfig
): Record<string, unknown> {
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
    exclude: config.excludePatterns,
    provenance: config.provenance,
  };
}
