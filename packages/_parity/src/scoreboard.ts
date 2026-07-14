/**
 * Scoreboard: totals + percentages + sorted failing list + classification —
 * a committed, diffable text artifact (oxc conformance-snapshot style).
 */
import type { Divergence, FamilyDecl } from './types';

export function renderScoreboard(opts: {
  mode: string;
  engines: [string, string];
  devMode: boolean;
  unitIds: string[];
  divergences: Divergence[];
  families: FamilyDecl[];
  familyVerdictErrors: string[];
}): string {
  const {
    mode,
    engines,
    devMode,
    unitIds,
    divergences,
    families,
    familyVerdictErrors,
  } = opts;
  const divergentUnits = [...new Set(divergences.map((d) => d.unit))].sort();
  const passed = unitIds.length - divergentUnits.length;
  const pct = unitIds.length === 0 ? 100 : (passed / unitIds.length) * 100;
  const unregistered = divergences.filter((d) => !d.registered);

  const lines: string[] = [];
  lines.push(
    `parity ${mode} — engines: ${engines[0]} vs ${engines[1]} — devMode: ${devMode}`
  );
  lines.push('');
  lines.push(`Units passed: ${passed}/${unitIds.length} (${pct.toFixed(2)}%)`);
  lines.push(
    `Divergences: ${divergences.length} (${unregistered.length} unregistered)`
  );
  lines.push('');
  if (divergentUnits.length) {
    lines.push('Failing units (sorted):');
    for (const u of divergentUnits) {
      for (const d of divergences.filter((x) => x.unit === u)) {
        const cls = d.classification ? ` [${d.classification}]` : '';
        const reg = d.registered
          ? ` (registered: ${d.registered.category})`
          : ' (UNREGISTERED)';
        const hashes = ` [${d.baselineSha256} -> ${d.candidateSha256}]`;
        lines.push(`  ${u} · ${d.artifact}${cls}${reg}${hashes} — ${d.detail}`);
      }
    }
    lines.push('');
  }
  lines.push('Usage-case families:');
  for (const f of families) {
    const familyDiverged = f.units.some((u) => divergentUnits.includes(u));
    const actual = familyDiverged ? 'divergence' : 'identical';
    const ok =
      (f.expectedVerdict === 'identical' && !familyDiverged) ||
      (f.expectedVerdict === 'registered-divergence' &&
        familyDiverged &&
        divergences
          .filter((d) => f.units.includes(d.unit))
          .every((d) => d.registered));
    lines.push(
      `  ${ok ? 'ok' : 'VIOLATED'} ${f.family} — expected ${f.expectedVerdict}, observed ${actual}`
    );
  }
  for (const e of familyVerdictErrors) lines.push(`  VIOLATED ${e}`);
  lines.push('');
  return lines.join('\n');
}

/** Family verdict violations (spec: each family produces its declared verdict). */
export function familyViolations(
  families: FamilyDecl[],
  divergences: Divergence[]
): string[] {
  const errs: string[] = [];
  const byUnit = new Map<string, Divergence[]>();
  for (const d of divergences) {
    byUnit.set(d.unit, [...(byUnit.get(d.unit) ?? []), d]);
  }
  for (const f of families) {
    const famDivs = f.units.flatMap((u) => byUnit.get(u) ?? []);
    if (f.expectedVerdict === 'identical' && famDivs.length) {
      errs.push(
        `family ${f.family}: expected identical, saw ${famDivs.length} divergence(s)`
      );
    }
    if (f.expectedVerdict === 'registered-divergence') {
      if (!famDivs.length)
        errs.push(
          `family ${f.family}: expected registered divergence, saw none`
        );
      else if (famDivs.some((d) => !d.registered)) {
        errs.push(`family ${f.family}: divergence present but unregistered`);
      }
    }
  }
  return errs;
}
