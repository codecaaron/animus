import { formatRustTimingWaterfall } from '@animus-ui/extract/pipeline';

/**
 * Verbose build-timing waterfall: JS phases, analysis sub-phases, and the
 * shared Rust phase table. `ANIMUS_TIMING_JSON=1` additionally dumps a
 * machine-readable merged record.
 */
export function logBuildTimings(
  bt: Record<string, number>,
  rustTiming: Record<string, number> | undefined,
  log: (msg: string) => void,
  verbose: boolean
): void {
  if (!verbose) return;
  const pad = (label: string, width: number): string =>
    label + ' '.repeat(Math.max(0, width - label.length));
  const jsPhases: [string, string][] = [
    ['systemLoad', 'system-load'],
    ['fileDiscovery', 'file-discovery'],
    ['fileRead', 'file-read+hash'],
    ['packageResolve', 'pkg-resolve'],
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

        if (sk === 'rustExtract' && rustTiming) {
          for (const line of formatRustTimingWaterfall(rustTiming, {
            indent: '      ',
            labelWidth: 13,
          })) {
            log(line);
          }
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
    if (rustTiming) {
      for (const [k, v] of Object.entries(rustTiming)) {
        if (typeof v === 'number') merged[`rust.${k}`] = v;
      }
    }
    console.info(`[animus:timing] ${JSON.stringify(merged)}`);
  }
}
