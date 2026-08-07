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
import { makeContextProbe } from './context-probe';

import type { CssSheets } from '../src/context';
import type { ContextProbe } from './context-probe';

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
    isProd?: boolean;
    engineOutput?: string;
  } = {}
): ContextProbe {
  const probe = makeContextProbe(ROOT, {
    isProd: options.isProd ?? false,
    externalDirOwners: {},
    externalFileOwners: {},
    storedManifest: { components: {}, files: options.knownFiles ?? {} },
    storedManifestJson: '{}',
    storedSheets: SHEETS,
    engineApi: () => ({
      transformFile: () => ({
        hasComponents: true,
        code: options.engineOutput ?? 'TRANSFORMED',
      }),
    }),
  });
  const ctx = probe.ctx as unknown as {
    storedManifest: { files: Record<string, string[]> };
    runAnalysis: () => void;
  };
  ctx.runAnalysis = () => {
    probe.analyses++;
    Object.assign(ctx.storedManifest.files, options.discoversOnAnalysis ?? {});
  };
  return probe;
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

describe('transform: dev output carries the bridge import, prod is engine-verbatim', () => {
  it('every dev component transform prepends exactly one bridge import', () => {
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

    // Unconditional per transform — the module-graph half of bridge delivery.
    // A re-transform after any invalidation re-adds it, and SSR hosts that
    // never serve index.html receive it through hydrated component modules.
    const withBridge = `import '${VIRTUAL_BRIDGE_ID}';\nTRANSFORMED`;
    expect(emitted).toEqual([withBridge, withBridge, withBridge]);
  });

  it('production output is the engine output verbatim', () => {
    const probe = makeProbe({
      knownFiles: { 'src/Button.tsx': ['Button#1'] },
      isProd: true,
    });

    const emitted = transformSource(
      probe.ctx,
      'export const X = 1;',
      join(ROOT, 'src/Button.tsx')
    )?.code;

    expect(emitted).toBe('TRANSFORMED');
    expect(emitted).not.toContain(VIRTUAL_BRIDGE_ID);
  });
});

describe('transform: dependencies resolved outside the root are not new files', () => {
  // Vite realpaths module ids, so a workspace-SYMLINKED package's dist file
  // reaches `transform` as a real path with no `node_modules` segment — the
  // dependency filter never sees it. Treating it as a project file created
  // after buildStart buys a full spurious re-analysis, an unconditional
  // invalidation of both virtual modules, and a client full-reload per dist
  // chunk on the first dev request that imports the package (observed in the
  // dev lane: `New file detected: ../../home/runner/.../dist/index.js`).
  it('an out-of-root dist file is not cached, analyzed, or invalidated', () => {
    const probe = makeProbe();

    const result = transformSource(
      probe.ctx,
      'export const dist = 1;',
      join('/tmp', 'animus-workspace', 'packages/system/dist/index.js')
    );

    expect(result).toBeNull();
    expect(probe.analyses).toBe(0);
    expect([...probe.ctx.fileCache.keys()]).toEqual([]);
    expect(probe.extractedInvalidations).toBe(0);
  });

  it('a declared external package file outside the root is still folded in', () => {
    // The one legitimate out-of-root population: `.includes()`-declared DS
    // packages resolve to workspace directories beyond the app root, and
    // their newly created files must keep flowing through new-file detection.
    const externalDir = join('/tmp', 'animus-workspace', 'ui-kit/dist');
    const probe = makeProbe();
    probe.ctx.externalPackageDirs.push(externalDir);

    transformSource(
      probe.ctx,
      'export const Kit = 1;',
      join(externalDir, 'index.js')
    );

    expect(probe.analyses).toBe(1);
    expect(probe.extractedInvalidations).toBe(1);
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
  // analysis" — the argument is on `invalidateExtractedModules` in src/context.ts.
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

  it('invalidates even when the new file yields no components of its own', () => {
    // A usage-only file (<Box p={16} /> and nothing else) mints utility
    // classes and moves the system-prop map without defining a component —
    // and a non-invalidated virtual module is served from Vite's cache for
    // the life of the server, page reloads included.
    const probe = makeProbe();

    transformSource(
      probe.ctx,
      'export const notAComponent = 1;',
      join(ROOT, 'src/Plain.ts')
    );

    expect(probe.analyses).toBe(1);
    expect(probe.extractedInvalidations).toBe(1);
  });

  it('inserts the bridge import below a directive prologue', () => {
    // The engine hoists 'use client'/'use strict' to byte 0; an import above
    // them would demote the directives to plain expression statements and
    // silently un-mark client modules on RSC-capable hosts.
    const probe = makeProbe({
      knownFiles: { 'src/Client.tsx': ['Client#1'] },
      engineOutput: `'use client';\n'use strict';\nTRANSFORMED`,
    });

    const emitted = transformSource(
      probe.ctx,
      'export const X = 1;',
      join(ROOT, 'src/Client.tsx')
    )?.code;

    expect(emitted).toBe(
      `'use client';\n'use strict';\nimport '${VIRTUAL_BRIDGE_ID}';\nTRANSFORMED`
    );
  });
});
