import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import { AssertionError } from './assert-css';

export type LaneHost = 'next' | 'react-router' | 'svelte' | 'vinext' | 'vite';

/**
 * Version of a host as INSTALLED, read from disk because an export map can hide
 * a package's own `package.json` from `import`.
 */
export function installedHostVersion(root: string, name: string): string {
  const path = resolve(root, 'node_modules', name, 'package.json');
  // SAFETY: an installed package manifest always carries a string `version`,
  // and a missing or corrupt file throws in readFileSync/JSON.parse first.
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
    version: string;
  };
  return manifest.version;
}

export interface LaneReceipt {
  lane: string;
  host: LaneHost;
  hostVersion: string;
  mode: 'production' | 'dev';
  engineLoaded: 'v2';
  engineDefault: 'v2';
  engineOverride: boolean;
  packageForm: 'workspace' | 'packed';
}

/**
 * Everything a lane knows about itself. The engine-identity triple is absent by
 * design: only `writeLaneReceipt` may spell it.
 */
export interface LaneReceiptClaim {
  lane: string;
  host: LaneHost;
  hostVersion: string;
  mode: 'production' | 'dev';
  packageForm: 'workspace' | 'packed';
  /**
   * Absolute path of the consumer config whose source must select no engine.
   * Required — the guard is the only thing that discharges engine identity.
   */
  engineConfigPath: string;
  engineConfigLabel?: string;
}

function assertNoEngineSelection(path: string, label: string): void {
  const config = readFileSync(path, 'utf8');
  if (config.includes('ANIMUS_ENGINE') || /\bengine\s*:/.test(config)) {
    throw new AssertionError(
      `${label} must not reference ANIMUS_ENGINE or set the engine ` +
        'option — the v1 engine was retired (openspec: retire-extract-v1)',
      { configPath: path }
    );
  }
}

/**
 * Writes one lane receipt, filling the engine-identity triple here and nowhere
 * else: no lane records an engine without proving its config selects none.
 */
export function writeLaneReceipt(
  path: string,
  claim: LaneReceiptClaim
): LaneReceipt {
  assertNoEngineSelection(
    claim.engineConfigPath,
    claim.engineConfigLabel ?? basename(claim.engineConfigPath)
  );

  const receipt: LaneReceipt = {
    lane: claim.lane,
    host: claim.host,
    hostVersion: claim.hostVersion,
    mode: claim.mode,
    engineLoaded: 'v2',
    engineDefault: 'v2',
    engineOverride: false,
    packageForm: claim.packageForm,
  };

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}
