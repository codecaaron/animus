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

  it('registers external package directories, and the absent system paths no watched directory covers, alongside system paths', () => {
    // A watch on an absent file inside a watched directory stops that
    // directory's events under inotify; the directory's own watch already
    // reports the creation.
    const { ctx, add } = contextWithWatcher({
      systemDependencyPaths: ['/ws/tokens/src/theme.ts'],
      systemMissingPaths: [
        '/ws/app/src/theme.js',
        '/ws/tokens/src/extra.ts',
        '/ws/ui-kit/src/Missing.ts',
      ],
      externalPackageDirs: ['/ws/ui-kit/src'],
    });
    ctx.rootDir = '/ws/app';
    ctx.registerSystemWatchPaths();
    expect(add.mock.calls).toEqual([
      [['/ws/tokens/src/theme.ts']],
      [['/ws/tokens/src/extra.ts']],
      [['/ws/ui-kit/src']],
    ]);
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
