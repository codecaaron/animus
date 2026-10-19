import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';

import {
  buildSystemPropsModule,
  hashReplacementPlans,
  snapshotFilePlans,
} from '../../pipeline';
import { ExtractionSession } from '../../session/extraction-session';
import { SESSION_REGISTRY_KEY } from '../../session/singleton';

import type {
  AnalysisSourceEntry,
  EngineApi,
  ManifestComponentDescriptor,
  ProjectManifest,
} from '../../pipeline';
import type {
  SessionHost,
  SessionOptions,
} from '../../session/extraction-session';
import type { CliLockRecord } from '../../session/published-set';
import type {
  RegistryPublication,
  SessionKey,
  SessionState,
} from '../../session/singleton';

/** The engine-free tests' stand-in for the native `resolveSpecifier`: a
 *  package as Node's `require.resolve` finds it, else a declared workspace's
 *  `main`, `module` or `index.ts`. These tests exercise the session, not
 *  package resolution, which the native resolver owns. */
export const requireResolveSpecifier: NonNullable<
  EngineApi['resolveSpecifier']
> = (specifier, fromDir, _conditions, workspaces) => {
  try {
    return {
      path: createRequire(import.meta.url).resolve(specifier, {
        paths: [fromDir],
      }),
    };
  } catch {
    const packageDir = workspaces?.[specifier];
    if (packageDir === undefined) return {};
    try {
      const manifest = JSON.parse(
        readFileSync(join(packageDir, 'package.json'), 'utf-8')
      );
      return {
        path: join(packageDir, manifest.main || manifest.module || 'index.ts'),
      };
    } catch {
      return {};
    }
  }
};

/** The key of the build a participant joined most recently: a harness that
 *  drives one host build reads that build's state through it. */
export function latestSessionKey(): SessionKey {
  // SAFETY: singleton.ts is the only writer of this symbol, and it stores
  // exactly this shape, entries in join order.
  const holder = globalThis as typeof globalThis & {
    [SESSION_REGISTRY_KEY]?: { sessions: Map<string, { key: SessionKey }> };
  };
  const states = [...(holder[SESSION_REGISTRY_KEY]?.sessions.values() ?? [])];
  const latest = states[states.length - 1];
  if (latest === undefined)
    throw new Error('no participant has joined a build');
  return latest.key;
}

/**
 * Clears the session registry, every build's state, for one test, and
 * restores it through its saved property descriptor. The engine-API test
 * seam lives outside the registry and survives.
 */
/** Merges `fields` into the build's committed publication, as a session's
 *  commit would write it; the rest keep their empty values. */
export function publishRecord(
  state: SessionState,
  fields: Partial<RegistryPublication>
): void {
  state.publication = {
    manifestJson: '{}',
    styles: '',
    fontPreloads: [],
    systemPropsModule: '',
    analyzedHashes: new Map(),
    packageReadRecord: null,
    replacementEpoch: '',
    externalPackageDirs: [],
    externalSourceEntries: new Map(),
    externalSourceSideEffects: new Map(),
    ...state.publication,
    ...fields,
  };
}

export function resetAnimusGlobals(): () => void {
  const saved = Object.getOwnPropertyDescriptor(
    globalThis,
    SESSION_REGISTRY_KEY
  );
  Reflect.deleteProperty(globalThis, SESSION_REGISTRY_KEY);
  return () => {
    Reflect.deleteProperty(globalThis, SESSION_REGISTRY_KEY);
    if (saved !== undefined)
      Object.defineProperty(globalThis, SESSION_REGISTRY_KEY, saved);
  };
}

/** The engine-handle store's size: the handles hosts still hold. */
export function engineHandleCount(): number {
  const registry: unknown = Object.getOwnPropertyDescriptor(
    globalThis,
    SESSION_REGISTRY_KEY
  )?.value;
  // SAFETY: the session registry's own global slot, whose `engines` map is
  // the engine-handle store.
  return (
    (registry as { engines?: ReadonlyMap<string, () => EngineApi> })?.engines
      ?.size ?? 0
  );
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
    chainBindings: {},
    parseCount: 0,
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
    admitted_transforms: {},
    typed_system_props: [],
    system_fingerprint: '',
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
    definition_fingerprint: '',
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

const REPO_ROOT = resolve(__dirname, '../../../..');

/**
 * An app whose system includes `kit/definition`, with `kit` installed and a
 * copy, `alt-kit`, whose definition's `brand` is `#ff6347` (the installed
 * one's is `#111111`): a host alias of `kit` to `alt-kit` is visible in the
 * extracted CSS (C8). `esm` writes `"type": "module"` packages with a `.js`
 * runtime entry, as Vite's ESM resolution reads them; otherwise `.mjs`.
 */
export function createAliasedKitApp(
  prefix: string,
  options: { esm?: boolean } = {}
): string {
  const root = realpathSync(makeTempRoot(prefix));
  const type = options.esm ? ',"type":"module"' : '';
  const runtime = options.esm ? 'definition.js' : 'definition.mjs';
  const write = (path: string, contents: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  };
  mkdirSync(join(root, 'node_modules', '@animus-ui'), { recursive: true });
  for (const name of ['system', 'properties']) {
    symlinkSync(
      join(REPO_ROOT, 'packages', name),
      join(root, 'node_modules', '@animus-ui', name)
    );
  }
  write('package.json', `{"name":"app"${type}}`);
  for (const [name, brand] of [
    ['kit', '#111111'],
    ['alt-kit', '#ff6347'],
  ] as const) {
    write(
      `node_modules/${name}/package.json`,
      `{"name":"${name}"${type},"exports":{"./definition":{"animus":"./src/definition.ts","default":"./dist/${runtime}"}}}`
    );
    write(
      `node_modules/${name}/src/definition.ts`,
      `import { createSystem } from '@animus-ui/system';
export const ds = createSystem().build().seal();
export const brand = '${brand}';
`
    );
    write(`node_modules/${name}/dist/${runtime}`, 'export const ds = {};\n');
  }
  write(
    'src/system.ts',
    `import { createSystem, createTheme } from '@animus-ui/system';
import { ds as kit, brand } from 'kit/definition';
export const theme = createTheme().addColors({ brand: { 500: brand } }).build();
export const ds = createSystem().extend(kit).build().seal();
`
  );
  write('src/App.tsx', 'export const App = 1;\n');
  return root;
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
  options: Partial<SessionOptions> = {},
  host: SessionHost = {}
): ExtractionSession {
  const session = new ExtractionSession(
    {
      system: './src/system.ts',
      ...options,
    },
    host
  );
  session.rootDir = root;
  return session;
}

export async function startSession(
  root: string,
  options: Partial<SessionOptions> = {},
  host: SessionHost = {}
): Promise<ExtractionSession> {
  const session = makeSession(root, options, host);
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
  admittedTransforms: {},
  typedSystemProps: [],
  runtimeTables: undefined,
});

export function expectedEpoch(
  components: Record<string, ManifestComponentDescriptor>
): string {
  return hashReplacementPlans(
    snapshotFilePlans({ components }),
    SYSTEM_PROPS_WITNESS
  );
}
