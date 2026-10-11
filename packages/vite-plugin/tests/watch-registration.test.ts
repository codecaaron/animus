import { ExtractionSession } from '@animus-ui/extract/session';
import { describe, expect, it, vi } from 'vitest';

import { PluginContext } from '../src/context';

interface WatchedPaths {
  systemDependencyPaths?: string[];
  systemMissingPaths?: string[];
  externalPackageDirs?: string[];
}

/** External package sources live outside the root walk: without `watcher.add`
 *  their edits never reach `hotUpdate` and stale CSS survives the session. */
describe('registerSystemWatchPaths', () => {
  function contextWithWatcher(paths: WatchedPaths) {
    const ctx = new PluginContext({ system: './src/ds.ts' });
    const add = vi.fn();
    ctx.devServer = { watcher: { add } };
    // Registration reads only these three path lists of the Session.
    ctx.session = Object.assign(Object.create(ExtractionSession.prototype), {
      systemDependencyPaths: [],
      systemMissingPaths: [],
      externalPackageDirs: [],
      ...paths,
    });
    return { ctx, add };
  }

  it('registers loader-reported system dependency paths, once per list', () => {
    const { ctx, add } = contextWithWatcher({
      systemDependencyPaths: ['/ws/tokens/src/theme.ts'],
    });
    ctx.registerSystemWatchPaths();
    ctx.registerSystemWatchPaths();
    expect(add.mock.calls).toEqual([[['/ws/tokens/src/theme.ts']]]);
  });

  it('registers absent system paths and external package directories alongside system paths', () => {
    const { ctx, add } = contextWithWatcher({
      systemDependencyPaths: ['/ws/tokens/src/theme.ts'],
      systemMissingPaths: ['/ws/tokens/src/extra.ts'],
      externalPackageDirs: ['/ws/ui-kit/src'],
    });
    ctx.registerSystemWatchPaths();
    expect(add).toHaveBeenCalledWith(['/ws/tokens/src/theme.ts']);
    expect(add).toHaveBeenCalledWith(['/ws/tokens/src/extra.ts']);
    expect(add).toHaveBeenCalledWith(['/ws/ui-kit/src']);
  });

  it('registers external package directories even with no system paths', () => {
    const { ctx, add } = contextWithWatcher({
      externalPackageDirs: ['/ws/ui-kit/src'],
    });
    ctx.registerSystemWatchPaths();
    expect(add).toHaveBeenCalledWith(['/ws/ui-kit/src']);
  });

  it('no-ops without a dev server', () => {
    const { ctx } = contextWithWatcher({
      externalPackageDirs: ['/ws/ui-kit/src'],
    });
    ctx.devServer = undefined;
    expect(() => ctx.registerSystemWatchPaths()).not.toThrow();
  });
});
