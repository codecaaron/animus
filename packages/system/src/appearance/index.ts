const DEFAULT_STORAGE_KEY = 'animus:appearance';

const CONTRACT_LEGACY_KEY = 'color-mode';

const RECORD_VERSION = 1;

export const SYSTEM_MODE = 'system';

const DEFAULT_RECORD = {
  v: RECORD_VERSION,
  mode: SYSTEM_MODE,
  theme: 'default',
} as const;

export interface AppearanceStorageOptions {
  storageKey?: string;
}

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

type ReadOutcome =
  | { kind: 'record'; record: AppearanceRecord }
  | { kind: 'absent' }
  | { kind: 'foreign' };

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
  } catch {}
}

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
    } catch {}
  };

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
