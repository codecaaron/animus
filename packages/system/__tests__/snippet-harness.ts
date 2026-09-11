import { vi } from 'vitest';

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
  mutations: string[];
}

export function createHarness(
  getItem: (key: string) => string | null,
  serverRendered: Record<string, string> = {}
): Harness {
  const attributes = { ...serverRendered };
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

type SnippetEntry = (
  documentGlobal: Harness['document'],
  storageGlobal: Harness['localStorage']
) => void;

export function runSnippetCode(code: string, harness: Harness): Harness {
  // SAFETY: `new Function` binds parameters in the listed order, matching
  // SnippetEntry; `code` is a generated self-contained IIFE.
  // oxlint-disable-next-line no-new-func
  const run = new Function('document', 'localStorage', code) as SnippetEntry;
  run(harness.document, harness.localStorage);
  return harness;
}
