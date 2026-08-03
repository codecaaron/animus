/**
 * Appearance record write path — the CLIENT half of the contract the generated
 * bootstrap reads (openspec: color-mode-bootstrap, "Appearance record
 * contract").
 *
 * This module is runtime application code: it ships in client bundles and owns
 * only the record WRITE path. It deliberately imports nothing from
 * `@animus-ui/system/bootstrap` — that subpath is build tooling, reaches
 * `node:crypto`, and must never enter an application bundle — so the two
 * modules re-state the key and shape they agree on, and the round-trip tests
 * pin the agreement (a record written here is restored by the generated
 * snippet).
 *
 * Record: `animus:appearance` → `{"v":1,"mode":…,"theme":…}`.
 *
 * Two axes share one record. A writer that changes ONE axis reads, modifies
 * and writes back, so fields it does not own (`theme`, plus anything a future
 * version adds) survive untouched.
 */

/** The single versioned appearance record key. */
const DEFAULT_STORAGE_KEY = 'animus:appearance';

/**
 * The CONTRACT's pre-record key. The generated bootstrap reads it once, only
 * when the record is absent, and never writes it — it may belong to another
 * app on this origin, so this module refuses to migrate (and therefore
 * delete) it. See {@link migrateLegacyModeKey}.
 */
const CONTRACT_LEGACY_KEY = 'color-mode';

/** The only appearance-record version this module writes or read-modify-writes. */
const RECORD_VERSION = 1;

/**
 * Mode value meaning "follow the OS". It is never a declared mode and never
 * reaches `data-color-mode` — the OS is followed by the attribute's ABSENCE,
 * which the generated bootstrap restores when it reads this value.
 */
export const SYSTEM_MODE = 'system';

/** Applied when nothing is stored: OS-driven mode, default theme. */
const DEFAULT_RECORD = {
  v: RECORD_VERSION,
  mode: SYSTEM_MODE,
  theme: 'default',
} as const;

export interface AppearanceStorageOptions {
  /**
   * Overrides the record key. MUST match the `storageKey` the bootstrap
   * artifact was generated with, or the snippet restores from a key this
   * module never writes. Defaults to `animus:appearance`.
   */
  storageKey?: string;
}

/**
 * The slice of Web Storage this module uses, typed structurally: the package
 * compiles without the DOM library, and resolving storage off `globalThis`
 * also makes a storage-less runtime (SSR, workers) degrade to the same
 * "unavailable" path as a throwing store.
 */
interface MinimalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storageOf(): MinimalStorage | undefined {
  return (globalThis as { localStorage?: MinimalStorage }).localStorage;
}

function keyOf(options?: AppearanceStorageOptions): string {
  const key = options?.storageKey ?? DEFAULT_STORAGE_KEY;
  if (typeof key !== 'string' || key === '') {
    throw new Error('appearance: storageKey must be a non-empty string.');
  }
  return key;
}

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
 * READ FAILURE vs. ABSENT: a `getItem` that THROWS (blocked or partitioned
 * storage) — or no storage object at all — is reported as `absent`, not
 * `foreign`, deliberately. "Absent" here means "this code has no knowledge of
 * a stored record", and a store we cannot read at all is indistinguishable
 * from an empty one. The asymmetry is safe because the accompanying write is
 * wrapped in its own try/catch: a store that throws on read throws on write
 * too, so the `absent` classification can never actually clobber anything.
 * Only a store we CAN read and whose content we cannot interpret yields
 * `foreign`.
 *
 * A present-but-corrupt value (not JSON, not an object) is `absent`: it is
 * nobody's live state, so replacing it with a clean record is a repair. A
 * present record carrying an unrecognized `v` is `foreign`: that is a future
 * writer's data, and v1-shaped fields written over it would destroy fields
 * this version does not know exist.
 */
function readRecord(storageKey: string): ReadOutcome {
  let raw: string | null = null;
  try {
    raw = storageOf()?.getItem(storageKey) ?? null;
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
 * Pass {@link SYSTEM_MODE} to persist "follow the OS" — the generated
 * bootstrap restores it as attribute absence. Applying the mode to the
 * document (setting or removing `data-color-mode`) stays the caller's job:
 * this module is storage-only and never touches the DOM.
 *
 * REFUSAL RULE: when the stored record carries a version this code does not
 * understand, NOTHING is written. Downgrading it to a v1 shape would drop
 * whatever fields the newer writer keeps there, and this axis is not worth
 * that. A caller that has already updated the attribute keeps the user's
 * choice for the session — only its persistence is skipped.
 *
 * Storage failures are likewise swallowed: persistence is a convenience, and
 * the attribute write that accompanies it has already taken effect.
 */
export function persistColorMode(
  mode: string,
  options?: AppearanceStorageOptions
): void {
  const storageKey = keyOf(options);
  const outcome = readRecord(storageKey);
  if (outcome.kind === 'foreign') return;

  const base = outcome.kind === 'record' ? outcome.record : DEFAULT_RECORD;
  try {
    storageOf()?.setItem(storageKey, JSON.stringify({ ...base, mode }));
  } catch {
    /* storage unavailable — the caller's attribute write still stands */
  }
}

/**
 * One-shot migration of an application's OWN historical mode key into the
 * record.
 *
 * The generated bootstrap only knows the record and the contract's `color-mode`
 * key — an app that persisted under its own key before adopting the record
 * would silently drop every returning visitor's mode without this. Run it
 * post-paint from the app entry: the visit on which it migrates still paints
 * in the OS-resolved mode before correcting itself — one accepted flash, once
 * — and every later load restores pre-paint through the bootstrap.
 *
 * It writes only when there is nothing to lose (no record) and something worth
 * keeping (a value in `declaredModes`), then DELETES the old key so the
 * migration cannot run twice or resurrect a stale value. Deleting is
 * legitimate precisely because the key is the application's own; the
 * contract's `color-mode` key may belong to another app on this origin and is
 * refused, as is the record key itself.
 *
 * @returns the migrated mode name, so the caller can apply it to the document
 *   for this one visit, or `null` when nothing was migrated.
 */
export function migrateLegacyModeKey(
  legacyKey: string,
  declaredModes: readonly string[],
  options?: AppearanceStorageOptions
): string | null {
  const storageKey = keyOf(options);
  if (legacyKey === CONTRACT_LEGACY_KEY) {
    throw new Error(
      `appearance: '${CONTRACT_LEGACY_KEY}' is the contract's shared legacy key — the generated bootstrap reads it read-only and it may belong to another app on this origin. Migrate only keys your application owns.`
    );
  }
  if (legacyKey === storageKey) {
    throw new Error(
      `appearance: legacyKey '${legacyKey}' is the record key itself — nothing to migrate.`
    );
  }

  const forget = (): void => {
    try {
      storageOf()?.removeItem(legacyKey);
    } catch {
      /* nothing to do — the key stays, the record still wins on the next load */
    }
  };

  // A record already exists (in any form we can detect): the old key is
  // superseded, so drop it without reading its value into anything.
  if (readRecord(storageKey).kind !== 'absent') {
    forget();
    return null;
  }

  let legacy: string | null = null;
  try {
    legacy = storageOf()?.getItem(legacyKey) ?? null;
  } catch {
    return null;
  }
  if (typeof legacy !== 'string' || !declaredModes.includes(legacy)) {
    // Unknown, empty, or absent: nothing worth migrating. An unknown name is
    // still the app's to clear — it can only ever be junk to the bootstrap.
    if (legacy !== null) forget();
    return null;
  }

  try {
    storageOf()?.setItem(
      storageKey,
      JSON.stringify({ ...DEFAULT_RECORD, mode: legacy })
    );
  } catch {
    return null;
  }
  forget();
  return legacy;
}
