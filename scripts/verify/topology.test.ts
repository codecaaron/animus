import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  classifyTree,
  collectViolations,
  extractSpecifiers,
  isForbidden,
  main,
  readE2ePackageNames,
  resolveSpecifierTree,
  scanPackageDependencies,
  scanSourceImports,
  scanTsconfigPaths,
} from './topology';

const ROOT = resolve(import.meta.dirname, '../..');
const SCRIPT = join(ROOT, 'scripts/verify/topology.ts');
const temporaryDirectories: string[] = [];

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(resolve(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function write(root: string, relPath: string, contents: string): void {
  const path = join(root, relPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function manifest(name: string, extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify({ name, ...extra }, null, 2)}\n`;
}

// A minimally-populated workspace with the three top-level trees and one e2e
// member that owns a workspace name. Callers layer violations on top.
function scaffold(prefix: string): string {
  const root = temporaryDirectory(prefix);
  write(root, 'package.json', manifest('root', { private: true }));
  write(root, 'e2e/next-app/package.json', manifest('@animus-ui/next-app'));
  write(root, 'e2e/next-app/src/index.ts', 'export const app = 1;\n');
  write(root, 'packages/system/package.json', manifest('@animus-ui/system'));
  write(root, 'packages/system/src/index.ts', 'export const system = 1;\n');
  write(root, 'legacy/core/src/index.ts', 'export const core = 1;\n');
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('topology pure predicates', () => {
  it('encodes exactly the three forbidden edges', () => {
    expect(isForbidden('packages', 'e2e')).toBe(true);
    expect(isForbidden('packages', 'legacy')).toBe(true);
    expect(isForbidden('e2e', 'legacy')).toBe(true);

    // Permitted / irrelevant edges.
    expect(isForbidden('e2e', 'packages')).toBe(false);
    expect(isForbidden('packages', 'packages')).toBe(false);
    expect(isForbidden('e2e', 'e2e')).toBe(false);
    expect(isForbidden('legacy', 'packages')).toBe(false);
    expect(isForbidden('other', 'legacy')).toBe(false);
  });

  it('classifies paths by their top-level tree', () => {
    expect(classifyTree('/repo', '/repo/packages/system/src/a.ts')).toBe(
      'packages'
    );
    expect(classifyTree('/repo', '/repo/e2e/next-app/app/page.tsx')).toBe(
      'e2e'
    );
    expect(classifyTree('/repo', '/repo/legacy/core/src/a.ts')).toBe('legacy');
    expect(classifyTree('/repo', '/repo/tsconfig.json')).toBe('other');
    expect(classifyTree('/repo', '/elsewhere/x.ts')).toBe('other');
  });
});

describe('specifier extraction', () => {
  it('captures every import form and ignores comments and unrelated strings', () => {
    const source = [
      "import a from '../../e2e/next-app/x';",
      "export { b } from '../../legacy/core/y';",
      "import '../side-effect';",
      "const c = require('../../e2e/next-app/z');",
      "const d = await import('../../legacy/core/w');",
      "// import ignored from '../../e2e/should-not-count';",
      "/* export skip from '../../legacy/should-not-count'; */",
      "const url = 'https://example.com/e2e/not-an-import';",
    ].join('\n');

    const values = extractSpecifiers(source).map((s) => s.value);
    expect(values).toContain('../../e2e/next-app/x');
    expect(values).toContain('../../legacy/core/y');
    expect(values).toContain('../side-effect');
    expect(values).toContain('../../e2e/next-app/z');
    expect(values).toContain('../../legacy/core/w');
    expect(values).not.toContain('../../e2e/should-not-count');
    expect(values).not.toContain('../../legacy/should-not-count');
    expect(values).not.toContain('https://example.com/e2e/not-an-import');
  });

  it('resolves relative paths against the file and e2e names against manifests', () => {
    const fileAbs = '/repo/packages/system/src/index.ts';
    expect(
      resolveSpecifierTree('/repo', fileAbs, '../../../e2e/next-app/x', [
        '@animus-ui/next-app',
      ])
    ).toBe('e2e');
    expect(
      resolveSpecifierTree('/repo', fileAbs, '../../../legacy/core/y', [])
    ).toBe('legacy');
    expect(resolveSpecifierTree('/repo', fileAbs, './sibling', [])).toBe(
      'packages'
    );
    expect(
      resolveSpecifierTree('/repo', fileAbs, '@animus-ui/next-app/sub', [
        '@animus-ui/next-app',
      ])
    ).toBe('e2e');
    // External/untracked dependency.
    expect(resolveSpecifierTree('/repo', fileAbs, 'react', [])).toBeNull();
  });
});

describe('source-import vector', () => {
  it('flags packages/* -> e2e/* via relative path', () => {
    const root = scaffold('animus-topology-pkg-e2e-rel-');
    write(
      root,
      'packages/system/src/bad.ts',
      "export { app } from '../../../e2e/next-app/src/index';\n"
    );

    const violations = scanSourceImports(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      vector: 'import',
      file: join('packages', 'system', 'src', 'bad.ts'),
      from: 'packages',
      to: 'e2e',
    });
  });

  it('flags packages/* -> e2e/* via workspace package name', () => {
    const root = scaffold('animus-topology-pkg-e2e-name-');
    write(
      root,
      'packages/system/src/bad.ts',
      "import { app } from '@animus-ui/next-app';\n"
    );

    const violations = scanSourceImports(root);
    expect(violations.map((v) => v.to)).toContain('e2e');
    expect(violations[0].detail).toContain('@animus-ui/next-app');
  });

  it('flags packages/* -> legacy/* and e2e/* -> legacy/*', () => {
    const root = scaffold('animus-topology-legacy-');
    write(
      root,
      'packages/system/src/bad.ts',
      "import '../../../legacy/core/src/index';\n"
    );
    write(
      root,
      'e2e/next-app/src/bad.ts',
      "const x = require('../../../legacy/core/src/index');\n"
    );

    const violations = scanSourceImports(root);
    const edges = violations.map((v) => `${v.from}->${v.to}`).sort();
    expect(edges).toEqual(['e2e->legacy', 'packages->legacy']);
  });

  it('permits e2e/* -> packages/* and intra-tree imports', () => {
    const root = scaffold('animus-topology-permitted-');
    write(
      root,
      'e2e/next-app/src/ok.ts',
      [
        "import { system } from '@animus-ui/system';",
        "import { other } from '../../../packages/system/src/index';",
        "import { local } from './index';",
      ].join('\n')
    );
    write(
      root,
      'packages/system/src/ok.ts',
      "import { local } from './index';\n"
    );

    expect(scanSourceImports(root)).toEqual([]);
  });

  it('excludes the byte-precise parity corpus from scanning', () => {
    const root = scaffold('animus-topology-corpus-');
    write(root, 'packages/_parity/package.json', manifest('@animus-ui/parity'));
    write(
      root,
      'packages/_parity/corpus/adversarial.tsx',
      "import '../../../legacy/core/src/index';\n"
    );

    expect(scanSourceImports(root)).toEqual([]);
  });
});

describe('tsconfig-path vector', () => {
  it('flags forbidden path targets and permits sibling packages targets', () => {
    const root = scaffold('animus-topology-tsconfig-');
    write(
      root,
      'packages/system/tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          // JSONC comment tolerated by the reader.
          paths: {
            '@x/e2e': ['../../e2e/next-app/src/index.ts'],
            '@x/legacy': ['../../legacy/core/src/index.ts'],
            '@x/ok': ['../properties/src/index.ts'],
          },
        },
      })
    );

    const violations = scanTsconfigPaths(root);
    const targets = violations.map((v) => `${v.from}->${v.to}`).sort();
    expect(targets).toEqual(['packages->e2e', 'packages->legacy']);
  });

  it('ignores an e2e tsconfig aliasing into packages (permitted direction)', () => {
    const root = scaffold('animus-topology-tsconfig-ok-');
    write(
      root,
      'e2e/next-app/tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          paths: {
            '@animus-ui/system': ['../../packages/system/src/index.ts'],
          },
        },
      })
    );

    expect(scanTsconfigPaths(root)).toEqual([]);
  });
});

describe('package-dependency vector', () => {
  it('flags a packages/* manifest depending on an e2e workspace name', () => {
    const root = scaffold('animus-topology-dep-');
    write(
      root,
      'packages/system/package.json',
      manifest('@animus-ui/system', {
        dependencies: { '@animus-ui/next-app': 'workspace:*' },
      })
    );

    const violations = scanPackageDependencies(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      vector: 'package-dependency',
      from: 'packages',
      to: 'e2e',
    });
    expect(violations[0].detail).toContain('@animus-ui/next-app');
  });

  it('flags a packages/* manifest depending on an archived legacy name', () => {
    const root = scaffold('animus-topology-dep-legacy-pkg-');
    write(
      root,
      'packages/system/package.json',
      manifest('@animus-ui/system', {
        devDependencies: { '@animus-ui/core': '^1.0.0' },
      })
    );

    const violations = scanPackageDependencies(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      vector: 'package-dependency',
      from: 'packages',
      to: 'legacy',
    });
    expect(violations[0].detail).toContain('@animus-ui/core');
  });

  it('flags an e2e manifest depending on an archived legacy name', () => {
    const root = scaffold('animus-topology-dep-legacy-e2e-');
    write(
      root,
      'e2e/next-app/package.json',
      manifest('@animus-ui/next-app', {
        dependencies: { '@animus-ui/core': '^1.0.0' },
      })
    );

    const violations = scanPackageDependencies(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      vector: 'package-dependency',
      file: 'e2e/next-app/package.json',
      from: 'e2e',
      to: 'legacy',
    });
    expect(violations[0].detail).toContain('@animus-ui/core');
  });

  it('permits an e2e manifest depending on a packages workspace name', () => {
    const root = scaffold('animus-topology-dep-ok-');
    write(
      root,
      'e2e/next-app/package.json',
      manifest('@animus-ui/next-app', {
        dependencies: { '@animus-ui/system': 'workspace:*' },
      })
    );

    expect(scanPackageDependencies(root)).toEqual([]);
    expect(collectViolations(root)).toEqual([]);
  });

  it('reads e2e package names from manifests', () => {
    const root = scaffold('animus-topology-names-');
    write(root, 'e2e/vite-app/package.json', manifest('@animus-ui/vite-app'));
    expect(readE2ePackageNames(root)).toEqual([
      '@animus-ui/next-app',
      '@animus-ui/vite-app',
    ]);
  });
});

describe('CLI main', () => {
  it('exits non-zero and prints the offending file on a violation fixture', () => {
    const root = scaffold('animus-topology-cli-fail-');
    write(
      root,
      'packages/system/src/bad.ts',
      "export { app } from '../../../e2e/next-app/src/index';\n"
    );

    const result = spawnSync('bun', [SCRIPT, root], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ERROR: workspace topology violation');
    expect(result.stderr).toContain(
      join('packages', 'system', 'src', 'bad.ts')
    );
    expect(result.stderr).toContain('Run:');
  });

  it('exits zero on a clean fixture', () => {
    const root = scaffold('animus-topology-cli-ok-');
    const result = spawnSync('bun', [SCRIPT, root], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[topology] workspace boundaries clean');
  });
});

// ---------------------------------------------------------------------------
// Review-driven fixtures (2026-07-20). Four verified findings against the
// freshly-landed checker; each block writes temp-dir fixtures only.
// ---------------------------------------------------------------------------

describe('finding 1 — source-extension breadth', () => {
  it('flags a .js file importing legacy via require()', () => {
    const root = scaffold('animus-topology-ext-js-');
    write(
      root,
      'packages/system/src/bad.js',
      "const x = require('../../../legacy/core/src/index');\n"
    );

    const violations = scanSourceImports(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      file: join('packages', 'system', 'src', 'bad.js'),
      from: 'packages',
      to: 'legacy',
    });
  });

  it('flags a .jsx / .mjs / .cjs file crossing a forbidden boundary', () => {
    const root = scaffold('animus-topology-ext-fam-');
    write(
      root,
      'packages/system/src/a.jsx',
      "import '../../../legacy/core/src/index';\n"
    );
    write(
      root,
      'packages/system/src/b.mjs',
      "export { app } from '../../../e2e/next-app/src/index';\n"
    );
    write(
      root,
      'e2e/next-app/src/c.cjs',
      "const y = require('../../../legacy/core/src/index');\n"
    );

    const edges = scanSourceImports(root)
      .map((v) => `${v.from}->${v.to}`)
      .sort();
    expect(edges).toEqual(['e2e->legacy', 'packages->e2e', 'packages->legacy']);
  });

  it('flags an .mdx file whose top-level ESM import crosses a boundary', () => {
    const root = scaffold('animus-topology-ext-mdx-');
    write(
      root,
      'packages/system/src/bad.mdx',
      [
        "import { Callout } from '../components/Callout';",
        "import legacy from '../../../legacy/core/src/index';",
        '',
        '# Heading',
      ].join('\n')
    );

    const violations = scanSourceImports(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      file: join('packages', 'system', 'src', 'bad.mdx'),
      from: 'packages',
      to: 'legacy',
    });
  });

  it('scans showcase MDX content (docs imports are real imports)', () => {
    const root = scaffold('animus-topology-ext-showcase-');
    write(
      root,
      'packages/showcase/package.json',
      manifest('@animus-ui/showcase')
    );
    write(
      root,
      'packages/showcase/src/content/guide.mdx',
      "import legacy from '../../../../legacy/core/src/index';\n"
    );

    const violations = scanSourceImports(root);
    expect(violations.map((v) => `${v.from}->${v.to}`)).toContain(
      'packages->legacy'
    );
  });

  it('does not flag legacy-looking text inside an MDX fenced code block', () => {
    const root = scaffold('animus-topology-ext-mdx-fence-');
    write(
      root,
      'packages/system/src/doc.mdx',
      [
        '# Config example',
        '',
        '```ts',
        "import legacy from '../../../legacy/core/src/index';",
        "export default { exclude: ['**/legacy/**'] };",
        '```',
        '',
        "import { Callout } from '../components/Callout';",
      ].join('\n')
    );

    expect(scanSourceImports(root)).toEqual([]);
  });

  it('excludes the napi-generated extract-v2 loader from scanning', () => {
    const root = scaffold('animus-topology-ext-generated-');
    write(
      root,
      'packages/extract/crates/extract-v2/index.js',
      "const x = require('../../../../legacy/core/src/index');\n"
    );
    write(
      root,
      'packages/extract/crates/extract-v2/index.d.ts',
      "export { app } from '../../../../e2e/next-app/src/index';\n"
    );

    expect(scanSourceImports(root)).toEqual([]);
  });
});

describe('finding 2 — tsconfig extends chains', () => {
  it('flags a forbidden path inherited from an extended parent', () => {
    const root = scaffold('animus-topology-extends-inherit-');
    write(
      root,
      'tsconfig.base.json',
      JSON.stringify({
        compilerOptions: {
          paths: { '@x/legacy': ['./legacy/core/src/index.ts'] },
        },
      })
    );
    write(
      root,
      'packages/system/tsconfig.json',
      JSON.stringify({ extends: '../../tsconfig.base.json' })
    );

    const violations = scanTsconfigPaths(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      file: join('packages', 'system', 'tsconfig.json'),
      from: 'packages',
      to: 'legacy',
    });
  });

  it('does not flag when a child overrides the parent paths with clean ones', () => {
    const root = scaffold('animus-topology-extends-override-');
    write(
      root,
      'tsconfig.base.json',
      JSON.stringify({
        compilerOptions: {
          paths: { '@x/legacy': ['./legacy/core/src/index.ts'] },
        },
      })
    );
    write(
      root,
      'packages/system/tsconfig.json',
      JSON.stringify({
        extends: '../../tsconfig.base.json',
        compilerOptions: { paths: { '@x/ok': ['./src/index.ts'] } },
      })
    );

    expect(scanTsconfigPaths(root)).toEqual([]);
  });

  it('resolves an extends chain of two or more parents', () => {
    const root = scaffold('animus-topology-extends-chain-');
    write(
      root,
      'tsconfig.a.json',
      JSON.stringify({
        compilerOptions: {
          paths: { '@x/e2e': ['./e2e/next-app/src/index.ts'] },
        },
      })
    );
    write(
      root,
      'tsconfig.b.json',
      JSON.stringify({ extends: './tsconfig.a.json' })
    );
    write(
      root,
      'packages/system/tsconfig.json',
      JSON.stringify({ extends: '../../tsconfig.b.json' })
    );

    const violations = scanTsconfigPaths(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ from: 'packages', to: 'e2e' });
  });

  it('silently skips a missing extended parent', () => {
    const root = scaffold('animus-topology-extends-missing-');
    write(
      root,
      'packages/system/tsconfig.json',
      JSON.stringify({ extends: './does-not-exist.json' })
    );

    expect(scanTsconfigPaths(root)).toEqual([]);
  });
});

describe('finding 3 — archived package names', () => {
  it('flags a bare archived @animus-ui name imported from packages/*', () => {
    const root = scaffold('animus-topology-archived-pkg-');
    write(
      root,
      'packages/system/src/bad.ts',
      "import { core } from '@animus-ui/core';\n"
    );

    const violations = scanSourceImports(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ from: 'packages', to: 'legacy' });
    expect(violations[0].detail).toContain('@animus-ui/core');
  });

  it('flags a bare archived @animus-ui name imported from e2e/*', () => {
    const root = scaffold('animus-topology-archived-e2e-');
    write(
      root,
      'e2e/next-app/src/bad.ts',
      "const c = await import('@animus-ui/core');\n"
    );

    const violations = scanSourceImports(root);
    expect(violations.map((v) => `${v.from}->${v.to}`)).toContain(
      'e2e->legacy'
    );
  });

  it('does not flag the active @animus-ui/system package name', () => {
    const root = scaffold('animus-topology-archived-active-');
    write(
      root,
      'packages/properties/package.json',
      manifest('@animus-ui/properties')
    );
    write(
      root,
      'packages/properties/src/ok.ts',
      "import { system } from '@animus-ui/system';\n"
    );

    expect(scanSourceImports(root)).toEqual([]);
  });
});

describe('finding 4 — syntactic specifiers only (AST)', () => {
  it('does not flag a forbidden path inside a string literal', () => {
    const root = scaffold('animus-topology-ast-string-');
    write(
      root,
      'packages/system/src/decoy.ts',
      'const s = "require(\'../../../legacy/core/src/index\')";\nexport { s };\n'
    );

    expect(scanSourceImports(root)).toEqual([]);
  });

  it('does not flag a forbidden path inside a template literal', () => {
    const root = scaffold('animus-topology-ast-template-');
    write(
      root,
      'packages/system/src/decoy.ts',
      "const t = `import('../../../legacy/core/src/index')`;\nexport { t };\n"
    );

    expect(scanSourceImports(root)).toEqual([]);
  });

  it('still flags a genuine static import', () => {
    const root = scaffold('animus-topology-ast-import-');
    write(
      root,
      'packages/system/src/bad.ts',
      "import x from '../../../legacy/core/src/index';\n"
    );

    expect(scanSourceImports(root)).toHaveLength(1);
  });

  it('flags a genuine dynamic import()', () => {
    const root = scaffold('animus-topology-ast-dynamic-');
    write(
      root,
      'packages/system/src/bad.ts',
      "const x = import('../../../legacy/core/src/index');\n"
    );

    const violations = scanSourceImports(root);
    expect(violations).toHaveLength(1);
    expect(violations[0].detail).toContain('dynamic-import');
  });

  it('flags a genuine export-from re-export', () => {
    const root = scaffold('animus-topology-ast-export-');
    write(
      root,
      'packages/system/src/bad.ts',
      "export * from '../../../legacy/core/src/index';\n"
    );

    const violations = scanSourceImports(root);
    expect(violations).toHaveLength(1);
    expect(violations[0].detail).toContain('export');
  });

  it('fails loud when an in-scope source file cannot be parsed', () => {
    const root = scaffold('animus-topology-ast-parsefail-');
    write(
      root,
      'packages/system/src/broken.ts',
      'const x = ; ) } @@@ import from garbage\n'
    );

    expect(() => scanSourceImports(root)).toThrow(/parse/i);
  });
});

describe('real repository tree', () => {
  it('has zero workspace-topology violations', () => {
    expect(collectViolations(ROOT)).toEqual([]);
  });

  it('main returns 0 against the live tree', () => {
    expect(main(ROOT)).toBe(0);
  });
});
