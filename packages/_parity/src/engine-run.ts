/**
 * CHILD entry: one engine, whole corpus, one dev-mode — run in a FRESH
 * process per invocation (cross-process determinism is part of what the
 * harness measures; std HashMap ordering is per-process).
 *
 * stdout: canonical JSON  Record<unitId, UnitSurface>
 * argv:   --engine v2 [--dev]
 */
import {
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonObject,
} from '@animus-ui/assertions';
import {
  buildAnalyzeProjectArgs,
  createV2EngineApi,
} from '@animus-ui/extract/pipeline';
import { createRequire } from 'module';
import { join } from 'path';

import { canonicalJson } from './content-hash';
import { enumerateUnits } from './corpus';

import type { UnitSurface } from './types';
import type { JsonObject, JsonValue } from '@animus-ui/assertions';
import type {
  EngineApi,
  ManifestDiagnostic,
  ProjectManifest,
  V2ExtractEngine,
} from '@animus-ui/extract/pipeline';

const ROOT = join(import.meta.dirname, '../../..');
// Direct relative path — documented workaround for the bun>=1.3.12
// createRequire "types"-condition bug (root AGENTS.md § Key Rules).
const require_ = createRequire(import.meta.url);

const engine = process.argv.includes('--engine')
  ? process.argv[process.argv.indexOf('--engine') + 1]
  : 'v2';
const devMode = process.argv.includes('--dev');

/**
 * The manifest slice this harness records.
 *
 * Field names and types are the PRODUCER's (`ProjectManifest` in
 * `@animus-ui/extract/pipeline`) — the harness keeps no second read model and
 * no second spelling. Its own observable names stay camelCase below; that
 * renaming happens where the surface is built, not by re-declaring the wire.
 *
 * `sheets` / `component_fragments` / `system_prop_map` / `dynamic_props` are
 * recorded as canonicalized bytes rather than interpreted, so this ingress
 * proves only that each is a JSON object. Their element contracts have a
 * runtime witness already — `packages/_integration/__tests__/
 * manifest-shape.test.ts` decodes a real manifest against `ProjectManifest` —
 * and re-checking them here would fork that witness, not strengthen it.
 */
interface ParityManifest extends Pick<
  ProjectManifest,
  'css' | 'diagnostics' | 'reverse_provenance' | 'parseCount'
> {
  sheets: JsonObject;
  component_fragments: JsonObject;
  system_prop_map: JsonObject;
  dynamic_props: JsonObject;
}

type EngineFailure = Error | JsonValue;

type NativeEngineConstructor =
  (typeof import('../../extract/crates/extract-v2'))['ExtractEngine'];

interface NativeEngineModuleCandidate {
  ExtractEngine?: object | null;
}

interface NativeEngineModule {
  ExtractEngine: NativeEngineConstructor;
}

function parseNativeEngineModule(
  candidate: NativeEngineModuleCandidate
): NativeEngineModule {
  if (
    Object.prototype.toString.call(candidate.ExtractEngine) !==
    '[object Function]'
  ) {
    throw new TypeError('v2 NAPI module is missing ExtractEngine');
  }
  // SAFETY: This value comes from the repository-owned index-v2.js bridge;
  // its generated declaration owns the constructor/instance contract, and the
  // function-tag check fails loud before this adapter attempts construction.
  return candidate as NativeEngineModule;
}

function loadEngine(name: string): EngineApi {
  if (name === 'v2') {
    // The oracle drives the SAME adapter the production plugins do
    // (packages/extract/pipeline/engine-adapter.ts): config inputs move from
    // the positional analyzeProject tuple to the engine constructor options,
    // and transformFile reads retained state instead of a manifest. Per-run
    // state lives in closure variables (the vite-plugin's storage shape).
    // Fail-loud surfaces (compose emission, resolved extension chains) throw
    // through.
    const native = parseNativeEngineModule(
      require_(join(ROOT, 'packages/extract/index-v2.js'))
    );
    let instance: V2ExtractEngine | null = null;
    let sentSources: Map<string, string> | null = null;
    let driftWarned = false;
    return createV2EngineApi({
      label: 'animus-parity',
      isV2: () => true,
      loadNativeEngine: () => native,
      store: {
        getEngine: () => instance,
        setEngine: (next) => {
          instance = next;
        },
        getSentSources: () => sentSources,
        setSentSources: (next) => {
          sentSources = next;
        },
        getDriftWarned: () => driftWarned,
        setDriftWarned: (value) => {
          driftWarned = value;
        },
      },
    })();
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
/** Harness-supplied condition alias registry (modern-css-surface inc 03/06).
 *  The test system registers none, so — exactly like HARNESS_GLOBAL_BLOCKS /
 *  HARNESS_KEYFRAMES above — the harness supplies one so the condition corpus
 *  fixtures resolve instead of remaining green-by-vacuity. Shape mirrors the
 *  serialized `conditionAliases` manifest field: alias → {value,order,kind}.
 *
 *  `_motionReduce` (order 500) is the pre-existing inc-03 user-band entry that
 *  the blessed `condition-aliased` unit depends on — left BYTE-IDENTICAL so
 *  existing baselines do not move. Inc 06 ADDS the built-in-band entries the
 *  new `condition-builtin-*` staging fixtures reference (`_osDark`, `_print`)
 *  at their real built-in cascade orders (design D8, band 300–380). Additive
 *  only: existing units are keyed by alias name and never touch these keys. */
const HARNESS_CONDITION_ALIASES = JSON.stringify({
  _motionReduce: {
    value: '@media (prefers-reduced-motion: reduce)',
    order: 500,
    kind: 'media',
  },
  // Built-in condition aliases (media-condition-aliases) at their reserved-band
  // orders — the `condition-builtin-*` fixtures prove built-ins resolve with no
  // user registration, and `condition-builtin-order` proves the built-in band
  // (370) emits before the user band (500).
  _osDark: {
    value: '@media (prefers-color-scheme: dark)',
    order: 370,
    kind: 'media',
  },
  _print: {
    value: '@media print',
    order: 320,
    kind: 'media',
  },
});

function parseJsonObjectField(candidate: JsonValue, field: string): JsonObject {
  if (!isJsonObject(candidate)) {
    throw new TypeError(`engine manifest ${field} must be an object`);
  }
  return candidate;
}

function parseDiagnostics(candidate: JsonValue): ManifestDiagnostic[] {
  if (!Array.isArray(candidate)) {
    throw new TypeError('engine manifest diagnostics must be an array');
  }
  return candidate.map((diagnostic, index) => {
    if (
      !isJsonObject(diagnostic) ||
      !isJsonString(diagnostic.kind) ||
      !isJsonString(diagnostic.component) ||
      !isJsonString(diagnostic.message) ||
      !isJsonString(diagnostic.file)
    ) {
      throw new TypeError(`engine manifest diagnostics[${index}] is malformed`);
    }
    return {
      kind: diagnostic.kind,
      component: diagnostic.component,
      message: diagnostic.message,
      file: diagnostic.file,
    };
  });
}

function parseReverseProvenance(
  candidate: JsonValue
): ProjectManifest['reverse_provenance'] {
  if (!isJsonObject(candidate)) {
    throw new TypeError('engine manifest reverse provenance must be an object');
  }
  const provenance: ProjectManifest['reverse_provenance'] = {};
  for (const [parentId, children] of Object.entries(candidate)) {
    if (!Array.isArray(children) || !children.every(isJsonString)) {
      throw new TypeError(
        `engine manifest reverse provenance ${parentId} must be a string array`
      );
    }
    provenance[parentId] = children;
  }
  return provenance;
}

/**
 * Decode the engine manifest into the recorded slice.
 *
 * Every field is read at its ONE emitted spelling. `ProjectManifest` declares
 * them all as always-present (the Rust `AnalyzeResult` carries no `Option` and
 * no `skip_serializing_if` at the top level), so a missing field is a producer
 * change and must fail the harness rather than be defaulted into an empty
 * observable — a silently-empty observable compares equal to a baseline that
 * recorded nothing, which is how a real regression would hide.
 */
function parseManifest(manifestJson: string): ParityManifest {
  const candidate = parseJsonObject(manifestJson, 'ExtractEngine.analyze');
  const css = candidate.css;
  if (!isJsonString(css)) {
    throw new TypeError('engine manifest css must be a string');
  }
  const parseCount = candidate.parseCount;
  if (!isJsonNumber(parseCount)) {
    throw new TypeError('engine manifest parseCount must be a number');
  }

  return {
    css,
    diagnostics: parseDiagnostics(candidate.diagnostics),
    component_fragments: parseJsonObjectField(
      candidate.component_fragments,
      'component fragments'
    ),
    reverse_provenance: parseReverseProvenance(candidate.reverse_provenance),
    system_prop_map: parseJsonObjectField(
      candidate.system_prop_map,
      'system prop map'
    ),
    dynamic_props: parseJsonObjectField(
      candidate.dynamic_props,
      'dynamic props'
    ),
    sheets: parseJsonObjectField(candidate.sheets, 'sheets'),
    parseCount,
  };
}

function engineFailureText(failure: EngineFailure): string {
  if (failure instanceof Error) return failure.stack ?? String(failure);
  if (isJsonObject(failure) && isJsonString(failure.stack)) {
    return failure.stack;
  }
  return String(failure);
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
      ...buildAnalyzeProjectArgs({
        filesJson: JSON.stringify(unit.files),
        scalesJson: theme.scalesJson,
        variableMapJson: theme.variableMapJson,
        contextualVarsJson: theme.contextualVarsJson || null,
        propConfigJson: config.propConfig,
        groupRegistryJson: config.groupRegistry,
        packageResolutionJson: '{}',
        devMode,
        // emitterConfigJson — the oracle compares raw engine output, so it
        // declares no bundler emitter identity (runtime import / css module
        // id / system-props module id all stay at the engine defaults).
        emitterConfigJson: null,
        selectorAliasesJson: config.selectorAliases ?? null,
        globalStyleBlocksJson: HARNESS_GLOBAL_BLOCKS,
        pathAliasesJson: null,
        keyframesJson: HARNESS_KEYFRAMES,
        // staticCssJson — current parity corpus has no forced-emission input.
        staticCssJson: null,
        conditionAliasesJson: HARNESS_CONDITION_ALIASES,
        // externalDirsJson — the harness declares no external packages.
        externalDirsJson: null,
        // Transform sources from the evaluated test system. Without this the
        // oracle would record every package-shipped transform (`size`,
        // `gridItem`, …) as unresolvable, blessing a raw-value fallback that
        // real consumers do not get.
        transformSourcesJson: config.transformSources ?? null,
      })
    );
    const manifest = parseManifest(manifestJson);

    const code: Record<string, string> = {};
    const hasComponents: Record<string, boolean> = {};
    for (const f of unit.files) {
      const r = api.transformFile(f.source, f.path, manifestJson);
      code[f.path] = r.code;
      hasComponents[f.path] = r.hasComponents;
    }

    const diagnostics = manifest.diagnostics
      .map(
        (diagnostic) =>
          `${diagnostic.file}|${diagnostic.kind}|${diagnostic.component}|${diagnostic.message}`
      )
      .sort();

    out[unit.id] = {
      css: manifest.css,
      code,
      hasComponents,
      diagnostics,
      observables: {
        componentFragmentKeys: Object.keys(manifest.component_fragments).sort(),
        reverseProvenanceEdges: Object.entries(manifest.reverse_provenance)
          .flatMap(([parent, children]) =>
            children.map((child) => `${parent}->${child}`)
          )
          .sort(),
        // Key-sorted via the comparator's own canonical form — native maps
        // can vary iteration order across fresh processes; the observable is
        // sorted content, not incidental emission order.
        systemPropMapJson: canonicalJson(manifest.system_prop_map),
        dynamicPropsJson: canonicalJson(manifest.dynamic_props),
        sheetsJson: canonicalJson(manifest.sheets),
        componentFragmentsJson: canonicalJson(manifest.component_fragments),
      },
      parseCount: manifest.parseCount,
    };
  }

  process.stdout.write(JSON.stringify(out, null, 1));
}

/** 2 = the harness refused to run, matching `cli.ts`'s taxonomy (documented
 *  in full at its `.catch`). This subprocess never emits a 1: it reports
 *  engine facts on stdout and lets `cli.ts` decide whether the gate passed,
 *  so "ran and failed" is not a state this entry point can be in. */
main().catch((error: EngineFailure) => {
  process.stderr.write(engineFailureText(error));
  process.exit(2);
});
