/**
 * @vitest-environment node
 *
 * Configured transform bindings in development: a system edit that changes a
 * bound callback republishes the component CSS and the runtime registry entry
 * together under the same binding, and a failed system reload publishes
 * neither.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { probeEnginePrerequisites } from '../../../extract/tests/engine-prerequisites';
import { createDevFixture } from './fixture';
import { renderTrace, until } from './scenario';
import { createViteDevAdapter } from './vite-adapter';

import type { DevFixture } from './fixture';
import type { DevArtifacts, DevServerAdapter } from './scenario';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** `wide` and `tall` share one callable; a project declaration reuses its
 *  readable name. */
function bindingSystemSource(factor: number): string {
  return `import { createSystem, createTransform } from '@animus-ui/system';
import { color, space } from '@animus-ui/system/groups';

export { tokens } from './theme';

const scaled = createTransform('scaled', (v) =>
  typeof v === 'number' ? \`\${v * ${factor}}px\` : v
);

export const ds = createSystem()
  .addGroup('space', space)
  .addGroup('surface', color)
  .addGroup('dims', {
    wide: { property: 'minWidth', transform: scaled },
    tall: { property: 'minHeight', transform: scaled },
  })
  .build()
  .seal();
`;
}

const GAUGE = `import { ds } from './ds';

export const Gauge = ds
  .styles({ wide: 10 })
  .system({ dims: true })
  .asElement('div');
`;

const GAUGE_USAGE = `import { Gauge } from './Gauge';

export const Meter = ({ value }: { value: number }) => (
  <Gauge wide={value} tall={value} />
);
`;

const SAME_NAMED_DECLARATION = `import { createTransform } from '@animus-ui/system';

export const scaled = createTransform('scaled', () => '999px');
`;

type Registry = {
  dynamicPropConfig: Record<string, { transformId?: string }>;
  transforms: Record<string, (value: number) => string>;
};

/** The served registry module, evaluated as the browser would. */
async function registryOf(served: DevArtifacts): Promise<Registry> {
  return import(
    `data:text/javascript,${encodeURIComponent(served.systemProps)}`
  );
}

/** The runtime result of the binding `prop` resolves through. */
async function runtimeValue(
  served: DevArtifacts,
  prop: string,
  value: number
): Promise<string> {
  const { dynamicPropConfig, transforms } = await registryOf(served);
  const id = dynamicPropConfig[prop]?.transformId;
  if (!id) throw new Error(`no binding for ${prop}:\n${served.systemProps}`);
  return transforms[id](value);
}

const prerequisites = probeEnginePrerequisites();

it('dev-server binding prerequisites are materialized', (context) => {
  if (!prerequisites.ok) context.skip(prerequisites.reason);
  expect(prerequisites.reason).toBe('');
});

const suite = prerequisites.ok ? describe : describe.skip;

suite('configured transform bindings in development', () => {
  let fixture: DevFixture;
  let adapter: DevServerAdapter;

  beforeAll(async () => {
    fixture = createDevFixture();
    fixture.write('src/ds.ts', bindingSystemSource(2));
    fixture.write('src/Gauge.ts', GAUGE);
    fixture.write('src/Meter.tsx', GAUGE_USAGE);
    // Sorts after ds.ts, the position where a same-named declaration won.
    fixture.write('src/zz-decoy.ts', SAME_NAMED_DECLARATION);
    adapter = createViteDevAdapter();
    await adapter.start(fixture.root);
  });

  afterAll(async () => {
    await adapter?.close();
    fixture?.dispose();
  });

  it('serves the configured callback on both paths, shared by two props', async () => {
    const served = await adapter.read();
    const { dynamicPropConfig } = await registryOf(served);

    expect(served.componentCss).toContain('min-width: 20px');
    expect(served.componentCss).not.toContain('999px');
    expect(dynamicPropConfig.wide.transformId).toBeDefined();
    expect(dynamicPropConfig.tall.transformId).toBe(
      dynamicPropConfig.wide.transformId
    );
    expect(await runtimeValue(served, 'wide', 13)).toBe('26px');
    expect(await runtimeValue(served, 'tall', 13)).toBe('26px');
  });

  it('a callback edit republishes CSS and the callable under the same binding', async () => {
    const before = await adapter.read();
    const { dynamicPropConfig } = await registryOf(before);

    fixture.write('src/ds.ts', bindingSystemSource(3));

    const after = await until(
      async () => {
        const served = await adapter.read();
        return served.componentCss.includes('min-width: 30px') ? served : false;
      },
      {
        what: 'the edited callback reaches the component CSS',
        reassert: () => fixture.write('src/ds.ts', bindingSystemSource(3)),
        describe: async () =>
          `component CSS:\n${(await adapter.read()).componentCss}${renderTrace(adapter)}`,
      }
    );

    expect(after.componentCss).not.toContain('min-width: 20px');
    expect((await registryOf(after)).dynamicPropConfig.wide.transformId).toBe(
      dynamicPropConfig.wide.transformId
    );
    expect(await runtimeValue(after, 'wide', 13)).toBe('39px');
    expect(after.systemPropsRevision).toBeGreaterThan(
      before.systemPropsRevision
    );
  });

  it('a failed system reload publishes neither CSS nor callable', async () => {
    const before = await adapter.read();
    const warnings: string[] = [];
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation((...args: unknown[]) => {
        warnings.push(args.map(String).join(' '));
      });

    try {
      fixture.write('src/ds.ts', 'export const ds = createSystem(\n');

      // The reset invalidates the static module even when the load fails.
      const after = await until(
        async () => {
          const served = await adapter.read();
          return served.staticRevision > before.staticRevision ? served : false;
        },
        {
          what: 'the reset over a broken system is attempted',
          describe: async () =>
            `static revision stuck at ${(await adapter.read()).staticRevision}${renderTrace(adapter)}`,
        }
      );
      expect(
        warnings.some((line) => line.includes('Failed to load system from')),
        JSON.stringify(warnings)
      ).toBe(true);
      expect(after.componentCss).toEqual(before.componentCss);
      expect(after.systemProps).toEqual(before.systemProps);
      expect(await runtimeValue(after, 'wide', 13)).toBe('39px');
    } finally {
      warnSpy.mockRestore();
    }

    fixture.write('src/ds.ts', bindingSystemSource(4));
    const repaired = await until(
      async () => {
        const served = await adapter.read();
        return served.componentCss.includes('min-width: 40px') ? served : false;
      },
      {
        what: 'the repaired system republishes',
        reassert: () => fixture.write('src/ds.ts', bindingSystemSource(4)),
        describe: async () =>
          `component CSS:\n${(await adapter.read()).componentCss}${renderTrace(adapter)}`,
      }
    );
    expect(await runtimeValue(repaired, 'wide', 13)).toBe('52px');
  });
});
