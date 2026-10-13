/**
 * @vitest-environment node
 */
import { mkdirSync, symlinkSync } from 'fs';
import { join } from 'path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { probeEnginePrerequisites } from '../../../extract/tests/engine-prerequisites';
import {
  componentSource,
  createDevFixture,
  systemSource,
  themeSource,
} from './fixture';
import { createWatcherBarrier, renderTrace, until } from './scenario';
import { createViteDevAdapter } from './vite-adapter';

import type { DevFixture } from './fixture';
import type { DevServerAdapter } from './scenario';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const prerequisites = probeEnginePrerequisites();
/** Where bun installs a package, linked from `node_modules/acme-kit`: the
 *  watcher reports this path, and its `@` and `+` are glob syntax. */
const KIT = 'node_modules/.bun/acme-kit@1.0.0+ab12/node_modules/acme-kit';

let fixture: DevFixture;
let adapter: DevServerAdapter;
let barrier: () => Promise<void>;

beforeAll(async () => {
  if (!prerequisites.ok) return;
  fixture = createDevFixture();
  fixture.write(
    'package.json',
    JSON.stringify({
      name: 'animus-dev-server-fixture',
      private: true,
      type: 'module',
      dependencies: { 'acme-kit': '1.0.0' },
    })
  );
  fixture.write(
    `${KIT}/package.json`,
    JSON.stringify({
      name: 'acme-kit',
      version: '1.0.0',
      type: 'module',
      exports: {
        '.': { animus: './src/index.ts', import: './dist/index.js' },
        './definition': { animus: './src/ds.ts', import: './dist/ds.js' },
      },
    })
  );
  fixture.write(`${KIT}/src/theme.ts`, themeSource('#123456'));
  fixture.write(`${KIT}/src/ds.ts`, systemSource('kit'));
  fixture.write(
    `${KIT}/src/Card.ts`,
    componentSource('Card', 'section', '12px')
  );
  fixture.write(`${KIT}/src/index.ts`, `export { Card } from './Card';\n`);
  fixture.write(`${KIT}/dist/index.js`, 'export const Card = null;\n');
  fixture.write(`${KIT}/dist/ds.js`, 'export const ds = null;\n');
  fixture.write(`${KIT}/node_modules/dep/index.js`, 'export const dep = 1;\n');
  mkdirSync(join(fixture.root, 'node_modules'), { recursive: true });
  symlinkSync(
    join(fixture.root, KIT),
    join(fixture.root, 'node_modules/acme-kit'),
    'dir'
  );
  // The application's system includes the kit's, so its components extract.
  fixture.write(
    'src/ds.ts',
    `import { createSystem } from '@animus-ui/system';\nimport { ds as kit } from 'acme-kit/definition';\n\nexport { tokens } from './theme';\n\nexport const ds = createSystem().extend(kit).build().seal();\n`
  );
  fixture.write(
    'src/main.ts',
    `import { Card } from 'acme-kit';\nimport { Button } from './Button';\nimport { Sentinel } from './Sentinel';\n\nexport const roots = [Button, Card, Sentinel];\n`
  );
  adapter = createViteDevAdapter();
  await adapter.start(fixture.root);
  barrier = createWatcherBarrier(
    (marker) => fixture.writeSentinel(marker),
    () => adapter.read(),
    () => renderTrace(adapter)
  );
});

afterAll(async () => {
  await adapter?.close();
  fixture?.dispose();
});

/** Contract: Vite ignores every `node_modules` path, so an installed source
 *  kit is watched as ingestion reads it. An edit to its source reaches the
 *  served CSS; its own `node_modules` and `dist` are never watched. */
it('an installed source kit is watched, its own dependencies and dist are not', async (context) => {
  if (!prerequisites.ok) context.skip(prerequisites.reason);
  expect((await adapter.read()).componentCss, renderTrace(adapter)).toContain(
    '12px'
  );

  fixture.write(`${KIT}/node_modules/dep/index.js`, 'export const dep = 2;\n');
  fixture.write(`${KIT}/dist/index.js`, 'export const Card = 1;\n');
  fixture.write(
    `${KIT}/src/Card.ts`,
    componentSource('Card', 'section', '28px')
  );
  await until(
    async () => (await adapter.read()).componentCss.includes('28px') || false,
    {
      what: 'the kit edit in the served component CSS',
      describe: async () =>
        `${(await adapter.read()).componentCss}${renderTrace(adapter)}`,
    }
  );
  await barrier();

  const events = (adapter.trace?.() ?? []).filter((line) =>
    line.includes(' watcher ')
  );
  expect(
    events.filter((line) => /acme-kit\/(node_modules|dist)\//.test(line)),
    renderTrace(adapter)
  ).toEqual([]);
});
