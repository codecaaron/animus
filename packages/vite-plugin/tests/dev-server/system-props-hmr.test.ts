/**
 * @vitest-environment node
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { probeEnginePrerequisites } from '../../../extract/tests/engine-prerequisites';
import { createDevFixture, INITIAL_USAGE_STEP, usageSource } from './fixture';
import { renderTrace, until } from './scenario';
import { createViteDevAdapter } from './vite-adapter';

import type { DevFixture } from './fixture';
import type { DevServerAdapter } from './scenario';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** A `space` scale step the fixture's usage site does not start on. */
const NEW_USAGE_STEP = 16;

const SYSTEM_PROPS_URL = 'virtual:animus/system-props';

const prerequisites = probeEnginePrerequisites();

it('system-props HMR prerequisites are materialized', (context) => {
  if (!prerequisites.ok) context.skip(prerequisites.reason);
  expect(prerequisites.reason).toBe('');
});

const suite = prerequisites.ok ? describe : describe.skip;

// Contract: a new utility value hot-updates without a reload, through a
// non-accepting importer chain. The map's importer here reaches the entry
// through a router module exporting an object, which accepts nothing, as an
// app's router does; without a boundary of its own the map's update reloads
// the page.
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

  it('a new utility value updates the map without a reload', async () => {
    const before = await adapter.read();
    expect(before.systemProps).toContain(`"${INITIAL_USAGE_STEP}"`);
    const mark = adapter.hotUpdatePaths!().length;

    fixture.write('src/Usage.tsx', usageSource(NEW_USAGE_STEP));

    await until(
      async () =>
        (await adapter.read()).systemProps.includes(`"${NEW_USAGE_STEP}"`) &&
        updatesSince(mark).some((path) => path.includes(SYSTEM_PROPS_URL)),
      {
        what: `the map's p=${NEW_USAGE_STEP} utility, delivered as an update`,
        describe: async () =>
          `payloads since mark: ${JSON.stringify(updatesSince(mark))}${renderTrace(adapter)}`,
      }
    );
    expect(updatesSince(mark)).not.toContain('full-reload');
  });
});
