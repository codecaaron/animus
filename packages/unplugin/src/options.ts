/**
 * Host option intake — the transform host is the fourth driver over the
 * shared option core (openspec: standalone-extraction-cli, D2/D9): one
 * schema, `assertKnownOptionKeys` at the boundary, and an explicit
 * emission `mode` that is plumbed — never environment-sniffed (D10).
 *
 * Unlike the Vite/Next plugin drivers, this host HONORS the core `root`
 * key: rollup and esbuild expose no root authority a plugin could derive,
 * so the host's root is the explicit option, defaulting to the process
 * working directory (the CLI's shape, not the plugin drivers').
 */

import {
  AnimusConfigError,
  assertKnownOptionKeys,
  assertNoRetiredEngineSelection,
  resolveMode,
} from '@animus-ui/extract/pipeline';
import { resolve } from 'node:path';

import type {
  AnimusCoreOptions,
  AnimusMode,
} from '@animus-ui/extract/pipeline';

/**
 * Options for the Animus transform host. Exactly the shared driver core —
 * the host declares no driver-specific top-level keys.
 *
 * `mode` selects EMISSION only (minify default, the `__ANIMUS_DEV__`
 * define, engine devMode). When absent, the host's documented default
 * applies: the bundler's own command oracle where one exists (webpack and
 * rspack `compiler.options.mode`, rollup watch mode), else production
 * (esbuild exposes no signal).
 */
export type AnimusUnpluginOptions = AnimusCoreOptions;

type HostOptionRecord = Partial<AnimusUnpluginOptions>;

function isOptionString(value: HostOptionRecord['system']): value is string {
  if (Object(value) === value) return false;
  try {
    String.prototype.valueOf.call(value);
    return true;
  } catch {
    return false;
  }
}

function hasRequiredSystem(
  options: HostOptionRecord
): options is AnimusUnpluginOptions {
  return isOptionString(options.system) && options.system.length > 0;
}

export interface ResolvedHostOptions {
  /** Absolute root every relative input resolves against. */
  root: string;
  /** The validated core options (mode still unresolved — the adapter's
   *  command oracle participates in that resolution). */
  options: AnimusCoreOptions;
}

/**
 * Validate raw options and resolve the root authority. Throws
 * `AnimusConfigError` (the shared config-error class) on unknown keys,
 * invalid `mode` values, a retired engine selection, or a missing
 * `system`.
 */
export function resolveHostOptions(
  raw: AnimusUnpluginOptions | undefined,
  cwd: string = process.cwd()
): ResolvedHostOptions {
  const options: HostOptionRecord = raw ?? {};
  // v2 is the only engine (openspec: retire-extract-v1) — reject a stale v1
  // selection loudly before any engine work, matching the plugin drivers.
  assertNoRetiredEngineSelection(options.engine);
  assertKnownOptionKeys(options);
  if (!hasRequiredSystem(options)) {
    throw new AnimusConfigError(
      'Missing required option `system` — pass `system: "./src/ds.ts"` to ' +
        'the Animus plugin.'
    );
  }
  const root = options.root ? resolve(cwd, options.root) : cwd;
  return { root, options };
}

/**
 * Resolve the effective emission mode: the explicit option wins over every
 * bundler signal; otherwise the adapter-supplied command oracle applies;
 * otherwise production (the documented host default — never NODE_ENV).
 */
export function resolveHostMode(
  explicit: AnimusMode | undefined,
  oracle: AnimusMode | null
): AnimusMode {
  return resolveMode(explicit, () => oracle ?? 'production').mode;
}
