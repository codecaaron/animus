/**
 * Behavior pins for the loader's single-CSS-import policy: strip the
 * emitter-injected stylesheet import everywhere, re-inject it only in the
 * root entry — detected by convention (ROOT_ENTRY_RE) or set explicitly via
 * the `cssImportTarget` option, which replaces the convention.
 *
 * The v2 engine adapter passes through paths absent from the last analyze()
 * set, so with an empty sent-sources map the loader's transform leg is a
 * no-op and only the CSS handling is exercised — no native engine involved.
 */
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import animusLoader from '../src/loader';

const MANIFEST_KEY = '__animus_manifest_json__';
const ENGINE_KEY = '__animus_engine__';
const V2_ENGINE_KEY = '__animus_v2_engine__';
const V2_SENT_SOURCES_KEY = '__animus_v2_sent_sources__';

const g = globalThis as Record<string, unknown>;
let saved: Record<string, unknown>;

const ROOT = '/proj';
const CSS_IMPORT = "import '.animus/styles.css';\n";

beforeEach(() => {
  saved = {
    [MANIFEST_KEY]: g[MANIFEST_KEY],
    [ENGINE_KEY]: g[ENGINE_KEY],
    [V2_ENGINE_KEY]: g[V2_ENGINE_KEY],
    [V2_SENT_SOURCES_KEY]: g[V2_SENT_SOURCES_KEY],
  };
  g[MANIFEST_KEY] = '{}';
  g[ENGINE_KEY] = 'v2';
  g[V2_ENGINE_KEY] = {
    transformFile: () => {
      throw new Error('engine must not be called for unknown paths');
    },
  };
  g[V2_SENT_SOURCES_KEY] = new Map<string, string>();
});

afterEach(() => {
  Object.assign(g, saved);
});

function runLoader(
  relPath: string,
  source: string,
  options: { strict?: boolean; cssImportTarget?: string } = {}
): string {
  const ctx = {
    resourcePath: join(ROOT, relPath),
    rootContext: ROOT,
    getOptions: () => options,
  };
  return animusLoader.call(ctx, source);
}

describe('default root-entry detection', () => {
  test('injects the CSS import in app/layout.tsx', () => {
    const out = runLoader('app/layout.tsx', 'export default function L() {}\n');
    expect(out.startsWith(CSS_IMPORT)).toBe(true);
  });

  test('injects after a "use client" directive', () => {
    const out = runLoader(
      'src/app/layout.tsx',
      "'use client'\nexport default function L() {}\n"
    );
    expect(out).toBe(
      "'use client'\nimport '.animus/styles.css';\nexport default function L() {}\n"
    );
  });

  test('strips the emitter CSS import from non-root files', () => {
    const out = runLoader(
      'app/page.tsx',
      `${CSS_IMPORT}export default function P() {}\n`
    );
    expect(out).toBe('export default function P() {}\n');
  });
});

describe('cssImportTarget option', () => {
  test('injects only in the configured target', () => {
    const target = 'src/app/[locale]/layout.tsx';
    const out = runLoader('src/app/[locale]/layout.tsx', 'export {};\n', {
      cssImportTarget: target,
    });
    expect(out.startsWith(CSS_IMPORT)).toBe(true);
  });

  test('replaces the default detection — app/layout.tsx no longer injects', () => {
    const out = runLoader('app/layout.tsx', 'export {};\n', {
      cssImportTarget: 'src/app/[locale]/layout.tsx',
    });
    expect(out).toBe('export {};\n');
  });

  test('tolerates a leading ./ in the configured path', () => {
    const out = runLoader('app/root.tsx', 'export {};\n', {
      cssImportTarget: './app/root.tsx',
    });
    expect(out.startsWith(CSS_IMPORT)).toBe(true);
  });
});
