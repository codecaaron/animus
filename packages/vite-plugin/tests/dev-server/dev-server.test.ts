/**
 * @vitest-environment node
 *
 * Scenarios share one dev server and run in order: each scenario's edits are
 * the next scenario's starting state.
 */
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

import { probeEnginePrerequisites } from '../../../extract/tests/engine-prerequisites';
import {
  brokenThemeSource,
  componentSource,
  createDevFixture,
  INITIAL_BRAND_HEX,
  INITIAL_BUTTON_PADDING,
  INITIAL_USAGE_STEP,
  paletteSource,
  systemComponentSource,
  systemSource,
  themeSource,
  themeViaPaletteSource,
  usageSource,
} from './fixture';
import {
  canonicalizeCss,
  createWatcherBarrier,
  renderTrace,
  until,
} from './scenario';
import { createViteDevAdapter } from './vite-adapter';

import type { DevFixture } from './fixture';
import type { DevArtifacts, DevServerAdapter } from './scenario';

// Booting a dev server, loading a system through NAPI and re-analyzing on each
// edit is orders of magnitude slower than a unit test.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const EDITED_BRAND_HEX = '#ff0000';
const REPAIRED_BRAND_HEX = '#00ff00';
const EDITED_BUTTON_PADDING = '24px';
const RESTYLED_BUTTON_PADDING = '32px';
/** A `space` scale step the fixture's usage site does not start on. */
const EDITED_USAGE_STEP = 16;

function exportLine(source: string, name: string): string {
  const line = source
    .split('\n')
    .find((candidate) => candidate.startsWith(`export const ${name} =`));
  if (line === undefined) {
    throw new Error(`system-props module has no '${name}' export:\n${source}`);
  }
  return line;
}

/**
 * The NAPI binary and sibling package dists this suite needs are not built by
 * the fast unit tier, so it skips with a reason instead of failing there.
 */
const prerequisites = probeEnginePrerequisites();

// The skip reason rides both this test's skip note and the suite name, so a
// reporter that prints only one of them still shows it.
it('dev-server test prerequisites are materialized', (context) => {
  if (!prerequisites.ok) context.skip(prerequisites.reason);
  expect(prerequisites.reason).toBe('');
});

const suite = prerequisites.ok ? describe : describe.skip;

suite(
  prerequisites.ok
    ? 'vite dev server conformance'
    : `vite dev server conformance — SKIPPED: ${prerequisites.reason}`,
  () => {
    let fixture: DevFixture;
    let adapter: DevServerAdapter;
    let barrier: () => Promise<void>;
    let buttonClass: string;

    beforeAll(async () => {
      fixture = createDevFixture();
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

    it('cold start serves the variable sheet and the component sheet', async () => {
      const served = await adapter.read();

      expect(served.staticCss).toContain(':root');
      expect(served.staticCss).toContain(INITIAL_BRAND_HEX);
      expect(served.staticCss).toContain('--color-primary');

      const match = served.componentCss.match(/animus-Button-[0-9a-f]+/);
      expect(
        match,
        `component CSS had no Button class:\n${served.componentCss}`
      ).not.toBeNull();
      buttonClass = match![0];
      expect(served.componentCss).toContain('8px');
    });

    it('the served document carries the HMR bridge, and the URL resolves', async () => {
      // Without the bridge the document adopts no component stylesheet at all,
      // and per-document delivery survives a module-graph invalidation.
      const html = await adapter.indexHtml();

      expect(html, `served document:\n${html}`).toContain('data-animus-bridge');

      const src = /<script[^>]*data-animus-bridge[^>]*>/
        .exec(html)?.[0]
        .match(/src="([^"]+)"/)?.[1];
      expect(src, `no src on the bridge tag:\n${html}`).toBeTruthy();

      const bridgeModule = await adapter.requestUrl(src!);
      expect(bridgeModule).toContain('adoptedStyleSheets');
      expect(bridgeModule).toContain('virtual:animus/components.js');

      // A head module script evaluates before the body entry module, so the
      // adopted stylesheet exists before any component module runs.
      expect(html.indexOf('data-animus-bridge')).toBeLessThan(
        html.indexOf('/src/main.ts')
      );

      // Component transforms carry the bridge import too: a re-transform
      // re-adds it, and SSR hosts that never serve index.html receive it.
      const transformed = await adapter.requestSource('src/Button.ts');
      expect(transformed).toContain('hmr-bridge');
    });

    it('editing a component re-analyzes and changes the served component CSS', async () => {
      const before = await adapter.read();

      fixture.write(
        'src/Button.ts',
        componentSource('Button', 'button', EDITED_BUTTON_PADDING)
      );

      const after = await until(
        async () => {
          const served = await adapter.read();
          return served.componentCss.includes(EDITED_BUTTON_PADDING)
            ? served
            : false;
        },
        {
          what: `component CSS picks up padding ${EDITED_BUTTON_PADDING}`,
          describe: async () =>
            `component CSS:\n${(await adapter.read()).componentCss}${renderTrace(adapter)}`,
        }
      );

      expect(after.componentCss).not.toEqual(before.componentCss);
      // Class names hash filename::binding, never style values — an edit must
      // not renumber the class or every consumer of it breaks.
      expect(after.componentCss).toContain(buttonClass);
      expect(after.componentRevision).toBeGreaterThan(before.componentRevision);
    });

    it('a style-only edit leaves the shared system prop map undelivered', async () => {
      const before = await adapter.read();
      // Non-vacuity: there IS a map to re-deliver, so a passing negative below
      // means the gate held, not that the module was empty all along.
      expect(
        before.systemProps,
        `system props module:\n${before.systemProps}`
      ).toContain(`"${INITIAL_USAGE_STEP}"`);

      // A static padding change mints no utility class, and every module that
      // renders a system prop imports the map — pushing it updates them all.
      fixture.write(
        'src/Button.ts',
        componentSource('Button', 'button', RESTYLED_BUTTON_PADDING)
      );

      const after = await until(
        async () => {
          const served = await adapter.read();
          return served.componentCss.includes(RESTYLED_BUTTON_PADDING)
            ? served
            : false;
        },
        {
          what: `component CSS picks up padding ${RESTYLED_BUTTON_PADDING}`,
          // This write targets the file the previous scenario just edited, so
          // it can land inside the watcher's per-path throttle and be dropped.
          reassert: () =>
            fixture.write(
              'src/Button.ts',
              componentSource('Button', 'button', RESTYLED_BUTTON_PADDING)
            ),
          describe: async () =>
            `component CSS:\n${(await adapter.read()).componentCss}${renderTrace(adapter)}`,
        }
      );

      expect(after.componentRevision).toBeGreaterThan(before.componentRevision);
      expect(after.systemProps).toEqual(before.systemProps);
      expect(after.systemPropsRevision).toBe(before.systemPropsRevision);
    });

    it('a new system-prop value re-delivers the map', async () => {
      const before = await adapter.read();

      fixture.write('src/Usage.tsx', usageSource(EDITED_USAGE_STEP));

      // Match the systemPropMap export line, not the whole module: scale keys
      // in dynamicPropConfig already carry the bare value at startup.
      const after = await until(
        async () => {
          const served = await adapter.read();
          return exportLine(served.systemProps, 'systemPropMap').includes(
            `"${EDITED_USAGE_STEP}"`
          )
            ? served
            : false;
        },
        {
          what: `system prop map picks up the p=${EDITED_USAGE_STEP} utility`,
          describe: async () =>
            `system props module:\n${(await adapter.read()).systemProps}${renderTrace(adapter)}`,
        }
      );

      expect(after.systemPropsRevision).toBeGreaterThan(
        before.systemPropsRevision
      );
    });

    it('widening a component system opt-in re-delivers the module', async () => {
      const before = await adapter.read();

      // Widening the opt-in moves dynamicPropConfig but not the prop map: a
      // gate keyed on the map strands the client on a config it cannot render.
      fixture.write('src/Box.ts', systemComponentSource(['space', 'surface']));

      const after = await until(
        async () => {
          const served = await adapter.read();
          return served.systemProps === before.systemProps ? false : served;
        },
        {
          what: 'the served system-props module changes after widening the opt-in',
          describe: async () =>
            `system props module:\n${(await adapter.read()).systemProps}${renderTrace(adapter)}`,
        }
      );

      expect(exportLine(after.systemProps, 'systemPropMap')).toEqual(
        exportLine(before.systemProps, 'systemPropMap')
      );
      expect(exportLine(after.systemProps, 'dynamicPropConfig')).not.toEqual(
        exportLine(before.systemProps, 'dynamicPropConfig')
      );
      expect(after.systemPropsRevision).toBeGreaterThan(
        before.systemPropsRevision
      );
    });

    it('editing the theme file the system imports triggers the system reload', async () => {
      const before = await adapter.read();

      fixture.write('src/theme.ts', themeSource(EDITED_BRAND_HEX));

      // The theme file is in the loader-reported system module graph, so a
      // token edit coalesces into a reload and reaches the variable CSS.
      const after = await until(
        async () => {
          const served = await adapter.read();
          return served.staticCss.includes(EDITED_BRAND_HEX) ? served : false;
        },
        {
          what: `variable CSS picks up ${EDITED_BRAND_HEX} after a transitive theme edit`,
          describe: async () =>
            `variable CSS:\n${(await adapter.read()).staticCss}${renderTrace(adapter)}`,
        }
      );
      expect(after.staticCss).not.toContain(INITIAL_BRAND_HEX);
      expect(after.staticRevision).toBeGreaterThan(before.staticRevision);
    });

    it('a system-entry edit still triggers the system reload', async () => {
      const before = await adapter.read();

      fixture.write('src/ds.ts', systemSource('reset-after-theme-edit'));

      // The theme edit already landed via membership; the entry edit must
      // still reset on its own — wait on the revision, not the token.
      const after = await until(
        async () => {
          const served = await adapter.read();
          return served.staticRevision > before.staticRevision ? served : false;
        },
        {
          what: 'a fresh static revision after a system-entry change',
          describe: async () =>
            `revision: ${(await adapter.read()).staticRevision}${renderTrace(adapter)}`,
        }
      );

      expect(after.staticCss).toContain(EDITED_BRAND_HEX);
      expect(after.staticCss).not.toContain(INITIAL_BRAND_HEX);
      // A reset invalidates component CSS too — it must come back, not vanish.
      expect(after.componentCss).toContain(buttonClass);
    });

    it('deleting a component file retracts its class', async () => {
      const before = await adapter.read();
      expect(before.componentCss).toContain(buttonClass);

      fixture.remove('src/Button.ts');

      await until(
        async () => {
          const served = await adapter.read();
          return served.componentCss.includes(buttonClass) ? false : served;
        },
        {
          what: `component CSS retracts ${buttonClass} after deletion`,
          describe: async () =>
            `component CSS:\n${(await adapter.read()).componentCss}${renderTrace(adapter)}`,
        }
      );
    });

    it('recreating the component file restores its class', async () => {
      fixture.write(
        'src/Button.ts',
        componentSource('Button', 'button', EDITED_BUTTON_PADDING)
      );
      await barrier();

      // Restoration flows through transform-time new-file detection, which
      // needs the module request a browser makes after the delete's reload.
      await adapter.requestSource('src/Button.ts');

      const after = await until(
        async () => {
          const served = await adapter.read();
          return served.componentCss.includes(buttonClass) ? served : false;
        },
        {
          what: `component CSS restores ${buttonClass} after recreation`,
          describe: async () =>
            `component CSS:\n${(await adapter.read()).componentCss}${renderTrace(adapter)}`,
        }
      );
      expect(after.componentCss).toContain(EDITED_BUTTON_PADDING);
    });

    it('a component file created after start-up is folded in at transform time', async () => {
      fixture.write('src/Card.ts', componentSource('Card', 'section', '4px'));
      await barrier();

      // The new-file path is in the transform hook, not the hot-update hook:
      // nothing happens until the browser actually asks for the module.
      const transformed = await adapter.requestSource('src/Card.ts');
      expect(transformed).toContain('createComponent');

      const after = await until(
        async () => {
          const served = await adapter.read();
          return /animus-Card-[0-9a-f]+/.test(served.componentCss)
            ? served
            : false;
        },
        {
          what: 'component CSS picks up the newly created Card',
          describe: async () =>
            `no animus-Card-* class in component CSS:\n${(await adapter.read()).componentCss}${renderTrace(adapter)}`,
        }
      );

      expect(after.componentCss).toContain(buttonClass);
    });

    it('a new imported extension parent recovers mid-session (ANI-035)', async () => {
      // The consumer edits land before the parent file exists, so their chains
      // drop; the session must converge to extracted serves without a restart.
      fixture.write(
        'src/Card.ts',
        "import { LedgerParent } from './LedgerParent';\n\n" +
          'export const Card = LedgerParent.extend()\n' +
          "  .styles({ padding: '6px' })\n" +
          "  .asElement('section');\n"
      );
      fixture.write(
        'src/Button.ts',
        "import { LedgerParent } from './LedgerParent';\n\n" +
          'export const Button = LedgerParent.extend()\n' +
          "  .styles({ padding: '40px' })\n" +
          "  .asElement('button');\n"
      );
      await barrier();

      // A watcher create feeds the same analysis path as an edit, so this
      // resolves the whole graph and re-delivers the dropped consumers.
      fixture.write(
        'src/LedgerParent.ts',
        "import { ds } from './ds';\n\n" +
          'export const LedgerParent = ds\n' +
          "  .styles({ margin: '2px', bg: 'primary' })\n" +
          "  .asElement('div');\n"
      );
      await barrier();

      const card = await until(
        async () => {
          const served = await adapter.requestSource('src/Card.ts');
          return served.includes('createComponent') ? served : false;
        },
        {
          what: 'consumer Card serves extracted after the parent appears',
          describe: async () =>
            `served Card:\n${await adapter.requestSource('src/Card.ts')}${renderTrace(adapter)}`,
        }
      );
      // The runtime fallback (a raw consumer over an extracted parent) must
      // never serve.
      expect(card).not.toContain('.extend()');

      const button = await adapter.requestSource('src/Button.ts');
      expect(button).toContain('createComponent');
      expect(button).not.toContain('.extend()');

      const parent = await adapter.requestSource('src/LedgerParent.ts');
      expect(parent).toContain('createComponent');

      const after = await until(
        async () => {
          const served = await adapter.read();
          return /animus-LedgerParent-[0-9a-f]+/.test(served.componentCss) &&
            served.componentCss.includes('40px')
            ? served
            : false;
        },
        {
          what: 'parent and both extended consumers reach the served CSS',
          describe: async () =>
            `component CSS:\n${(await adapter.read()).componentCss}${renderTrace(adapter)}`,
        }
      );
      expect(after.componentCss).toContain(buttonClass);
      expect(after.componentCss).toContain('6px');
    });

    it('a broken system dependency keeps the server up on the last good config', async () => {
      const before = await adapter.read();

      // A failed system load warns in non-strict mode; capturing it turns
      // expected stderr noise into an assertion.
      const warnings: string[] = [];
      const warnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation((...args: unknown[]) => {
          warnings.push(args.map(String).join(' '));
        });

      try {
        fixture.write('src/theme.ts', brokenThemeSource());
        fixture.write('src/ds.ts', systemSource('reset-over-broken-theme'));

        // The reset invalidates the static module even when the system load
        // fails, so the revision is the observable that it was attempted.
        const after = await until(
          async () => {
            const served = await adapter.read();
            return served.staticRevision > before.staticRevision
              ? served
              : false;
          },
          {
            what: 'static module is invalidated by the reset over a broken theme',
            describe: async () =>
              `static revision stuck at ${(await adapter.read()).staticRevision} (was ${before.staticRevision})${renderTrace(adapter)}`,
          }
        );

        expect(
          warnings.some((line) => line.includes('Failed to load system from')),
          `expected a failed-system-load warning, saw: ${JSON.stringify(warnings)}`
        ).toBe(true);
        expect(after.staticCss).toEqual(before.staticCss);
        expect(after.staticCss).toContain(EDITED_BRAND_HEX);
        expect(after.componentCss).toContain(buttonClass);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('repairing the system dependency recovers without a restart', async () => {
      const before = await adapter.read();

      fixture.write('src/theme.ts', themeSource(REPAIRED_BRAND_HEX));
      fixture.write('src/ds.ts', systemSource('reset-after-repair'));

      const after = await until(
        async () => {
          const served = await adapter.read();
          return served.staticCss.includes(REPAIRED_BRAND_HEX) ? served : false;
        },
        {
          what: `variable CSS picks up the repaired ${REPAIRED_BRAND_HEX}`,
          describe: async () =>
            `variable CSS:\n${(await adapter.read()).staticCss}${renderTrace(adapter)}`,
        }
      );

      expect(after.staticCss).not.toContain(EDITED_BRAND_HEX);
      expect(after.staticRevision).toBeGreaterThan(before.staticRevision);
      expect(after.componentCss).toContain(buttonClass);
    });

    it('a two-hop transitive dependency joins the reset set after a reload', async () => {
      // The loader reports every module it evaluated, so membership must reach
      // a dependency two hops from the entry, not only direct imports.
      const TRANSITIVE_HEX = '#123456';
      const before = await adapter.read();

      // Introduce the second hop at the current hex: the theme file is already
      // a member, so this write re-reports a graph that includes palette.ts.
      fixture.write('src/palette.ts', paletteSource(REPAIRED_BRAND_HEX));
      fixture.write('src/theme.ts', themeViaPaletteSource());
      await until(
        async () => {
          const served = await adapter.read();
          return served.staticRevision > before.staticRevision ? served : false;
        },
        {
          what: 'a fresh static revision after re-rooting the theme through palette.ts',
          describe: async () =>
            `revision: ${(await adapter.read()).staticRevision}${renderTrace(adapter)}`,
        }
      );

      // Editing only the two-hop module: if membership stopped at the first
      // hop this is a plain component event and the variable CSS never moves.
      fixture.write('src/palette.ts', paletteSource(TRANSITIVE_HEX));
      const after = await until(
        async () => {
          const served = await adapter.read();
          return served.staticCss.includes(TRANSITIVE_HEX) ? served : false;
        },
        {
          what: `variable CSS picks up ${TRANSITIVE_HEX} after a two-hop palette edit`,
          describe: async () =>
            `variable CSS:\n${(await adapter.read()).staticCss}${renderTrace(adapter)}`,
        }
      );
      expect(after.staticCss).not.toContain(REPAIRED_BRAND_HEX);
      expect(after.componentCss).toContain(buttonClass);
    });

    it('a second cold server serves the same CSS as the incremental one', async () => {
      const incremental: DevArtifacts = await adapter.read();

      const coldAdapter = createViteDevAdapter();
      await coldAdapter.start(fixture.root);
      try {
        const cold = await coldAdapter.read();

        expect(canonicalizeCss(cold.staticCss)).toEqual(
          canonicalizeCss(incremental.staticCss)
        );
        expect(canonicalizeCss(cold.componentCss)).toEqual(
          canonicalizeCss(incremental.componentCss)
        );
        expect(cold.staticCss).toEqual(incremental.staticCss);
        expect(cold.componentCss).toEqual(incremental.componentCss);
      } finally {
        await coldAdapter.close();
      }
    });
  }
);

suite(
  prerequisites.ok
    ? 'presentation-only HMR identity gate'
    : `presentation-only HMR identity gate — SKIPPED: ${prerequisites.reason}`,
  () => {
    let fixture: DevFixture;
    let adapter: DevServerAdapter;

    /** Paddings distinct from the fixture's initial 8px and from each other. */
    const STYLE_ONLY_PADDING = '11px';
    const MIXED_EDIT_PADDING = '13px';
    const FOLLOWUP_PADDING = '17px';

    const updatesSince = (mark: number): string[] =>
      adapter.hotUpdatePaths!().slice(mark);

    beforeAll(async () => {
      fixture = createDevFixture();
      adapter = createViteDevAdapter();
      await adapter.start(fixture.root);
      // The bridge request registers acceptance of the components module;
      // without it every components.js update dead-ends in a full reload.
      await adapter.read();
      await adapter.requestSource('src/main.ts');
      await adapter.requestSource('src/Button.ts');
      await adapter.requestUrl('/@id/__x00__virtual:animus/hmr-bridge.js');
    });

    afterAll(async () => {
      await adapter?.close();
      fixture?.dispose();
    });

    it('a style-only edit delivers CSS without re-executing the module', async () => {
      const mark = adapter.hotUpdatePaths!().length;
      fixture.write(
        'src/Button.ts',
        componentSource('Button', 'button', STYLE_ONLY_PADDING)
      );

      await until(
        async () => {
          const served = await adapter.read();
          return served.componentCss.includes(STYLE_ONLY_PADDING) &&
            updatesSince(mark).some((p) => p.includes('components.js'))
            ? served
            : false;
        },
        {
          what: `suppressed delivery of padding ${STYLE_ONLY_PADDING} (CSS + components.js update)`,
          describe: async () =>
            `payloads since mark: ${JSON.stringify(updatesSince(mark))}\ncomponent CSS:\n${(await adapter.read()).componentCss}${renderTrace(adapter)}`,
        }
      );

      // The edited module receives no update at all, so a browser holding
      // React state in its subtree keeps it.
      const paths = updatesSince(mark);
      expect(paths.filter((p) => p.includes('Button.ts'))).toEqual([]);
      expect(paths).not.toContain('full-reload');

      // The plugin re-warms the suppressed module so a later unrelated
      // propagation cannot observe an invalidated node.
      await until(async () => adapter.isModuleWarm!('src/Button.ts') || false, {
        what: 'suppressed module re-warmed (transformResult present)',
        describe: async () => renderTrace(adapter),
      });
    });

    it('reverting the style-only edit is suppressed the same way', async () => {
      const mark = adapter.hotUpdatePaths!().length;
      const revert = (): void =>
        fixture.write(
          'src/Button.ts',
          componentSource('Button', 'button', INITIAL_BUTTON_PADDING)
        );
      revert();

      await until(
        async () => {
          const served = await adapter.read();
          return served.componentCss.includes(INITIAL_BUTTON_PADDING) &&
            !served.componentCss.includes(STYLE_ONLY_PADDING) &&
            updatesSince(mark).some((p) => p.includes('components.js'))
            ? served
            : false;
        },
        {
          what: `revert to ${INITIAL_BUTTON_PADDING} delivered with suppression`,
          // Consecutive writes to the same path can land inside chokidar's
          // 50ms per-path throttle and be dropped outright — re-assert.
          reassert: revert,
          describe: async () =>
            `payloads since mark: ${JSON.stringify(updatesSince(mark))}\ncomponent CSS:\n${(await adapter.read()).componentCss}${renderTrace(adapter)}`,
        }
      );

      const paths = updatesSince(mark);
      expect(paths.filter((p) => p.includes('Button.ts'))).toEqual([]);
      expect(paths).not.toContain('full-reload');
    });

    it('a mixed style+code edit still delivers the module update', async () => {
      const mark = adapter.hotUpdatePaths!().length;
      const writeMixed = (): void =>
        fixture.write(
          'src/Button.ts',
          componentSource('Button', 'button', MIXED_EDIT_PADDING) +
            'export const buttonMeta = 1;\n'
        );
      writeMixed();

      // Button has no self-accepting boundary in this JSX-free fixture, so
      // genuine delivery surfaces as a full reload, not a module update.
      await until(
        async () => {
          const served = await adapter.read();
          const paths = updatesSince(mark);
          const delivered =
            paths.some((p) => p.includes('Button.ts')) ||
            paths.includes('full-reload');
          return served.componentCss.includes(MIXED_EDIT_PADDING) && delivered
            ? served
            : false;
        },
        {
          what: `mixed edit (padding ${MIXED_EDIT_PADDING} + new export) delivers a module update`,
          reassert: writeMixed,
          describe: async () =>
            `payloads since mark: ${JSON.stringify(updatesSince(mark))}\ncomponent CSS:\n${(await adapter.read()).componentCss}${renderTrace(adapter)}`,
        }
      );

      const transformed = await adapter.requestSource('src/Button.ts');
      expect(transformed).toContain('buttonMeta');
    });

    it('suppression state survives a later unrelated update', async () => {
      // Re-adding buttonMeta keeps this edit style-only relative to the mixed
      // edit above, so Button is suppressed again before the unrelated edit.
      const styleOnly = (): void =>
        fixture.write(
          'src/Button.ts',
          componentSource('Button', 'button', FOLLOWUP_PADDING) +
            'export const buttonMeta = 1;\n'
        );
      const markA = adapter.hotUpdatePaths!().length;
      styleOnly();
      await until(
        async () =>
          (await adapter.read()).componentCss.includes(FOLLOWUP_PADDING) &&
          updatesSince(markA).some((p) => p.includes('components.js')),
        {
          what: `style-only follow-up (${FOLLOWUP_PADDING}) suppressed`,
          reassert: styleOnly,
          describe: async () =>
            `payloads since mark: ${JSON.stringify(updatesSince(markA))}${renderTrace(adapter)}`,
        }
      );
      expect(
        updatesSince(markA).filter((p) => p.includes('Button.ts'))
      ).toEqual([]);

      // The sentinel edit is style-only too, so the window stays free of
      // reloads and any Button payload would be the gate leaking.
      const markB = adapter.hotUpdatePaths!().length;
      fixture.writeSentinel('41px');
      await until(
        async () =>
          (await adapter.read()).componentCss.includes('41px') &&
          updatesSince(markB).some((p) => p.includes('components.js')),
        {
          what: 'unrelated sentinel edit delivered',
          reassert: () => fixture.writeSentinel('41px'),
          describe: async () =>
            `payloads since mark: ${JSON.stringify(updatesSince(markB))}${renderTrace(adapter)}`,
        }
      );

      const windowPaths = updatesSince(markB);
      expect(windowPaths.filter((p) => p.includes('Button.ts'))).toEqual([]);
      expect(windowPaths).not.toContain('full-reload');
      expect(adapter.isModuleWarm!('src/Button.ts')).toBe(true);
    });
  }
);
