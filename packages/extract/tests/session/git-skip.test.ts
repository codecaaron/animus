import { execFileSync } from 'child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'fs';
import { dirname, join, posix } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { fakeEngineApi, nativeFunctions } from '../native-functions';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn<(...args: AnalyzeProjectArgs) => string>(),
  clearAnalysisCache: vi.fn(),
  moduleSpecifiers: vi.fn<(files: string, aliases?: string) => string>(),
}));

import { setEngineApiOverride } from '../../session/singleton';

setEngineApiOverride(() => ({
  ...fakeEngineApi(),
  extractModuleFacts: () => '{"files":{},"parseCount":0}',
  loadSystemModule: mocks.loadSystemModule,
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
  moduleSpecifiers: mocks.moduleSpecifiers,
}));

import {
  buildManifest,
  createProject,
  disposeTempRoots,
  lastAnalyzedPaths,
  makeSession,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from './session-fixtures';

import type { AnalyzeProjectArgs } from '../../pipeline';

let restoreGlobals: () => void;

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
  mocks.loadSystemModule.mockReset().mockReturnValue({ ...SYSTEM_CONFIG });
  mocks.moduleSpecifiers
    .mockReset()
    .mockImplementation((files, aliases) =>
      nativeFunctions().moduleSpecifiers(files, aliases)
    );
  // As the engine's `prepare` names them: each relative specifier, joined
  // to its importer's directory.
  mocks.analyzeProject.mockReset().mockImplementation((...args) => {
    const files: Array<{ path: string; source: string }> = JSON.parse(args[0]);
    const bases = files.flatMap(({ path, source }) =>
      [...source.matchAll(/from '(\.[^']+)'/g)].map((match) =>
        posix.join(posix.dirname(path), match[1])
      )
    );
    // Each `import.meta.glob` call, listed as the computed load it is.
    const loads = files.flatMap(({ path, source }) =>
      [...source.matchAll(/import\.meta\.glob\(/g)].map((match) => ({
        importer: path,
        start: match.index ?? 0,
        kind: 'glob' as const,
        args: null,
      }))
    );
    // `probeEvidence`, the last of `AnalyzeProjectArgs`.
    args[25]?.(bases, 'identity', loads);
    return buildManifest({});
  });
});

afterEach(() => {
  restoreGlobals();
  vi.restoreAllMocks();
  disposeTempRoots();
});

/** A project whose root is a git repository, holding `files`. */
function gitProject(
  files: Record<string, string>,
  { repository = true } = {}
): string {
  const root = createProject('animus-git-skip-');
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  if (repository) execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
}

const analysed = () => lastAnalyzedPaths(mocks.analyzeProject).sort();

/** Contract: an ignored, never-imported file is not analysed; an ignored,
 *  imported one is. A directory below the root that is a git checkout of
 *  its own counts as ignored. */
describe('an ignored, never-imported file is not analysed; an ignored, imported one is', () => {
  const files = {
    '.gitignore': '.publish/\ngen/\n',
    '.publish/old/bundle.js': 'export const stale = 1;\n',
    'gen/route.ts':
      "import { leaf } from './leaf';\nexport const route = leaf;\n",
    'gen/leaf.ts': 'export const leaf = 1;\n',
    'gen/unused.ts': 'export const unused = 1;\n',
    'src/App.tsx':
      "import { route } from '../gen/route';\nexport const App = route;\n",
  };

  test('ignored files: skipped unless imported, transitively', async () => {
    const root = gitProject(files);
    const session = makeSession(root);
    await session.runFullPipeline();
    expect(analysed()).toEqual([
      'gen/leaf.ts',
      'gen/route.ts',
      'src/App.tsx',
      'src/Button.tsx',
      'src/system.ts',
    ]);
    session.close();
  });

  test('a checkout of its own: skipped unless imported', async () => {
    const root = gitProject({
      'src/App.tsx':
        "import { used } from '../wt/src/used';\nexport const App = used;\n",
      'wt/.git': 'gitdir: /elsewhere\n',
      'wt/src/used.ts': 'export const used = 1;\n',
      'wt/src/Copy.tsx': 'export const Copy = 1;\n',
      'clone/.git/HEAD': 'ref: refs/heads/main\n',
      'clone/src/Other.tsx': 'export const Other = 1;\n',
    });
    const session = makeSession(root);
    await session.runFullPipeline();
    expect(analysed()).toEqual([
      'src/App.tsx',
      'src/Button.tsx',
      'src/system.ts',
      'wt/src/used.ts',
    ]);
    session.close();
  });

  test('no repository: nothing is skipped as ignored', async () => {
    const root = gitProject(files, { repository: false });
    const session = makeSession(root);
    await session.runFullPipeline();
    expect(analysed()).toContain('gen/unused.ts');
    expect(analysed()).toContain('.publish/old/bundle.js');
    session.close();
  });

  test('a root git ignores itself: nothing is skipped as ignored', async () => {
    const root = gitProject({
      '.gitignore': 'app/\n',
      'app/.gitignore': 'gen/\n',
      'app/src/system.ts': 'export const system = { space: [0, 4, 8] };\n',
      'app/gen/unused.ts': 'export const unused = 1;\n',
    });
    const session = makeSession(join(root, 'app'));
    await session.runFullPipeline();
    expect(analysed()).toContain('gen/unused.ts');
    session.close();
  });

  test('past the round bound, a pass analyses everything git ignores', async () => {
    // Each round then finds one more link: none is followed ahead.
    mocks.moduleSpecifiers.mockReturnValue('{"files":{}}');
    const chain = ['a', 'b', 'c', 'd', 'e'];
    const root = gitProject({
      '.gitignore': '.publish/\ngen/\n',
      '.publish/stale.js': 'export const stale = 1;\n',
      'src/App.tsx': "import { a } from '../gen/a';\nexport const App = a;\n",
      ...Object.fromEntries(
        chain.map((name, index) => [
          `gen/${name}.ts`,
          index + 1 < chain.length
            ? `import { ${chain[index + 1]} } from './${chain[index + 1]}';\nexport const ${name} = ${chain[index + 1]};\n`
            : `export const ${name} = 1;\n`,
        ])
      ),
    });
    const session = makeSession(root);
    await session.runFullPipeline();
    expect(analysed()).toContain('gen/e.ts');
    expect(analysed()).toContain('.publish/stale.js');
    session.close();
  });

  test('analyzeIgnored analyses a path git ignores', async () => {
    const root = gitProject(files);
    const session = makeSession(root, { analyzeIgnored: ['gen/unused.ts'] });
    await session.runFullPipeline();
    expect(analysed()).toContain('gen/unused.ts');
    expect(analysed()).not.toContain('.publish/old/bundle.js');
    session.close();
  });

  test('an edit to a .gitignore is a configuration change', async () => {
    const root = gitProject(files);
    const session = makeSession(root);
    await session.runFullPipeline();
    expect(session.watchPlan().files).toContain(
      join(realpathSync(root), '.gitignore')
    );
    session.close();
  });

  test('a file git ignores, created after the walk and never imported, is not analysed', async () => {
    const root = gitProject({ '.gitignore': 'out/\n' });
    const session = makeSession(root);
    await session.runFullPipeline();
    mkdirSync(join(root, 'out'));
    writeFileSync(join(root, 'out', 'late.js'), 'export const late = 1;\n');
    expect(
      session.scanConfig.excludeMatcher.matches(
        join(root, 'out', 'late.js'),
        join('out', 'late.js')
      )
    ).toBe(true);
    session.close();
  });

  test('an edit that imports an ignored file analyses it, through later edits', async () => {
    const root = gitProject({
      '.gitignore': 'gen/\n',
      'gen/route.ts': 'export const route = 1;\n',
      'src/App.tsx': 'export const App = 1;\n',
    });
    const session = makeSession(root);
    await session.runFullPipeline();
    expect(analysed()).not.toContain('gen/route.ts');
    const edit = async (source: string) => {
      writeFileSync(join(root, 'src', 'App.tsx'), source);
      await session.handleWatchUpdate({
        modifiedFiles: new Set([join(root, 'src', 'App.tsx')]),
        removedFiles: new Set(),
      });
    };
    await edit(
      "import { route } from '../gen/route';\nexport const App = route;\n"
    );
    expect(analysed()).toContain('gen/route.ts');
    await edit(
      "import { route } from '../gen/route';\nexport const App = [route];\n"
    );
    expect(analysed()).toContain('gen/route.ts');
    session.close();
  });

  test('a computed load the host cannot list fails the pass open', async () => {
    const root = gitProject({
      '.gitignore': 'gen/\n',
      'gen/Widget.tsx': 'export default 1;\n',
      'src/App.tsx':
        "const modules = import.meta.glob('../gen/[W]*.tsx', { eager: true });\nexport const App = modules;\n",
    });
    const session = makeSession(root);
    await session.runFullPipeline();
    expect(analysed()).toContain('gen/Widget.tsx');
    session.close();
  });

  test('without a repository, a checkout of its own is analysed too', async () => {
    const root = gitProject(
      {
        'nested/.git/HEAD': 'ref: refs/heads/main\n',
        'nested/Widget.tsx': 'export const Widget = 1;\n',
      },
      { repository: false }
    );
    const session = makeSession(root);
    await session.runFullPipeline();
    expect(analysed()).toContain('nested/Widget.tsx');
    session.close();
  });

  test('a git that fails keeps nothing out', async () => {
    const root = gitProject({
      '.gitignore': 'gen/\n',
      'gen/unused.ts': 'export const unused = 1;\n',
      'nested/.git/HEAD': 'ref: refs/heads/main\n',
      'nested/Widget.tsx': 'export const Widget = 1;\n',
    });
    const session = makeSession(root);
    const path = process.env.PATH;
    process.env.PATH = '';
    try {
      await session.runFullPipeline();
    } finally {
      process.env.PATH = path;
    }
    expect(analysed()).toContain('gen/unused.ts');
    expect(analysed()).toContain('nested/Widget.tsx');
    session.close();
  });

  test('a git listing cut short keeps nothing out', async () => {
    const root = gitProject({
      '.gitignore': 'gen/\n',
      'gen/unused.ts': 'export const unused = 1;\n',
    });
    // A git whose ignore listing ends without its NUL, and exits zero.
    const shim = join(root, '.shim');
    mkdirSync(shim);
    const real = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    writeFileSync(
      join(shim, 'git'),
      `#!/bin/sh\ncase "$*" in *--ignored*) printf src; exit 0;; esac\nexec ${real} "$@"\n`,
      { mode: 0o755 }
    );
    const session = makeSession(root);
    const path = process.env.PATH;
    process.env.PATH = `${shim}:${path}`;
    try {
      await session.runFullPipeline();
    } finally {
      process.env.PATH = path;
    }
    expect(analysed()).toContain('src/Button.tsx');
    expect(analysed()).toContain('gen/unused.ts');
    session.close();
  });

  test('a .gitignore created under the root re-runs the full pass', async () => {
    const root = gitProject({
      '.gitignore': 'gen/*\n',
      'gen/Widget.tsx': 'export const Widget = 1;\n',
    });
    const session = makeSession(root);
    await session.runFullPipeline();
    expect(analysed()).not.toContain('gen/Widget.tsx');
    writeFileSync(join(root, 'gen', '.gitignore'), '!Widget.tsx\n');
    expect(session.isConfigInput(join(root, 'gen', '.gitignore'))).toBe(true);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(root, 'gen', '.gitignore')]),
      removedFiles: new Set(),
    });
    expect(analysed()).toContain('gen/Widget.tsx');
    session.close();
  });

  test('a pass run again for an ignored import still reports what it found', async () => {
    const root = gitProject({
      '.gitignore': 'gen/\n',
      'gen/Widget.tsx': 'export const Widget = 1;\n',
      'src/App.tsx':
        "import { Widget } from '../gen/Widget';\nexport const App = Widget;\n",
    });
    const session = makeSession(root, {
      strict: true,
      exclude: ['definitely-not-found'],
      diagnostics: { 'animus.discovery.exclude-unmatched': 'error' },
    });
    await expect(session.runFullPipeline()).rejects.toThrow(
      /definitely-not-found/
    );
    session.close();
  });

  test('a generated file created where an import looks is analysed', async () => {
    const root = gitProject({
      '.gitignore': 'gen/\n',
      'src/App.tsx':
        "import { route } from '../gen/later';\nexport const App = route;\n",
    });
    const session = makeSession(root);
    await session.runFullPipeline();
    expect(analysed()).not.toContain('gen/later.ts');
    mkdirSync(join(root, 'gen'));
    writeFileSync(join(root, 'gen', 'later.ts'), 'export const route = 1;\n');
    // A host drops an event its matcher excludes before the session sees it.
    expect(
      session.scanConfig.excludeMatcher.matches(
        join(root, 'gen', 'later.ts'),
        join('gen', 'later.ts')
      )
    ).toBe(false);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(root, 'gen', 'later.ts')]),
      removedFiles: new Set(),
    });
    expect(analysed()).toContain('gen/later.ts');
    session.close();
  });
});
