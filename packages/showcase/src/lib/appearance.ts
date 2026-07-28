/**
 * Appearance record — client half of the contract the generated bootstrap reads.
 *
 * The bootstrap generator is BUILD tooling — reachable only from the config,
 * never from a component. This module deliberately imports nothing from it: it
 * re-states the key and shape they agree on, and owns only the write path.
 *
 * Record: `animus:appearance` → `{"v":1,"mode":…,"theme":…}`.
 *
 * Two axes share one record. A consumer that changes ONE axis reads, modifies
 * and writes back, so fields it does not own (`theme`, plus anything a future
 * version adds) survive untouched.
 *
 * Three storage keys exist, and only one of them is ever WRITTEN from here:
 * - `animus:appearance` — the record. Written.
 * - `color-mode`        — the CONTRACT's pre-record key, read by the generated
 *                         bootstrap for migration. Never read and never written
 *                         here; it may belong to another app on this origin.
 * - `animus-color-mode` — the SHOWCASE's own historical key. Read once and
 *                         DELETED by `migrateShowcaseLegacyKey`; it is ours to
 *                         retire (see that function).
 */

/** The single versioned appearance record key. */
const APPEARANCE_KEY = 'animus:appearance';

/**
 * The showcase's OWN pre-record key, written by the hand-rolled inline script
 * this migration replaced. It is NOT the contract's legacy key (`color-mode`),
 * so the generated bootstrap does not know about it — without the one-shot
 * migration below, every returning visitor would silently lose their mode.
 */
const SHOWCASE_LEGACY_KEY = 'animus-color-mode';

/** The only record version this code writes or read-modify-writes. */
const RECORD_VERSION = 1;

/**
 * Mode value meaning "follow the OS". It is never a declared mode and never
 * reaches `data-color-mode` — the OS is followed by the attribute's ABSENCE.
 */
export const SYSTEM_MODE = 'system';

/** Applied when nothing is stored: OS-driven mode, default theme. */
const DEFAULT_RECORD = {
  v: RECORD_VERSION,
  mode: SYSTEM_MODE,
  theme: 'default',
} as const;

type AppearanceRecord = Record<string, unknown> & { v?: unknown };

/**
 * The three outcomes a caller must tell apart:
 * - `record`  — a v1 record we may merge into;
 * - `absent`  — nothing usable is stored, so a fresh record may be written;
 * - `foreign` — something IS stored that this code cannot interpret, so
 *               writing would destroy another writer's state.
 */
type ReadOutcome =
  | { kind: 'record'; record: AppearanceRecord }
  | { kind: 'absent' }
  | { kind: 'foreign' };

/**
 * Reads the stored record.
 *
 * READ FAILURE vs. ABSENT (F5 pin): a `getItem` that THROWS (blocked or
 * partitioned storage) is reported as `absent`, not `foreign` — deliberately.
 * "Absent" here means "this code has no knowledge of a stored record", and a
 * store we cannot read at all is indistinguishable from an empty one. The
 * asymmetry is safe because the accompanying write is wrapped in its own
 * try/catch: a store that throws on read throws on write too, so the `absent`
 * classification can never actually clobber anything. Only a store we CAN read
 * and whose content we cannot interpret yields `foreign`.
 *
 * A present-but-corrupt value (not JSON, not an object) is `absent`: it is
 * nobody's live state, so replacing it with a clean record is a repair. A
 * present record carrying an unrecognized `v` is `foreign`: that is a future
 * writer's data, and v1-shaped fields written over it would destroy fields
 * this version does not know exist.
 */
function readRecord(): ReadOutcome {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(APPEARANCE_KEY);
  } catch {
    return { kind: 'absent' };
  }
  if (typeof raw !== 'string' || raw === '') return { kind: 'absent' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'absent' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'absent' };
  }
  const record = parsed as AppearanceRecord;
  if (record.v !== RECORD_VERSION) return { kind: 'foreign' };
  return { kind: 'record', record };
}

/**
 * Persists the mode axis, preserving every field this call does not own
 * (`v`, `theme`, and any additional keys already in the record).
 *
 * REFUSAL PIN (F2): when the stored record carries a version this code does
 * not understand, NOTHING is written. Downgrading it to a v1 shape would drop
 * whatever fields the newer writer keeps there, and this axis is not worth
 * that. The caller has already set `data-color-mode`, so the user's choice
 * still holds for the session — only its persistence is skipped.
 *
 * Storage failures are likewise swallowed: persistence is a convenience, and
 * the attribute write that accompanies it has already taken effect.
 */
export function persistColorMode(mode: string): void {
  const outcome = readRecord();
  if (outcome.kind === 'foreign') return;

  const base = outcome.kind === 'record' ? outcome.record : DEFAULT_RECORD;
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ ...base, mode }));
  } catch {
    /* storage unavailable — the in-session attribute write still stands */
  }
}

/**
 * One-shot migration of the SHOWCASE's own historical key into the record.
 *
 * Runs POST-paint from the app entry, so the visit on which it runs still
 * paints in the OS-resolved mode before correcting itself — one accepted
 * flash, once, for visitors who last chose a mode under the old scheme. Every
 * later load restores pre-paint through the generated bootstrap, which is the
 * whole point of moving the value into the record.
 *
 * It writes only when there is nothing to lose (no record) and something worth
 * keeping (a declared mode name), then DELETES the old key so the migration
 * cannot run twice or resurrect a stale value. Deleting is legitimate here
 * precisely because this key is the showcase's own — the contract's
 * `color-mode` key belongs to the platform and is never touched.
 *
 * @returns the migrated mode name, so the caller can apply it to the document
 *   for this one visit, or `null` when nothing was migrated.
 */
export function migrateShowcaseLegacyKey(
  declaredModes: readonly string[]
): string | null {
  // A record already exists (in any form we can detect): the old key is
  // superseded, so drop it without reading its value into anything.
  if (readRecord().kind !== 'absent') {
    forgetShowcaseLegacyKey();
    return null;
  }

  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem(SHOWCASE_LEGACY_KEY);
  } catch {
    return null;
  }
  if (typeof legacy !== 'string' || !declaredModes.includes(legacy)) {
    // Unknown, empty, or absent: nothing worth migrating. An unknown name is
    // still ours to clear — it can only ever be junk to the bootstrap.
    if (legacy !== null) forgetShowcaseLegacyKey();
    return null;
  }

  try {
    localStorage.setItem(
      APPEARANCE_KEY,
      JSON.stringify({ ...DEFAULT_RECORD, mode: legacy })
    );
  } catch {
    return null;
  }
  forgetShowcaseLegacyKey();
  return legacy;
}

function forgetShowcaseLegacyKey(): void {
  try {
    localStorage.removeItem(SHOWCASE_LEGACY_KEY);
  } catch {
    /* nothing to do — the key stays, the record still wins on the next load */
  }
}
