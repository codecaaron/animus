import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declaredWorkspacePackages } from '../../pipeline/workspace-packages';

describe('declaredWorkspacePackages', () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'animus-workspaces-')));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const workspace = (dir: string, name: string) => {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, 'package.json'), JSON.stringify({ name }));
  };

  // Contract: the session captures the workspace packages npm and Yarn
  // declare for its root: literal entries, `*` within a segment, `**`
  // across directories, `!` removals, never through `node_modules` or into
  // a dot directory, each name kept by the first entry to declare it.
  it('names the packages npm and Yarn find for each entry', () => {
    workspace('packages/a', 'pa');
    workspace('packages/node_modules/x', 'px');
    workspace('packages/.hidden', 'ph');
    workspace('apps/web-one', 'w1');
    workspace('apps/api', 'api');
    workspace('tools/deep', 'td');
    workspace('tools/deep/nested/t', 'tn');
    workspace('libs/skip', 'ls');
    workspace('libs/keep', 'lk');
    workspace('first', 'dup');
    workspace('packages/dup', 'dup');
    mkdirSync(join(root, 'packages/empty'));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        workspaces: [
          'first',
          'packages/*',
          'apps/web-*',
          'tools/**',
          'libs/*',
          '!libs/skip',
        ],
      })
    );

    expect(declaredWorkspacePackages(root)).toEqual({
      dup: join(root, 'first'),
      pa: join(root, 'packages/a'),
      w1: join(root, 'apps/web-one'),
      td: join(root, 'tools/deep'),
      tn: join(root, 'tools/deep/nested/t'),
      lk: join(root, 'libs/keep'),
    });
  });
});
