import { describe, expect, it, vi } from 'vitest';

import { PluginContext } from '../src/context';

/**
 * External DS package sources live outside the root walk, so
 * without an explicit `watcher.add` their edits and deletions never reach
 * `hotUpdate` — the pruning path exists but no event ever drives it, and the
 * last-extracted CSS survives for the life of the dev server.
 */
describe('registerSystemWatchPaths', () => {
  function contextWithWatcher() {
    const ctx = new PluginContext({ system: './src/ds.ts' });
    const add = vi.fn();
    ctx.devServer = { watcher: { add } };
    return { ctx, add };
  }

  it('registers loader-reported system dependency paths', () => {
    const { ctx, add } = contextWithWatcher();
    ctx.systemDependencyPaths = ['/ws/tokens/src/theme.ts'];
    ctx.registerSystemWatchPaths();
    expect(add).toHaveBeenCalledWith(['/ws/tokens/src/theme.ts']);
  });

  it('registers external package directories alongside system paths', () => {
    const { ctx, add } = contextWithWatcher();
    ctx.systemDependencyPaths = ['/ws/tokens/src/theme.ts'];
    ctx.externalPackageDirs = ['/ws/ui-kit/src'];
    ctx.registerSystemWatchPaths();
    expect(add).toHaveBeenCalledWith(['/ws/tokens/src/theme.ts']);
    expect(add).toHaveBeenCalledWith(['/ws/ui-kit/src']);
  });

  it('registers external package directories even with no system paths', () => {
    const { ctx, add } = contextWithWatcher();
    ctx.externalPackageDirs = ['/ws/ui-kit/src'];
    ctx.registerSystemWatchPaths();
    expect(add).toHaveBeenCalledWith(['/ws/ui-kit/src']);
  });

  it('no-ops without a dev server', () => {
    const ctx = new PluginContext({ system: './src/ds.ts' });
    ctx.externalPackageDirs = ['/ws/ui-kit/src'];
    expect(() => ctx.registerSystemWatchPaths()).not.toThrow();
  });
});
