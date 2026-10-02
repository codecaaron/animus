/**
 * @vitest-environment node
 *
 * An extension's extracted config reads the callbacks it inherits from its
 * parent component when the extending module runs. An edit to state private to
 * the parent's module changes no served plan, so every module defining an
 * extension of it must be delivered again with the parent, published edits
 * held behind a failed parse included.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { probeEnginePrerequisites } from '../../../extract/tests/engine-prerequisites';
import { componentSource, createDevFixture } from './fixture';
import { renderTrace, until } from './scenario';
import { createViteDevAdapter } from './vite-adapter';

import type { DevFixture } from './fixture';
import type { DevServerAdapter } from './scenario';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** Each module accepts its own update, as a React Refresh boundary does. */
const ACCEPT = 'import.meta.hot?.accept();\n';

function parentsSource(step: number): string {
  return `import { ds } from './ds';

const STEP = ${step};

export const Parent = ds
  .props({ inl: { property: 'minWidth', transform: (v) => \`\${Number(v) * STEP}px\` } })
  .asElement('div');
export const Near = Parent.extend().asElement('div');
${ACCEPT}`;
}

const CHILDREN = `import { Parent as Base } from './parents';

export const Child = Base.extend().asElement('div');
export const Grand = Child.extend().asElement('div');
${ACCEPT}`;

const GRAND = `import { Grand } from './children';

export const GreatGrand = Grand.extend().asElement('div');
${ACCEPT}`;

const EXTENDING = ['src/children.ts', 'src/grand.ts'];

/** Whether a hot payload path names the project file. */
const names = (sent: string, path: string): boolean =>
  sent.endsWith(path.slice('src'.length));

/** The unrelated module whose broken edit holds publication. */
const sentinelSource = (): string =>
  componentSource('Sentinel', 'aside', '2px') + ACCEPT;

const withoutTimestamps = (code: string): string =>
  code.replace(/[?&]t=\d+/g, '');

const prerequisites = probeEnginePrerequisites();

it('inherited callback refresh prerequisites are materialized', (context) => {
  if (!prerequisites.ok) context.skip(prerequisites.reason);
  expect(prerequisites.reason).toBe('');
});

const suite = prerequisites.ok ? describe : describe.skip;

suite('a parent edit that changes no served plan', () => {
  let fixture: DevFixture;
  let adapter: DevServerAdapter;
  const served: Record<string, string> = {};

  const updatesSince = (mark: number): string[] =>
    adapter.hotUpdatePaths!().slice(mark);

  /** Writes `parents.ts` and resolves with the hot updates up to its own. */
  async function editParents(step: number): Promise<string[]> {
    const mark = adapter.hotUpdatePaths!().length;
    const write = () => fixture.write('src/parents.ts', parentsSource(step));
    write();
    return until(
      () => {
        const paths = updatesSince(mark);
        return paths.some((path) => path.endsWith('/parents.ts'))
          ? paths
          : false;
      },
      {
        what: `parents.ts update for STEP ${step}`,
        reassert: write,
        describe: () =>
          `payloads since mark: ${JSON.stringify(updatesSince(mark))}${renderTrace(adapter)}`,
      }
    );
  }

  beforeAll(async () => {
    fixture = createDevFixture();
    fixture.write('src/parents.ts', parentsSource(3));
    fixture.write('src/children.ts', CHILDREN);
    fixture.write('src/grand.ts', GRAND);
    fixture.write('src/Sentinel.ts', sentinelSource());
    adapter = createViteDevAdapter();
    await adapter.start(fixture.root);
    // The bridge request registers acceptance of the components module, and
    // each request records its module's own acceptance.
    await adapter.read();
    await adapter.requestUrl('/@id/__x00__virtual:animus/hmr-bridge.js');
    await adapter.requestSource('src/main.ts');
    await adapter.requestSource('src/Sentinel.ts');
    for (const path of ['src/parents.ts', ...EXTENDING]) {
      served[path] = await adapter.requestSource(path);
    }
  });

  afterAll(async () => {
    await adapter?.close();
    fixture?.dispose();
  });

  it('re-delivers every module extending the parent, at any depth', async () => {
    const paths = await editParents(4);

    for (const path of EXTENDING) {
      expect(
        paths.filter((sent) => names(sent, path)),
        path
      ).toHaveLength(1);
      // Nothing about the extension's own replacement changed; only Vite's
      // import timestamps differ.
      expect(withoutTimestamps(await adapter.requestSource(path))).toEqual(
        withoutTimestamps(served[path])
      );
    }
    expect(paths.filter((sent) => sent.endsWith('/Button.ts'))).toEqual([]);
    expect(paths).not.toContain('full-reload');
  });

  it('re-delivers them when a held parent edit is published', async () => {
    const write = () =>
      fixture.write(
        'src/Sentinel.ts',
        sentinelSource().replace(
          'export const Sentinel = ds',
          'export const Sentinel = ds('
        )
      );
    write();
    await until(
      () =>
        adapter.trace!().some(
          (line) =>
            line.includes('analysis not published') &&
            line.includes('src/Sentinel.ts')
        ) || false,
      {
        what: 'the broken Sentinel edit holds publication',
        reassert: write,
        describe: () => renderTrace(adapter),
      }
    );

    // Held: the parent's valid edit is kept for the repair to publish.
    const held = adapter.hotUpdatePaths!().length;
    const parentEvents = () =>
      adapter.trace!().filter((line) =>
        line.includes('hotUpdate update src/parents.ts')
      ).length;
    const before = parentEvents();
    fixture.write('src/parents.ts', parentsSource(5));
    await until(() => parentEvents() > before || false, {
      what: 'the held parent edit is observed',
      reassert: () => fixture.write('src/parents.ts', parentsSource(5)),
      describe: () => renderTrace(adapter),
    });
    expect(
      updatesSince(held).filter((sent) =>
        EXTENDING.some((path) => names(sent, path))
      )
    ).toEqual([]);

    const repair = () => fixture.write('src/Sentinel.ts', sentinelSource());
    repair();
    const paths = await until(
      () => {
        const sent = updatesSince(held);
        return EXTENDING.every((path) =>
          sent.some((update) => names(update, path))
        )
          ? sent
          : false;
      },
      {
        what: 'extending modules re-delivered with the published parent',
        reassert: repair,
        describe: () =>
          `payloads since hold: ${JSON.stringify(updatesSince(held))}${renderTrace(adapter)}`,
      }
    );
    expect(paths.some((sent) => sent.endsWith('/parents.ts'))).toBe(true);
    expect(paths).not.toContain('full-reload');
  });
});
