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
