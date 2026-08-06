import { join } from 'path';
import { describe, expect, it } from 'vitest';

import {
  RESOLVED_BRIDGE_ID,
  RESOLVED_COMPONENTS_ID,
  RESOLVED_CSS_ID,
  RESOLVED_SYSTEM_PROPS_ID,
  VIRTUAL_BRIDGE_ID,
  VIRTUAL_COMPONENTS_ID,
} from '../src/constants';
import { transformSource } from '../src/transform';

import type { CssSheets, PluginContext } from '../src/context';

/**
 * The `transform` hook's own contracts, driven through the hook body with a
 * canned engine (the injected-fn seam — `vi.mock` is a no-op in this repo's
 * runner).
 *
 * Two of them are about what the hook must NOT do:
 * - the plugin's OWN virtual modules pass back through `transform`, and they
 *   are not source files: registering them would seed permanent `\0` keys in
 *   `fileCache` (which `pruneFileCache` can never remove, since no watcher
 *   event ever names them) and buy a full spurious re-analysis each;
 * - the HMR bridge is delivered by `transformIndexHtml` (openspec:
 *   dev-stylesheet-management, "HMR bridge auto-injected in dev mode"), so the
 *   transform emitter must not import it.
 */

interface TransformProbe {
  ctx: PluginContext;
  analyses: number;
  extractedInvalidations: number;
  infoLines: string[];
  verboseLines: string[];
}

const ROOT = join('/tmp', 'animus-transform-root');

const SHEETS: CssSheets = {
  declaration: '',
  global: '',
  base: '.animus-Button-abc{color:red}',
  variants: '',
  compounds: '',
  states: '',
  system: '',
  custom: '',
};

function makeProbe(
  options: {
    knownFiles?: Record<string, string[]>;
    /** Component ids the next analysis attributes to each file it discovers. */
    discoversOnAnalysis?: Record<string, string[]>;
  } = {}
): TransformProbe {
  const probe = {
    analyses: 0,
    extractedInvalidations: 0,
    infoLines: [] as string[],
    verboseLines: [] as string[],
  };
  const ctx = {
    isProd: false,
    verbose: false,
    rootDir: ROOT,
    options: {},
    externalPackageDirs: [] as string[],
    externalDirOwners: {},
    externalFileOwners: {},
    fileCache: new Map<string, { hash: string; source: string }>(),
    storedManifest: { components: {}, files: options.knownFiles ?? {} },
    storedManifestJson: '{}',
    storedSheets: SHEETS,
    // The system-props module's inputs, republished by every analysis.
    storedSystemPropMapJson: '{}',
    storedDynamicPropsJson: '{}',
    storedTransformsSource: '{}',
    system: { groupRegistryJson: '{}' },
    engineApi: () => ({
      transformFile: () => ({ hasComponents: true, code: 'TRANSFORMED' }),
    }),
    runAnalysis() {
      probe.analyses++;
      Object.assign(
        ctx.storedManifest.files,
        options.discoversOnAnalysis ?? {}
      );
    },
    invalidateExtractedModules() {
      probe.extractedInvalidations++;
    },
    log(msg: string) {
      probe.verboseLines.push(msg);
    },
    info(msg: string) {
      probe.infoLines.push(msg);
    },
    warn() {},
  };
  return {
    ctx: ctx as unknown as PluginContext,
    get analyses() {
      return probe.analyses;
    },
    get extractedInvalidations() {
      return probe.extractedInvalidations;
    },
    get infoLines() {
      return probe.infoLines;
    },
    get verboseLines() {
      return probe.verboseLines;
    },
  };
}

describe('transform: the plugin never treats its own virtual modules as sources', () => {
  // Both `.js`-suffixed resolved ids pass the `/\.[jt]sx?$/` extension gate on
  // their raw text, which is exactly why the `\0` guard has to come first.
  const VIRTUAL_IDS = [
    RESOLVED_COMPONENTS_ID,
    RESOLVED_BRIDGE_ID,
    RESOLVED_CSS_ID,
    RESOLVED_SYSTEM_PROPS_ID,
    VIRTUAL_COMPONENTS_ID,
    VIRTUAL_BRIDGE_ID,
  ];

  it.each(VIRTUAL_IDS)('%j is not transformed, cached, or analyzed', (id) => {
    const probe = makeProbe();

    const result = transformSource(probe.ctx, 'export default ``;', id);

    expect(result).toBeNull();
    expect(probe.analyses).toBe(0);
    expect([...probe.ctx.fileCache.keys()]).toEqual([]);
  });

  it('leaves no `\\0` keys behind after a full virtual-module load pass', () => {
    const probe = makeProbe();

    for (const id of VIRTUAL_IDS) {
      transformSource(probe.ctx, 'export default ``;', id);
    }

    expect(
      [...probe.ctx.fileCache.keys()].filter((key) => key.includes('\0'))
    ).toEqual([]);
    expect(probe.analyses).toBe(0);
  });

  it('still transforms a real source file (the guard is not vacuous)', () => {
    const probe = makeProbe({ knownFiles: { 'src/Button.tsx': ['Button#1'] } });

    const result = transformSource(
      probe.ctx,
      'export const Button = 1;',
      join(ROOT, 'src/Button.tsx')
    );

    expect(result?.code).toContain('TRANSFORMED');
  });
});

describe('transform: the emitter does not import the HMR bridge', () => {
  it('a dev transform of a known component emits no bridge import', () => {
    const probe = makeProbe({ knownFiles: { 'src/Button.tsx': ['Button#1'] } });

    const result = transformSource(
      probe.ctx,
      'export const Button = 1;',
      join(ROOT, 'src/Button.tsx')
    );

    expect(result?.code).toBe('TRANSFORMED');
    expect(result?.code).not.toContain(VIRTUAL_BRIDGE_ID);
  });

  it('no transform in a dev session ever carries the bridge specifier', () => {
    const probe = makeProbe({
      knownFiles: {
        'src/Button.tsx': ['Button#1'],
        'src/Card.tsx': ['Card#1'],
      },
    });

    const emitted = ['src/Button.tsx', 'src/Card.tsx', 'src/Button.tsx'].map(
      (rel) =>
        transformSource(probe.ctx, 'export const X = 1;', join(ROOT, rel))?.code
    );

    expect(emitted.every((code) => code === 'TRANSFORMED')).toBe(true);
  });
});

describe('transform: new-file detection logs at the standard level', () => {
  // openspec: hmr-new-file-detection — "New file detection events SHALL be
  // logged at the standard logging level (not verbose-only)."
  it('routes the detection line through the non-verbose channel', () => {
    const probe = makeProbe();

    transformSource(
      probe.ctx,
      'export const New = 1;',
      join(ROOT, 'src/New.tsx')
    );

    expect(probe.analyses).toBe(1);
    expect(probe.infoLines).toEqual([
      'New file detected: src/New.tsx — no components',
    ]);
    expect(probe.verboseLines.join('\n')).not.toContain('New file detected');
  });
});

describe('transform: new-file invalidation is unconditional', () => {
  // openspec: hmr-new-file-detection, "CSS invalidation after new file
  // analysis" — the component CSS AND the system props module are both
  // invalidated on creation, with no content condition on either. A client
  // reload does not rescue a module that was never invalidated: Vite keeps
  // serving its cached transform result.
  it('invalidates even when the system-props inputs did not move', () => {
    const probe = makeProbe({
      discoversOnAnalysis: { 'src/New.tsx': ['New#1'] },
    });

    transformSource(
      probe.ctx,
      'export const New = 1;',
      join(ROOT, 'src/New.tsx')
    );

    expect(probe.analyses).toBe(1);
    expect(probe.ctx.storedSystemPropMapJson).toBe('{}');
    expect(probe.ctx.storedDynamicPropsJson).toBe('{}');
    expect(probe.extractedInvalidations).toBe(1);
  });

  it('invalidates nothing when the new file yields no components', () => {
    const probe = makeProbe();

    transformSource(
      probe.ctx,
      'export const notAComponent = 1;',
      join(ROOT, 'src/Plain.ts')
    );

    expect(probe.analyses).toBe(1);
    expect(probe.extractedInvalidations).toBe(0);
  });
});
