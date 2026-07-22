/**
 * CHILD entry: one engine, whole corpus, one dev-mode — run in a FRESH
 * process per invocation (cross-process determinism is part of what the
 * harness measures; std HashMap ordering is per-process).
 *
 * stdout: canonical JSON  Record<unitId, UnitSurface>
 * argv:   --engine v2 [--dev]
 */
import { createRequire } from 'module';
import { join } from 'path';

import { enumerateUnits } from './corpus';

import type { UnitSurface } from './types';

const ROOT = join(import.meta.dirname, '../../..');
// Direct relative path — documented workaround for the bun>=1.3.12
// createRequire "types"-condition bug (root AGENTS.md § Key Rules).
const require_ = createRequire(import.meta.url);

const engine = process.argv.includes('--engine')
  ? process.argv[process.argv.indexOf('--engine') + 1]
  : 'v2';
const devMode = process.argv.includes('--dev');

interface EngineApi {
  analyzeProject: (...args: unknown[]) => string;
  transformFile: (
    source: string,
    path: string,
    manifest: string
  ) => { code: string; hasComponents: boolean };
  clearAnalysisCache: () => void;
}

function loadEngine(name: string): EngineApi {
  if (name === 'v2') {
    // Adapter over the stateful ExtractEngine handle (RF-54): maps the
    // function-shaped harness interface onto per-unit engine instances.
    // Config inputs move from analyzeProject args to constructor options;
    // transformFile reads retained state instead of a manifest. Fail-loud
    // surfaces (compose emission, resolved extension chains) throw through.
    const native = require_(join(ROOT, 'packages/extract/index-v2.js'));
    let instance: InstanceType<typeof native.ExtractEngine> | null = null;
    return {
      analyzeProject: (
        filesJson: unknown,
        scalesJson: unknown,
        variableMapJson: unknown,
        contextualVarsJson: unknown,
        propConfig: unknown,
        groupRegistry: unknown,
        _pkgResolution: unknown,
        devMode: unknown,
        _emitterConfig: unknown,
        selectorAliases: unknown,
        _selectorOrder: unknown,
        globalStyleBlocks: unknown,
        pathAliases: unknown,
        keyframes: unknown
      ) => {
        // NAPI Option fields: undefined → None; null is a conversion error.
        instance = new native.ExtractEngine({
          themeJson: scalesJson,
          variableMapJson,
          contextualVarsJson: contextualVarsJson ?? undefined,
          configJson: propConfig,
          groupRegistryJson: groupRegistry,
          selectorAliasesJson: selectorAliases ?? undefined,
          // Caller positions 12/13/14 (row-13 review A6): preserve the
          // supplied harness inputs rather than re-asserting constants.
          globalStyleBlocksJson: globalStyleBlocks ?? undefined,
          pathAliasesJson: pathAliases ?? undefined,
          keyframesJson: keyframes ?? undefined,
          packageResolutionJson: _pkgResolution ?? undefined,
          devMode: Boolean(devMode),
        });
        return instance.analyze(filesJson as string);
      },
      transformFile: (source: string, path: string, _manifest: string) => {
        if (!instance)
          throw new Error('v2 adapter: analyzeProject must run first');
        return JSON.parse(instance.transformFile(path));
      },
      clearAnalysisCache: () => {
        instance = null;
      },
    };
  }
  throw new Error(`unknown engine '${name}' — supported: v2`);
}

/** Harness-level global/keyframes inputs. The test system exports neither,
 *  so the harness supplies them to keep resolve_all_global_blocks and the
 *  keyframes registry from remaining green-by-vacuity. */
const HARNESS_GLOBAL_BLOCKS = JSON.stringify({
  reset: { body: { margin: 0, fontFamily: '{fonts.base}' } },
});
const HARNESS_KEYFRAMES = JSON.stringify({
  motion: {
    ember: {
      name: 'anm-ember',
      frames: { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
    },
  },
});

function fragmentsOf(manifest: Record<string, unknown>) {
  return (manifest.component_fragments ??
    manifest.componentFragments ??
    {}) as Record<string, unknown>;
}

/** Key-sorted stringify — native maps can vary iteration order across fresh
 *  processes; the observable is sorted content, not incidental emission
 *  order. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(v).sort())
        sorted[key] = (v as Record<string, unknown>)[key];
      return sorted;
    }
    return v;
  });
}

async function main() {
  const { ds, tokens } = await import(
    join(ROOT, 'packages/extract/tests/test-system.ts')
  );
  const config = ds.toConfig();
  const theme = tokens.serialize();

  const api = loadEngine(engine);
  const units = await enumerateUnits();
  // Vacuity floor (gate-integrity review): a shrunken corpus must fail
  // loud, not pass empty. 30 < the current 47-unit corpus; raise with it.
  if (units.length < 30) {
    throw new Error(
      `corpus vacuity: only ${units.length} units enumerated (floor 30) — check fixture/corpus paths`
    );
  }
  const out: Record<string, UnitSurface> = {};

  for (const unit of units) {
    api.clearAnalysisCache();
    const manifestJson: string = api.analyzeProject(
      JSON.stringify(unit.files),
      theme.scalesJson,
      theme.variableMapJson,
      theme.contextualVarsJson || null,
      config.propConfig,
      config.groupRegistry,
      '{}',
      devMode,
      null,
      config.selectorAliases ?? null,
      null,
      HARNESS_GLOBAL_BLOCKS,
      null,
      HARNESS_KEYFRAMES,
      null
    );
    const manifest = JSON.parse(manifestJson);

    const code: Record<string, string> = {};
    const hasComponents: Record<string, boolean> = {};
    for (const f of unit.files) {
      const r = api.transformFile(f.source, f.path, manifestJson);
      code[f.path] = r.code;
      hasComponents[f.path] = r.hasComponents;
    }

    const diagnostics = (manifest.diagnostics ?? [])
      .map(
        (d: {
          kind: string;
          component: string;
          message: string;
          file: string;
        }) => `${d.file}|${d.kind}|${d.component}|${d.message}`
      )
      .sort();

    out[unit.id] = {
      css: manifest.css ?? '',
      code,
      hasComponents,
      diagnostics,
      observables: {
        componentFragmentKeys: Object.keys(fragmentsOf(manifest)).sort(),
        reverseProvenanceEdges: Object.entries(
          manifest.reverse_provenance ?? manifest.reverseProvenance ?? {}
        )
          .flatMap(([parent, children]) =>
            (children as string[]).map((c) => `${parent}->${c}`)
          )
          .sort(),
        systemPropMapJson: canonicalJson(
          manifest.system_prop_map ?? manifest.systemPropMap ?? {}
        ),
        dynamicPropsJson: canonicalJson(
          manifest.dynamic_props ?? manifest.dynamicProps ?? {}
        ),
        sheetsJson: canonicalJson(manifest.sheets ?? {}),
        componentFragmentsJson: canonicalJson(fragmentsOf(manifest)),
      },
      parseCount:
        typeof manifest.timing?.parseCount === 'number'
          ? manifest.timing.parseCount
          : typeof manifest.parseCount === 'number'
            ? manifest.parseCount
            : null,
    };
  }

  process.stdout.write(JSON.stringify(out, null, 1));
}

main().catch((e) => {
  process.stderr.write(String(e?.stack ?? e));
  process.exit(2);
});
