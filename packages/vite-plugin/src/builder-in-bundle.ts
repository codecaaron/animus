import {
  surfaceManifestDiagnostics,
  systemBuilderShippedDiagnostic,
} from '@animus-ui/extract/pipeline';
import { relative } from 'path';

import type { PluginContext } from './context';
import type { Rolldown } from 'vite';

/** Exports of `@animus-ui/system`'s root module that a chunk renders only
 *  where it keeps the builder. */
const BUILDER_EXPORTS: ReadonlySet<string> = new Set([
  'createSystem',
  'createTheme',
  'SystemBuilder',
]);

/** What the chain reads of a module: Rollup and Rolldown's module info. */
interface ModuleLinks {
  readonly isEntry: boolean;
  readonly importers: readonly string[];
  readonly dynamicImporters: readonly string[];
}

/**
 * Reports, at info, each chunk of a production client build that renders
 * the builder of `systemModule` (`@animus-ui/system`'s root module, as the
 * system file resolves it), with the import chain that keeps it. A build
 * drops the builder where no runtime code reads a module that builds the
 * system, so this is the one place that loss shows: the CSS is the same.
 */
export function reportShippedBuilder(
  ctx: PluginContext,
  bundle: Rolldown.OutputBundle,
  systemModule: string,
  moduleInfo: (id: string) => ModuleLinks | null
): void {
  const diagnostics = Object.values(bundle).flatMap((file) => {
    if (file.type !== 'chunk') return [];
    const rendered = file.modules[systemModule]?.renderedExports ?? [];
    if (!rendered.some((name) => BUILDER_EXPORTS.has(name))) return [];
    const chain = importChain(systemModule, moduleInfo);
    return [
      systemBuilderShippedDiagnostic(
        file.fileName,
        chain.map((id) => relative(ctx.rootDir, id))
      ),
    ];
  });
  if (diagnostics.length === 0) return;
  surfaceManifestDiagnostics({ diagnostics }, (message) => ctx.warn(message), {
    levels: ctx.options.diagnostics,
    strict: ctx.options.strict,
    info: (line) => ctx.log(line),
    reportErrors: ctx.reportErrors(),
  });
}

/** The shortest import chain from an entry down to `target`, `target` left
 *  out, through the module graph: a module that only re-exports is part of
 *  it though no chunk renders it. Empty where no entry reaches it. */
function importChain(
  target: string,
  moduleInfo: (id: string) => ModuleLinks | null
): string[] {
  // Each module reached, and the module it imports on the way to `target`.
  const toward = new Map<string, string>([[target, target]]);
  let frontier = [target];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      const info = moduleInfo(id);
      if (info === null) continue;
      if (info.isEntry && id !== target) {
        const chain: string[] = [];
        for (let at = id; at !== target; at = toward.get(at)!) chain.push(at);
        return chain;
      }
      for (const importer of [...info.importers, ...info.dynamicImporters]) {
        if (toward.has(importer)) continue;
        toward.set(importer, id);
        next.push(importer);
      }
    }
    frontier = next;
  }
  return [];
}
