/**
 * @vitest-environment node
 *
 * While a component edit the parser cannot finish persists, the last
 * successful generation stays served and every later edit is held; the
 * repair publishes them together without a restart — identically in every
 * strictness mode. A recovered parse diagnostic stays a warning.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { probeEnginePrerequisites } from '../../../extract/tests/engine-prerequisites';
import {
  componentSource,
  createDevFixture,
  INITIAL_BRAND_HEX,
  systemSource,
  themeSource,
} from './fixture';
import { renderTrace, until } from './scenario';
import { createViteDevAdapter } from './vite-adapter';

import type { DevFixture } from './fixture';
import type { DevServerAdapter } from './scenario';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const NOT_PUBLISHED = 'analysis not published';

/** The parser stops at `ds(` and yields no facts for the module. */
function brokenCardSource(padding: string): string {
  return componentSource('Card', 'section', padding).replace(
    'export const Card = ds',
    'export const Card = ds('
  );
}

/** A top-level `return` is a diagnostic the parser recovers from. */
function recoveredSource(): string {
  return `${componentSource('Recovered', 'nav', '13px')}return 1;\n`;
}

function warnings(adapter: DevServerAdapter): string[] {
  return adapter.trace!().filter((line) => line.includes('log.warn'));
}

function cardRejections(adapter: DevServerAdapter): string[] {
  return warnings(adapter).filter(
    (line) => line.includes(NOT_PUBLISHED) && line.includes('src/Card.ts')
  );
}

async function describeCss(adapter: DevServerAdapter): Promise<string> {
  return `component CSS:\n${(await adapter.read()).componentCss}${renderTrace(adapter)}`;
}

/** Writes a valid Card and resolves with the component CSS that publishes it. */
function repairCard(
  fixture: DevFixture,
  adapter: DevServerAdapter,
  what: string,
  padding = '16px'
): Promise<string> {
  const write = () =>
    fixture.write('src/Card.ts', componentSource('Card', 'section', padding));
  write();
  return until(
    async () => {
      const css = (await adapter.read()).componentCss;
      return css.includes(padding) ? css : false;
    },
    { what, reassert: write, describe: () => describeCss(adapter) }
  );
}

const STRICTNESS = [
  ['omitted', undefined],
  ['false', false],
  ['true', true],
] as const;

const prerequisites = probeEnginePrerequisites();

it('failed-parse publication prerequisites are materialized', (context) => {
  if (!prerequisites.ok) context.skip(prerequisites.reason);
  expect(prerequisites.reason).toBe('');
});

const suite = prerequisites.ok ? describe : describe.skip;

suite.each(STRICTNESS)(
  'a failed component edit with %s strictness',
  (_label, strict) => {
    let fixture: DevFixture;
    let adapter: DevServerAdapter;
    let admittedCss: string;

    beforeAll(async () => {
      fixture = createDevFixture();
      fixture.write('src/Card.ts', componentSource('Card', 'section', '12px'));
      fixture.write('src/recovered.js', recoveredSource());
      adapter = createViteDevAdapter(strict === undefined ? {} : { strict });
      await adapter.start(fixture.root);
    });

    afterAll(async () => {
      await adapter?.close();
      fixture?.dispose();
    });

    it('publishes past a recovered parse diagnostic with a warning', async () => {
      admittedCss = (await adapter.read()).componentCss;
      expect(admittedCss).toContain('12px');
      expect(admittedCss).toContain('13px');
      expect(warnings(adapter).join('\n')).toContain(
        'SOURCE_NATIVE_PARSE_ERROR src/recovered.js'
      );
    });

    it('keeps the last generation served and holds later edits', async () => {
      const rejections = () => cardRejections(adapter);
      fixture.write('src/Card.ts', brokenCardSource('14px'));

      const failure = await until(() => rejections()[0] ?? false, {
        what: 'the rejected Card edit is reported',
        reassert: () => fixture.write('src/Card.ts', brokenCardSource('14px')),
        describe: () => describeCss(adapter),
      });
      expect(failure).toContain('src/Card.ts (Unexpected token)');
      // Vite reports the syntax error itself; a plugin error payload would
      // leave the client reloading into the broken module on its next update.
      expect(
        adapter.hotErrors!().filter((message) =>
          message.includes(NOT_PUBLISHED)
        )
      ).toEqual([]);
      expect((await adapter.read()).componentCss).toEqual(admittedCss);

      // The broken bytes reach Vite's own parser instead of being served as
      // the previous module.
      await expect(adapter.requestSource('src/Card.ts')).rejects.toThrow();

      // A valid edit elsewhere is analyzed with the broken Card, rejected
      // with it, and held: nothing it changes is published.
      fixture.writeSentinel('77px');
      await until(() => rejections().length > 1 || false, {
        what: 'the held sentinel edit is rejected',
        reassert: () => fixture.writeSentinel('77px'),
        describe: () => describeCss(adapter),
      });
      expect((await adapter.read()).componentCss).toEqual(admittedCss);
      // Served meanwhile, the held module keeps the previous generation.
      await adapter.requestSource('src/Sentinel.ts');
      expect(adapter.isModuleWarm!('src/Sentinel.ts')).toBe(true);
    });

    it('a repaired edit publishes a new generation without a restart', async () => {
      const repaired = await repairCard(
        fixture,
        adapter,
        'the repaired Card publishes'
      );
      expect(repaired).not.toContain('12px');
      expect(repaired).toContain('77px');
      // The repair re-delivers the held module instead of keeping its
      // previous-generation transform.
      expect(adapter.isModuleWarm!('src/Sentinel.ts')).toBe(false);
      expect(repaired).toContain('13px');
      expect(await adapter.requestSource('src/Card.ts')).toContain('Card');
    });
  }
);

suite.each(STRICTNESS)(
  'a component that cannot be parsed at startup with %s strictness',
  (_label, strict) => {
    let fixture: DevFixture;
    let adapter: DevServerAdapter;

    beforeAll(async () => {
      fixture = createDevFixture();
      fixture.write('src/Card.ts', brokenCardSource('14px'));
      adapter = createViteDevAdapter(strict === undefined ? {} : { strict });
      await adapter.start(fixture.root);
    });

    afterAll(async () => {
      await adapter?.close();
      fixture?.dispose();
    });

    it('publishes no partial generation and recovers the whole corpus on repair', async () => {
      expect(
        warnings(adapter).find((line) => line.includes(NOT_PUBLISHED))
      ).toContain('src/Card.ts');
      expect((await adapter.read()).componentCss).toBe('');

      const repaired = await repairCard(
        fixture,
        adapter,
        'the repaired corpus publishes'
      );
      expect(repaired).toContain('8px');
    });
  }
);

const HELD_BRAND_HEX = '#00ff00';

/** Writes, then waits until the Card rejection is reported once more. */
async function rejectedAgain(
  adapter: DevServerAdapter,
  what: string,
  write: () => void
): Promise<void> {
  const before = cardRejections(adapter).length;
  write();
  await until(() => cardRejections(adapter).length > before || false, {
    what,
    reassert: write,
    describe: () => describeCss(adapter),
  });
}

/** Breaks Card, then holds a sentinel edit, a theme variable and a group. */
async function holdSystemEdit(
  fixture: DevFixture,
  adapter: DevServerAdapter
): Promise<void> {
  await rejectedAgain(adapter, 'the broken Card is rejected', () =>
    fixture.write('src/Card.ts', brokenCardSource('14px'))
  );
  await rejectedAgain(adapter, 'the held sentinel edit is rejected', () =>
    fixture.writeSentinel('77px')
  );
  await rejectedAgain(adapter, 'the held theme edit is rejected', () =>
    fixture.write('src/theme.ts', themeSource(HELD_BRAND_HEX))
  );
  await rejectedAgain(adapter, 'the held group edit is rejected', () =>
    fixture.write('src/ds.ts', systemSource('held-flex', ['flex']))
  );
}

suite('a system edit while a component parse is held', () => {
  let fixture: DevFixture;
  let adapter: DevServerAdapter;

  beforeAll(async () => {
    fixture = createDevFixture();
    fixture.write('src/Card.ts', componentSource('Card', 'section', '12px'));
    adapter = createViteDevAdapter();
    await adapter.start(fixture.root);
  });

  afterAll(async () => {
    await adapter?.close();
    fixture?.dispose();
  });

  it('holds the system with the components and publishes the latest of both on repair', async () => {
    const baseline = await adapter.read();
    expect(baseline.staticCss).toContain(INITIAL_BRAND_HEX);
    expect(baseline.systemProps).not.toContain('flexDirection');

    await holdSystemEdit(fixture, adapter);

    const during = await adapter.read();
    expect(during.staticCss).toBe(baseline.staticCss);
    expect(during.systemProps).toBe(baseline.systemProps);
    expect(during.componentCss).toBe(baseline.componentCss);

    const repaired = await repairCard(fixture, adapter, 'the repair publishes');
    expect(repaired).toContain('77px');
    const recovered = await adapter.read();
    expect(recovered.staticCss).toContain(HELD_BRAND_HEX);
    expect(recovered.staticCss).not.toContain(INITIAL_BRAND_HEX);
    expect(recovered.systemProps).toContain('flexDirection');

    // A later ordinary edit keeps the published system.
    await repairCard(fixture, adapter, 'a later Card edit publishes', '18px');
    const later = await adapter.read();
    expect(later.staticCss).toContain(HELD_BRAND_HEX);
    expect(later.systemProps).toContain('flexDirection');
  });
});
