import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeAll, describe, expect, test } from 'vitest';

import { createV2EngineApi } from '../pipeline/engine-adapter';

import type { V2ExtractEngine } from '../pipeline/engine-adapter';
import type { ProjectManifest } from '../pipeline/manifest-schema';

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

function analyze(staticCssJson: string | null) {
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
    false,
    null,
    null,
    null,
    null,
    null,
    null,
    staticCssJson
  );
  // SAFETY: `manifestJson` is this call's own `analyzeProject` return, serde
  // output from the Rust `AnalyzeResult` that `manifest-schema.ts` mirrors.
  const manifest = JSON.parse(manifestJson) as ProjectManifest;
  return { manifestJson, manifest };
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
    expect(manifest.css).not.toContain('ghost');
    expect(manifest.css).not.toContain('loading');
    expect(manifest.report.components_eliminated).toBeGreaterThanOrEqual(1);
    expect(
      manifest.report.eliminated_details.some(
        (d) => d.component === 'Spacer' && d.kind === 'component'
      )
    ).toBe(true);
    expect(manifest.report.variants_forced).toBe(0);
  });

  test('forcing restores variants, states, components, and system values', () => {
    const { manifest } = analyze(FORCED);

    expect(manifest.css).toContain('ghost');
    expect(manifest.css).toContain('loading');
    expect(
      manifest.report.eliminated_details.some(
        (d) => d.component === 'Spacer' && d.kind === 'component'
      )
    ).toBe(false);
    expect(manifest.css).toMatch(/padding:\s*7px/);

    expect(manifest.report.components_forced).toBe(1);
    expect(manifest.report.variants_forced).toBe(1);
    expect(manifest.report.states_forced).toBe(1);
    const forcedDetails = manifest.report.eliminated_details.filter(
      (d) => d.kind === 'forced'
    );
    expect(forcedDetails).toHaveLength(3);
    expect(forcedDetails.some((d) => d.name === 'ghost')).toBe(true);
    expect(forcedDetails.some((d) => d.name === 'loading')).toBe(true);

    expect(
      (manifest.diagnostics ?? []).filter((d) => d.file === 'staticCss')
    ).toEqual([]);
  });

  test('observed and forced usage compose', () => {
    const { manifest } = analyze(FORCED);
    expect(manifest.css).toContain('stroke');
    expect(manifest.css).toContain('ghost');
  });

  test('unmatched names warn without failing', () => {
    const { manifest } = analyze(JSON.stringify({ components: { Buton: {} } }));
    const warnings = (manifest.diagnostics ?? []).filter(
      (d) => d.file === 'staticCss' && d.kind === 'warn'
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("unknown component 'Buton'");
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
