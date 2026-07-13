/**
 * Parity harness CLI.
 *
 *   bun run src/cli.ts                          # compare (default v1 vs v1 identity)
 *   bun run src/cli.ts --engines v1,v2          # differential mode
 *   bun run src/cli.ts --self-check             # one engine twice, byte-diff
 *   bun run src/cli.ts --dev                    # devMode=true corpus pass
 *   bun run src/cli.ts --parse-count            # include parse budget check
 *   bun run src/cli.ts --threads 1,8            # v2 thread variation (self-check)
 *
 * Exit codes: 0 = green (all divergences registered, family verdicts hold,
 * CSS valid); 1 = gate failure; 2 = engine run failure.
 *
 * Every engine×devMode pass runs in a FRESH child process (engine-run.ts) —
 * cross-process determinism is part of the measured surface.
 */
import { spawnSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';

import { compareUnit } from './compare';
import { loadFamilies } from './corpus';
import { loadRegister, matchRegister } from './register';
import { familyViolations, renderScoreboard } from './scoreboard';

import type { Divergence, UnitSurface } from './types';

const HERE = join(import.meta.dirname, '..');

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));

function runEngine(
  engine: string,
  devMode: boolean,
  env: Record<string, string> = {}
): Record<string, UnitSurface> {
  const args = [join(HERE, 'src/engine-run.ts'), '--engine', engine];
  if (devMode) args.push('--dev');
  const res = spawnSync('bun', ['run', ...args], {
    cwd: HERE,
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  if (res.status !== 0) {
    throw new Error(
      `engine ${engine} run failed (devMode=${devMode}):\n${res.stderr}`
    );
  }
  return JSON.parse(res.stdout);
}

async function comparePass(
  engines: [string, string],
  devMode: boolean,
  opts: { selfCheck: boolean; parseCount: boolean; threads?: string[] }
): Promise<{ scoreboard: string; failed: boolean }> {
  // --threads a,b (self-check): pin each run's rayon pool size so the
  // thread-count determinism leg (G8 / NS6) is actually exercised.
  const [ta, tb] = opts.threads?.length === 2 ? opts.threads : [null, null];
  const a = runEngine(engines[0], devMode, ta ? { RAYON_NUM_THREADS: ta } : {});
  const b = runEngine(engines[1], devMode, tb ? { RAYON_NUM_THREADS: tb } : {});

  const unitIds = Object.keys(a).sort();
  let divergences: Divergence[] = [];

  if (opts.selfCheck) {
    // Byte-level comparison of the whole canonical surface, per unit.
    for (const u of unitIds) {
      if (JSON.stringify(a[u]) !== JSON.stringify(b[u])) {
        divergences.push({
          unit: u,
          artifact: 'observables',
          detail: 'self-check: fresh-process surfaces not byte-identical',
        });
      }
    }
  } else {
    for (const u of unitIds) {
      if (!b[u]) {
        divergences.push({
          unit: u,
          artifact: 'observables',
          detail: 'unit missing in engine b',
        });
        continue;
      }
      divergences.push(...(await compareUnit(u, a[u], b[u])));
    }
  }

  const notes: string[] = [];
  if (opts.parseCount) {
    const nonReporting = new Set<string>();
    for (const u of unitIds) {
      for (const [tag, s] of [
        [engines[0], a[u]],
        [engines[1], b[u]],
      ] as const) {
        if (s?.parseCount == null) {
          nonReporting.add(tag);
        } else if (tag === 'v2' && s.parseCount > Object.keys(s.code).length) {
          divergences.push({
            unit: u,
            artifact: 'observables',
            detail: `v2 parse budget exceeded: ${s.parseCount} parses for ${Object.keys(s.code).length} files`,
          });
        }
      }
    }
    for (const tag of [...nonReporting].sort()) {
      notes.push(
        `engine ${tag} does not report parse counts — budget check informational only (v1 counter: registry row 10)`
      );
    }
  }

  const register = loadRegister();
  divergences = matchRegister(divergences, register);

  const families = loadFamilies(new Set(unitIds));
  const famErrors = opts.selfCheck
    ? []
    : familyViolations(families, divergences);

  let scoreboard = renderScoreboard({
    mode: opts.selfCheck ? 'self-check' : 'compare',
    engines,
    devMode,
    unitIds,
    divergences,
    families,
    familyVerdictErrors: famErrors,
  });
  if (notes.length) {
    scoreboard += `Notes:\n${notes.map((n) => `  ${n}`).join('\n')}\n`;
  }

  const unregistered = divergences.filter((d) => !d.registered);
  const failed = unregistered.length > 0 || famErrors.length > 0;
  return { scoreboard, failed };
}

async function main() {
  const engines = (arg('--engines') ?? 'v1,v1').split(',') as [string, string];
  const selfCheck = flags.has('--self-check');
  const parseCount = flags.has('--parse-count');
  const threads = (arg('--threads') ?? '').split(',').filter(Boolean);
  const modes = flags.has('--dev')
    ? [true]
    : flags.has('--both')
      ? [false, true]
      : [false];

  if (selfCheck) engines[1] = engines[0];
  if (threads.length === 2 && !selfCheck) {
    throw new Error(
      '--threads a,b is a self-check leg (two runs of one engine at different thread counts)'
    );
  }

  let failed = false;
  const boards: string[] = [];
  for (const devMode of modes) {
    const res = await comparePass(engines, devMode, {
      selfCheck,
      parseCount,
      threads,
    });
    boards.push(res.scoreboard);
    failed = failed || res.failed;
  }

  const full = boards.join('\n---\n\n');
  const snapName = selfCheck ? 'self-check.snap' : 'scoreboard.snap';
  if (failed) {
    // Baseline snapshots are recorded ONLY from green runs (the spec's
    // "self-check gates baselines" made mechanical, and symmetrically for
    // compare): a red run must never overwrite the committed baseline.
    writeFileSync(join(HERE, 'last-failure.txt'), full);
    console.log(full);
    console.log(
      `PARITY GATE: FAIL (baseline ${snapName} NOT updated; details in last-failure.txt)`
    );
    process.exit(1);
  }
  writeFileSync(join(HERE, snapName), full);
  console.log(full);
  console.log('PARITY GATE: PASS');
  process.exit(0);
}

main().catch((e) => {
  console.error(String(e?.stack ?? e));
  process.exit(2);
});
