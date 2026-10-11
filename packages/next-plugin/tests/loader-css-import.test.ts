import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { joinSession, sessionKey } from '../../extract/session/singleton';
import { resetAnimusGlobals } from '../../extract/tests/session/session-fixtures';
import animusLoader from '../src/loader';

import type { LoaderPolicyOptions } from '../src/loader-core';
import type { V2ExtractEngine } from '@animus-ui/extract/pipeline';

let restoreGlobals: () => void;

const ROOT = '/proj';
const CSS_IMPORT = "import '.animus/styles.css';\n";

const unreachableEngine: V2ExtractEngine = {
  analyze: () => {
    throw new Error('engine must not be called for unknown paths');
  },
  transformFile: () => {
    throw new Error('engine must not be called for unknown paths');
  },
  clearCache: () => {
    throw new Error('engine must not be called for unknown paths');
  },
};

const BUILD = 'loader-css-import';

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
  const state = joinSession(sessionKey(BUILD, ROOT), 'animus-next', {
    system: './src/ds.ts',
  });
  state.manifestJson = '{}';
  state.engine = unreachableEngine;
  state.sentSources = new Map<string, string>();
});

afterEach(() => {
  restoreGlobals();
});

function runLoader(
  relPath: string,
  source: string,
  options: LoaderPolicyOptions = {}
): string {
  const ctx = {
    resourcePath: join(ROOT, relPath),
    rootContext: ROOT,
    getOptions: () => ({ build: BUILD, root: ROOT, ...options }),
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
