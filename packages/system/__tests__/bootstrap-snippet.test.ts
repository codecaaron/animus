/**
 * Behavior tests for the GENERATED snippet (increment 02).
 *
 * The workspace has no DOM library, so the artifact's code is executed with
 * shadowed globals: `new Function('document', 'localStorage', code)` — which
 * only works because the IIFE references `document` and `localStorage` as free
 * identifiers. Keep it that way.
 *
 * Covers spec `color-mode-bootstrap`:
 * - "Validation and tri-state restoration" (including blocked storage, which
 *   is treated as NO record and therefore removes the attribute)
 * - "Legacy key migration" (including the empty-string record, pinned as
 *   "absent")
 * - "OS preference is never materialized into the attribute"
 * - "Appearance record contract" (explicit mode round-trips, record version)
 */
import { describe, expect, it } from 'vitest';

import { createAppearanceBootstrap } from '../src/bootstrap';
import {
  type Harness,
  SNIPPET_THEME,
  createHarness,
  runSnippetCode,
} from './snippet-harness';

const RECORD_KEY = 'animus:appearance';
const LEGACY_KEY = 'color-mode';
const ATTRIBUTE = 'data-color-mode';

function runCode(harness: Harness): Harness {
  return runSnippetCode(createAppearanceBootstrap(SNIPPET_THEME).code, harness);
}

/** Runs the snippet against a plain key/value store. */
function runBootstrap(
  store: Record<string, string>,
  serverRendered: Record<string, string> = {}
): Harness {
  return runCode(
    createHarness(
      (key) => (Object.hasOwn(store, key) ? store[key] : null),
      serverRendered
    )
  );
}

/**
 * Runs the snippet against a store whose reads THROW for `blockedKeys` —
 * private browsing / blocked-storage behavior.
 */
function runWithBlockedStorage(
  blockedKeys: string[],
  store: Record<string, string> = {},
  serverRendered: Record<string, string> = {}
): Harness {
  return runCode(
    createHarness((key) => {
      if (blockedKeys.includes(key)) {
        throw new Error(`SecurityError: access denied for ${key}`);
      }
      return Object.hasOwn(store, key) ? store[key] : null;
    }, serverRendered)
  );
}

describe('bootstrap snippet — tri-state restoration', () => {
  it('applies a declared mode from the appearance record', () => {
    const harness = runBootstrap({
      [RECORD_KEY]: '{"v":1,"mode":"midnight","theme":"default"}',
    });

    expect(harness.root.setAttribute).toHaveBeenCalledWith(
      ATTRIBUTE,
      'midnight'
    );
    expect(harness.attributes[ATTRIBUTE]).toBe('midnight');
  });

  it('removes a server-rendered attribute when the mode is "system"', () => {
    const harness = runBootstrap(
      { [RECORD_KEY]: '{"v":1,"mode":"system","theme":"default"}' },
      { [ATTRIBUTE]: 'paper' }
    );

    expect(harness.root.removeAttribute).toHaveBeenCalledWith(ATTRIBUTE);
    expect(harness.attributes[ATTRIBUTE]).toBeUndefined();
  });

  it('removes the attribute when no record and no legacy value exist', () => {
    const harness = runBootstrap({}, { [ATTRIBUTE]: 'paper' });

    expect(harness.root.removeAttribute).toHaveBeenCalledWith(ATTRIBUTE);
    expect(harness.attributes[ATTRIBUTE]).toBeUndefined();
  });

  it('removes the attribute for an undeclared mode name', () => {
    const harness = runBootstrap(
      { [RECORD_KEY]: '{"v":1,"mode":"nocturne","theme":"default"}' },
      { [ATTRIBUTE]: 'paper' }
    );

    expect(harness.attributes[ATTRIBUTE]).toBeUndefined();
    expect(harness.root.setAttribute).not.toHaveBeenCalled();
  });

  it('leaves markup untouched when the record is unparseable', () => {
    const harness = runBootstrap(
      { [RECORD_KEY]: '{not json' },
      { [ATTRIBUTE]: 'paper' }
    );

    expect(harness.mutations).toEqual([]);
    expect(harness.attributes[ATTRIBUTE]).toBe('paper');
  });

  it('treats a parseable non-record value as a missing mode', () => {
    const harness = runBootstrap(
      { [RECORD_KEY]: 'null' },
      { [ATTRIBUTE]: 'paper' }
    );

    expect(harness.mutations).toEqual([`remove:${ATTRIBUTE}`]);
  });

  it('removes the attribute when the store throws on every read', () => {
    // Blocked storage means "no knowledge", not "keep what the server said":
    // freezing a server-rendered mode would defeat the media-query fallback.
    const harness = runWithBlockedStorage(
      [RECORD_KEY, LEGACY_KEY],
      {},
      {
        [ATTRIBUTE]: 'paper',
      }
    );

    expect(harness.root.removeAttribute).toHaveBeenCalledWith(ATTRIBUTE);
    expect(harness.attributes[ATTRIBUTE]).toBeUndefined();
  });

  it('treats a throwing record read as an absent record (legacy still runs)', () => {
    const harness = runWithBlockedStorage([RECORD_KEY], {
      [LEGACY_KEY]: 'midnight',
    });

    expect(harness.root.setAttribute).toHaveBeenCalledWith(
      ATTRIBUTE,
      'midnight'
    );
  });

  it('ignores the record theme axis entirely', () => {
    const harness = runBootstrap({
      [RECORD_KEY]: '{"v":1,"mode":"paper","theme":"brandX"}',
    });

    expect(harness.mutations).toEqual([`set:${ATTRIBUTE}=paper`]);
    expect(harness.attributes['data-animus-theme']).toBeUndefined();
  });
});

describe('bootstrap snippet — record version', () => {
  it('removes the attribute for a version-less record', () => {
    const harness = runBootstrap(
      { [RECORD_KEY]: '{"mode":"midnight"}' },
      { [ATTRIBUTE]: 'paper' }
    );

    expect(harness.mutations).toEqual([`remove:${ATTRIBUTE}`]);
  });

  it('a version mismatch is terminal — legacy is not consulted', () => {
    // Pins the interpretation: an unreadable-version record is still a
    // RECORD, so the pre-record key does not get a second vote. The
    // server-rendered attribute makes the removal observable in the markup —
    // a future version leaves nothing behind.
    const harness = runBootstrap(
      {
        [RECORD_KEY]: '{"v":2,"mode":"midnight"}',
        [LEGACY_KEY]: 'paper',
      },
      { [ATTRIBUTE]: 'paper' }
    );

    expect(harness.mutations).toEqual([`remove:${ATTRIBUTE}`]);
    expect(harness.attributes[ATTRIBUTE]).toBeUndefined();
    expect(harness.localStorage.getItem).not.toHaveBeenCalledWith(LEGACY_KEY);
  });
});

describe('bootstrap snippet — legacy key migration', () => {
  it('treats an empty-string record as absent and falls through to legacy', () => {
    const harness = runBootstrap({
      [RECORD_KEY]: '',
      [LEGACY_KEY]: 'midnight',
    });

    expect(harness.root.setAttribute).toHaveBeenCalledWith(
      ATTRIBUTE,
      'midnight'
    );
    expect(harness.localStorage.getItem).toHaveBeenCalledWith(LEGACY_KEY);
  });

  it('removes the attribute for an empty-string record with no legacy value', () => {
    const harness = runBootstrap(
      { [RECORD_KEY]: '' },
      { [ATTRIBUTE]: 'paper' }
    );

    expect(harness.mutations).toEqual([`remove:${ATTRIBUTE}`]);
  });

  it('honors the legacy key when the record is absent', () => {
    const harness = runBootstrap({ [LEGACY_KEY]: 'midnight' });

    expect(harness.root.setAttribute).toHaveBeenCalledWith(
      ATTRIBUTE,
      'midnight'
    );
  });

  it('ignores a legacy value that is not a declared mode', () => {
    const harness = runBootstrap(
      { [LEGACY_KEY]: 'nocturne' },
      { [ATTRIBUTE]: 'paper' }
    );

    expect(harness.attributes[ATTRIBUTE]).toBeUndefined();
  });

  it('prefers the record over the legacy key and never reads legacy', () => {
    const harness = runBootstrap({
      [RECORD_KEY]: '{"v":1,"mode":"paper","theme":"default"}',
      [LEGACY_KEY]: 'midnight',
    });

    expect(harness.root.setAttribute).toHaveBeenCalledWith(ATTRIBUTE, 'paper');
    expect(harness.localStorage.getItem).toHaveBeenCalledWith(RECORD_KEY);
    expect(harness.localStorage.getItem).not.toHaveBeenCalledWith(LEGACY_KEY);
  });

  it('never writes any storage key in any state', () => {
    const states: Record<string, string>[] = [
      {},
      { [RECORD_KEY]: '{"v":1,"mode":"midnight","theme":"default"}' },
      { [RECORD_KEY]: '{"v":1,"mode":"system","theme":"default"}' },
      { [RECORD_KEY]: '{"v":1,"mode":"nocturne","theme":"default"}' },
      { [RECORD_KEY]: '{not json' },
      { [RECORD_KEY]: '' },
      { [RECORD_KEY]: '{"v":2,"mode":"midnight"}' },
      { [LEGACY_KEY]: 'midnight' },
      { [RECORD_KEY]: '{"v":1,"mode":"paper"}', [LEGACY_KEY]: 'midnight' },
    ];

    for (const store of states) {
      const before = { ...store };
      const harness = runBootstrap(store);
      expect(harness.localStorage.setItem).not.toHaveBeenCalled();
      expect(store).toEqual(before);
    }

    // …including the blocked-storage path, which reaches the removal branch.
    const blocked = runWithBlockedStorage([RECORD_KEY, LEGACY_KEY]);
    expect(blocked.localStorage.setItem).not.toHaveBeenCalled();
  });
});

describe('bootstrap snippet — OS preference is never materialized', () => {
  it('contains no matchMedia or prefers-color-scheme reference', () => {
    const { code } = createAppearanceBootstrap(SNIPPET_THEME);

    expect(code).not.toContain('matchMedia');
    expect(code).not.toContain('prefers-color-scheme');
  });

  it('never derives an attribute value outside the declared allowlist', () => {
    const harness = runBootstrap({
      [RECORD_KEY]: '{"v":1,"mode":"system","theme":"default"}',
    });

    expect(harness.mutations).toEqual([`remove:${ATTRIBUTE}`]);
  });

  it('touches only `document` and `localStorage` globals', () => {
    const { code } = createAppearanceBootstrap(SNIPPET_THEME);

    expect(code).not.toContain('window');
    expect(code).not.toContain('navigator');
    expect(code).not.toContain('setItem');
  });
});
