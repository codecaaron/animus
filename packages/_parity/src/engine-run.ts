/** Runs one engine over the whole corpus in a fresh process: cross-process
 *  determinism is measured, and native map order is per-process. */
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

import { classifyCliFailure } from './cli-messages';
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
const require_ = createRequire(import.meta.url);

const engine = process.argv.includes('--engine')
  ? process.argv[process.argv.indexOf('--engine') + 1]
  : 'v2';
const devMode = process.argv.includes('--dev');

interface ParityManifest extends Pick<
  ProjectManifest,
  'css' | 'diagnostics' | 'reverse_provenance' | 'parseCount'
> {
  sheets: JsonObject;
  component_fragments: JsonObject;
  system_prop_map: JsonObject;
  dynamic_props: JsonObject;
}

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
  // SAFETY: the value comes from the repository-owned index-v2.js bridge, and
  // the function-tag check above fails loud before construction.
  return candidate as NativeEngineModule;
}

function loadEngine(name: string): EngineApi {
  if (name === 'v2') {
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

/** The test system exports no global blocks or keyframes; supplying them here
 *  keeps those resolution paths from passing vacuously. */
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
/** The test system registers no condition aliases; supplying them here keeps
 *  the condition corpus from resolving vacuously. */
const HARNESS_CONDITION_ALIASES = JSON.stringify({
  _motionReduce: {
    value: '@media (prefers-reduced-motion: reduce)',
    order: 500,
    kind: 'media',
  },
  // The real built-in cascade orders: the built-in band must sort ahead of the
  // user band for the ordering fixture to prove anything.
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

/** A missing field throws instead of defaulting: an empty observable compares
 *  equal to a baseline that recorded nothing, hiding a regression. */
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

/** The NAPI can reject with a plain JSON value carrying a `stack` string
 *  instead of an `Error`; that is the one non-`Error` shape decoded here. */
function toEngineError<Thrown>(thrown: Thrown): Error {
  if (thrown instanceof Error) return thrown;
  const error = new Error(String(thrown));
  const stack =
    thrown instanceof Object && 'stack' in thrown ? thrown.stack : null;
  if (Object.prototype.toString.call(stack) === '[object String]') {
    error.stack = String(stack);
  }
  return error;
}

async function main() {
  const { ds, tokens } = await import(
    join(ROOT, 'packages/extract/tests/test-system.ts')
  );
  const config = ds.toConfig();
  const theme = tokens.serialize();

  const api = loadEngine(engine);
  const units = await enumerateUnits();
  // A shrunken corpus must fail loud, not pass empty; raise the floor as the
  // corpus grows.
  if (units.length < 30) {
    throw new Error(
      `corpus vacuity: only ${units.length} units enumerated (floor 30) — check fixture/corpus paths`
    );
  }
  const out: Record<string, UnitSurface> = {};

  for (const unit of units) {
    try {
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
          // The oracle compares raw engine output, so it declares no bundler
          // emitter identity; emitter ids stay at the engine defaults.
          emitterConfigJson: null,
          selectorAliasesJson: config.selectorAliases ?? null,
          globalStyleBlocksJson: HARNESS_GLOBAL_BLOCKS,
          pathAliasesJson: null,
          keyframesJson: HARNESS_KEYFRAMES,
          staticCssJson: null,
          conditionAliasesJson: HARNESS_CONDITION_ALIASES,
          externalDirsJson: null,
          // Without transform sources the oracle records package-shipped
          // transforms as unresolvable, blessing a fallback consumers lack.
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
          componentFragmentKeys: Object.keys(
            manifest.component_fragments
          ).sort(),
          reverseProvenanceEdges: Object.entries(manifest.reverse_provenance)
            .flatMap(([parent, children]) =>
              children.map((child) => `${parent}->${child}`)
            )
            .sort(),
          // Native map iteration order varies across processes, so the
          // observable is sorted content rather than emission order.
          systemPropMapJson: canonicalJson(manifest.system_prop_map),
          dynamicPropsJson: canonicalJson(manifest.dynamic_props),
          sheetsJson: canonicalJson(manifest.sheets),
          componentFragmentsJson: canonicalJson(manifest.component_fragments),
        },
        parseCount: manifest.parseCount,
      };
    } catch (thrown) {
      throw toEngineError(thrown);
    }
  }

  process.stdout.write(JSON.stringify(out, null, 1));
}

main().catch((error: Error) => {
  const failure = classifyCliFailure(error);
  process.stderr.write(failure.stderr);
  process.exit(failure.exitCode);
});
