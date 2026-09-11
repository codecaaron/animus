/** rollup and esbuild expose no root authority a plugin could derive, so
 *  `root` is the explicit option, defaulting to the working directory. */

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
  root: string;
  options: AnimusCoreOptions;
}

export function resolveHostOptions(
  raw: AnimusUnpluginOptions | undefined,
  cwd: string = process.cwd()
): ResolvedHostOptions {
  const options: HostOptionRecord = raw ?? {};
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

export function resolveHostMode(
  explicit: AnimusMode | undefined,
  oracle: AnimusMode | null
): AnimusMode {
  return resolveMode(explicit, () => oracle ?? 'production').mode;
}
