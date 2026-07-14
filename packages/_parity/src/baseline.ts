import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import { compareUnit } from './compare';
import {
  canonicalPrettyJson,
  hashArtifact,
  sha256,
  sha256Json,
} from './content-hash';
import { matchRegister, validateRegister } from './register';
import { familyViolations } from './scoreboard';

import type {
  CorpusUnit,
  Divergence,
  FamilyDecl,
  RegisterEntry,
  UnitSurface,
} from './types';

export const BASELINE_VERSION = 1 as const;
export const SURFACE_SCHEMA_SHA256 = sha256(
  [
    'UnitSurface/v1',
    'css',
    'code',
    'hasComponents',
    'diagnostics',
    'observables.componentFragmentKeys',
    'observables.reverseProvenanceEdges',
    'observables.systemPropMapJson',
    'observables.dynamicPropsJson',
    'observables.sheetsJson',
    'observables.componentFragmentsJson',
    'parseCount',
  ].join('\n')
);

export type BaselineMode = 'production' | 'development';

export interface BaselineEnvelope {
  version: typeof BASELINE_VERSION;
  engine: 'v2';
  mode: BaselineMode;
  surfaceSchemaSha256: string;
  corpusSha256: string;
  refreshIntent: string;
  units: Record<string, UnitSurface>;
}

export interface BaselineRefreshChecks {
  determinism: Divergence[];
  cssValidity: Divergence[];
  parseBudget: Divergence[];
  families: string[];
}

export function corpusSha256(units: CorpusUnit[]): string {
  return sha256Json(
    units.map((unit) => ({
      id: unit.id,
      configSource: unit.configSource,
      files: unit.files.map((file) => ({
        path: file.path,
        source: file.source,
      })),
    }))
  );
}

export function createBaselineEnvelope(
  mode: BaselineMode,
  refreshIntent: string,
  corpusDigest: string,
  units: Record<string, UnitSurface>
): BaselineEnvelope {
  return {
    version: BASELINE_VERSION,
    engine: 'v2',
    mode,
    surfaceSchemaSha256: SURFACE_SCHEMA_SHA256,
    corpusSha256: corpusDigest,
    refreshIntent,
    units,
  };
}

export function validateBaselineEnvelope(
  envelope: BaselineEnvelope,
  expected: { mode: BaselineMode; corpusSha256: string }
): string[] {
  const errors: string[] = [];
  const sha = /^[a-f0-9]{64}$/;
  if (envelope.version !== BASELINE_VERSION) {
    errors.push(
      `baseline version differs (${envelope.version} vs ${BASELINE_VERSION})`
    );
  }
  if (envelope.engine !== 'v2') errors.push('baseline engine must be v2');
  if (envelope.mode !== expected.mode) {
    errors.push(`baseline mode differs (${envelope.mode} vs ${expected.mode})`);
  }
  if (envelope.surfaceSchemaSha256 !== SURFACE_SCHEMA_SHA256) {
    errors.push('baseline surface schema digest differs');
  }
  if (envelope.corpusSha256 !== expected.corpusSha256) {
    errors.push('baseline corpus digest differs');
  }
  if (!sha.test(envelope.corpusSha256)) {
    errors.push('baseline corpus digest must be SHA-256');
  }
  if (
    typeof envelope.refreshIntent !== 'string' ||
    !envelope.refreshIntent.trim()
  ) {
    errors.push('baseline refresh intent missing');
  }
  if (
    !envelope.units ||
    typeof envelope.units !== 'object' ||
    Array.isArray(envelope.units)
  ) {
    errors.push('baseline units missing');
  }
  return errors;
}

export async function compareUnitSets(
  baseline: Record<string, UnitSurface>,
  candidate: Record<string, UnitSurface>
): Promise<Divergence[]> {
  const ids = [
    ...new Set([...Object.keys(baseline), ...Object.keys(candidate)]),
  ].sort();
  const divergences: Divergence[] = [];
  for (const unit of ids) {
    const before = baseline[unit];
    const after = candidate[unit];
    if (!before || !after) {
      for (const artifact of [
        'css',
        'code',
        'observables',
        'diagnostics',
      ] as const) {
        divergences.push({
          unit,
          artifact,
          detail: before
            ? 'unit missing from candidate'
            : 'unit missing from baseline',
          baselineSha256: hashArtifact(before, artifact),
          candidateSha256: hashArtifact(after, artifact),
        });
      }
      continue;
    }
    divergences.push(...(await compareUnit(unit, before, after)));
  }
  return divergences;
}

export function baselineGateFailed(
  divergences: Divergence[],
  familyErrors: string[]
): boolean {
  return divergences.length > 0 || familyErrors.length > 0;
}

export function assertRefreshEligible(
  divergences: Divergence[],
  register: RegisterEntry[]
): void {
  const classified = matchRegister(divergences, register);
  const registerErrors = validateRegister(register, divergences);
  if (registerErrors.length) {
    throw new Error(
      `baseline refresh register invalid: ${registerErrors.join('; ')}`
    );
  }
  const unregistered = classified.filter((d) => !d.registered);
  if (unregistered.length) {
    const detail = unregistered
      .map(
        (d) =>
          `${d.unit} · ${d.artifact} (${d.baselineSha256} -> ${d.candidateSha256})`
      )
      .join(', ');
    throw new Error(`baseline refresh has unregistered drift: ${detail}`);
  }
}

export function assertRefreshPairEligible(
  divergences: Record<BaselineMode, Divergence[]>,
  register: RegisterEntry[]
): void {
  assertRefreshEligible(
    [...divergences.production, ...divergences.development],
    register
  );
}

export function refreshFamilyErrors(
  families: FamilyDecl[],
  divergences: Divergence[],
  register: RegisterEntry[]
): string[] {
  return familyViolations(families, matchRegister(divergences, register));
}

/**
 * Family verdicts guard the atomic production/development refresh pair.
 * A registered transition may be mode-specific, so evaluate its exact drift
 * across the pair instead of requiring the same family to diverge per mode.
 */
export function refreshPairFamilyErrors(
  families: FamilyDecl[],
  divergences: Record<BaselineMode, Divergence[]>,
  register: RegisterEntry[]
): string[] {
  return refreshFamilyErrors(
    families,
    [...divergences.production, ...divergences.development],
    register
  );
}

export function assertRefreshIntent(intent: string, journal: string): void {
  const escaped = intent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const checked = new RegExp('^- \\[x\\] `' + escaped + '`(?:\\s|$)', 'm');
  if (!checked.test(journal)) {
    throw new Error(
      `baseline refresh requires a checked journal intent: ${intent}`
    );
  }
}

export function writeBaselinePairAtomic(
  baselinesRoot: string,
  production: BaselineEnvelope,
  development: BaselineEnvelope
): void {
  mkdirSync(baselinesRoot, { recursive: true });
  const live = join(baselinesRoot, 'v2');
  const nonce = `${process.pid}-${Date.now()}`;
  const next = join(baselinesRoot, `.v2-next-${nonce}`);
  const previous = join(baselinesRoot, `.v2-previous-${nonce}`);
  mkdirSync(next);
  writeFileSync(join(next, 'production.json'), canonicalPrettyJson(production));
  writeFileSync(
    join(next, 'development.json'),
    canonicalPrettyJson(development)
  );

  let movedPrevious = false;
  try {
    if (existsSync(live)) {
      renameSync(live, previous);
      movedPrevious = true;
    }
    renameSync(next, live);
  } catch (error) {
    if (!existsSync(live) && movedPrevious && existsSync(previous)) {
      renameSync(previous, live);
    }
    rmSync(next, { recursive: true, force: true });
    throw error;
  }
  if (movedPrevious) {
    try {
      rmSync(previous, { recursive: true, force: true });
    } catch (error) {
      console.warn(
        `baseline refresh committed; previous-directory cleanup failed (${previous}): ${String(error)}`
      );
    }
  }
}

export function writeValidatedBaselinePair(
  baselinesRoot: string,
  production: BaselineEnvelope,
  development: BaselineEnvelope,
  checks: Record<BaselineMode, BaselineRefreshChecks>
): void {
  const envelopes = [
    ['production', production],
    ['development', development],
  ] as const;
  const envelopeErrors = envelopes.flatMap(([mode, envelope]) =>
    validateBaselineEnvelope(envelope, {
      mode,
      corpusSha256: envelope.corpusSha256,
    }).map((error) => `${mode}: ${error}`)
  );
  if (
    production.corpusSha256 !== development.corpusSha256 ||
    production.refreshIntent !== development.refreshIntent
  ) {
    envelopeErrors.push(
      'production/development envelope corpus and refresh intent must match'
    );
  }
  if (envelopeErrors.length) {
    throw new Error(
      `baseline refresh envelope invalid: ${envelopeErrors.join('; ')}`
    );
  }
  for (const mode of ['production', 'development'] as const) {
    const result = checks[mode];
    const failures =
      result.determinism.length +
      result.cssValidity.length +
      result.parseBudget.length +
      result.families.length;
    if (failures) {
      throw new Error(
        `baseline refresh candidate is not green (${mode}): determinism=${result.determinism.length}, css=${result.cssValidity.length}, budget=${result.parseBudget.length}, families=${result.families.length}`
      );
    }
  }
  writeBaselinePairAtomic(baselinesRoot, production, development);
}
