/**
 * @vitest-environment node
 *
 * Build strictness in development: a classified unsupported declaration warns
 * by default, and under explicit strictness surfaces an error without
 * publishing the rejected analysis, then recovers after a valid edit.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { probeEnginePrerequisites } from '../../../extract/tests/engine-prerequisites';
import { componentSource, createDevFixture } from './fixture';
import { renderTrace, until } from './scenario';
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

suite.each([
  ['omitted', undefined],
  ['false', false],
] as const)('development with %s strictness', (_label, strict) => {
  let fixture: DevFixture;
  let adapter: DevServerAdapter;

  beforeAll(async () => {
    fixture = createDevFixture();
    adapter = createViteDevAdapter(strict === undefined ? {} : { strict });
    await adapter.start(fixture.root);
  });

  afterAll(async () => {
    await adapter?.close();
    fixture?.dispose();
  });

  it('an unsupported declaration warns with its code and the server keeps publishing', async () => {
    fixture.write('src/Button.ts', wholeAxisButtonSource('41px'));

    const warning = await until(
      () =>
        adapter.trace!().find(
          (line) => line.includes('log.warn') && line.includes(CODE)
        ) ?? false,
      {
        what: `a warning carrying ${CODE}`,
        reassert: () =>
          fixture.write('src/Button.ts', wholeAxisButtonSource('41px')),
        describe: () => renderTrace(adapter),
      }
    );
    expect(warning).toMatch(/⚠ src\/Button\.ts:\d+:\d+: Button not extracted/);
    expect(warning).toContain('src/Button.ts');

    // A later edit still publishes beside the unsupported declaration.
    fixture.writeSentinel('42px');
    const served = await until(
      async () => {
        const current = await adapter.read();
        return current.componentCss.includes('42px') ? current : false;
      },
      {
        what: 'the sentinel edit publishes beside the unsupported Button',
        reassert: () => fixture.writeSentinel('42px'),
        describe: async () =>
          `component CSS:\n${(await adapter.read()).componentCss}${renderTrace(adapter)}`,
      }
    );
    expect(served.componentCss).not.toContain('41px');
    expect(adapter.hotErrors!()).toEqual([]);
  });
});

suite('development with explicit true strictness', () => {
  let fixture: DevFixture;
  let adapter: DevServerAdapter;

  beforeAll(async () => {
    fixture = createDevFixture();
    adapter = createViteDevAdapter({ strict: true });
    await adapter.start(fixture.root);
  });

  afterAll(async () => {
    await adapter?.close();
    fixture?.dispose();
  });

  it('an unsupported edit surfaces an error and publishes nothing from it', async () => {
    const before = await adapter.read();
    expect(before.componentCss).toContain('8px');

    fixture.write('src/Button.ts', wholeAxisButtonSource('43px'));

    const error = await until(
      () =>
        adapter.hotErrors!().find((message) => message.includes(CODE)) ?? false,
      {
        what: `an error payload carrying ${CODE}`,
        reassert: () =>
          fixture.write('src/Button.ts', wholeAxisButtonSource('43px')),
        describe: () =>
          `errors: ${JSON.stringify(adapter.hotErrors!())}${renderTrace(adapter)}`,
      }
    );
    expect(error).toContain('[animus] strict');
    expect(error).toContain('Button');
    expect(error).toContain('src/Button.ts');

    const after = await adapter.read();
    expect(after.componentCss).toEqual(before.componentCss);
    expect(after.componentCss).not.toContain('43px');
  });

  it('a valid edit recovers without a restart', async () => {
    fixture.write('src/Button.ts', componentSource('Button', 'button', '44px'));

    await until(
      async () => (await adapter.read()).componentCss.includes('44px') || false,
      {
        what: 'the repaired Button publishes',
        reassert: () =>
          fixture.write(
            'src/Button.ts',
            componentSource('Button', 'button', '44px')
          ),
        describe: async () =>
          `component CSS:\n${(await adapter.read()).componentCss}${renderTrace(adapter)}`,
      }
    );
    expect((await adapter.read()).componentCss).not.toContain('43px');
  });
});
