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

// Contract: in the browser dev server the system prop map module accepts no
// update of its own: a new utility value reaches the client as an update of
// the map's importers, here a reload, since the map's importer reaches the
// entry through a router object that accepts nothing. Taking the map in
// place re-stamped its stateful importers, so an edited module re-imported a
// provider under consumers that kept the old one.
suite('the system prop map in the browser dev server', () => {
  let fixture: DevFixture;
  let adapter: DevServerAdapter;

  const updatesSince = (mark: number): string[] =>
    adapter.hotUpdatePaths!().slice(mark);

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

  it("a new utility value reaches the map's importers, not the map alone", async () => {
    const before = await adapter.read();
    expect(before.systemProps).toContain(`"${INITIAL_USAGE_STEP}"`);
    expect(before.systemProps).not.toContain('import.meta.hot');
    const mark = adapter.hotUpdatePaths!().length;

    // The first step stays used, so the map only gains the new one.
    const write = () =>
      fixture.write(
        'src/Usage.tsx',
        usage([INITIAL_USAGE_STEP, NEW_USAGE_STEP])
      );
    write();
    await until(
      async () =>
        (await adapter.read()).systemProps.includes(`"${NEW_USAGE_STEP}"`) &&
        updatesSince(mark).includes('full-reload'),
      {
        what: `the map's p=${NEW_USAGE_STEP} utility, delivered by a reload`,
        // A write right after the last event lands inside chokidar's 50ms
        // per-path change throttle, which drops it on Linux.
        reassert: write,
        describe: async () =>
          `payloads since mark: ${JSON.stringify(updatesSince(mark))}${renderTrace(adapter)}`,
      }
    );
    expect(
      updatesSince(mark).filter((path) => path.includes(SYSTEM_PROPS_URL))
    ).toEqual([]);
  });
});
