import { camelToKebab } from '../pipeline/utils';

/** Whether a build times its phases and prints their lines: when verbose,
 *  or when `ANIMUS_TIMING_JSON=1` (`timingJson`) asks for them alone, which
 *  turns on nothing else verbose does (slot provenance among it). */
export function timingRequested(
  verbose: boolean,
  timingJson: string | undefined
): boolean {
  return verbose || timingJson === '1';
}

/** The build's timing lines: the session's phases, with the engine's own
 *  (`engineTiming`) and the host's probe evidence, which runs after the
 *  engine's prepare, under `rust-extract`, which holds them, when `timed`
 *  (`timingRequested`); `log` prints whatever the verbosity. */
export function logBuildTimings(
  bt: Record<string, number>,
  rustTiming: Record<string, number> | undefined,
  log: (msg: string) => void,
  timed: boolean,
  engineTiming?: Record<string, number>
): void {
  if (!timed) return;
  const pad = (label: string, width: number): string =>
    label + ' '.repeat(Math.max(0, width - label.length));
  const jsPhases: [string, string][] = [
    ['systemLoad', 'system-load'],
    ['fileDiscovery', 'file-discovery'],
    ['fileRead', 'file-read+hash'],
    ['packageResolve', 'pkg-resolve'],
    ['taggedPackages', 'tagged-packages'],
    ['foreignPackages', 'foreign-packages'],
    ['analysis', 'analysis'],
  ];
  for (const [key, label] of jsPhases) {
    const ms = bt[key] ?? 0;
    if (ms === 0 && !Object.hasOwn(bt, key)) continue;
    log(`  ${pad(label, 17)}${String(ms).padStart(5)}ms`);

    if (key === 'analysis') {
      for (const [sk, sl] of [
        ['jsonSerialize', 'json-serialize'],
        ['rustExtract', 'rust-extract'],
        ['jsonParse', 'json-parse'],
      ] as const) {
        const sms = bt[sk] ?? 0;
        log(`    ${pad(sl, 15)}${String(sms).padStart(5)}ms`);
        if (sk !== 'rustExtract') continue;
        const phases = Object.entries(engineTiming ?? {});
        if (Object.hasOwn(bt, 'probeEvidence')) {
          // After the engine's prepare, which names the probes.
          const at = phases.findIndex(([phase]) => phase === 'prepareProbes');
          phases.splice(at + 1, 0, ['probeEvidence', bt.probeEvidence]);
        }
        for (const [phase, phaseMs] of phases) {
          log(
            `      ${pad(camelToKebab(phase), 17)}${String(Math.round(phaseMs)).padStart(5)}ms`
          );
        }
      }
    }
  }
  log(`  total             ${String(bt.total).padStart(5)}ms`);

  if (process.env.ANIMUS_TIMING_JSON === '1') {
    const merged: Record<string, number> = {};
    for (const [k, v] of Object.entries(bt)) {
      merged[`buildStart.${k}`] = v;
    }
    for (const [k, v] of Object.entries({ ...rustTiming, ...engineTiming })) {
      merged[`rust.${k}`] = v;
    }
    console.error(`[animus:timing] ${JSON.stringify(merged)}`);
  }
}
