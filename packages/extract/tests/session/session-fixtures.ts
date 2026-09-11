import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  buildSystemPropsModule,
  hashReplacementPlans,
  snapshotFilePlans,
} from '../../pipeline';
import { ExtractionSession } from '../../session/extraction-session';
import { SINGLETON_GLOBAL_KEYS } from '../../session/singleton';

import type {
  AnalysisSourceEntry,
  ManifestComponentDescriptor,
  ProjectManifest,
} from '../../pipeline';
import type { SessionOptions } from '../../session/extraction-session';
import type { CliLockRecord } from '../../session/published-set';

export const ANIMUS_GLOBAL_KEYS = SINGLETON_GLOBAL_KEYS;

type AnimusGlobalKey = (typeof ANIMUS_GLOBAL_KEYS)[number];

/**
 * Restores through saved property descriptors: the singleton's slot value
 * types are private, so no value is named or inspected here.
 */
export function resetAnimusGlobals(): () => void {
  const saved = new Map<AnimusGlobalKey, PropertyDescriptor>();
  for (const key of ANIMUS_GLOBAL_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    if (descriptor !== undefined) saved.set(key, descriptor);
    Object.assign(globalThis, { [key]: undefined });
  }
  return () => {
    // Keys absent before the reset keep the own `undefined` the clearing wrote.
    for (const [key, descriptor] of saved) {
      Object.defineProperty(globalThis, key, descriptor);
    }
  };
}

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
 * A complete `ProjectManifest` at empty-universe values: the engine
 * serializes every field, so a missing field means "not a manifest".
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

export function buildManifest(
  components: Record<string, ManifestComponentDescriptor>,
  css = '.btn{margin:8px;}'
): string {
  return JSON.stringify(makeManifest({ components, css }));
}

const tempRoots: string[] = [];

export function makeTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

export function disposeTempRoots(): void {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
}

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

/** App system module importing a sibling kit: the import is what admits the
 *  kit as an external root. */
export const KIT_SYSTEM_SOURCE = `import { createSystem } from '@animus-ui/system';
import kit from '../../kits/ui/src/index.ts';
export const system = createSystem({}).extend(kit);
`;

/** `kitOld` is unreachable from the app's system module, so it is never
 *  admitted as an external root. */
export interface KitWorkspace {
  parent: string;
  app: string;
  kit: string;
  kitOld: string;
}

/**
 * Realpath'd because macOS resolves `/var` through a symlink and the session
 * compares resolved roots.
 */
export function createKitWorkspace(
  systemSource: string = KIT_SYSTEM_SOURCE
): KitWorkspace {
  const parent = realpathSync(makeTempRoot('animus-kit-workspace-'));
  const app = join(parent, 'app');
  mkdirSync(join(app, 'src'), { recursive: true });
  writeFileSync(join(app, 'package.json'), '{"name":"app"}');
  writeFileSync(join(app, 'src', 'system.ts'), systemSource);
  writeFileSync(join(app, 'src', 'App.tsx'), 'export const App = 1;\n');
  const kit = join(parent, 'kits', 'ui');
  mkdirSync(join(kit, 'src'), { recursive: true });
  writeFileSync(join(kit, 'package.json'), '{"name":"@kits/ui"}');
  writeFileSync(join(kit, 'src', 'index.ts'), "export * from './Button';\n");
  writeFileSync(join(kit, 'src', 'Button.tsx'), BUTTON_SOURCE);
  const kitOld = join(parent, 'kits', 'ui-old');
  mkdirSync(join(kitOld, 'src'), { recursive: true });
  writeFileSync(join(kitOld, 'src', 'Rogue.tsx'), 'export const Rogue = 1;\n');
  return { parent, app, kit, kitOld };
}

export function makeSession(
  root: string,
  options: Partial<SessionOptions> = {}
): ExtractionSession {
  const session = new ExtractionSession({
    system: './src/system.ts',
    ...options,
  });
  session.rootDir = root;
  return session;
}

export async function startSession(
  root: string,
  options: Partial<SessionOptions> = {}
): Promise<ExtractionSession> {
  const session = makeSession(root, options);
  await session.runFullPipeline();
  return session;
}

interface AnalyzeProjectRecorder {
  mock: { calls: ReadonlyArray<readonly [string, ...unknown[]]> };
}

/** Throws when no call was recorded: an empty answer would compare equal to
 *  a corpus that analyzed nothing. */
export function lastAnalyzedFiles(
  analyzeProject: AnalyzeProjectRecorder
): AnalysisSourceEntry[] {
  const { calls } = analyzeProject.mock;
  if (calls.length === 0) {
    throw new Error('no analyzeProject call was recorded');
  }
  const corpus: unknown = JSON.parse(calls[calls.length - 1][0]);
  if (!Array.isArray(corpus)) {
    throw new Error('analyzeProject was called with a non-array corpus');
  }
  // SAFETY: the recorder captured the session's own serialized corpus, whose
  // element type the session declares (`AnalysisSourceEntry`).
  return corpus as AnalysisSourceEntry[];
}

/** rootDir-relative paths of the file set the last analysis received. */
export function lastAnalyzedPaths(
  analyzeProject: AnalyzeProjectRecorder
): string[] {
  return lastAnalyzedFiles(analyzeProject).map((entry) => entry.path);
}

export function lockRecord({
  pid = process.pid,
  ageMs = 0,
}: { pid?: number; ageMs?: number } = {}): CliLockRecord {
  const at = new Date(Date.now() - ageMs).toISOString();
  return { pid, startedAt: at, heartbeatAt: at };
}

export type ReplacementPlan = Pick<
  ManifestComponentDescriptor,
  'file' | 'replacement'
>;

/** Keyed by `<file>::<binding>` component id. */
export type ReplacementPlans = Record<string, ReplacementPlan>;

const SYSTEM_PROPS_WITNESS = buildSystemPropsModule({
  systemPropMapJson: '{}',
  groupRegistryJson: SYSTEM_CONFIG.groupRegistry,
  dynamicProps: {},
});

export function expectedEpoch(
  components: Record<string, ManifestComponentDescriptor>
): string {
  return hashReplacementPlans(
    snapshotFilePlans({ components }),
    SYSTEM_PROPS_WITNESS
  );
}
