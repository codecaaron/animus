/**
 * Scoreboard: totals + percentages + sorted failing list + classification —
 * a committed, diffable text artifact (oxc conformance-snapshot style).
 */
import type { Divergence, FamilyDecl } from './types';

interface ScoreboardInput {
  mode: string;
  engines: [string, string];
  devMode: boolean;
  unitIds: string[];
  divergences: Divergence[];
  families: FamilyDecl[];
  familyVerdictErrors: string[];
}

/** Header plus the pass/divergence totals, always emitted. */
function summarySection(
  input: ScoreboardInput,
  divergentUnits: string[]
): string[] {
  const { mode, engines, devMode, unitIds, divergences } = input;
  const passed = unitIds.length - divergentUnits.length;
  const pct = unitIds.length === 0 ? 100 : (passed / unitIds.length) * 100;
  const unregistered = divergences.filter((d) => !d.registered);

  return [
    `parity ${mode} — engines: ${engines[0]} vs ${engines[1]} — devMode: ${devMode}`,
    '',
    `Units passed: ${passed}/${unitIds.length} (${pct.toFixed(2)}%)`,
    `Divergences: ${divergences.length} (${unregistered.length} unregistered)`,
    '',
  ];
}

/** One failing-unit row: `  <unit> · <artifact>[cls](reg)[hashes] — detail`. */
function divergenceRow(unit: string, d: Divergence): string {
  const cls = d.classification ? ` [${d.classification}]` : '';
  const reg = d.registered
    ? ` (registered: ${d.registered.category})`
    : ' (UNREGISTERED)';
  const hashes = ` [${d.baselineSha256} -> ${d.candidateSha256}]`;
  return `  ${unit} · ${d.artifact}${cls}${reg}${hashes} — ${d.detail}`;
}

/** Sorted failing-unit block, or nothing at all when the run is clean. */
function failingSection(
  divergences: Divergence[],
  divergentUnits: string[]
): string[] {
  if (divergentUnits.length === 0) return [];
  return [
    'Failing units (sorted):',
    ...divergentUnits.flatMap((u) =>
      divergences.filter((x) => x.unit === u).map((d) => divergenceRow(u, d))
    ),
    '',
  ];
}

/** A family holds when its observed verdict matches the one it declared. */
function familyHolds(
  f: FamilyDecl,
  divergences: Divergence[],
  familyDiverged: boolean
): boolean {
  if (f.expectedVerdict === 'identical') return !familyDiverged;
  return (
    familyDiverged &&
    divergences
      .filter((d) => f.units.includes(d.unit))
      .every((d) => d.registered)
  );
}

/** Usage-case family verdicts, then any externally supplied violations. */
function familySection(
  input: ScoreboardInput,
  divergentUnits: string[]
): string[] {
  const { families, divergences, familyVerdictErrors } = input;
  return [
    'Usage-case families:',
    ...families.map((f) => {
      const familyDiverged = f.units.some((u) => divergentUnits.includes(u));
      const actual = familyDiverged ? 'divergence' : 'identical';
      const verdict = familyHolds(f, divergences, familyDiverged)
        ? 'ok'
        : 'VIOLATED';
      return `  ${verdict} ${f.family} — expected ${f.expectedVerdict}, observed ${actual}`;
    }),
    ...familyVerdictErrors.map((e) => `  VIOLATED ${e}`),
    '',
  ];
}

export function renderScoreboard(input: ScoreboardInput): string {
  const divergentUnits = [
    ...new Set(input.divergences.map((d) => d.unit)),
  ].sort();

  return [
    ...summarySection(input, divergentUnits),
    ...failingSection(input.divergences, divergentUnits),
    ...familySection(input, divergentUnits),
  ].join('\n');
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
