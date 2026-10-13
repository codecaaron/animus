import {
  createExcludeMatcher,
  DEFAULT_EXTENSIONS,
} from '@animus-ui/extract/pipeline';
import { resolve } from 'path';

import { PluginContext } from '../src/context';
import { makeManifest } from './manifest-fixture';

import type { ObservedOutcome } from '../src/context';
import type {
  ProjectManifest,
  SourceEntryOwnership,
} from '@animus-ui/extract/pipeline';
import type {
  SessionPublication,
  WatchChanges,
} from '@animus-ui/extract/session';
import type { DevEnvironment } from 'vite';

/** What the probe's Session holds: its sources by root-relative path, and
 *  the published corpus's analysis entries and ownership. */
export interface ProbeSession {
  heldSources: Map<string, { hash: string; source: string }>;
  corpus: {
    published: {
      analysisEntries: Map<string, { path: string; source: string }>;
      ownership: Record<string, SourceEntryOwnership>;
    };
  };
}

/** The Session's answer to one submission. */
export type ProbeResponder = (
  changes: WatchChanges
) => ObservedOutcome[] | Promise<ObservedOutcome[]>;

/** `vi.mock` is a no-op in this runner, so a hook runs against a plain object
 *  carrying the state it touches, extended through `extras`. The Session is
 *  scripted: `submitChanges` records each change set and returns what
 *  `respond` answers, by default an unchanged republication. */
export interface ContextProbe {
  ctx: PluginContext;
  session: ProbeSession;
  /** Every change set submitted to the Session, in order. */
  submissions: WatchChanges[];
  extractedInvalidations: number;
  infoLines: string[];
  verboseLines: string[];
  warnings: string[];
  respond(responder: ProbeResponder): void;
}

/** A Session publication carrying `fields`, every other one empty. */
export function publicationWith(
  fields: Partial<SessionPublication> = {}
): SessionPublication {
  return {
    manifest: makeManifest(),
    manifestJson: '{}',
    analysisGlobalCss: '',
    analysisComponentCss: '',
    styles: '',
    systemPropsModule: '',
    system: {
      propConfigJson: '{}',
      groupRegistryJson: '{}',
      scalesJson: '{}',
      variableMapJson: '{}',
      variableCss: '',
      contextualVarsJson: '{}',
      selectorAliasesJson: null,
      globalStyleBlocksJson: null,
      keyframesJson: null,
    },
    packageMap: {},
    ownership: {},
    analyzedHashes: new Map(),
    packageReadRecord: null,
    replacementEpoch: '',
    externalPackageDirs: [],
    externalSourceEntries: new Map(),
    externalSourceSideEffects: new Map(),
    ...fields,
  };
}

/** Serves `fields` merged into what the context serves now, as adopting a
 *  publication does. */
export function serve(
  ctx: PluginContext,
  fields: Partial<SessionPublication>
): void {
  ctx.served = { ...publicationWith(), ...ctx.served, ...fields };
}

/** A published outcome: `manifest` becomes the served manifest, as the
 *  context's adoption does. */
export function published(
  probe: ContextProbe,
  options: {
    manifest?: ProjectManifest;
    pass?: 'full' | 'incremental';
    planChanged?: string[];
    endedHold?: boolean;
    redeliver?: string[];
    systemPropsChanged?: boolean;
  } = {}
): ObservedOutcome {
  if (options.manifest) serve(probe.ctx, { manifest: options.manifest });
  return {
    outcome: {
      kind: 'published',
      // SAFETY: the Vite half reads no field of the publication itself.
      publication: {} as Extract<
        ObservedOutcome['outcome'],
        { kind: 'published' }
      >['publication'],
      pass: options.pass ?? 'incremental',
      planChanged: options.planChanged ?? [],
      endedHold: options.endedHold ?? false,
      redeliver: options.redeliver ?? [],
    },
    systemPropsChanged: options.systemPropsChanged ?? false,
  };
}

/** A held outcome over the given aborted originals (path → hash). */
export function held(
  abortedOriginals: Record<string, string>
): ObservedOutcome {
  return {
    outcome: {
      kind: 'held',
      abortedOriginals: new Map(Object.entries(abortedOriginals)),
    },
    systemPropsChanged: false,
  };
}

interface ProbeModuleNode {
  id: string;
  url: string;
  file: string | null;
}

interface ProbeModuleGraph {
  getModulesByFile(file: string): Set<ProbeModuleNode> | undefined;
  getModuleById(id: string): ProbeModuleNode | undefined;
  invalidateModule(module: ProbeModuleNode): void;
}

type ContextProbeOverrides = Partial<PluginContext>;

export function makeEnvGraph(opts: {
  rootDir: string;
  file?: string;
  ids?: string[];
}) {
  const absPath = opts.file ? resolve(opts.rootDir, opts.file) : null;
  const invalidated: string[] = [];
  const nodes = (opts.ids ?? (absPath ? [absPath] : [])).map((id) => ({
    id,
    url: id,
    file: absPath,
  }));
  const moduleGraph: ProbeModuleGraph = {
    getModulesByFile: (file) =>
      absPath && file === absPath ? new Set(nodes) : undefined,
    getModuleById: (id) => nodes.find((node) => node.id === id),
    invalidateModule: (module) => {
      invalidated.push(module.id);
    },
  };
  return {
    invalidated,
    // SAFETY: The probe models every moduleGraph method its Vite consumers
    // call, and each node carries the id, url, and file fields they read back.
    moduleGraph: moduleGraph as DevEnvironment['moduleGraph'],
  };
}

export function makeContextProbe<Overrides extends ContextProbeOverrides>(
  rootDir: string,
  extras?: Overrides
): ContextProbe {
  let probe: ContextProbe;
  let responder: ProbeResponder = () => [published(probe)];
  const session: ProbeSession = {
    heldSources: new Map(),
    corpus: { published: { analysisEntries: new Map(), ownership: {} } },
  };
  // The served publication's views are getters: extras naming one seed the
  // publication the probe serves instead.
  const {
    storedManifest,
    storedManifestJson,
    system,
    externalPackageDirs,
    externalSourceEntries,
    externalSourceSideEffects,
    ...hooks
  } = extras ?? {};
  const fields: Partial<SessionPublication> = {
    manifest: storedManifest ?? makeManifest(),
    externalPackageDirs: externalPackageDirs ?? [],
  };
  if (storedManifestJson !== undefined)
    fields.manifestJson = storedManifestJson;
  if (system !== undefined) fields.system = system;
  if (externalSourceEntries !== undefined) {
    fields.externalSourceEntries = new Map(externalSourceEntries);
  }
  if (externalSourceSideEffects !== undefined) {
    fields.externalSourceSideEffects = new Map(externalSourceSideEffects);
  }
  const served = publicationWith(fields);
  // A context instance whose own fields shadow every member the Vite hooks
  // read, the Session reduced to the sources and corpus they consult;
  // owner-typed extras are spread last for each exact hook consumer.
  const ctx: PluginContext = Object.assign(
    Object.create(PluginContext.prototype),
    {
      isProd: false,
      verbose: false,
      tracing: false,
      rootDir,
      options: {},
      served,
      excludeMatcher: createExcludeMatcher(undefined),
      extensionsSet: new Set<string>(DEFAULT_EXTENSIONS),
      outputExcludes: [],
      assetCopyDir: null,
      session,
      abortedParseHashes: new Map<string, string>(),
      transformOutputHashes: new Map<string, string>(),
      recordTransformOutput(
        this: PluginContext,
        relativePath: string,
        code: string
      ) {
        this.transformOutputHashes.set(relativePath, `probe:${code.length}`);
      },
      async submitChanges(changes: WatchChanges) {
        probe.submissions.push(changes);
        return responder(changes);
      },
      invalidateExtractedModules() {
        probe.extractedInvalidations++;
      },
      invalidateSystemReloadModules() {},
      log(msg: string) {
        probe.verboseLines.push(msg);
      },
      trace(msg: string) {
        probe.verboseLines.push(msg);
      },
      info(msg: string) {
        probe.infoLines.push(msg);
      },
      warn(msg: string) {
        probe.warnings.push(msg);
      },
      ...hooks,
    }
  );
  probe = {
    ctx,
    session,
    submissions: [],
    extractedInvalidations: 0,
    infoLines: [],
    verboseLines: [],
    warnings: [],
    respond(next) {
      responder = next;
    },
  };
  return probe;
}
