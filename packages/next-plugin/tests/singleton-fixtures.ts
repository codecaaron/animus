import {
  buildSystemPropsModule,
  hashReplacementPlans,
  snapshotFilePlans,
} from '@animus-ui/extract/pipeline';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { SINGLETON_GLOBAL_KEYS } from '../../extract/session/singleton';

import type {
  ManifestComponentDescriptor,
  ProjectManifest,
} from '@animus-ui/extract/pipeline';

/**
 * Shared, webpack-free fixtures for the next-plugin behavioral suites: the
 * singleton globalThis hygiene, the canned SystemConfig, the Button project
 * corpus, the canonical manifest builder, the temp-root lifecycle, and the
 * replacement-epoch witness. Suites (and the webpack gauntlet harness, which
 * re-exports for its test files) import these instead of re-declaring them.
 */

/** Every globalThis key owned by the session singleton (packages/extract/session/singleton.ts) — sourced from the
 *  singleton's own exported list, never re-declared. */
export const ANIMUS_GLOBAL_KEYS = SINGLETON_GLOBAL_KEYS;

/** One singleton-owned key, taken from the singleton's own exported list. */
type AnimusGlobalKey = (typeof ANIMUS_GLOBAL_KEYS)[number];

/**
 * Clear every singleton-owned global (simulating a fresh process) and
 * return a restorer for afterEach. Callers that only want the clearing
 * (gauntlet sessions) ignore the return value.
 *
 * The singleton keeps each slot's value type private (`AnimusSingletonStore`
 * in packages/extract/session/singleton.ts), so this fixture never names or
 * inspects a value: it carries each key's own property descriptor out and
 * back. Clearing writes the same `undefined` assignment it always did.
 */
export function resetAnimusGlobals(): () => void {
  const saved = new Map<AnimusGlobalKey, PropertyDescriptor>();
  for (const key of ANIMUS_GLOBAL_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    if (descriptor !== undefined) saved.set(key, descriptor);
    Object.assign(globalThis, { [key]: undefined });
  }
  return () => {
    // Keys with no saved descriptor were absent before the reset; restoring
    // them has always meant leaving an own key valued `undefined`, which the
    // clearing pass above already wrote.
    for (const [key, descriptor] of saved) {
      Object.defineProperty(globalThis, key, descriptor);
    }
  };
}

/** Canned loadSystemModule return value (NAPI camelCase surface). */
export const SYSTEM_CONFIG = {
  propConfig: '{"props":{}}',
  groupRegistry: '{"groups":{}}',
  scalesJson: '{"space":{}}',
  variableMapJson: '{"map":{}}',
  variableCss: ':root{--anm-space-1: 4px}',
  contextualVarsJson: null,
  selectorAliases: null,
  globalStyleBlocks: null,
  keyframesBlocks: null,
};

export const BUTTON_SOURCE =
  "export const Button = animus.styles({ margin: 8 }).asElement('button');\n";
/** Style-value-only edit — replacement plans unchanged. */
export const BUTTON_STYLE_EDIT =
  "export const Button = animus.styles({ margin: 16 }).asElement('button');\n";
/** Config edit — replacement plans move. */
export const BUTTON_PLAN_EDIT =
  "export const Button = animus.styles({ margin: 16 }).variant({}).asElement('button');\n";

/**
 * A COMPLETE `ProjectManifest` at its empty-universe values, overridden per
 * test — the next-plugin twin of `packages/vite-plugin/tests/manifest-fixture
 * .ts` (each package keeps a local copy; test directories are not importable
 * across packages).
 *
 * The engine's `AnalyzeResult` declares no `Option` and no
 * `skip_serializing_if` at the top level (see `manifest-schema.ts`), so an
 * empty project still serializes `{}` / `[]` / `""` for every field — absence
 * means "not a manifest". Fakes that omitted fields were the only thing
 * keeping `manifest?.sheets`-style shape guards alive in the shared pipeline;
 * building every fake from this base is what lets those guards go.
 */
export function makeManifest(
  overrides: Partial<ProjectManifest> = {}
): ProjectManifest {
  return {
    fileFacts: {},
    crossFile: {
      componentNames: [],
      classResolvers: [],
      memberBindings: {},
      renderedComponents: [],
      variantOptions: {},
      stateNames: {},
    },
    parseCount: 0,
    usageResidue: [],
    css: '',
    sheets: {
      declaration: '',
      global: '',
      base: '',
      variants: '',
      compounds: '',
      states: '',
      system: '',
      custom: '',
    },
    diagnostics: [],
    report: {
      components_total: 0,
      components_extracted: 0,
      components_eliminated: 0,
      variants_total: 0,
      variants_used: 0,
      variants_eliminated: 0,
      states_total: 0,
      states_used: 0,
      states_eliminated: 0,
      components_forced: 0,
      variants_forced: 0,
      states_forced: 0,
      eliminated_details: [],
    },
    system_prop_map: {},
    dynamic_props: {},
    component_fragments: {},
    reverse_provenance: {},
    components: {},
    files: {},
    timing: { parseCount: 0 },
    ...overrides,
  };
}

/**
 * One component descriptor. `file` and `replacement` are the two fields the
 * epoch/plan derivation reads; the rest carry the engine's own empty values
 * so a fake descriptor is a whole one.
 */
export function makeComponent(
  file: string,
  replacement = ''
): ManifestComponentDescriptor {
  return {
    file,
    binding: '',
    class_name: '',
    extends_from: null,
    terminal: 'asElement',
    tag: 'div',
    replacement,
    system_prop_names: [],
  };
}

export const PLAN_A = {
  'src/Button.tsx::Button': makeComponent(
    'src/Button.tsx',
    "createComponent('button', 'a')"
  ),
};
export const PLAN_B = {
  'src/Button.tsx::Button': makeComponent(
    'src/Button.tsx',
    "createComponent('button', 'b')"
  ),
};

/** Canonical engine-manifest JSON for a component set — a COMPLETE
 *  `ProjectManifest`, so the pipeline's typed reads hold in these suites. */
export function buildManifest(
  components: Record<string, ManifestComponentDescriptor>,
  css = '.btn{margin:8px;}'
): string {
  return JSON.stringify(makeManifest({ components, css }));
}

const tempRoots: string[] = [];

/**
 * Make a temp directory under the OS temp dir and register it for
 * `disposeTempRoots`. The one disposal policy for every temp tree these
 * suites create — recursive + force, per-file `afterEach`, and never through
 * a symlinked fixture tree (nothing here links out of `tmpdir()`).
 */
export function makeTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

/** Remove every root registered since the last disposal — raw roots from
 *  `makeTempRoot` and project fixtures from `createProject` alike. Call it
 *  from afterEach. */
export function disposeTempRoots(): void {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Temp project carrying src/system.ts + src/Button.tsx. Roots are
 *  registered for `disposeTempRoots` (call it from afterEach). */
export function createProject(prefix: string): string {
  const root = makeTempRoot(prefix);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'src', 'system.ts'),
    'export const system = { space: [0, 4, 8] };\n'
  );
  writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SOURCE);
  return root;
}

/** The (file, replacement) projection of one component descriptor — the two
 *  fields the epoch derivation reads (`snapshotFilePlans`,
 *  packages/extract/pipeline/replacement-plans.ts). Reader-side validators
 *  assert artifacts read back from disk carry at least this projection. */
export type ReplacementPlan = Pick<
  ManifestComponentDescriptor,
  'file' | 'replacement'
>;

/** The manifest `components` map these fixtures drive, keyed by
 *  `<file>::<binding>` component id. */
export type ReplacementPlans = Record<string, ReplacementPlan>;

/** The served system-props module the fixture pipeline emits — the epoch's
 *  served-dependency witness (fixture manifests carry empty prop maps). */
const SYSTEM_PROPS_WITNESS = buildSystemPropsModule({
  systemPropMapJson: '{}',
  groupRegistryJson: SYSTEM_CONFIG.groupRegistry,
  dynamicProps: {},
});

/** The canonical replacement epoch for a component set — the value the
 *  session must publish and write to its epoch artifact. Takes complete
 *  descriptors (`makeComponent`) because the epoch derivation reads a
 *  typed manifest projection. */
export function expectedEpoch(
  components: Record<string, ManifestComponentDescriptor>
): string {
  return hashReplacementPlans(
    snapshotFilePlans({ components }),
    SYSTEM_PROPS_WITNESS
  );
}
