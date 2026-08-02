/**
 * Shared harness for executing the GENERATED bootstrap snippet in tests.
 *
 * The workspace has no DOM library, so the artifact's code runs with shadowed
 * globals: `new Function('document', 'localStorage', code)` — which only works
 * because the IIFE references `document` and `localStorage` as free
 * identifiers. That calling convention is the contract this module pins; the
 * suites that consume it (`bootstrap-snippet`, `appearance`) must not re-state
 * it locally, or a generator change needs N edits instead of one.
 *
 * Not a test file — vitest only collects `*.test.ts`.
 */
import { vi } from 'vitest';

/** The canonical two-mode theme the snippet suites generate from. */
export const SNIPPET_THEME = {
  manifest: {
    modes: {
      midnight: { 'colors.primary': '#000000' },
      paper: { 'colors.primary': '#ffffff' },
    },
  },
};

export interface Harness {
  document: unknown;
  localStorage: {
    getItem: ReturnType<typeof vi.fn>;
    setItem: ReturnType<typeof vi.fn>;
  };
  root: {
    setAttribute: ReturnType<typeof vi.fn>;
    removeAttribute: ReturnType<typeof vi.fn>;
  };
  attributes: Record<string, string>;
  /** Every attribute mutation, in order — empty means "markup untouched". */
  mutations: string[];
}

export function createHarness(
  getItem: (key: string) => string | null,
  serverRendered: Record<string, string> = {}
): Harness {
  const attributes: Record<string, string> = { ...serverRendered };
  const mutations: string[] = [];

  const setAttribute = vi.fn((name: string, value: string) => {
    mutations.push(`set:${name}=${value}`);
    attributes[name] = value;
  });
  const removeAttribute = vi.fn((name: string) => {
    mutations.push(`remove:${name}`);
    delete attributes[name];
  });
  const root = { setAttribute, removeAttribute };

  return {
    document: { documentElement: root },
    localStorage: { getItem: vi.fn(getItem), setItem: vi.fn() },
    root,
    attributes,
    mutations,
  };
}

/** Execute snippet `code` against the harness's shadowed globals. */
export function runSnippetCode(code: string, harness: Harness): Harness {
  // oxlint-disable-next-line no-new-func
  const run = new Function('document', 'localStorage', code) as (
    documentGlobal: unknown,
    storageGlobal: unknown
  ) => void;
  run(harness.document, harness.localStorage);
  return harness;
}
