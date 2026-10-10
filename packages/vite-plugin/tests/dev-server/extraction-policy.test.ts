/**
 * @vitest-environment node
 *
 * Build strictness in development: a classified unsupported declaration warns
 * by default, and under explicit strictness or an `error` entry it is reported
 * as an error. The dev server keeps publishing either way.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { probeEnginePrerequisites } from '../../../extract/tests/engine-prerequisites';
import { createDevFixture } from './fixture';
import { createWatcherBarrier, renderTrace, until } from './scenario';
import { createViteDevAdapter } from './vite-adapter';

import type { DevFixture } from './fixture';
import type { DevServerAdapter } from './scenario';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const CODE = 'animus.variant.unsupported-config-reference';

/** `Button` with its whole variant config passed through an identifier. */
function wholeAxisButtonSource(padding: string): string {
  return `import { ds } from './ds';

const TONE_AXIS = { prop: 'tone', variants: { quiet: { opacity: 0.5 } } };

export const Button = ds
  .styles({ padding: '${padding}', bg: 'primary' })
  .variant(TONE_AXIS)
  .asElement('button');
`;
}

const prerequisites = probeEnginePrerequisites();

it('dev-server policy prerequisites are materialized', (context) => {
  if (!prerequisites.ok) context.skip(prerequisites.reason);
  expect(prerequisites.reason).toBe('');
});

const suite = prerequisites.ok ? describe : describe.skip;

/** How each level reports the unsupported Button: the trace channel and line. */
const WARNS = {
  channel: 'log.warn',
  line: /⚠ src\/Button\.ts:\d+:\d+: Button not extracted/,
} as const;
const ERRORS = {
  channel: 'log.error',
  line: /\[animus\] strict: 1 error diagnostic\(s\)/,
} as const;

// The level decides only how the record is reported: the dev server keeps
// publishing at every level, and only a build fails.
suite.each([
  ['omitted strictness', {}, WARNS],
  ['false strictness', { strict: false }, WARNS],
  ['true strictness', { strict: true }, ERRORS],
  ['an error entry', { diagnostics: { [CODE]: 'error' } }, ERRORS],
] as const)('development with %s', (_label, pluginOptions, report) => {
  let fixture: DevFixture;
  let adapter: DevServerAdapter;

  beforeAll(async () => {
    fixture = createDevFixture();
    adapter = createViteDevAdapter(pluginOptions);
    await adapter.start(fixture.root);
  });

  afterAll(async () => {
    await adapter?.close();
    fixture?.dispose();
  });

  it('an unsupported declaration is reported with its code and the server keeps publishing', async () => {
    fixture.write('src/Button.ts', wholeAxisButtonSource('41px'));

    const line = await until(
      () =>
        adapter.trace!().find(
          (entry) => entry.includes(report.channel) && entry.includes(CODE)
        ) ?? false,
      {
        what: `a ${report.channel} line carrying ${CODE}`,
        reassert: () =>
          fixture.write('src/Button.ts', wholeAxisButtonSource('41px')),
        describe: () => renderTrace(adapter),
      }
    );
    expect(line).toMatch(report.line);
    expect(line).toContain('src/Button.ts');

    // A later edit still publishes beside the unsupported declaration.
    await createWatcherBarrier(fixture.writeSentinel, adapter.read, () =>
      renderTrace(adapter)
    )();
    expect((await adapter.read()).componentCss).not.toContain('41px');
    expect(adapter.hotErrors!()).toEqual([]);
  });
});
