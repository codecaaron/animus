import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import viteConfig from '../../vite.config';
import {
  discoverWorkspaceManifests,
  resolveDistDependencyClosure,
} from './workspace-graph';

type Manifest = {
  name: string;
  scripts?: Record<string, string>;
};

type Owner = {
  directory: string;
  manifest: Manifest;
  worker: boolean;
};

type RootTask = {
  command?: string;
  dependsOn?: string[];
};

const ROOT = resolve(import.meta.dirname, '../..');
const temporaryDirectories: string[] = [];
const consumerTargets = [
  'next',
  'showcase',
  'vite',
  'vinext',
  'react-router',
] as const;
const workerTargets = ['showcase', 'vite', 'vinext', 'react-router'] as const;
const compatibilityAssertionTasks = {
  'verify:assert:react-router':
    'vp run @animus-ui/react-router-app#verify:assert',
  'verify:assert:vinext': 'vp run @animus-ui/vinext-app#verify:assert',
} as const;

function currentSurfaceFiles(): string[] {
  const directoryRoots = ['.github', 'docs', 'e2e', 'packages', 'scripts'];
  const fileRoots = ['AGENTS.md', 'CLAUDE.md', 'README.md', 'package.json'];
  // Historical plans, archived/legacy source, and active OpenSpec artifacts
  // are evidence inputs, not current executable/contributor surfaces.
  const excludedTrees = ['docs/superpowers', 'legacy', 'openspec/changes'];
  const ignoredDirectories = new Set([
    '.animus',
    '.next',
    '.receipts',
    '.react-router',
    '.vite',
    '.wrangler',
    'build',
    'dist',
    'node_modules',
    'target',
    'tmp',
  ]);
  const includedExtensions = /\.(?:c?js|jsonc?|mdx?|mjs|sh|tsx?|ya?ml)$/;
  // These files mention retired names only as negative contracts or serialized
  // receipt fixtures; they do not invoke or document executable commands.
  const nonCallerContractFiles = new Set([
    'packages/_assertions/__tests__/receipt.test.ts',
    'scripts/verify/ci-graph.test.ts',
    'scripts/verify/owner-graph.test.ts',
  ]);
  const files: string[] = [];

  function visit(relativePath: string): void {
    if (
      excludedTrees.some(
        (tree) => relativePath === tree || relativePath.startsWith(`${tree}/`)
      )
    ) {
      return;
    }
    const absolutePath = join(ROOT, relativePath);
    if (!existsSync(absolutePath)) return;

    const entries = readdirSync(absolutePath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          visit(join(relativePath, entry.name));
        }
        continue;
      }
      if (!entry.isFile()) continue;

      const path = join(relativePath, entry.name);
      if (
        includedExtensions.test(entry.name) &&
        !nonCallerContractFiles.has(path)
      ) {
        files.push(path);
      }
    }
  }

  for (const path of fileRoots) {
    if (existsSync(join(ROOT, path))) files.push(path);
  }
  for (const directory of directoryRoots) {
    visit(directory);
  }

  return files;
}

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(resolve(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function readManifest(path: string): Manifest {
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
}

function discoverOwners(): Owner[] {
  const directories = [
    'packages/showcase',
    ...readdirSync(join(ROOT, 'e2e'), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name !== 'packed-app' &&
          existsSync(join(ROOT, 'e2e', entry.name, 'package.json'))
      )
      .map((entry) => `e2e/${entry.name}`),
  ];

  return directories.map((directory) => ({
    directory,
    manifest: readManifest(join(ROOT, directory, 'package.json')),
    worker: existsSync(join(ROOT, directory, 'wrangler.jsonc')),
  }));
}

function rootTasks(): Record<string, RootTask> {
  const config = viteConfig as {
    run?: { tasks?: Record<string, RootTask> };
  };

  return config.run?.tasks ?? {};
}

function sequentialCommands(command: string | undefined): string[] {
  return (command ?? '')
    .split(/\s*&&\s*/)
    .map((entry) => entry.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function writeManifest(
  root: string,
  directory: string,
  manifest: Record<string, unknown>
): void {
  const path = join(root, directory, 'package.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('workspace dependency closure', () => {
  it('derives every reachable dist-bearing production workspace dependency', () => {
    const workspace = discoverWorkspaceManifests(ROOT);
    const expected = new Map<string, string[]>([
      [
        '@animus-ui/showcase',
        [
          '@animus-ui/extract',
          '@animus-ui/properties',
          '@animus-ui/system',
          '@animus-ui/test-ds',
          '@animus-ui/vite-plugin',
        ],
      ],
      [
        '@animus-ui/next-app',
        [
          '@animus-ui/extract',
          '@animus-ui/next-plugin',
          '@animus-ui/properties',
          '@animus-ui/system',
          '@animus-ui/test-ds',
        ],
      ],
      [
        '@animus-ui/next16-app',
        [
          '@animus-ui/extract',
          '@animus-ui/next-plugin',
          '@animus-ui/properties',
          '@animus-ui/system',
          '@animus-ui/test-ds',
        ],
      ],
      [
        '@animus-ui/vite-app',
        [
          '@animus-ui/extract',
          '@animus-ui/properties',
          '@animus-ui/system',
          '@animus-ui/test-ds',
          '@animus-ui/vite-plugin',
        ],
      ],
      [
        '@animus-ui/vinext-app',
        [
          '@animus-ui/extract',
          '@animus-ui/properties',
          '@animus-ui/system',
          '@animus-ui/test-ds',
          '@animus-ui/vite-plugin',
        ],
      ],
      [
        '@animus-ui/react-router-app',
        [
          '@animus-ui/extract',
          '@animus-ui/properties',
          '@animus-ui/system',
          '@animus-ui/test-ds',
          '@animus-ui/vite-plugin',
        ],
      ],
    ]);

    for (const [owner, packageNames] of expected) {
      expect(
        resolveDistDependencyClosure(workspace, owner)
          .map((entry) => entry.name)
          .sort()
      ).toEqual(packageNames);
    }
  });

  it('recognizes a nested export as a dist-bearing package entry', () => {
    const workspace = discoverWorkspaceManifests(ROOT);
    const extract = workspace.get('@animus-ui/extract');

    expect(extract?.distEntries).toContain('./dist/index.cjs');
  });

  it('fails with both package names for an unknown workspace edge', () => {
    const root = temporaryDirectory('animus-owner-graph-unknown-');
    writeManifest(root, '.', {
      name: 'root',
      private: true,
      workspaces: ['packages/owner'],
    });
    writeManifest(root, 'packages/owner', {
      name: '@animus-ui/owner',
      dependencies: { '@animus-ui/missing': 'workspace:*' },
    });

    expect(() =>
      resolveDistDependencyClosure(
        discoverWorkspaceManifests(root),
        '@animus-ui/owner'
      )
    ).toThrow(
      '@animus-ui/owner declares unknown workspace dependency @animus-ui/missing'
    );
  });
});

describe('root verification graph', () => {
  it('offers non-gating TypeScript coverage over the unit target set', () => {
    const tasks = rootTasks();
    const unitCommand = tasks['verify:unit:ts']?.command;
    const coverageCommand = tasks['verify:coverage:ts']?.command;
    const unitRunner = 'bunx vp test run ';
    const unitTargets = unitCommand?.replace(unitRunner, '');
    const coverageExclusionArguments = [
      '**/dist/**',
      'legacy/**',
      'packages/extract/index*.js',
      '**/__tests__/**',
      '**/tests/**',
      '**/__fixtures__/**',
    ]
      .map((pattern) => `--coverage.exclude='${pattern}'`)
      .join(' ');

    expect(unitCommand).toMatch(new RegExp(`^${unitRunner}`));
    expect(coverageCommand).toBe(
      `bunx vitest run ${unitTargets} --coverage.enabled --coverage.provider=v8 --coverage.reporter=text --coverage.reporter=lcov --coverage.reportsDirectory=coverage/ts ${coverageExclusionArguments}`
    );
    expect(tasks.verify?.dependsOn).not.toContain('verify:coverage:ts');
    expect(tasks['verify:full']?.command).not.toContain('verify:coverage:ts');
  });

  it('keeps the root verify claim fast and owns Worker contracts exactly once', () => {
    const tasks = rootTasks();
    const fastLeaves = tasks.verify?.dependsOn ?? [];

    expect(fastLeaves).toEqual([
      'verify:lint',
      'verify:compile',
      'verify:types',
      'verify:unit:ts',
      'verify:unit:rust',
      'verify:clippy',
      'verify:canary',
      'verify:workers:contracts',
    ]);
    expect(
      fastLeaves.filter((task) => task === 'verify:workers:contracts')
    ).toHaveLength(1);
    expect(fastLeaves).not.toContain('verify:integration');
    expect(fastLeaves.some((task) => task.startsWith('verify:build:'))).toBe(
      false
    );
  });

  it('makes verify:full the ordered complete local claim over workspace owners', () => {
    const tasks = rootTasks();
    const full = tasks['verify:full'];
    const commands = sequentialCommands(full?.command);

    expect(full?.dependsOn).toBeUndefined();
    expect(commands).toEqual([
      'vp run build:extract-v2',
      'vp run build:ts',
      'vp run verify',
      "vp run --fail-if-no-match -F './e2e/*' -F '!animus-packed-app' -F './packages/showcase' verify",
      'vp run verify:parity',
      'vp run verify:integration',
      'vp run verify:hygiene:rust',
      'vp run verify:packed',
    ]);

    const command = full?.command ?? '';
    for (const owner of discoverOwners()) {
      expect(command).not.toContain(owner.manifest.name);
    }
    for (const alias of [
      'verify:next',
      'verify:showcase',
      'verify:vite',
      'verify:vinext',
      'verify:react-router',
      'verify:build:',
      'verify:assert:',
      'verify:dry-run:',
    ]) {
      expect(command).not.toContain(alias);
    }
  });

  it('has no local CI projection or private before/after stages', () => {
    const taskNames = Object.keys(rootTasks());

    expect(taskNames).not.toContain('verify:ci');
    expect(taskNames.filter((task) => task.startsWith('_verify:'))).toEqual([]);
  });

  it('documents every Change-Type Map command as copy-pasteable', () => {
    const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
    const changeMap = agents
      .split('### Change-Type Map')[1]
      ?.split('### Cache Tiers')[0];
    expect(changeMap).toBeDefined();

    const commands = (changeMap ?? '')
      .split('\n')
      .map((line) => line.match(/^\|\s*`[^`]+`[^|]*\|\s*`([^`]+)`\s*\|$/)?.[1])
      .filter((command): command is string => command !== undefined);
    expect(commands.length).toBeGreaterThan(20);
    for (const command of commands) {
      for (const segment of command.split(' && ')) {
        expect(segment, command).toMatch(/^(?:vp run|bunx vp test run)\b/);
      }
    }
  });

  it('has no live obsolete consumer orchestration references', () => {
    const tasks = rootTasks();
    const taskNames = Object.keys(tasks);
    const consumerTaskPattern = new RegExp(
      `^(?:verify(?::(?:build|assert|dry-run))?|build):(?:${consumerTargets.join('|')})$`
    );
    const remainingConsumerTasks = taskNames
      .filter((task) => consumerTaskPattern.test(task))
      .sort();

    expect(remainingConsumerTasks).toEqual(
      Object.keys(compatibilityAssertionTasks).sort()
    );
    for (const [task, command] of Object.entries(compatibilityAssertionTasks)) {
      expect(tasks[task]?.command).toBe(command);
      expect(tasks[task]?.dependsOn).toBeUndefined();
    }

    const wrapperPaths = consumerTargets.flatMap((target) => [
      `scripts/verify/build-${target}.sh`,
      `scripts/verify/assert-${target}.sh`,
    ]);
    for (const path of wrapperPaths) {
      expect(existsSync(join(ROOT, path)), path).toBe(false);
    }

    const consumerPattern = consumerTargets.join('|');
    const workerPattern = workerTargets.join('|');
    const retiredFamilyPatterns = [
      new RegExp(
        `(?:^|[^#\\w-])verify:build:(?:${consumerPattern}|\\*)(?![\\w-])`
      ),
      new RegExp(
        `(?:^|[^#\\w-])verify:assert:(?:${consumerPattern}|\\*)(?![\\w-])`
      ),
      new RegExp(
        `(?:^|[^#\\w-])verify:dry-run:(?:${workerPattern}|\\*)(?![\\w-])`
      ),
      new RegExp(
        `(?:^|[^#\\w-])_verify:dry-run:(?:${workerPattern}|\\*):after-build(?![\\w-])`
      ),
      new RegExp(`(?:^|[^#\\w-])verify:(?:${consumerPattern})(?![\\w-])`),
      new RegExp(
        `(?:bunx\\s+)?vp\\s+run\\s+build:(?:${workerPattern}|\\*)(?![\\w-])`
      ),
      new RegExp(
        `scripts/verify/(?:build|assert)-(?:${consumerPattern}|\\*)\\.sh(?![\\w-])`
      ),
    ];
    const references = currentSurfaceFiles().flatMap((path) => {
      const lines = readFileSync(join(ROOT, path), 'utf8').split('\n');
      return lines.flatMap((line, index) =>
        retiredFamilyPatterns.some((pattern) => pattern.test(line))
          ? [`${path}:${index + 1}: ${line.trim()}`]
          : []
      );
    });

    expect(references).toEqual([]);
  });

  it('keeps the root graph materially below the calibrated 57 tasks', () => {
    expect(Object.keys(rootTasks()).length).toBeLessThanOrEqual(30);
  });

  it('presents exactly four ordinary contributor workflow shapes', () => {
    const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
    const ordinaryWorkflows = agents
      .split('#### Ordinary Workflows')[1]
      ?.split('#### Atomic Diagnostics')[0];
    expect(ordinaryWorkflows).toBeDefined();

    const commands = (ordinaryWorkflows ?? '')
      .split('\n')
      .map((line) => line.match(/^\|[^|]+\|\s*`([^`]+)`\s*\|/)?.[1])
      .filter((command): command is string => command !== undefined);

    expect(commands).toHaveLength(4);
    expect(
      commands.filter((command) => command === 'vp run verify')
    ).toHaveLength(1);
    expect(
      commands.filter((command) => command === 'vp run verify:full')
    ).toHaveLength(1);
    expect(
      commands.filter((command) => /^vp run @[^#]+#verify$/.test(command))
    ).toHaveLength(1);
    expect(
      commands.filter(
        (command) =>
          command.startsWith('vp run --fail-if-no-match -F ') &&
          command.endsWith(' verify')
      )
    ).toHaveLength(1);
  });
});

describe('package-owned consumer verification', () => {
  it('consumer owner claims are complete', () => {
    const owners = discoverOwners();
    const fakeRoot = temporaryDirectory('animus-owner-graph-fake-vp-');
    const fakeBin = join(fakeRoot, 'bin');
    const callLog = join(fakeRoot, 'calls.log');
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(
      join(fakeBin, 'vp'),
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$VP_CALLS"
if [ "\${VP_FAIL_TASK:-}" = "\${2:-}" ]; then
  exit 19
fi
`
    );
    chmodSync(join(fakeBin, 'vp'), 0o755);

    expect(owners.map((owner) => owner.manifest.name).sort()).toEqual([
      '@animus-ui/next-app',
      '@animus-ui/next16-app',
      '@animus-ui/react-router-app',
      '@animus-ui/showcase',
      '@animus-ui/vinext-app',
      '@animus-ui/vite-app',
    ]);

    for (const owner of owners) {
      const scripts = owner.manifest.scripts ?? {};
      expect(scripts['verify:build'], owner.manifest.name).toBeDefined();
      expect(scripts['verify:assert'], owner.manifest.name).toBeDefined();
      expect(scripts.verify, owner.manifest.name).toBeDefined();

      if (owner.worker) {
        expect(scripts['verify:dry-run'], owner.manifest.name).toBeDefined();
      } else {
        expect(scripts['verify:dry-run'], owner.manifest.name).toBeUndefined();
      }

      writeFileSync(callLog, '');
      const result = spawnSync('bash', ['-c', scripts.verify ?? ''], {
        cwd: join(ROOT, owner.directory),
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          VP_CALLS: callLog,
        },
      });
      const expectedCalls = [`run ${owner.manifest.name}#verify:build`];
      // Consumer apps with their own tsconfig carry a verify:tsc step
      // (added 2026-07-23: no gate type-checked the e2e apps, which let
      // fixture-component type drift hide — see scripts/verify/tsc-consumer.sh).
      if (scripts['verify:tsc']) {
        expectedCalls.push(`run ${owner.manifest.name}#verify:tsc`);
      }
      expectedCalls.push(`run ${owner.manifest.name}#verify:assert`);
      if (owner.worker) {
        expectedCalls.push(`run ${owner.manifest.name}#verify:dry-run`);
      }

      expect(result.status, owner.manifest.name).toBe(0);
      expect(readFileSync(callLog, 'utf8').trim().split('\n')).toEqual(
        expectedCalls
      );
      expect(scripts.verify).not.toContain('verify:workers:contracts');
    }

    const worker = owners.find(
      (owner) => owner.manifest.name === '@animus-ui/vite-app'
    );
    expect(worker).toBeDefined();
    writeFileSync(callLog, '');
    const failed = spawnSync(
      'bash',
      ['-c', worker?.manifest.scripts?.verify ?? ''],
      {
        cwd: join(ROOT, worker?.directory ?? ''),
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          VP_CALLS: callLog,
          VP_FAIL_TASK: '@animus-ui/vite-app#verify:assert',
        },
      }
    );
    expect(failed.status).toBe(19);
    expect(readFileSync(callLog, 'utf8').trim().split('\n')).toEqual([
      'run @animus-ui/vite-app#verify:build',
      'run @animus-ui/vite-app#verify:tsc',
      'run @animus-ui/vite-app#verify:assert',
    ]);
  });

  it('verification claims exclude mutating cleanup', () => {
    const forbidden = [
      /(^|[\s:#])clean(?=[:\s&]|$)/,
      /(^|[\s:#])hygiene(?=[:\s&]|$)/,
      /check:fix/,
      /--fix(?:\s|$)/,
    ];

    for (const owner of discoverOwners()) {
      const scripts = owner.manifest.scripts ?? {};
      const chain = [
        scripts.verify,
        scripts['verify:build'],
        scripts['verify:assert'],
        scripts['verify:dry-run'],
        scripts.build,
        scripts['cf:dry-run'],
      ]
        .filter((command): command is string => command !== undefined)
        .join('\n');

      for (const pattern of forbidden) {
        expect(chain, `${owner.manifest.name}: ${pattern}`).not.toMatch(
          pattern
        );
      }
      expect(chain).not.toContain('verify:workers:contracts');
    }
  });

  it('atomic diagnostics fail loud without building', () => {
    const root = temporaryDirectory('animus-owner-graph-diagnostics-');
    mkdirSync(join(root, 'scripts/verify'), { recursive: true });
    for (const script of [
      '_preconditions.sh',
      'napi-target.ts',
      'build-consumer.sh',
      'workspace-graph.ts',
    ]) {
      copyFileSync(
        join(ROOT, 'scripts/verify', script),
        join(root, 'scripts/verify', script)
      );
    }
    writeManifest(root, '.', {
      name: 'root',
      private: true,
      workspaces: ['packages/dependency', 'e2e/fixture'],
    });
    writeManifest(root, 'packages/dependency', {
      name: '@animus-ui/dependency',
      main: './dist/index.js',
      scripts: { 'build:ts': 'bun -e "process.exit(0)"' },
    });
    writeManifest(root, 'e2e/fixture', {
      name: '@animus-ui/fixture',
      dependencies: { '@animus-ui/dependency': 'workspace:*' },
      scripts: {
        build: "bun -e \"require('node:fs').writeFileSync('BUILD_RAN', '')\"",
      },
    });

    const result = spawnSync(
      'bash',
      ['../../scripts/verify/build-consumer.sh'],
      {
        cwd: join(root, 'e2e/fixture'),
        encoding: 'utf8',
      }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ERROR: v2 NAPI binary missing.');
    expect(result.stderr).toContain(
      'ERROR: packages/dependency/dist/ missing.'
    );
    expect(result.stderr).toContain(
      'PREPARE: vp run build:extract-v2 && vp run build:ts'
    );
    const preparation = result.stderr
      .split('\n')
      .find((line) => line.startsWith('PREPARE:'));
    expect(preparation).not.toContain("--filter '@animus-ui/dependency'");
    expect(result.stderr.match(/^PREPARE:/gm)).toHaveLength(1);
    expect(existsSync(join(root, 'e2e/fixture/BUILD_RAN'))).toBe(false);
  });

  it('reports the exact assertions workspace remediation when dist is missing', () => {
    const root = temporaryDirectory('animus-assertions-dist-missing-');
    mkdirSync(join(root, 'scripts/verify'), { recursive: true });
    copyFileSync(
      join(ROOT, 'scripts/verify/_preconditions.sh'),
      join(root, 'scripts/verify/_preconditions.sh')
    );
    writeManifest(root, 'packages/_assertions', {
      name: '@animus-ui/assertions',
      main: './dist/index.js',
    });

    const result = spawnSync(
      'bash',
      [
        '-c',
        'set -euo pipefail; source scripts/verify/_preconditions.sh; require_fresh_package_dist packages/_assertions',
      ],
      { cwd: root, encoding: 'utf8' }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "ERROR: packages/_assertions/dist/ missing. Run: bun run --filter '@animus-ui/assertions' build:ts"
    );
  });

  it('keeps short package inputs and exact remediation when dist is stale', () => {
    const root = temporaryDirectory('animus-assertions-dist-stale-');
    mkdirSync(join(root, 'scripts/verify'), { recursive: true });
    copyFileSync(
      join(ROOT, 'scripts/verify/_preconditions.sh'),
      join(root, 'scripts/verify/_preconditions.sh')
    );
    writeManifest(root, 'packages/_assertions', {
      name: '@animus-ui/assertions',
      main: './dist/index.js',
    });
    const dist = join(root, 'packages/_assertions/dist/index.js');
    const source = join(root, 'packages/_assertions/src/index.ts');
    mkdirSync(dirname(dist), { recursive: true });
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(dist, 'export {};\n');
    writeFileSync(source, 'export {};\n');
    utimesSync(dist, new Date(1_000), new Date(1_000));
    utimesSync(source, new Date(2_000), new Date(2_000));

    const result = spawnSync(
      'bash',
      [
        '-c',
        'set -euo pipefail; source scripts/verify/_preconditions.sh; require_fresh_package_dist _assertions',
      ],
      { cwd: root, encoding: 'utf8' }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "ERROR: packages/_assertions/dist/ is stale (src newer than dist). Run: bun run --filter '@animus-ui/assertions' build:ts"
    );
  });

  it('assertion preflight names the package build without creating output', () => {
    const output = 'e2e/vite-app/.owner-graph-absent-output';
    const outputPath = join(ROOT, output);
    expect(existsSync(outputPath)).toBe(false);

    const result = spawnSync(
      'bash',
      [
        '../../scripts/verify/assert-consumer.sh',
        output,
        'e2e/vite-app/scripts/assert-build.ts',
      ],
      {
        cwd: join(ROOT, 'e2e/vite-app'),
        encoding: 'utf8',
      }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      `ERROR: ${output} missing. Run: vp run @animus-ui/vite-app#verify:build`
    );
    expect(existsSync(outputPath)).toBe(false);
  });

  it('rejects absolute and escaping output and assertion paths independently', () => {
    const cases = [
      {
        kind: 'output',
        output: '/tmp/animus-owner-absolute-output',
        assertion: 'e2e/vite-app/scripts/assert-build.ts',
      },
      {
        kind: 'assertion',
        output: 'e2e/vite-app/.owner-graph-absent-output',
        assertion: '/tmp/animus-owner-absolute-assertion.ts',
      },
      {
        kind: 'output',
        output: '../animus-owner-escaping-output',
        assertion: 'e2e/vite-app/scripts/assert-build.ts',
      },
      {
        kind: 'assertion',
        output: 'e2e/vite-app/.owner-graph-absent-output',
        assertion: '../animus-owner-escaping-assertion.ts',
      },
    ];

    for (const testCase of cases) {
      const value =
        testCase.kind === 'output' ? testCase.output : testCase.assertion;
      const result = spawnSync(
        'bash',
        [
          '../../scripts/verify/assert-consumer.sh',
          testCase.output,
          testCase.assertion,
        ],
        {
          cwd: join(ROOT, 'e2e/vite-app'),
          encoding: 'utf8',
        }
      );

      expect(result.status, `${testCase.kind}: ${value}`).toBe(2);
      expect(result.stderr).toContain(
        `ERROR: ${testCase.kind} path must be root-relative and remain within repository: ${value}`
      );
    }
  });
});
