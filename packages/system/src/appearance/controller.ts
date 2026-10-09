import { SYSTEM_MODE, persistColorMode } from './index.js';

import type { AppearanceStorageOptions } from './index.js';

// Restated from the appearance core and the bootstrap, which keep them
// private: the record this controller reads is the one they read and write.
const DEFAULT_STORAGE_KEY = 'animus:appearance';
const SHARED_LEGACY_KEY = 'color-mode';
const MODE_ATTRIBUTE = 'data-color-mode';
const RECORD_VERSION = 1;

export interface ColorModeControllerOptions {
  /** The modes the theme declares, such as `Object.keys(theme.manifest.modes)`. */
  modes: readonly string[];
  /** The setting before one is made: a declared mode or `system`, the
   *  default. A stored setting replaces it when storage is enabled. */
  initial?: string;
  /**
   * Off unless given. When enabled, the initial setting is read from the
   * appearance record as the bootstrap reads it, and each change is written
   * through `persistColorMode`.
   */
  storage?: boolean | AppearanceStorageOptions;
}

export interface ColorModeController {
  /** A declared mode, or `system`. */
  get(): string;
  /** The setting before storage is read: what a server renders. */
  getDefault(): string;
  /** Writes `data-color-mode` on the root by the bootstrap's rules: a
   *  declared mode as is, `system` by removing the attribute. */
  set(mode: string): void;
  /** Calls `listener` after each change; returns the unsubscriber. */
  subscribe(listener: (mode: string) => void): () => void;
}

interface MinimalStorage {
  getItem(key: string): string | null;
}

interface StoredRecord {
  v?: number;
  mode?: string;
}

/** The setting the bootstrap restores: the record's mode, or the shared
 *  legacy key when no record is stored. Null when nothing applies. */
function storedSetting(
  storageKey: string,
  modes: readonly string[]
): string | null {
  // SAFETY: `localStorage` is the host's Storage where one exists; only
  // `getItem` is called on it, inside a try.
  const storage = (globalThis as { localStorage?: MinimalStorage })
    .localStorage;
  const read = (key: string): string | null => {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const declared = (mode: string | null | undefined): mode is string =>
    modes.some((name) => name === mode);
  const raw = read(storageKey);
  if (raw === null || raw === '') {
    const legacy = read(SHARED_LEGACY_KEY);
    return declared(legacy) ? legacy : null;
  }
  let record: StoredRecord | null;
  try {
    // SAFETY: the record's fields are only compared below, as the bootstrap
    // compares them, so a value of any other shape fails those comparisons.
    record = JSON.parse(raw) as StoredRecord | null;
  } catch {
    return null;
  }
  // A record of another version, or one naming no declared mode, is
  // restored as `system`.
  return record?.v === RECORD_VERSION && declared(record.mode)
    ? record.mode
    : SYSTEM_MODE;
}

/**
 * Holds the light/dark setting for one theme: any mode it declares, or
 * `system`, which leaves the choice to the operating system's preference
 * through CSS. It never queries the operating system, and writes nothing,
 * neither the root attribute nor storage, until `set` is called.
 */
export function createColorModeController(
  options: ColorModeControllerOptions
): ColorModeController {
  const { modes, storage } = options;
  const valid = (mode: string): boolean =>
    mode === SYSTEM_MODE || modes.includes(mode);
  const fallback = options.initial ?? SYSTEM_MODE;
  if (!valid(fallback)) {
    throw new Error(
      `colorMode: initial '${fallback}' is neither a declared mode nor '${SYSTEM_MODE}'.`
    );
  }
  const storageOptions =
    storage === undefined || storage === false
      ? null
      : storage === true
        ? {}
        : storage;
  if (storageOptions?.storageKey === '') {
    throw new Error('colorMode: storageKey must be a non-empty string.');
  }
  let current =
    (storageOptions &&
      storedSetting(storageOptions.storageKey ?? DEFAULT_STORAGE_KEY, modes)) ??
    fallback;
  const listeners = new Set<(mode: string) => void>();

  return {
    get: () => current,
    getDefault: () => fallback,
    set(mode) {
      if (!valid(mode)) {
        throw new Error(
          `colorMode: '${mode}' is neither a declared mode nor '${SYSTEM_MODE}'.`
        );
      }
      // SAFETY: `document` is the DOM's document where one exists; a server
      // has none, and nothing is written there.
      const root = (globalThis as { document?: Document }).document
        ?.documentElement;
      if (mode === SYSTEM_MODE) root?.removeAttribute(MODE_ATTRIBUTE);
      else root?.setAttribute(MODE_ATTRIBUTE, mode);
      if (storageOptions) persistColorMode(mode, storageOptions);
      if (mode === current) return;
      current = mode;
      for (const listener of [...listeners]) listener(mode);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
