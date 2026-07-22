/**
 * Rust-side timing phases as reported in `manifest.timing`, in waterfall
 * order, with their display labels. Mirrors the timing struct in the
 * extract-v2 crate — a renamed or added Rust phase is updated here once,
 * not per plugin.
 */
export const RUST_TIMING_PHASES: ReadonlyArray<
  readonly [key: string, label: string]
> = [
  ['parseAndWalk', 'parse+walk'],
  ['importResolution', 'imports'],
  ['extensionProvenance', 'provenance'],
  ['topologicalSort', 'topo-sort'],
  ['chainEvaluation', 'chains'],
  ['jsxScanning', 'jsx-scan'],
  ['systemPropAggregation', 'sys-props'],
  ['usageLedger', 'usage'],
  ['reconciliation', 'reconcile'],
  ['cssGeneration', 'css-gen'],
  ['manifestSerialization', 'serialize'],
];

/**
 * Format the Rust timing waterfall as log lines. `indent` and `labelWidth`
 * let each plugin keep its established column layout; the phase table and
 * the `(N files, M cached)` suffix are shared.
 */
export function formatRustTimingWaterfall(
  timing: Record<string, number>,
  opts: { indent: string; labelWidth: number }
): string[] {
  const lines: string[] = [];
  for (const [key, label] of RUST_TIMING_PHASES) {
    const ms = timing[key] ?? 0;
    const pad = ' '.repeat(Math.max(0, opts.labelWidth - label.length));
    const extra =
      key === 'parseAndWalk'
        ? `  (${timing.fileCount ?? 0} files, ${timing.cacheHits ?? 0} cached)`
        : '';
    lines.push(
      `${opts.indent}${label}${pad}${String(ms).padStart(5)}ms${extra}`
    );
  }
  return lines;
}
