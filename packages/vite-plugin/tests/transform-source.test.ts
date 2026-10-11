import { ENGINE_TRANSFORM_EXTENSIONS } from '@animus-ui/extract/pipeline';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
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
import { makeContextProbe, makeEnvGraph, published } from './context-probe';
import { makeComponent, makeManifest } from './manifest-fixture';

import type { ContextProbe } from './context-probe';
import type { ManifestSheets } from '@animus-ui/extract/pipeline';

/**
 * The `transform` hook driven through its body with a canned engine and a
 * scripted Session: `vi.mock` is a no-op in this runner, so both arrive
 * through injected seams.
 */

const ROOT = join('/tmp', 'animus-transform-root');

const SHEETS: ManifestSheets = {
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
    storedManifest: makeManifest({ files: options.knownFiles ?? {} }),
    storedManifestJson: '{}',
    storedSheets: SHEETS,
    engineApi: () => ({
      transformFile: () => ({
        hasComponents: true,
        code: options.engineOutput ?? 'TRANSFORMED',
      }),
    }),
  });
  const ctx = probe.ctx;
  probe.respond(() => {
    Object.assign(ctx.storedManifest!.files, options.discoversOnAnalysis ?? {});
    return [published(probe)];
  });
  return probe;
}

describe('transform: the plugin never treats its own virtual modules as sources', () => {
  // The `.js`-suffixed resolved ids pass the engine-transform file class, so
  // the `\0` guard must come first — a `\0` cache key can never be pruned.
  const VIRTUAL_IDS = [
    RESOLVED_COMPONENTS_ID,
    RESOLVED_BRIDGE_ID,
    RESOLVED_CSS_ID,
    RESOLVED_SYSTEM_PROPS_ID,
    VIRTUAL_COMPONENTS_ID,
    VIRTUAL_BRIDGE_ID,
  ];

  it.each(VIRTUAL_IDS)(
    '%j is not transformed or submitted to the Session',
    async (id) => {
      const probe = makeProbe();

      const result = await transformSource(probe.ctx, 'export default ``;', id);

      expect(result).toBeNull();
      expect(probe.submissions).toEqual([]);
    }
  );

  it('still transforms a real source file (the guard is not vacuous)', async () => {
    const probe = makeProbe({ knownFiles: { 'src/Button.tsx': ['Button#1'] } });

    const result = await transformSource(
      probe.ctx,
      'export const Button = 1;',
      join(ROOT, 'src/Button.tsx')
    );

    expect(result?.code).toContain('TRANSFORMED');
  });
});

describe('transform: the file-class gate is the shared engine-transform set', () => {
  // `ENGINE_TRANSFORM_EXTENSIONS` owns the file class; a driver-local spelling
  // silently skips a whole class on one bundler family.
  it.each([...ENGINE_TRANSFORM_EXTENSIONS])(
    'transforms a manifest-listed local .%s file',
    async (ext) => {
      const rel = `src/Button.${ext}`;
      const probe = makeProbe({ knownFiles: { [rel]: ['Button#1'] } });

      const result = await transformSource(
        probe.ctx,
        'export const Button = 1;',
        join(ROOT, rel)
      );

      expect(result?.code).toContain('TRANSFORMED');
    }
  );

  it('claims nothing outside that set — not even a manifest-listed file', async () => {
    // Native Svelte usage is the live out-of-set case (its projected
    // `.instance.tsx` is what the engine sees), so the gate is not vacuous.
    const probe = makeProbe({
      knownFiles: { 'src/Usage.svelte': ['Usage#1'] },
    });

    expect(
      await transformSource(
        probe.ctx,
        '<script>let x = 1;</script>',
        join(ROOT, 'src/Usage.svelte')
      )
    ).toBeNull();
    expect(probe.submissions).toEqual([]);
  });
});

describe('transform: dev output carries the bridge import, prod is engine-verbatim', () => {
  it('every dev component transform prepends exactly one bridge import', async () => {
    const probe = makeProbe({
      knownFiles: {
        'src/Button.tsx': ['Button#1'],
        'src/Card.tsx': ['Card#1'],
      },
    });

    const emitted = await Promise.all(
      ['src/Button.tsx', 'src/Card.tsx', 'src/Button.tsx'].map(
        async (rel) =>
          (
            await transformSource(
              probe.ctx,
              'export const X = 1;',
              join(ROOT, rel)
            )
          )?.code
      )
    );

    // Unconditional per transform: a re-transform re-adds it, and SSR hosts
    // that never serve index.html receive it through component modules.
    const withBridge = `import '${VIRTUAL_BRIDGE_ID}';\nTRANSFORMED`;
    expect(emitted).toEqual([withBridge, withBridge, withBridge]);
  });

  it('production output is the engine output verbatim', async () => {
    const probe = makeProbe({
      knownFiles: { 'src/Button.tsx': ['Button#1'] },
      isProd: true,
    });

    const emitted = (
      await transformSource(
        probe.ctx,
        'export const X = 1;',
        join(ROOT, 'src/Button.tsx')
      )
    )?.code;

    expect(emitted).toBe('TRANSFORMED');
    expect(emitted).not.toContain(VIRTUAL_BRIDGE_ID);
  });
});

describe('transform: a dropped extension is never served raw', () => {
  // Contract (SA1, spec §12.2 row 11): a file whose extension the analysis
  // dropped over a parent it could not resolve fails its transform in every
  // mode, naming the component, parent and specifier; served untransformed,
  // its builder code would render with empty classes.
  // Mixed: another component of the same file extracted.
  for (const [isProd, mixed] of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ] as const) {
    it(`fails the transform in ${isProd ? 'a build' : 'development'}${mixed ? ' beside an extracted component' : ''}`, async () => {
      const probe = makeContextProbe(ROOT, {
        isProd,
        engineApi: () => ({
          transformFile: () => ({ hasComponents: true, code: 'TRANSFORMED' }),
        }),
        storedManifest: makeManifest({
          files: mixed ? { 'src/Fancy.tsx': ['src/Fancy.tsx::Good'] } : {},
          missing_inputs: [
            {
              file: 'src/Fancy.tsx',
              component: 'Fancy',
              parent: 'Parent',
              specifier: './Parent',
              base: 'src/Parent',
              outcome: 'absent',
            },
          ],
        }),
        storedManifestJson: '{}',
        storedSheets: SHEETS,
      });
      // The Session holds the file, so development does not re-detect it.
      probe.session.heldSources.set('src/Fancy.tsx', { hash: 'h', source: '' });

      await expect(
        transformSource(
          probe.ctx,
          "export const Fancy = Parent.extend().asElement('div');",
          join(ROOT, 'src/Fancy.tsx')
        )
      ).rejects.toThrow(
        "cannot serve src/Fancy.tsx: 'Fancy' extends 'Parent' from './Parent'"
      );
    });
  }
});

describe('transform: dependencies resolved outside the root are not new files', () => {
  // Vite realpaths module ids, so a symlinked package's dist file arrives with
  // no `node_modules` segment and the dependency filter never sees it.
  it('an out-of-root dist file is not submitted or invalidated', async () => {
    const probe = makeProbe();

    const result = await transformSource(
      probe.ctx,
      'export const dist = 1;',
      join('/tmp', 'animus-workspace', 'packages/system/dist/index.js')
    );

    expect(result).toBeNull();
    expect(probe.submissions).toEqual([]);
    expect(probe.extractedInvalidations).toBe(0);
  });

  it('a declared external package file outside the root is still folded in', async () => {
    // Declared DS packages resolve outside the app root, and their new files
    // must still flow through new-file detection.
    const externalDir = join('/tmp', 'animus-workspace', 'ui-kit/dist');
    const probe = makeProbe();
    probe.ctx.externalPackageDirs.push(externalDir);

    await transformSource(
      probe.ctx,
      'export const Kit = 1;',
      join(externalDir, 'index.js')
    );

    expect(probe.submissions).toEqual([
      { modifiedFiles: new Set([join(externalDir, 'index.js')]) },
    ]);
    expect(probe.extractedInvalidations).toBe(1);
  });
});

describe('transform: new-file detection logs at the standard level', () => {
  it('routes the detection line through the non-verbose channel', async () => {
    const probe = makeProbe();

    await transformSource(
      probe.ctx,
      'export const New = 1;',
      join(ROOT, 'src/New.tsx')
    );

    expect(probe.submissions).toHaveLength(1);
    expect(probe.infoLines).toEqual([
      'New file detected: src/New.tsx — no components',
    ]);
    expect(probe.verboseLines.join('\n')).not.toContain('New file detected');
  });
});

describe('transform: new-file invalidation is unconditional', () => {
  it('invalidates even when the system-props inputs did not move', async () => {
    const probe = makeProbe({
      discoversOnAnalysis: { 'src/New.tsx': ['New#1'] },
    });

    await transformSource(
      probe.ctx,
      'export const New = 1;',
      join(ROOT, 'src/New.tsx')
    );

    expect(probe.submissions).toHaveLength(1);
    expect(probe.extractedInvalidations).toBe(1);
  });

  it('invalidates even when the new file yields no components of its own', async () => {
    // A usage-only file mints utility classes without defining a component,
    // and an un-invalidated virtual module is served from cache indefinitely.
    const probe = makeProbe();

    await transformSource(
      probe.ctx,
      'export const notAComponent = 1;',
      join(ROOT, 'src/Plain.ts')
    );

    expect(probe.submissions).toHaveLength(1);
    expect(probe.extractedInvalidations).toBe(1);
  });

  it('re-delivers definitions whose plan changed in the recovery analysis', async () => {
    // A detection re-analysis can resurrect dropped chains in other, already
    // served files; their nodes must be evicted before the reload re-fetches.
    const consumerAbs = join(ROOT, 'src/Fancy.tsx');
    const probe = makeProbe();
    const ctx = probe.ctx;
    // The Session reports the plans its publication changed, the detected
    // file's own among them.
    probe.respond(() => [
      published(probe, {
        planChanged: ['src/Fancy.tsx', 'src/New.tsx'],
        manifest: makeManifest({
          ...ctx.storedManifest,
          components: {
            ...ctx.storedManifest!.components,
            'src/Fancy.tsx::Fancy': makeComponent(
              'src/Fancy.tsx',
              "createComponent('div', 'recovered')"
            ),
            'src/New.tsx::New': makeComponent(
              'src/New.tsx',
              "createComponent('div', 'new')"
            ),
          },
          files: {
            ...ctx.storedManifest!.files,
            'src/Fancy.tsx': ['src/Fancy.tsx::Fancy'],
            'src/New.tsx': ['src/New.tsx::New'],
          },
        }),
      }),
    ]);
    const graph = makeEnvGraph({ rootDir: ROOT, file: 'src/Fancy.tsx' });
    const invalidated = graph.invalidated;
    ctx.devServer = {
      environments: {
        client: { moduleGraph: graph.moduleGraph },
      },
    };

    await transformSource(
      probe.ctx,
      'export const New = 1;',
      join(ROOT, 'src/New.tsx')
    );

    // The detected file is not self-invalidated: its in-flight transform is
    // the current serve.
    expect(invalidated).toEqual([consumerAbs]);
    expect(probe.extractedInvalidations).toBe(1);
  });

  it('fails a new file whose detection failed, and leaves it retryable', async () => {
    // A failed detection is the transform's error, never a raw serve (SA1),
    // and must not register the file, or the next transform skips detection
    // forever.
    const probe = makeProbe();
    probe.respond(() => {
      throw new Error('planned analysis failure');
    });

    await expect(
      transformSource(
        probe.ctx,
        'export const New = 1;',
        join(ROOT, 'src/New.tsx')
      )
    ).rejects.toThrow(/analysis of the new file src\/New\.tsx failed/);
    expect(probe.session.heldSources.has('src/New.tsx')).toBe(false);
    expect(probe.extractedInvalidations).toBe(0);

    await expect(
      transformSource(
        probe.ctx,
        'export const New = 1;',
        join(ROOT, 'src/New.tsx')
      )
    ).rejects.toThrow();
    expect(probe.submissions).toHaveLength(2);
  });

  it('stabilizes interdependent new files found on disk during detection', async () => {
    // A detected file can extend another undiscovered file: reconciliation
    // folds the on-disk base and re-analyzes before the result is served.
    const root = mkdtempSync(join(tmpdir(), 'animus-transform-stab-'));
    try {
      writeFileSync(
        join(root, 'Base.tsx'),
        "export const Base = ds.styles({}).asElement('div');\n"
      );
      const probe = makeContextProbe(root, {
        extensionsSet: new Set(['.ts', '.tsx']),
        storedManifest: makeManifest(),
        storedManifestJson: '{}',
        storedSheets: SHEETS,
        engineApi: () => ({
          transformFile: () => ({ hasComponents: true, code: 'TRANSFORMED' }),
        }),
      });
      probe.respond(() => {
        if (probe.submissions.length === 1) {
          return [
            published(probe, {
              manifest: makeManifest({
                missing_inputs: [
                  {
                    file: 'New.tsx',
                    component: 'Child',
                    parent: 'Base',
                    specifier: './Base',
                    base: 'Base',
                    outcome: 'absent',
                  },
                ],
              }),
            }),
          ];
        }
        return [
          published(probe, {
            manifest: makeManifest({
              components: {
                'Base.tsx::Base': makeComponent('Base.tsx', 'rb'),
                'New.tsx::Child': makeComponent('New.tsx', 'rc'),
              },
              files: {
                'Base.tsx': ['Base.tsx::Base'],
                'New.tsx': ['New.tsx::Child'],
              },
            }),
          }),
        ];
      });

      const result = await transformSource(
        probe.ctx,
        'export const Child = 1;',
        join(root, 'New.tsx')
      );

      // The fold submits the on-disk base the Session does not hold.
      expect(probe.submissions).toEqual([
        { modifiedFiles: new Set([join(root, 'New.tsx')]) },
        { modifiedFiles: new Set([join(root, 'Base.tsx')]) },
      ]);
      // The consumer-of-a-consumer serve is extracted on the first response.
      expect(result?.code).toContain('TRANSFORMED');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('inserts the bridge import below a directive prologue', async () => {
    // An import above a directive prologue demotes the directives to plain
    // expression statements and silently un-marks client modules on RSC hosts.
    const probe = makeProbe({
      knownFiles: { 'src/Client.tsx': ['Client#1'] },
      engineOutput: `'use client';\n'use strict';\nTRANSFORMED`,
    });

    const emitted = (
      await transformSource(
        probe.ctx,
        'export const X = 1;',
        join(ROOT, 'src/Client.tsx')
      )
    )?.code;

    expect(emitted).toBe(
      `'use client';\n'use strict';\nimport '${VIRTUAL_BRIDGE_ID}';\nTRANSFORMED`
    );
  });
});
