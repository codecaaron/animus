/**
 * @vitest-environment node
 *
 * Dev-server conformance lane.
 *
 * Every other consumer lane in this repo builds for production and asserts on
 * `dist/`. Nothing exercised the dev server, so the hot-update hook, the
 * geological reset and the transform-time new-file path had no regression
 * coverage at all. This lane closes that gap: one real Vite dev server, one
 * real watcher, one real fixture app on disk, and assertions on the artifacts
 * the server hands a browser.
 *
 * Rules of the lane:
 *   - no wall-clock sleeps: every wait is `until(...)` over an observable
 *     artifact, or a sentinel-based watcher barrier (see scenario.ts)
 *   - assertions are on served CSS and on bundler revisions, never on timings
 *   - the scenarios share one server and run in order; only the last scenario
 *     starts a second one
 *
 * Two scenarios below are marked GAP. They pin behavior that is currently
 * WRONG, so the lane stays green while naming the defect. Each says exactly
 * which assertion to swap in when the fix lands; the swap is the regression
 * test.
 */
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

import {
  brokenThemeSource,
  componentSource,
  createDevFixture,
  INITIAL_BRAND_HEX,
  systemSource,
  themeSource,
} from './fixture';
import { probeDevLanePrerequisites } from './prerequisites';
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

const prerequisites = probeDevLanePrerequisites();

// Fail-loud skip. Two carriers so the reason cannot be swallowed: this test's
// skip note (printed by the reporter) and the suite name below.
it('dev-lane prerequisites are materialized', (context) => {
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

    it('editing the theme file the system imports triggers the geological reset', async () => {
      const before = await adapter.read();

      fixture.write('src/theme.ts', themeSource(EDITED_BRAND_HEX));

      // Contract (dependency-set membership): the theme file is in the
      // loader-reported system module graph, so a transitive token edit
      // coalesces into a geological reset and lands in the variable CSS.
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

    it('a system-entry edit still triggers the geological reset', async () => {
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

      // Contract (hotUpdate migration): the delete event reaches the plugin,
      // the cache entry is pruned, and the served CSS regenerates without
      // the class.
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

      // Deletion genuinely pruned the cache entry, so restoration flows
      // through transform-time new-file detection — which fires when the
      // browser re-requests the module after the delete's reload. Emulate
      // that request; a real session gets it from the full-reload.
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

    it('a broken system dependency keeps the server up on the last good config', async () => {
      const before = await adapter.read();

      // The plugin reports a failed system load through console.warn (non-strict
      // mode). Capturing it turns the scenario's expected stderr noise into an
      // assertion instead of leaving a stack trace in the run output.
      const warnings: string[] = [];
      const warnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation((...args: unknown[]) => {
          warnings.push(args.map(String).join(' '));
        });

      try {
        fixture.write('src/theme.ts', brokenThemeSource());
        fixture.write('src/ds.ts', systemSource('reset-over-broken-theme'));

        // The reset is the observable event here — it invalidates the static
        // module even when loading the system fails, so waiting on the revision
        // proves the failed reset was attempted and survived.
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

        // Non-strict mode: warn and keep the previous config rather than throw.
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

    it('a second cold server serves the same CSS as the incremental one', async () => {
      const incremental: DevArtifacts = await adapter.read();

      const coldAdapter = createViteDevAdapter();
      await coldAdapter.start(fixture.root);
      try {
        const cold = await coldAdapter.read();

        // Same mode (dev vs dev), same fixture state on disk: a server that
        // reached this state through eight incremental edits must serve what a
        // server that never saw an edit serves.
        expect(canonicalizeCss(cold.staticCss)).toEqual(
          canonicalizeCss(incremental.staticCss)
        );
        expect(canonicalizeCss(cold.componentCss)).toEqual(
          canonicalizeCss(incremental.componentCss)
        );
        // Byte equality holds today; keep it asserted so a whitespace-level
        // divergence between the cold and incremental paths is also caught.
        expect(cold.staticCss).toEqual(incremental.staticCss);
        expect(cold.componentCss).toEqual(incremental.componentCss);
      } finally {
        await coldAdapter.close();
      }
    });
  }
);
