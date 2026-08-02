/**
 * Behavior tests for the appearance record WRITE path
 * (`@animus-ui/system/appearance`) — the client half of the contract the
 * generated bootstrap reads.
 *
 * The workspace has no DOM library, so the module resolves storage off
 * `globalThis` structurally; tests install an in-memory store with
 * `vi.stubGlobal`. The round-trip block at the end is the load-bearing part:
 * the two subpaths share no code on purpose (bootstrap is build tooling,
 * appearance is client runtime), so key/shape agreement is proven here by
 * writing with one and restoring with the other.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SYSTEM_MODE,
  migrateLegacyModeKey,
  persistColorMode,
} from '../src/appearance';
import { createAppearanceBootstrap } from '../src/bootstrap';
import {
  SNIPPET_THEME,
  createHarness,
  runSnippetCode,
} from './snippet-harness';

const RECORD_KEY = 'animus:appearance';
const LEGACY_KEY = 'animus-color-mode';

interface MemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  dump(): Record<string, string>;
}

function createStorage(initial: Record<string, string> = {}): MemoryStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    dump: () => Object.fromEntries(map),
  };
}

function install(store: MemoryStorage | undefined): void {
  vi.stubGlobal('localStorage', store);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('persistColorMode', () => {
  it('writes a fresh default-based record when nothing is stored', () => {
    const store = createStorage();
    install(store);

    persistColorMode('midnight');

    expect(JSON.parse(store.dump()[RECORD_KEY])).toEqual({
      v: 1,
      mode: 'midnight',
      theme: 'default',
    });
  });

  it('preserves fields it does not own, including ones it has never heard of', () => {
    const store = createStorage({
      [RECORD_KEY]: '{"v":1,"mode":"paper","theme":"brandX","future":42}',
    });
    install(store);

    persistColorMode('midnight');

    expect(JSON.parse(store.dump()[RECORD_KEY])).toEqual({
      v: 1,
      mode: 'midnight',
      theme: 'brandX',
      future: 42,
    });
  });

  it('refuses to write over a record with an unrecognized version', () => {
    const foreign = '{"v":2,"mode":"paper","palette":"p3"}';
    const store = createStorage({ [RECORD_KEY]: foreign });
    install(store);

    persistColorMode('midnight');

    expect(store.dump()[RECORD_KEY]).toBe(foreign);
  });

  it('repairs a present-but-corrupt value', () => {
    const store = createStorage({ [RECORD_KEY]: 'not json' });
    install(store);

    persistColorMode('midnight');

    expect(JSON.parse(store.dump()[RECORD_KEY]).mode).toBe('midnight');
  });

  it('swallows a store that throws on every access', () => {
    install({
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
      dump: () => ({}),
    });

    expect(() => persistColorMode('midnight')).not.toThrow();
  });

  it('is a no-op in a runtime with no storage at all', () => {
    install(undefined);
    expect(() => persistColorMode('midnight')).not.toThrow();
  });

  it('honors a custom storage key and rejects an empty one', () => {
    const store = createStorage();
    install(store);

    persistColorMode('midnight', { storageKey: 'acme:appearance' });

    expect(store.dump()['acme:appearance']).toBeDefined();
    expect(store.dump()[RECORD_KEY]).toBeUndefined();
    expect(() => persistColorMode('midnight', { storageKey: '' })).toThrow(
      /non-empty/
    );
  });
});

describe('migrateLegacyModeKey', () => {
  it('migrates a declared legacy mode into the record and deletes the key', () => {
    const store = createStorage({ [LEGACY_KEY]: 'midnight' });
    install(store);

    const migrated = migrateLegacyModeKey(LEGACY_KEY, ['midnight', 'paper']);

    expect(migrated).toBe('midnight');
    expect(JSON.parse(store.dump()[RECORD_KEY])).toEqual({
      v: 1,
      mode: 'midnight',
      theme: 'default',
    });
    expect(store.dump()[LEGACY_KEY]).toBeUndefined();
  });

  it('drops the legacy key without reading it when a record already exists', () => {
    const record = '{"v":1,"mode":"paper","theme":"default"}';
    const store = createStorage({
      [RECORD_KEY]: record,
      [LEGACY_KEY]: 'midnight',
    });
    install(store);

    expect(migrateLegacyModeKey(LEGACY_KEY, ['midnight', 'paper'])).toBeNull();
    expect(store.dump()[RECORD_KEY]).toBe(record);
    expect(store.dump()[LEGACY_KEY]).toBeUndefined();
  });

  it('treats a foreign-version record as existing — key dropped, nothing written', () => {
    const foreign = '{"v":9,"mode":"paper"}';
    const store = createStorage({
      [RECORD_KEY]: foreign,
      [LEGACY_KEY]: 'midnight',
    });
    install(store);

    expect(migrateLegacyModeKey(LEGACY_KEY, ['midnight', 'paper'])).toBeNull();
    expect(store.dump()[RECORD_KEY]).toBe(foreign);
    expect(store.dump()[LEGACY_KEY]).toBeUndefined();
  });

  it('clears an undeclared legacy value without migrating it', () => {
    const store = createStorage({ [LEGACY_KEY]: 'nocturne' });
    install(store);

    expect(migrateLegacyModeKey(LEGACY_KEY, ['midnight', 'paper'])).toBeNull();
    expect(store.dump()[RECORD_KEY]).toBeUndefined();
    expect(store.dump()[LEGACY_KEY]).toBeUndefined();
  });

  it('leaves everything alone when the legacy key is absent', () => {
    const store = createStorage();
    install(store);

    expect(migrateLegacyModeKey(LEGACY_KEY, ['midnight'])).toBeNull();
    expect(store.dump()).toEqual({});
  });

  it("refuses the contract's shared legacy key and the record key itself", () => {
    install(createStorage());

    expect(() => migrateLegacyModeKey('color-mode', ['midnight'])).toThrow(
      /another app/
    );
    expect(() => migrateLegacyModeKey(RECORD_KEY, ['midnight'])).toThrow(
      /record key itself/
    );
  });
});

/**
 * Round-trip: write with `appearance`, restore with the GENERATED snippet.
 * This is the parity pin for the deliberately duplicated key/shape constants —
 * if either module drifts, a persisted mode stops restoring pre-paint.
 */
describe('appearance ↔ bootstrap round-trip', () => {
  function runSnippet(store: MemoryStorage): {
    attributes: Record<string, string>;
  } {
    // The snippet only ever READS storage, so a getItem view of the store the
    // appearance module wrote to is a faithful round-trip.
    const harness = createHarness((key) => store.getItem(key));
    return runSnippetCode(
      createAppearanceBootstrap(SNIPPET_THEME).code,
      harness
    );
  }

  it('a persisted explicit mode is restored as the attribute', () => {
    const store = createStorage();
    install(store);

    persistColorMode('midnight');

    expect(runSnippet(store).attributes['data-color-mode']).toBe('midnight');
  });

  it('a persisted SYSTEM_MODE is restored as attribute absence', () => {
    const store = createStorage();
    install(store);

    persistColorMode('paper');
    persistColorMode(SYSTEM_MODE);

    expect(runSnippet(store).attributes['data-color-mode']).toBeUndefined();
  });

  it('a migrated legacy mode is restored as the attribute', () => {
    const store = createStorage({ [LEGACY_KEY]: 'paper' });
    install(store);

    migrateLegacyModeKey(LEGACY_KEY, ['midnight', 'paper']);

    expect(runSnippet(store).attributes['data-color-mode']).toBe('paper');
  });
});
