import {
  effectiveLevel,
  systemBuilderShippedDiagnostic,
} from '@animus-ui/extract/pipeline';
import { readFileSync } from 'fs';
import { dirname, isAbsolute, join, relative, resolve } from 'path';

import type { PluginContext } from './context';
import type { Rolldown } from 'vite';

/** The package whose builder the record reports. */
const SYSTEM_PACKAGE = '@animus-ui/system';

/** Exports a module of the system package renders only where it keeps the
 *  system builder, or the theme builder: its dist entry, or the source
 *  modules that implement them. */
const SYSTEM_EXPORTS: ReadonlySet<string> = new Set([
  'createSystem',
  'SystemBuilder',
]);
const THEME_EXPORTS: ReadonlySet<string> = new Set([
  'createTheme',
  'ThemeBuilder',
]);

/** What the chain reads of a module: Rollup and Rolldown's module info. */
interface ModuleLinks {
  readonly isEntry: boolean;
  readonly importers: readonly string[];
  readonly dynamicImporters: readonly string[];
  readonly importedIds: readonly string[];
}

/**
 * Reports, at info, each chunk of a production client build that renders
 * the system builder from any installed copy of `@animus-ui/system`, dist
 * or source, with the import chain that keeps it. A build drops the builder
 * where no runtime code reads a module that builds the system, so this is
 * the one place that loss shows: the CSS is the same.
 *
 * Nothing runs where the record would not print: off, or info without
 * verbose. It resolves nothing, so it adds no import the build's own graph
 * lacks. A failure to read the bundle's modules skips the record and leaves
 * the build as it was; an escalated record still fails it.
 */
export function reportShippedBuilder(
  ctx: PluginContext,
  bundle: Rolldown.OutputBundle,
  moduleInfo: (id: string) => ModuleLinks | null
): void {
  const policy = ctx.diagnosticPolicy();
  const level = effectiveLevel(
    systemBuilderShippedDiagnostic('', { system: [] }),
    policy
  );
  if (level === 'off' || (level === 'info' && !ctx.verbose)) return;
  let diagnostics;
  try {
    const owners = new PackageOwners();
    const ownedBySystem = (id: string) => owners.of(id) === SYSTEM_PACKAGE;
    // Every module some chunk renders code for.
    const renderedModules = new Set(
      Object.values(bundle).flatMap((file) =>
        file.type === 'chunk'
          ? Object.entries(file.modules)
              .filter(([, module]) => module.renderedLength > 0)
              .map(([id]) => id)
          : []
      )
    );
    // The project's modules that import each builder from the system
    // package, read once where some chunk ships one.
    let holders: BuilderHolders | undefined;
    diagnostics = Object.values(bundle).flatMap((file) => {
      if (file.type !== 'chunk') return [];
      // Per builder, the system package's modules this chunk renders it in.
      const rendering: BuilderModules = {
        system: [],
        theme: [],
      };
      for (const [id, module] of Object.entries(file.modules)) {
        const names = module.renderedExports;
        const system = names.some((name) => SYSTEM_EXPORTS.has(name));
        const theme = names.some((name) => THEME_EXPORTS.has(name));
        if ((!system && !theme) || !ownedBySystem(id)) continue;
        if (system) rendering.system.push(id);
        if (theme) rendering.theme.push(id);
      }
      if (rendering.system.length === 0 && rendering.theme.length === 0) {
        return [];
      }
      holders ??= builderHolders(ctx, moduleInfo);
      // A chain ends at a module holding the builder; where none is known
      // (a compiled kit), at the system package's module that renders it.
      const chainTo = (kind: 'system' | 'theme') => {
        if (rendering[kind].length === 0) return undefined;
        // A holder explains this chunk's builder only where the bundle
        // renders it and its runtime imports reach the very package
        // instance rendering the builder here: a type-only import is
        // erased, and another installed copy is another instance.
        const instances = new Set(
          rendering[kind].map((id) => owners.systemInstanceOf(id))
        );
        const admitted = holders![kind].filter(
          (id) =>
            renderedModules.has(id) &&
            (moduleInfo(id)?.importedIds ?? []).some((dep) =>
              instances.has(owners.systemInstanceOf(dep))
            )
        );
        const targets = admitted.length > 0 ? admitted : rendering[kind];
        return importChain(targets, moduleInfo, renderedModules)
          .filter((id) => !ownedBySystem(id))
          .map((id) => relative(ctx.rootDir, id));
      };
      return [
        systemBuilderShippedDiagnostic(file.fileName, {
          system: chainTo('system'),
          theme: chainTo('theme'),
        }),
      ];
    });
  } catch (err) {
    ctx.log(`system builder check skipped: ${String(err)}`);
    return;
  }
  if (diagnostics.length === 0) return;
  ctx.surfaceDiagnostics(diagnostics);
}

/** The name of the package each module id lies in (its nearest
 *  `package.json`), read once per directory. */
class PackageOwners {
  private readonly byDir = new Map<string, OwningPackage | null>();

  of(id: string): string | null {
    return this.packageOf(id)?.name ?? null;
  }

  /** The directory of the system package instance `id` lies in; `null`
   *  outside one. Two installed copies are two instances. */
  systemInstanceOf(id: string): string | null {
    const owning = this.packageOf(id);
    return owning?.name === SYSTEM_PACKAGE ? owning.dir : null;
  }

  private packageOf(id: string): OwningPackage | null {
    // A virtual or query-suffixed id names no file.
    if (!isAbsolute(id) || id.includes('?')) return null;
    return this.inDir(dirname(id));
  }

  private inDir(dir: string): OwningPackage | null {
    const known = this.byDir.get(dir);
    if (known !== undefined) return known;
    let owning: OwningPackage | null;
    try {
      // SAFETY: npm requires a manifest's `name` to be a string; one that is
      // not compares unequal to the system package's, as an absent one does.
      const manifest = JSON.parse(
        readFileSync(join(dir, 'package.json'), 'utf8')
      ) as { name?: string };
      owning = { name: manifest.name ?? null, dir };
    } catch {
      const parent = dirname(dir);
      owning = parent === dir ? null : this.inDir(parent);
    }
    this.byDir.set(dir, owning);
    return owning;
  }
}

/** The package a module lies in: its nearest `package.json`. */
interface OwningPackage {
  readonly name: string | null;
  readonly dir: string;
}

/** Per builder, module ids. */
interface BuilderModules {
  system: string[];
  theme: string[];
}

/** The project's modules, by id, that import each builder from the system
 *  package by name (`createSystem`, `createTheme`) and are in the build's
 *  module graph: from the facts the Session already parsed, through its
 *  cache. Candidates only: a chunk admits one where the bundle renders it
 *  and its runtime imports reach the instance rendering the builder there.
 *  A namespace member or a re-exported factory is not followed; its chain
 *  ends at the package module. */
interface BuilderHolders {
  readonly system: readonly string[];
  readonly theme: readonly string[];
}

function builderHolders(
  ctx: PluginContext,
  moduleInfo: (id: string) => ModuleLinks | null
): BuilderHolders {
  const corpus = ctx.session?.corpus;
  if (!corpus) return { system: [], theme: [] };
  const entries = [...corpus.published.analysisEntries].map(
    ([path, { hash, source }]) => ({ path, hash, source })
  );
  const system = new Set<string>();
  const theme = new Set<string>();
  for (const [path, facts] of Object.entries(corpus.facts(entries).files)) {
    const id = resolve(ctx.rootDir, path);
    for (const fact of facts.imports) {
      if (fact.source !== SYSTEM_PACKAGE) continue;
      if (fact.imported === 'createSystem') system.add(id);
      if (fact.imported === 'createTheme') theme.add(id);
    }
  }
  const inGraph = (ids: Set<string>) =>
    [...ids].filter((id) => moduleInfo(id) !== null);
  return { system: inGraph(system), theme: inGraph(theme) };
}

/** An import chain from an entry down to one of `targets`, that target
 *  included, through the fewest modules no chunk renders: a module the
 *  bundle tree-shook explains nothing, but one that only re-exports renders
 *  nothing and may still be the way in, so it is crossed where no rendered
 *  path exists. Empty where no entry reaches a target. */
function importChain(
  targets: readonly string[],
  moduleInfo: (id: string) => ModuleLinks | null,
  rendered: ReadonlySet<string>
): string[] {
  // A 0-1 search: each module no chunk renders costs one.
  const weight = (id: string) => (rendered.has(id) ? 0 : 1);
  const cost = new Map<string, number>();
  // Each module reached, and the module it imports on the way to a target.
  const toward = new Map<string, string>();
  const queue: string[] = [];
  for (const target of targets) {
    cost.set(target, weight(target));
    if (weight(target) === 0) queue.unshift(target);
    else queue.push(target);
  }
  const done = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (done.has(id)) continue;
    done.add(id);
    const info = moduleInfo(id);
    if (info === null) continue;
    if (info.isEntry) {
      const chain: string[] = [id];
      for (let at = toward.get(id); at !== undefined; at = toward.get(at)) {
        chain.push(at);
      }
      return chain;
    }
    for (const importer of [...info.importers, ...info.dynamicImporters]) {
      if (done.has(importer)) continue;
      const step = weight(importer);
      const reached = cost.get(id)! + step;
      if (reached >= (cost.get(importer) ?? Infinity)) continue;
      cost.set(importer, reached);
      toward.set(importer, id);
      if (step === 0) queue.unshift(importer);
      else queue.push(importer);
    }
  }
  return [];
}
