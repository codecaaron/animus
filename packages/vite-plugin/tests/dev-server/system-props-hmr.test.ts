/**
 * @vitest-environment node
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { probeEnginePrerequisites } from '../../../extract/tests/engine-prerequisites';
import { createDevFixture, INITIAL_USAGE_STEP } from './fixture';
import { renderTrace, until } from './scenario';
import { createViteDevAdapter } from './vite-adapter';

import type { DevFixture } from './fixture';
import type { DevServerAdapter } from './scenario';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** A `space` scale step the fixture's usage site does not start on. */
const NEW_USAGE_STEP = 16;

const SYSTEM_PROPS_URL = 'virtual:animus/system-props';

/** Vite's hot-context prelude, which imports the browser's Vite client. */
const HOT_CONTEXT_PRELUDE =
  /^import \{ createHotContext as __vite__createHotContext \} from "\/@vite\/client";import\.meta\.hot = __vite__createHotContext\([^)]*\);/;

type SystemPropMap = Record<string, Record<string, string>>;

/** What the tests read of an evaluated generation. */
interface Generation {
  systemPropMap: SystemPropMap;
}

/** What the served module keeps across its generations. */
interface HotData {
  animusSystemProps?: { signature: string; map: SystemPropMap };
}

/** A generation's hot context, as Vite's client gives each one: its own
 *  callbacks, and the data every generation of the module shares. */
interface HotStub {
  data: HotData;
  callbacks: Array<(next: Generation) => void>;
  invalidated: string[];
  accept(callback: (next: Generation) => void): void;
  invalidate(message: string): void;
}

function hotStub(data: HotData): HotStub {
  const stub: HotStub = {
    data,
    callbacks: [],
    invalidated: [],
    accept: (callback) => stub.callbacks.push(callback),
    invalidate: (message) => stub.invalidated.push(message),
  };
  return stub;
}

declare global {
  /** Each evaluated generation's hot context, by its evaluation index. */
  var __animusTestHot: HotStub[] | undefined;
}

/** Evaluates a served generation with `hot` as its `import.meta.hot`. */
async function evaluate(served: string, hot: HotStub): Promise<Generation> {
  globalThis.__animusTestHot ??= [];
  const index = globalThis.__animusTestHot.push(hot) - 1;
  const source = served.replace(
    HOT_CONTEXT_PRELUDE,
    `import.meta.hot = globalThis.__animusTestHot[${index}];`
  );
  return import(`data:text/javascript,${encodeURIComponent(source)}`);
}

const usage = (steps: number[]) =>
  `import { Box } from './Box';\n\nexport const App = () => <>${steps
    .map((step) => `<Box p={${step}} />`)
    .join('')}</>;\n`;

const prerequisites = probeEnginePrerequisites();

it('system-props HMR prerequisites are materialized', (context) => {
  if (!prerequisites.ok) context.skip(prerequisites.reason);
  expect(prerequisites.reason).toBe('');
});

const suite = prerequisites.ok ? describe : describe.skip;

// Contract: in the browser dev server, a generation of the system prop map
// that only adds entries hot-updates without a reload, through a
// non-accepting importer chain, and the map object components already hold
// gains the entries. A generation that removes an entry, or any generation
// of a project with a class resolver that has system props, is invalidated
// and reaches its importers as it does without the boundary: a mounted
// component may hold the removed entry's class, and an updated module may
// have called a resolver before the map gained what it reads. A resolver
// with no system props is created without the map, so it changes nothing.
suite('the system prop map in the browser dev server', () => {
  let fixture: DevFixture;
  let adapter: DevServerAdapter;

  const updatesSince = (mark: number): string[] =>
    adapter.hotUpdatePaths!().slice(mark);

  /** Writes the usage site and waits for the map it mints. */
  async function serve(steps: number[], present: number, absent?: number) {
    const write = () => fixture.write('src/Usage.tsx', usage(steps));
    write();
    return until(
      async () => {
        const served = (await adapter.read()).systemProps;
        const map = /export const systemPropMap = .*$/m.exec(served)?.[0] ?? '';
        return map.includes(`"${present}"`) &&
          (absent === undefined || !map.includes(`"${absent}"`))
          ? served
          : false;
      },
      {
        what: `the map serving p=${present}${absent === undefined ? '' : ` and not p=${absent}`}`,
        // Each scenario writes this file right after the last one's event,
        // inside chokidar's 50ms per-path change throttle, which drops the
        // write outright where the watcher reports each one (Linux inotify).
        reassert: write,
        describe: async () =>
          `${(await adapter.read()).systemProps}${renderTrace(adapter)}`,
      }
    );
  }

  beforeAll(async () => {
    fixture = createDevFixture();
    fixture.write(
      'src/router.ts',
      "import { Box } from './Box';\n\nexport const router = { Frame: Box };\n"
    );
    fixture.write(
      'src/main.ts',
      "import { router } from './router';\n\nexport const app = router;\n"
    );
    adapter = createViteDevAdapter();
    await adapter.start(fixture.root);
    await adapter.read();
    // The graph a browser holds: entry → router → Box → the map, and the
    // bridge accepting the component sheet.
    await adapter.requestSource('src/main.ts');
    await adapter.requestSource('src/router.ts');
    const box = await adapter.requestSource('src/Box.ts');
    expect(box, box).toContain(SYSTEM_PROPS_URL);
    await adapter.requestUrl('/@id/__x00__virtual:animus/hmr-bridge.js');
  });

  afterAll(async () => {
    await adapter?.close();
    fixture?.dispose();
  });

  it('an added utility value updates the held map without a reload', async () => {
    const data: HotData = {};
    const first = hotStub(data);
    const held = (await evaluate((await adapter.read()).systemProps, first))
      .systemPropMap;
    expect(held.p).toHaveProperty(`${INITIAL_USAGE_STEP}`);
    const mark = adapter.hotUpdatePaths!().length;

    // The first step stays used, so the map only gains the new one.
    const served = await serve(
      [INITIAL_USAGE_STEP, NEW_USAGE_STEP],
      NEW_USAGE_STEP
    );
    await until(
      async () =>
        updatesSince(mark).some((path) => path.includes(SYSTEM_PROPS_URL)),
      {
        what: 'the map delivered as an update',
        describe: async () =>
          `payloads since mark: ${JSON.stringify(updatesSince(mark))}${renderTrace(adapter)}`,
      }
    );
    expect(updatesSince(mark)).not.toContain('full-reload');

    const next = await evaluate(served, hotStub(data));
    first.callbacks.forEach((callback) => callback(next));
    expect(first.invalidated).toEqual([]);
    expect(next.systemPropMap).toBe(held);
    expect(held.p).toHaveProperty(`${NEW_USAGE_STEP}`);
    expect(held.p).toHaveProperty(`${INITIAL_USAGE_STEP}`);
  });

  // geist's docs: their class resolvers style nothing through system props.
  it('a class resolver with no system props leaves an added value in place', async () => {
    fixture.write(
      'src/Card.ts',
      "import { ds } from './ds';\n\nexport const card = ds.styles({ display: 'block' }).asClass();\n"
    );
    await until(
      async () =>
        (await adapter.requestSource('src/Card.ts')).includes(
          'createClassResolver'
        ),
      {
        what: 'the class resolver analyzed',
        describe: async () => renderTrace(adapter),
      }
    );
    const data: HotData = {};
    const first = hotStub(data);
    const held = (
      await evaluate(
        await serve([INITIAL_USAGE_STEP, NEW_USAGE_STEP], NEW_USAGE_STEP),
        first
      )
    ).systemPropMap;

    const added = await evaluate(
      await serve([INITIAL_USAGE_STEP, NEW_USAGE_STEP, 8], 8),
      hotStub(data)
    );
    first.callbacks.forEach((callback) => callback(added));
    expect(first.invalidated).toEqual([]);
    expect(added.systemPropMap).toBe(held);
    expect(held.p).toHaveProperty('8');
  });

  it('a removed utility value, or a class resolver, invalidates the update', async () => {
    const data: HotData = {};
    const first = hotStub(data);
    const held = (
      await evaluate(
        await serve([INITIAL_USAGE_STEP, NEW_USAGE_STEP], NEW_USAGE_STEP),
        first
      )
    ).systemPropMap;
    const before = JSON.stringify(held);

    const removed = await evaluate(
      await serve([NEW_USAGE_STEP], NEW_USAGE_STEP, INITIAL_USAGE_STEP),
      hotStub(data)
    );
    first.callbacks.forEach((callback) => callback(removed));
    expect(first.invalidated).toHaveLength(1);
    expect(removed.systemPropMap).not.toBe(held);
    expect(JSON.stringify(held)).toBe(before);

    // With a class resolver in the project, even an added value invalidates.
    fixture.write(
      'src/Resolver.ts',
      "import { ds } from './ds';\n\nexport const box = ds.styles({}).system({ space: true }).asClass();\n"
    );
    const resolverData: HotData = {};
    const resolverFirst = hotStub(resolverData);
    await until(
      async () => {
        await adapter.read();
        return adapter.trace!().some((line) => line.includes('Resolver.ts'));
      },
      {
        what: 'the class resolver analyzed',
        describe: async () => renderTrace(adapter),
      }
    );
    await evaluate(
      await serve([NEW_USAGE_STEP, 4], NEW_USAGE_STEP),
      resolverFirst
    );
    const added = await evaluate(
      await serve([NEW_USAGE_STEP, 4, 8], 8),
      hotStub(resolverData)
    );
    resolverFirst.callbacks.forEach((callback) => callback(added));
    expect(resolverFirst.invalidated).toHaveLength(1);
  });
});
