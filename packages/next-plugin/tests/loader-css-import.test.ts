import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  engineApi,
  joinSession,
  sessionKey,
  setEngineFactoryLoaderForTests,
} from '../../extract/session/singleton';
import {
  publishRecord,
  resetAnimusGlobals,
} from '../../extract/tests/session/session-fixtures';
import animusLoader from '../src/loader';

import type { LoaderPolicyOptions } from '../src/loader-core';
import type { ExtractorEngine } from '@animus-ui/extract/pipeline';

let restoreGlobals: () => void;

const ROOT = '/proj';
const CSS_IMPORT = "import '.animus/styles.css';\n";

/** A native module whose engine analyzed nothing and is never called for
 *  a path outside that analysis. */
const unreachableNative = {
  ExtractEngine: class implements ExtractorEngine {
    prepare(): string {
      return '{}';
    }
    analyzePrepared(): string {
      return '{}';
    }
    transformFile(): string {
      throw new Error('engine must not be called for unknown paths');
    }
    clearCache(): void {
      throw new Error('engine must not be called for unknown paths');
    }
  },
};

const BUILD = 'loader-css-import';

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
  const state = joinSession(sessionKey(BUILD, ROOT), 'animus-next', {
    system: './src/ds.ts',
  });
  publishRecord(state, { manifestJson: '{}' });
  setEngineFactoryLoaderForTests(() => unreachableNative);
  // An analysis of no files: every path the loader sees is outside it.
  engineApi(sessionKey(BUILD, ROOT)).analyzeProject(
    '[]',
    '{}',
    '{}',
    null,
    '{}',
    '{}',
    '{}',
    false,
    '{}'
  );
});

afterEach(() => {
  setEngineFactoryLoaderForTests(null);
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
