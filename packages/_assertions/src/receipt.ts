import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import { AssertionError } from './assert-css';

/** Build host a consumer fixture lane verifies. */
export type LaneHost = 'next' | 'react-router' | 'svelte' | 'vinext' | 'vite';

/**
 * Version of a host as INSTALLED under `<root>/node_modules/<name>` — the one
 * reader for hosts whose export map hides their own `package.json` (so a lane
 * cannot `import 'host/package.json'`). A receipt records the version that
 * actually built the fixture, never the manifest's declared range.
 */
export function installedHostVersion(root: string, name: string): string {
  const path = resolve(root, 'node_modules', name, 'package.json');
  // SAFETY: an installed package manifest always carries a string `version`
  // (npm rejects publishing without one), and a missing/corrupt file throws in
  // readFileSync/JSON.parse above rather than reaching this assertion.
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
 * Everything a lane knows about ITSELF. The engine-identity triple
 * (`engineLoaded` / `engineDefault` / `engineOverride`) is deliberately absent:
 * a lane may not spell it. See `writeLaneReceipt`.
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
  /**
   * How that config is named in the failure message (e.g. `next.config.ts`,
   * `packages/showcase/vite.config.ts`). Defaults to the path's basename.
   */
  engineConfigLabel?: string;
}

/**
 * Retirement regression guard (openspec: retire-extract-v1): v2 is the only
 * engine, so a consumer config MUST NOT reference `ANIMUS_ENGINE` or set the
 * `engine` option — either would reintroduce a retired v1 selection path.
 */
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
 * Write one lane receipt, filling the engine-identity triple HERE and nowhere
 * else.
 *
 * The contract (openspec: dual-engine-build § "Engine identity in verification
 * receipts"): engine identity is asserted from the single-engine invariant
 * plus a config-absence guard; it is NEVER inferred from plugin source
 * (guardrail G3). Because the guard and the constants are one indivisible
 * step, no lane can record `v2` without having proved its own config selects
 * no engine — which is exactly what the four hand-copied lane blocks this
 * replaces could not enforce.
 *
 * Returns the receipt as written so a lane can log what it recorded without
 * re-spelling the values.
 */
export function writeLaneReceipt(
  path: string,
  claim: LaneReceiptClaim
): LaneReceipt {
  assertNoEngineSelection(
    claim.engineConfigPath,
    claim.engineConfigLabel ?? basename(claim.engineConfigPath)
  );

  // v1 is retired (openspec: retire-extract-v1): v2 is the only engine, so the
  // receipt records v2 as both default and loaded, with no override.
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
