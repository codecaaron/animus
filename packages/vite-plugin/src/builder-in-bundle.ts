import {
  effectiveLevel,
  surfaceManifestDiagnostics,
  systemBuilderShippedDiagnostic,
} from '@animus-ui/extract/pipeline';
import { readFileSync } from 'fs';
import { dirname, isAbsolute, join, relative } from 'path';

import type { PluginContext } from './context';
import type { Rolldown } from 'vite';

/** The package whose builder the record reports. */
const SYSTEM_PACKAGE = '@animus-ui/system';

/** Exports a module of the system package renders only where it keeps the
 *  builder: its dist entry, or the source modules that implement it. */
const BUILDER_EXPORTS: ReadonlySet<string> = new Set([
  'createSystem',
  'createTheme',
  'SystemBuilder',
  'ThemeBuilder',
]);

/** What the chain reads of a module: Rollup and Rolldown's module info. */
interface ModuleLinks {
  readonly isEntry: boolean;
  readonly importers: readonly string[];
  readonly dynamicImporters: readonly string[];
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
  const policy = {
    levels: ctx.options.diagnostics,
    strict: ctx.options.strict,
    info: (line: string) => ctx.log(line),
    reportErrors: ctx.reportErrors(),
  };
  const level = effectiveLevel(systemBuilderShippedDiagnostic('', []), policy);
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
    diagnostics = Object.values(bundle).flatMap((file) => {
      if (file.type !== 'chunk') return [];
      // The builder exports the chunk renders, from every module of the
      // system package that renders one, and the first such module.
      const rendered = new Set<string>();
      let builder: string | undefined;
      for (const [id, module] of Object.entries(file.modules)) {
        const names = module.renderedExports.filter((name) =>
          BUILDER_EXPORTS.has(name)
        );
        if (names.length === 0 || !ownedBySystem(id)) continue;
        builder ??= id;
        for (const name of names) rendered.add(name);
      }
      if (builder === undefined) return [];
      const chain = importChain(builder, moduleInfo, renderedModules).filter(
        (id) => !ownedBySystem(id)
      );
      return [
        systemBuilderShippedDiagnostic(
          file.fileName,
          chain.map((id) => relative(ctx.rootDir, id)),
          {
            system:
              rendered.has('createSystem') || rendered.has('SystemBuilder'),
            theme: rendered.has('createTheme') || rendered.has('ThemeBuilder'),
          }
        ),
      ];
    });
  } catch (err) {
    ctx.log(`system builder check skipped: ${String(err)}`);
    return;
  }
  if (diagnostics.length === 0) return;
  surfaceManifestDiagnostics(
    { diagnostics },
    (message) => ctx.warn(message),
    policy
  );
}

/** The name of the package each module id lies in (its nearest
 *  `package.json`), read once per directory. */
class PackageOwners {
  private readonly byDir = new Map<string, string | null>();

  of(id: string): string | null {
    // A virtual or query-suffixed id names no file.
    if (!isAbsolute(id) || id.includes('?')) return null;
    return this.inDir(dirname(id));
  }

  private inDir(dir: string): string | null {
    const known = this.byDir.get(dir);
    if (known !== undefined) return known;
    let name: string | null;
    try {
      // SAFETY: npm requires a manifest's `name` to be a string; one that is
      // not compares unequal to the system package's, as an absent one does.
      const manifest = JSON.parse(
        readFileSync(join(dir, 'package.json'), 'utf8')
      ) as { name?: string };
      name = manifest.name ?? null;
    } catch {
      const parent = dirname(dir);
      name = parent === dir ? null : this.inDir(parent);
    }
    this.byDir.set(dir, name);
    return name;
  }
}

/** An import chain from an entry down to `target`, `target` left out,
 *  through the fewest modules no chunk renders: a module the bundle
 *  tree-shook explains nothing, but one that only re-exports renders
 *  nothing and may still be the way in, so it is crossed where no rendered
 *  path exists. Empty where no entry reaches `target`. */
function importChain(
  target: string,
  moduleInfo: (id: string) => ModuleLinks | null,
  rendered: ReadonlySet<string>
): string[] {
  // A 0-1 search: crossing a module no chunk renders costs one.
  const cost = new Map<string, number>([[target, 0]]);
  // Each module reached, and the module it imports on the way to `target`.
  const toward = new Map<string, string>();
  const queue: string[] = [target];
  const done = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (done.has(id)) continue;
    done.add(id);
    const info = moduleInfo(id);
    if (info === null) continue;
    if (info.isEntry && id !== target) {
      const chain: string[] = [];
      for (let at = id; at !== target; at = toward.get(at)!) chain.push(at);
      return chain;
    }
    for (const importer of [...info.importers, ...info.dynamicImporters]) {
      if (done.has(importer)) continue;
      const step = rendered.has(importer) ? 0 : 1;
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
