/**
 * Parity harness CLI after oracle inversion.
 *
 *   bun run src/cli.ts --both                  # committed baseline vs v2
 *   bun run src/cli.ts --self-check --both     # fresh v2 process identity
 *   bun run src/cli.ts --self-check --threads 1,8
 *   bun run src/cli.ts --refresh-baseline ID   # privileged, journaled write
 *
 * Ordinary and red runs never write packages/_parity/baselines/**.
 */
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import {
  assertRefreshIntent,
  assertRefreshPairEligible,
  baselineGateFailed,
  compareUnitSets,
  corpusSha256,
  createBaselineEnvelope,
  refreshFamilyErrors,
  validateBaselineEnvelope,
  writeValidatedBaselinePair,
} from './baseline';
import { baselineStaleFailureMessage } from './cli-messages';
import { compareUnit } from './compare';
import { hashArtifact } from './content-hash';
import { enumerateUnits, loadFamilies } from './corpus';
import { loadRegister, matchRegister, validateRegister } from './register';
import { familyViolations, renderScoreboard } from './scoreboard';

import type {
  BaselineEnvelope,
  BaselineMode,
  BaselineRefreshChecks,
} from './baseline';
import type { Divergence, UnitSurface } from './types';

const HERE = join(import.meta.dirname, '..');
const BASELINES_ROOT = join(HERE, 'baselines');
const REFRESH_JOURNAL = join(HERE, 'baseline-intents.md');
const BOOLEAN_OPTIONS = new Set(['--both', '--dev', '--self-check']);
const VALUE_OPTIONS = new Set(['--refresh-baseline', '--threads']);

function validateArgs(): void {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const option = args[i]!;
    if (VALUE_OPTIONS.has(option)) {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${option} requires a value`);
      }
      i++;
    } else if (!BOOLEAN_OPTIONS.has(option)) {
      throw new Error(
        option.startsWith('--')
          ? `unknown option: ${option}`
          : `unexpected argument: ${option}`
      );
    }
  }
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));

function runV2(
  devMode: boolean,
  env: Record<string, string> = {}
): Record<string, UnitSurface> {
  const args = [join(HERE, 'src/engine-run.ts'), '--engine', 'v2'];
  if (devMode) args.push('--dev');
  const result = spawnSync('bun', ['run', ...args], {
    cwd: HERE,
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error(
      `engine v2 run failed (devMode=${devMode}):\n${result.stderr}`
    );
  }
  return JSON.parse(result.stdout);
}

function modeOf(devMode: boolean): BaselineMode {
  return devMode ? 'development' : 'production';
}

function baselinePath(mode: BaselineMode): string {
  return join(BASELINES_ROOT, 'v2', `${mode}.json`);
}

function loadBaseline(mode: BaselineMode): BaselineEnvelope {
  const path = baselinePath(mode);
  if (!existsSync(path)) {
    throw new Error(
      `committed v2 baseline missing: ${path} — run: scripts/verify/refresh-parity-baseline.sh <checked-intent-id>`
    );
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function selfCheckDivergences(
  baseline: Record<string, UnitSurface>,
  candidate: Record<string, UnitSurface>
): Divergence[] {
  const ids = [
    ...new Set([...Object.keys(baseline), ...Object.keys(candidate)]),
  ].sort();
  const divergences: Divergence[] = [];
  for (const unit of ids) {
    const before = baseline[unit];
    const after = candidate[unit];
    if (!before || !after || JSON.stringify(before) !== JSON.stringify(after)) {
      divergences.push({
        unit,
        artifact: 'observables',
        detail: 'self-check: fresh-process surfaces not byte-identical',
        baselineSha256: hashArtifact(before, 'observables'),
        candidateSha256: hashArtifact(after, 'observables'),
      });
    }
  }
  return divergences;
}

function parseBudgetDivergences(
  units: Record<string, UnitSurface>
): Divergence[] {
  const divergences: Divergence[] = [];
  for (const [unit, surface] of Object.entries(units)) {
    const fileCount = Object.keys(surface.code).length;
    if (surface.parseCount == null || surface.parseCount > fileCount) {
      const hash = hashArtifact(surface, 'observables');
      divergences.push({
        unit,
        artifact: 'observables',
        detail:
          surface.parseCount == null
            ? 'v2 parse budget missing'
            : `v2 parse budget exceeded: ${surface.parseCount} parses for ${fileCount} files`,
        baselineSha256: hash,
        candidateSha256: hash,
      });
    }
  }
  return divergences;
}

async function cssValidityDivergences(
  units: Record<string, UnitSurface>
): Promise<Divergence[]> {
  const divergences: Divergence[] = [];
  for (const [unit, surface] of Object.entries(units)) {
    divergences.push(
      ...(await compareUnit(unit, surface, surface)).filter(
        (d) => d.artifact === 'css-validity'
      )
    );
  }
  return divergences;
}

async function selfCheckPass(
  devMode: boolean,
  threads: string[]
): Promise<{ scoreboard: string; failed: boolean }> {
  const [ta, tb] = threads.length === 2 ? threads : [null, null];
  const baseline = runV2(devMode, ta ? { RAYON_NUM_THREADS: ta } : {});
  const candidate = runV2(devMode, tb ? { RAYON_NUM_THREADS: tb } : {});
  const divergences = selfCheckDivergences(baseline, candidate);
  const unitIds = [
    ...new Set([...Object.keys(baseline), ...Object.keys(candidate)]),
  ].sort();
  const families = loadFamilies(new Set(unitIds));
  return {
    scoreboard: renderScoreboard({
      mode: 'self-check',
      engines: ['v2', 'v2'],
      devMode,
      unitIds,
      divergences,
      families,
      familyVerdictErrors: [],
    }),
    failed: divergences.length > 0,
  };
}

async function baselinePass(
  devMode: boolean,
  corpusDigest: string
): Promise<{ scoreboard: string; failed: boolean }> {
  const mode = modeOf(devMode);
  const baseline = loadBaseline(mode);
  const candidate = runV2(devMode);
  const envelopeErrors = validateBaselineEnvelope(baseline, {
    mode,
    corpusSha256: corpusDigest,
  });
  let divergences = await compareUnitSets(baseline.units, candidate);
  divergences.push(...parseBudgetDivergences(candidate));
  const register = loadRegister();
  const registerErrors = validateRegister(register, divergences);
  divergences = matchRegister(divergences, register);
  const unitIds = [
    ...new Set([...Object.keys(baseline.units), ...Object.keys(candidate)]),
  ].sort();
  const families = loadFamilies(new Set(unitIds));
  const familyErrors = familyViolations(families, divergences);
  let scoreboard = renderScoreboard({
    mode: 'baseline',
    engines: ['baseline:v2', 'v2'],
    devMode,
    unitIds,
    divergences,
    families,
    familyVerdictErrors: familyErrors,
  });
  const metadataErrors = [...envelopeErrors, ...registerErrors];
  if (metadataErrors.length) {
    scoreboard += `Baseline metadata errors:\n${metadataErrors
      .map((error) => `  ${error}`)
      .join('\n')}\n`;
  }
  return {
    scoreboard,
    failed:
      metadataErrors.length > 0 ||
      baselineGateFailed(divergences, familyErrors),
  };
}

async function refreshBaselines(intent: string): Promise<void> {
  if (!existsSync(REFRESH_JOURNAL)) {
    throw new Error(`baseline refresh journal missing: ${REFRESH_JOURNAL}`);
  }
  assertRefreshIntent(intent, readFileSync(REFRESH_JOURNAL, 'utf8'));
  const corpus = await enumerateUnits();
  const digest = corpusSha256(corpus);
  const register = loadRegister();
  const created = new Map<BaselineMode, BaselineEnvelope>();
  const checks = {} as Record<BaselineMode, BaselineRefreshChecks>;
  const drift = {
    production: [],
    development: [],
  } as Record<BaselineMode, Divergence[]>;
  const existingPaths = (['production', 'development'] as const).map((mode) =>
    existsSync(baselinePath(mode))
  );
  if (existingPaths[0] !== existingPaths[1]) {
    throw new Error('baseline refresh refuses a partial existing mode pair');
  }

  for (const devMode of [false, true]) {
    const mode = modeOf(devMode);
    const first = runV2(devMode, { RAYON_NUM_THREADS: '1' });
    const second = runV2(devMode, { RAYON_NUM_THREADS: '8' });
    const determinism = selfCheckDivergences(first, second);
    const validity = await cssValidityDivergences(first);
    const budget = parseBudgetDivergences(first);
    checks[mode] = {
      determinism,
      cssValidity: validity,
      parseBudget: budget,
      families: [],
    };

    if (existingPaths[0]) {
      const existing = loadBaseline(mode);
      const existingErrors = validateBaselineEnvelope(existing, {
        mode,
        corpusSha256: existing.corpusSha256,
      });
      if (existingErrors.length) {
        throw new Error(
          `baseline refresh refuses an invalid existing envelope (${mode}): ${existingErrors.join('; ')}`
        );
      }
      drift[mode] = await compareUnitSets(existing.units, first);
    }
    created.set(mode, createBaselineEnvelope(mode, intent, digest, first));
  }

  assertRefreshPairEligible(drift, register);
  for (const mode of ['production', 'development'] as const) {
    const unitIds = Object.keys(created.get(mode)!.units);
    const families = loadFamilies(new Set(unitIds));
    checks[mode].families = refreshFamilyErrors(
      families,
      drift[mode],
      register
    );
  }
  writeValidatedBaselinePair(
    BASELINES_ROOT,
    created.get('production')!,
    created.get('development')!,
    checks
  );
  console.log(`BASELINE REFRESH: PASS (${intent})`);
}

async function main() {
  validateArgs();
  const refreshIntent = arg('--refresh-baseline');
  if (refreshIntent) {
    await refreshBaselines(refreshIntent);
    return;
  }

  const selfCheck = flags.has('--self-check');
  const threads = (arg('--threads') ?? '').split(',').filter(Boolean);
  if (threads.length && threads.length !== 2) {
    throw new Error('--threads requires exactly two comma-separated values');
  }
  if (threads.length === 2 && !selfCheck) {
    throw new Error('--threads is available only with --self-check');
  }
  const modes = flags.has('--dev')
    ? [true]
    : flags.has('--both')
      ? [false, true]
      : [false];
  const corpusDigest = selfCheck ? '' : corpusSha256(await enumerateUnits());

  let failed = false;
  const boards: string[] = [];
  for (const devMode of modes) {
    const result = selfCheck
      ? await selfCheckPass(devMode, threads)
      : await baselinePass(devMode, corpusDigest);
    boards.push(result.scoreboard);
    failed = failed || result.failed;
  }

  const full = boards.join('\n---\n\n');
  const snapName = selfCheck ? 'self-check.snap' : 'scoreboard.snap';
  if (failed) {
    writeFileSync(join(HERE, 'last-failure.txt'), full);
    console.log(full);
    console.log(
      selfCheck
        ? `PARITY GATE: FAIL (${snapName} NOT updated; details in last-failure.txt)`
        : baselineStaleFailureMessage()
    );
    process.exit(1);
  }
  writeFileSync(join(HERE, snapName), full);
  console.log(full);
  console.log('PARITY GATE: PASS');
}

main().catch((error) => {
  console.error(String(error?.stack ?? error));
  process.exit(2);
});
