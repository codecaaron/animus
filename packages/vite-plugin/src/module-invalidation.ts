import { resolve } from 'path';

import type { PluginContext } from './context';

/**
 * Completeness is load-bearing: the file-plan diff is the only invalidation
 * candidate source, so a node shape missed here stays stale for the session.
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
