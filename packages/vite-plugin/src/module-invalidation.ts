import { resolve } from 'path';

import type { PluginContext } from './context';

/**
 * Evict every module node the dev server holds for each file — every
 * environment graph (client, ssr, and any custom environment), by-file node
 * sets (covers query-suffixed variants), plus the absolute-path id lookup.
 * Falls back to the mixed compat graph for hosts without environment
 * graphs. Returns the number of nodes invalidated.
 *
 * Completeness here is load-bearing: the file-plan diff is the ONLY
 * invalidation candidate source, so a node shape this enumeration misses
 * stays stale for the life of the server (openspec: dev-transform-coherence,
 * "Client and SSR nodes are both evicted").
 */
export function invalidateFileModules(
  ctx: PluginContext,
  relPaths: string[]
): number {
  const server = ctx.devServer;
  if (!server || relPaths.length === 0) return 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphs: any[] = server.environments
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Object.values(server.environments)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((env: any) => env?.moduleGraph)
        .filter(Boolean)
    : [server.moduleGraph].filter(Boolean);

  let total = 0;
  for (const relPath of relPaths) {
    const absPath = resolve(ctx.rootDir, relPath);
    let fileCount = 0;
    for (const graph of graphs) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nodes = new Set<any>();
      const byFile = graph.getModulesByFile?.(absPath);
      if (byFile) for (const mod of byFile) nodes.add(mod);
      const byId = graph.getModuleById?.(absPath);
      if (byId) nodes.add(byId);
      for (const mod of nodes) {
        graph.invalidateModule(mod);
        fileCount++;
      }
    }
    if (fileCount > 0) {
      ctx.log(`HMR invalidate: ${relPath} (plan changed, ${fileCount} nodes)`);
    }
    total += fileCount;
  }
  return total;
}
