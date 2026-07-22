/**
 * static-emission-overrides evidence (spec: static-emission-overrides) —
 * REAL v2 engine, reconciliation fixture. Proves: the baseline drop exists
 * (unused variants/states/components pruned), forcing restores each scope
 * axis through the ordinary ledger, empty config is byte-identical,
 * unmatched names warn, and forcing is deterministic.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeAll, describe, expect, test } from 'vitest';

import { createV2EngineApi } from '../pipeline/engine-adapter';

import type { V2ExtractEngine } from '../pipeline/engine-adapter';

const ROOT = join(__dirname, '../../..');
const NATIVE = join(__dirname, '../index-v2.js');
const FIXTURE = readFileSync(
  join(__dirname, 'fixtures/reconciliation.tsx'),
  'utf-8'
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeApi(): any {
  let engine: V2ExtractEngine | null = null;
  let sentSources: Map<string, string> | null = null;
  let driftWarned = false;
  return createV2EngineApi({
    label: 'static-css-test',
    isV2: () => true,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loadNativeEngine: () => require(NATIVE),
    store: {
      getEngine: () => engine,
      setEngine: (next) => {
        engine = next;
      },
      getSentSources: () => sentSources,
      setSentSources: (sources) => {
        sentSources = sources;
      },
      getDriftWarned: () => driftWarned,
      setDriftWarned: (value) => {
        driftWarned = value;
      },
    },
  })();
}

let theme: {
  scalesJson: string;
  variableMapJson: string;
  contextualVarsJson: string | null;
};
let config: { propConfig: string; groupRegistry: string };

beforeAll(async () => {
  const { ds, tokens } = await import(
    join(ROOT, 'packages/extract/tests/test-system.ts')
  );
  config = ds.toConfig();
  theme = tokens.serialize();
});

function analyze(staticCssJson: string | null): {
  manifestJson: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  manifest: any;
} {
  const api = makeApi();
  api.clearAnalysisCache();
  const manifestJson: string = api.analyzeProject(
    JSON.stringify([
      { path: 'tests/fixtures/reconciliation.tsx', source: FIXTURE },
    ]),
    theme.scalesJson,
    theme.variableMapJson,
    theme.contextualVarsJson || null,
    config.propConfig,
    config.groupRegistry,
    '{}',
    false, // prod: reconciliation prunes
    null,
    null,
    null,
    null,
    null,
    null,
    staticCssJson
  );
  return { manifestJson, manifest: JSON.parse(manifestJson) };
}

const FORCED = JSON.stringify({
  components: {
    Button: { variants: { variant: ['ghost'] }, states: '*' },
    Spacer: {},
  },
  systemProps: { p: ['7px'] },
});

describe('static-emission-overrides (real engine)', () => {
  test('baseline: unobserved usage demonstrably drops', () => {
    const { manifest } = analyze(null);
    // ghost variant unused → pruned; loading state unused → pruned;
    // Spacer never rendered → eliminated.
    expect(manifest.css).not.toContain('ghost');
    expect(manifest.css).not.toContain('loading');
    expect(manifest.report.components_eliminated).toBeGreaterThanOrEqual(1);
    expect(
      manifest.report.eliminated_details.some(
        (d: { component: string; kind: string }) =>
          d.component === 'Spacer' && d.kind === 'component'
      )
    ).toBe(true);
    expect(manifest.report.variants_forced).toBe(0);
  });

  test('forcing restores variants, states, components, and system values', () => {
    const { manifest } = analyze(FORCED);

    // Variant list forcing
    expect(manifest.css).toContain('ghost');
    // States wildcard: the unobserved 'loading' state now emits
    expect(manifest.css).toContain('loading');
    // Never-rendered component survives
    expect(
      manifest.report.eliminated_details.some(
        (d: { component: string; kind: string }) =>
          d.component === 'Spacer' && d.kind === 'component'
      )
    ).toBe(false);
    // System prop value reaches the utility stream
    expect(manifest.css).toMatch(/padding:\s*7px/);

    // Report: forced counts + labeled details. Button is observed-rendered
    // so only Spacer counts as a forced component; 'disabled' is observed
    // so only 'loading' counts as a forced state.
    expect(manifest.report.components_forced).toBe(1);
    expect(manifest.report.variants_forced).toBe(1);
    expect(manifest.report.states_forced).toBe(1);
    const forcedDetails = manifest.report.eliminated_details.filter(
      (d: { kind: string }) => d.kind === 'forced'
    );
    expect(forcedDetails).toHaveLength(3);
    expect(
      forcedDetails.some(
        (d: { name: string | null }) => d.name === 'ghost'
      )
    ).toBe(true);
    expect(
      forcedDetails.some(
        (d: { name: string | null }) => d.name === 'loading'
      )
    ).toBe(true);

    // No warnings for a fully-matched declaration
    expect(
      (manifest.diagnostics ?? []).filter(
        (d: { file: string }) => d.file === 'staticCss'
      )
    ).toEqual([]);
  });

  test('observed and forced usage compose', () => {
    const { manifest } = analyze(FORCED);
    // Observed stroke + default fill still present alongside forced ghost
    expect(manifest.css).toContain('stroke');
    expect(manifest.css).toContain('ghost');
  });

  test('unmatched names warn without failing', () => {
    const { manifest } = analyze(
      JSON.stringify({ components: { Buton: {} } })
    );
    const warnings = (manifest.diagnostics ?? []).filter(
      (d: { file: string; kind: string }) =>
        d.file === 'staticCss' && d.kind === 'warn'
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("unknown component 'Buton'");
    // Build proceeded: observed extraction unaffected
    expect(manifest.css).toContain('stroke');
  });

  test('empty config is byte-identical to no config', () => {
    const bare = analyze(null).manifestJson;
    const empty = analyze('{}').manifestJson;
    expect(empty).toBe(bare);
  });

  test('forcing is deterministic across runs', () => {
    const a = analyze(FORCED).manifestJson;
    const b = analyze(FORCED).manifestJson;
    expect(b).toBe(a);
  });
});
