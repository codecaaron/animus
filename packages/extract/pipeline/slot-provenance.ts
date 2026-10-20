import { locationOf } from './manifest-diagnostics';

import type { ManifestComponentDescriptor } from './manifest-schema';

/** One thing that keeps system slots open: a rule of the use proof, or the
 *  site where it applies. */
export interface SlotOpening {
  rule: string;
  file?: string;
  at?: number;
  line?: number;
  detail?: string;
}

/** An owner that keeps a prop's slot, and how. */
export type SlotKeeper = SlotOpening & { owner: string };

/** What keeps each system slot open (`slot_provenance` in the manifest),
 *  present when verbose output asks the engine for it. */
export interface SlotProvenance {
  /** Why usage is not proven project-wide, where it is not. */
  usage: SlotOpening[];
  /** Every reason each owner whose uses are unproven is. */
  owners: Record<string, SlotOpening[]>;
  /** Each kept system slot, by prop: every owner that keeps it. */
  props: Record<string, SlotKeeper[]>;
  /** Each kept component slot, by component and prop: what keeps it. */
  components: Record<string, Record<string, SlotOpening[]>>;
}

/** The owners each kept prop lists in full before `+N more`. */
const OWNERS_SHOWN = 3;

/** The components with the most kept slots that the summary names. */
const COMPONENTS_SHOWN = 5;

function place(opening: SlotOpening): string {
  const detail = opening.detail ? ` ${opening.detail}` : '';
  const at = opening.file
    ? ` at ${locationOf({ file: opening.file, line: opening.line })}`
    : '';
  return `${opening.rule}${detail}${at}`;
}

/**
 * The verbose lines for `provenance`: a count of kept props by the rule that
 * keeps each, the reasons usage is not proven project-wide, per prop the
 * owners that keep it and how, each named by its binding, and the same
 * counts for component slots, with the components that keep the most.
 */
export function slotProvenanceLines(
  provenance: SlotProvenance,
  components: Record<string, ManifestComponentDescriptor>
): string[] {
  const props = Object.entries(provenance.props);
  const slots = Object.entries(provenance.components ?? {});
  if (props.length === 0 && slots.length === 0) return [];
  // An unproven owner keeps its slots for each of its reasons.
  const keeping = (keeper: SlotKeeper): SlotOpening[] =>
    keeper.rule === 'unproven-owner'
      ? (provenance.owners[keeper.owner] ?? [keeper])
      : [keeper];
  const byRule = new Map<string, number>();
  for (const [, keepers] of props) {
    const rules = new Set(
      keepers.flatMap((keeper) => keeping(keeper).map(({ rule }) => rule))
    );
    for (const rule of rules) byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
  }
  const counts = [...byRule]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([rule, count]) => `${rule} ${count}`)
    .join(', ');
  const lines = [
    `slots kept for ${props.length} system props; props each rule keeps: ${counts}`,
  ];
  const gaps = new Map<string, number>();
  for (const gap of provenance.usage) {
    const key = place(gap);
    gaps.set(key, (gaps.get(key) ?? 0) + 1);
  }
  for (const [key, count] of gaps) {
    lines.push(
      `usage not proven project-wide: ${key}${count > 1 ? ` (×${count})` : ''}`
    );
  }
  for (const [prop, keepers] of props) {
    const shown = keepers.slice(0, OWNERS_SHOWN).map((keeper) => {
      const name = components[keeper.owner]?.binding ?? keeper.owner;
      return `${name} (${keeping(keeper).map(place).join('; ')})`;
    });
    const more =
      keepers.length > OWNERS_SHOWN
        ? `, +${keepers.length - OWNERS_SHOWN} more`
        : '';
    lines.push(`slot '${prop}' kept by ${shown.join(', ')}${more}`);
  }
  if (slots.length === 0) return lines;
  // A component slot an unproven owner keeps stays for each of its reasons.
  const reasons = (owner: string, openings: SlotOpening[]): SlotOpening[] =>
    openings.flatMap((opening) =>
      opening.rule === 'unproven-owner'
        ? (provenance.owners[owner] ?? [opening])
        : [opening]
    );
  const slotsByRule = new Map<string, number>();
  let total = 0;
  for (const [owner, byProp] of slots) {
    for (const openings of Object.values(byProp)) {
      total += 1;
      const kept = new Set(reasons(owner, openings).map(({ rule }) => rule));
      for (const name of kept) {
        slotsByRule.set(name, (slotsByRule.get(name) ?? 0) + 1);
      }
    }
  }
  const slotCounts = [...slotsByRule]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([rule, count]) => `${rule} ${count}`)
    .join(', ');
  lines.push(
    `component slots kept: ${total} on ${slots.length} components; slots each rule keeps: ${slotCounts}`
  );
  const largest = slots
    .map(([owner, byProp]) => [owner, Object.keys(byProp).length] as const)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, COMPONENTS_SHOWN);
  for (const [owner, count] of largest) {
    const name = components[owner]?.binding ?? owner;
    const why = [
      ...new Set(
        Object.values(provenance.components[owner]).flatMap((openings) =>
          reasons(owner, openings).map(place)
        )
      ),
    ];
    lines.push(`${name} keeps ${count} component slots (${why.join('; ')})`);
  }
  return lines;
}
