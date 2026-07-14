import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');

type Manifest = {
  name?: string;
  private?: boolean;
  type?: string;
  workspaces?: string[];
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function manifest(path: string): Manifest {
  const absolute = resolve(ROOT, path);
  expect(existsSync(absolute), `${path} must exist`).toBe(true);
  return JSON.parse(readFileSync(absolute, 'utf8')) as Manifest;
}

function source(path: string): string {
  const absolute = resolve(ROOT, path);
  expect(existsSync(absolute), `${path} must exist`).toBe(true);
  return readFileSync(absolute, 'utf8');
}

function jsonc(path: string): Record<string, unknown> {
  return JSON.parse(source(path).replace(/,\s*([}\]])/g, '$1')) as Record<
    string,
    unknown
  >;
}

function taskBlock(config: string, task: string): string {
  const marker = `'${task}': {`;
  const start = config.indexOf(marker);
  expect(start, `${task} must be registered`).toBeGreaterThanOrEqual(0);
  const openingBrace = config.indexOf('{', start);
  let depth = 0;

  for (let index = openingBrace; index < config.length; index += 1) {
    if (config[index] === '{') depth += 1;
    if (config[index] !== '}') continue;
    depth -= 1;
    if (depth === 0) return config.slice(start, index + 1);
  }

  throw new Error(`${task} task block is not balanced`);
}

function stripJavaScriptComments(input: string): string {
  let output = '';
  let quote: "'" | '"' | '`' | undefined;
  let index = 0;

  while (index < input.length) {
    const character = input[index];
    const next = input[index + 1];

    if (quote) {
      output += character;
      if (character === '\\') {
        output += next ?? '';
        index += 2;
        continue;
      }
      if (character === quote) quote = undefined;
      index += 1;
      continue;
    }

    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      output += character;
      index += 1;
      continue;
    }

    if (character === '/' && next === '/') {
      index += 2;
      while (index < input.length && input[index] !== '\n') index += 1;
      if (input[index] === '\n') output += '\n';
      index += 1;
      continue;
    }

    if (character === '/' && next === '*') {
      index += 2;
      while (
        index < input.length &&
        !(input[index] === '*' && input[index + 1] === '/')
      ) {
        if (input[index] === '\n') output += '\n';
        index += 1;
      }
      index += 2;
      continue;
    }

    output += character;
    index += 1;
  }

  return output;
}

function animusOptions(config: string, label: string): string {
  const uncommented = stripJavaScriptComments(config);
  const callStart = uncommented.indexOf('animusExtract(');
  expect(callStart, `${label} must configure Animus`).toBeGreaterThanOrEqual(0);
  const openingBrace = uncommented.indexOf('{', callStart);
  expect(openingBrace, `${label} Animus options must open`).toBeGreaterThan(
    callStart
  );

  let depth = 0;
  let quote: "'" | '"' | '`' | undefined;
  for (let index = openingBrace; index < uncommented.length; index += 1) {
    const character = uncommented[index];
    if (quote) {
      if (character === '\\') {
        index += 1;
        continue;
      }
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character !== '}') continue;
    depth -= 1;
    if (depth === 0) return uncommented.slice(openingBrace, index + 1);
  }

  throw new Error(`${label} Animus options are not balanced`);
}

function expectPinned(value: string | undefined, label: string): void {
  expect(value, `${label} must be declared`).toBeTruthy();
  expect(value, `${label} must be exact SemVer`).toMatch(
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z.-]+)?$/
  );
}

const cloudflareScripts = {
  'cf:deploy': 'wrangler deploy',
  'cf:upload': 'wrangler versions upload',
  'cf:dry-run': 'wrangler deploy --dry-run',
};

const selectedVersions = {
  wrangler: '4.110.0',
  cloudflareVitePlugin: '1.44.0',
  vinext: '1.0.0-beta.1',
  viteRscPlugin: '0.5.27',
  viteReactPlugin: '6.0.3',
  reactRouter: '8.2.0',
  react: '19.2.7',
  reactTypes: '19.2.17',
  reactDomTypes: '19.2.3',
  vite: '8.1.4',
} as const;

const deploymentScripts = {
  'deploy:showcase': "bun run --filter '@animus-ui/showcase' cf:deploy",
  'deploy:vite': "bun run --filter '@animus-ui/vite-app' cf:deploy",
  'deploy:vinext': "bun run --filter '@animus-ui/vinext-app' cf:deploy",
  'deploy:react-router':
    "bun run --filter '@animus-ui/react-router-app' cf:deploy",
} as const;

const assertionCommands = {
  next: 'bash scripts/verify/assert-next.sh',
  showcase: 'bash scripts/verify/assert-showcase.sh',
  vite: 'bash scripts/verify/assert-vite.sh',
  vinext: 'bash scripts/verify/assert-vinext.sh',
  'react-router': 'bash scripts/verify/assert-react-router.sh',
} as const;

const dryRunCommands = {
  showcase:
    "bash scripts/verify/dry-run-worker.sh packages/showcase '@animus-ui/showcase' packages/showcase/dist animus verify:build:showcase",
  vite: "bash scripts/verify/dry-run-worker.sh e2e/vite-app '@animus-ui/vite-app' e2e/vite-app/dist animus-vite-canary verify:build:vite",
  vinext:
    "bash scripts/verify/dry-run-worker.sh e2e/vinext-app '@animus-ui/vinext-app' e2e/vinext-app/dist animus-vinext-canary verify:build:vinext",
  'react-router':
    "bash scripts/verify/dry-run-worker.sh e2e/react-router-app '@animus-ui/react-router-app' e2e/react-router-app/build animus-react-router-canary verify:build:react-router",
} as const;

const workerBuilds = {
  showcase: 'packages/showcase/vite.config.ts',
  vite: 'e2e/vite-app/vite.config.ts',
  vinext: 'e2e/vinext-app/vite.config.ts',
  'react-router': 'e2e/react-router-app/vite.config.ts',
} as const;

describe('Workers canary package envelope', () => {
  it.each([
    'latest',
    'beta',
    '8.x',
    'file:../vite',
    'https://example.com/pkg.tgz',
  ])('rejects non-exact external version %s', (version) => {
    expect(() => expectPinned(version, 'fixture')).toThrow();
  });

  it('registers both new applications and pins Wrangler and Node', () => {
    const root = manifest('package.json');
    expect(root.workspaces).toContain('e2e/vinext-app');
    expect(root.workspaces).toContain('e2e/react-router-app');
    expectPinned(root.devDependencies?.wrangler, 'wrangler');
    expect(root.devDependencies?.wrangler).toBe(selectedVersions.wrangler);
    expect(readFileSync(resolve(ROOT, '.tool-versions'), 'utf8')).toMatch(
      /^nodejs 24\.18\.0$/m
    );
    expect(source('.node-version')).toBe('24.18.0\n');
  });

  it.each(['packages/showcase', 'e2e/vite-app'])(
    '%s exposes Cloudflare commands',
    (path) => {
      expect(manifest(`${path}/package.json`).scripts).toMatchObject(
        cloudflareScripts
      );
    }
  );

  it('pins the Cloudflare adapter in the existing Vite canary', () => {
    expect(
      manifest('e2e/vite-app/package.json').devDependencies?.[
        '@cloudflare/vite-plugin'
      ]
    ).toBe(selectedVersions.cloudflareVitePlugin);
  });

  it('defines a pinned Vinext workspace envelope', () => {
    const app = manifest('e2e/vinext-app/package.json');
    expect(app).toMatchObject({
      name: '@animus-ui/vinext-app',
      private: true,
      type: 'module',
    });
    expect(app.scripts).toMatchObject({
      dev: 'vinext dev',
      build: 'vinext build',
      start: 'vinext start',
      check: 'vinext check',
      ...cloudflareScripts,
    });
    for (const name of [
      'vinext',
      '@vinext/cloudflare',
      '@cloudflare/vite-plugin',
      '@vitejs/plugin-rsc',
      '@vitejs/plugin-react',
      'vite',
      'react',
      'react-dom',
      'react-server-dom-webpack',
    ]) {
      expectPinned(
        app.dependencies?.[name] ?? app.devDependencies?.[name],
        `vinext-app ${name}`
      );
    }
    expect(app.dependencies).toMatchObject({
      '@animus-ui/system': 'workspace:*',
      '@animus-ui/test-ds': 'workspace:*',
      '@animus-ui/vite-plugin': 'workspace:*',
    });
    expect({ ...app.dependencies, ...app.devDependencies }).toMatchObject({
      '@cloudflare/vite-plugin': selectedVersions.cloudflareVitePlugin,
      '@types/react': selectedVersions.reactTypes,
      '@types/react-dom': selectedVersions.reactDomTypes,
      '@vinext/cloudflare': selectedVersions.vinext,
      '@vitejs/plugin-react': selectedVersions.viteReactPlugin,
      '@vitejs/plugin-rsc': selectedVersions.viteRscPlugin,
      react: selectedVersions.react,
      'react-dom': selectedVersions.react,
      'react-server-dom-webpack': selectedVersions.react,
      vinext: selectedVersions.vinext,
      vite: selectedVersions.vite,
    });
  });

  it('defines a pinned React Router workspace envelope', () => {
    const app = manifest('e2e/react-router-app/package.json');
    expect(app).toMatchObject({
      name: '@animus-ui/react-router-app',
      private: true,
      type: 'module',
    });
    expect(app.scripts).toMatchObject({
      dev: 'react-router dev',
      build: 'react-router build',
      preview: 'vite preview',
      typecheck: 'react-router typegen && tsgo --noEmit',
      ...cloudflareScripts,
    });
    for (const name of [
      'react-router',
      '@react-router/dev',
      '@cloudflare/vite-plugin',
      'vite',
      'react',
      'react-dom',
    ]) {
      expectPinned(
        app.dependencies?.[name] ?? app.devDependencies?.[name],
        `react-router-app ${name}`
      );
    }
    expect(app.dependencies).toMatchObject({
      '@animus-ui/system': 'workspace:*',
      '@animus-ui/test-ds': 'workspace:*',
      '@animus-ui/vite-plugin': 'workspace:*',
    });
    expect({ ...app.dependencies, ...app.devDependencies }).toMatchObject({
      '@cloudflare/vite-plugin': selectedVersions.cloudflareVitePlugin,
      '@react-router/dev': selectedVersions.reactRouter,
      '@types/react': selectedVersions.reactTypes,
      '@types/react-dom': selectedVersions.reactDomTypes,
      react: selectedVersions.react,
      'react-dom': selectedVersions.react,
      'react-router': selectedVersions.reactRouter,
      vite: selectedVersions.vite,
    });
  });
});

describe('Workers cutover orchestration', () => {
  it('keeps the Vite canary assets-only', () => {
    const config = jsonc('e2e/vite-app/wrangler.jsonc');
    expect(config).toMatchObject({
      name: 'animus-vite-canary',
      assets: { not_found_handling: 'single-page-application' },
    });
    expect(config).not.toHaveProperty('main');
    expect(config.assets).not.toHaveProperty('run_worker_first');
    expect(existsSync(resolve(ROOT, 'e2e/vite-app/worker/index.ts'))).toBe(
      false
    );
    expect(
      existsSync(resolve(ROOT, 'e2e/vite-app/scripts/worker.test.ts'))
    ).toBe(false);
  });

  it('exposes four independent root deploy commands and no Netlify command', () => {
    const scripts = manifest('package.json').scripts ?? {};
    expect(scripts).toMatchObject(deploymentScripts);
    expect(Object.values(scripts).join('\n')).not.toMatch(/netlify/i);
    expect(existsSync(resolve(ROOT, 'netlify.toml'))).toBe(false);
  });

  it('registers every Worker build, assert, dry-run, and focused tier', () => {
    const config = source('vite.config.ts');
    for (const task of [
      'verify:workers:contracts',
      'verify:build:vinext',
      'verify:assert:vinext',
      'verify:dry-run:showcase',
      'verify:dry-run:vite',
      'verify:dry-run:vinext',
      'verify:build:react-router',
      'verify:assert:react-router',
      'verify:dry-run:react-router',
      '_verify:dry-run:showcase:after-build',
      '_verify:dry-run:vite:after-build',
      '_verify:dry-run:vinext:after-build',
      '_verify:dry-run:react-router:after-build',
      'verify:vinext',
      'verify:react-router',
      'build:vite',
      'build:vinext',
      'build:react-router',
    ]) {
      expect(config, `${task} must be registered`).toContain(`'${task}'`);
    }
  });

  it('keeps public assertions atomic and focused wrappers ordered', () => {
    const config = source('vite.config.ts');
    for (const [target, command] of Object.entries(assertionCommands)) {
      expect(taskBlock(config, `verify:assert:${target}`)).not.toContain(
        'dependsOn:'
      );
      expect(taskBlock(config, `verify:${target}`)).toContain(
        `command: '${command}'`
      );
      expect(taskBlock(config, `verify:${target}`)).toContain(
        `dependsOn: ['verify:build:${target}']`
      );
    }
  });

  it('keeps public dry runs atomic and registers private ordered chains', () => {
    const config = source('vite.config.ts');
    for (const [target, command] of Object.entries(dryRunCommands)) {
      expect(taskBlock(config, `verify:dry-run:${target}`)).toContain(command);
      expect(taskBlock(config, `verify:dry-run:${target}`)).not.toContain(
        'dependsOn:'
      );
      expect(
        taskBlock(config, `_verify:dry-run:${target}:after-build`)
      ).toContain(command);
      expect(
        taskBlock(config, `_verify:dry-run:${target}:after-build`)
      ).toContain(`dependsOn: ['verify:build:${target}']`);
    }
  });

  it('composes complete graphs from focused and private ordered tasks', () => {
    const config = source('vite.config.ts');
    const full = taskBlock(config, 'verify:full');
    const fullGraph = [
      full,
      taskBlock(config, '_verify:full:build'),
      taskBlock(config, '_verify:full:after-build'),
    ].join('\n');
    const ci = taskBlock(config, 'verify:ci');
    const ciGraph = [
      ci,
      taskBlock(config, '_verify:ci:build'),
      taskBlock(config, '_verify:ci:after-build'),
    ].join('\n');

    expect(fullGraph).toContain("'verify:workers:contracts'");
    for (const target of Object.keys(assertionCommands)) {
      expect(fullGraph).toContain(`'verify:${target}'`);
      expect(fullGraph).not.toContain(`'verify:assert:${target}'`);
    }
    for (const target of Object.keys(dryRunCommands)) {
      expect(fullGraph).toContain(`'_verify:dry-run:${target}:after-build'`);
      expect(fullGraph).not.toContain(`'verify:dry-run:${target}'`);
      expect(ciGraph).toContain(`'verify:${target}'`);
      expect(ciGraph).toContain(`'_verify:dry-run:${target}:after-build'`);
      expect(ciGraph).not.toContain(`'verify:assert:${target}'`);
      expect(ciGraph).not.toContain(`'verify:dry-run:${target}'`);
    }
  });

  it('reads only the top-level Worker name from adversarial JSONC', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'animus-worker-name-'));
    const configPath = resolve(directory, 'wrangler.jsonc');
    writeFileSync(
      configPath,
      `{
        // A nested name must not impersonate the Worker identity.
        "vars": {
          "metadata": { "name": "nested-decoy", },
        },
        "name"   :   "top-level-worker",
      }`
    );

    try {
      const result = spawnSync(
        'bun',
        [resolve(ROOT, 'scripts/verify/read-worker-name.ts'), configPath],
        { cwd: ROOT, encoding: 'utf8' }
      );
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toBe('top-level-worker\n');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('ignores generated Cloudflare and React Router state', () => {
    const ignore = source('.gitignore');
    expect(ignore).toMatch(/^\.wrangler\/$/m);
    expect(ignore).toMatch(/^\.react-router\/$/m);
  });
});

describe('Workers cold-build reproducibility', () => {
  it('uses published rquickjs bindings without bindgen', () => {
    const result = spawnSync(
      'cargo',
      [
        'tree',
        '--locked',
        '--manifest-path',
        resolve(ROOT, 'packages/extract/crates/extract-v2/Cargo.toml'),
        '-e',
        'features',
        '-i',
        'rquickjs-sys',
      ],
      { cwd: ROOT, encoding: 'utf8' }
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toContain('rquickjs feature "bindgen"');
    expect(result.stdout).not.toContain('rquickjs-sys feature "bindgen"');
  });

  it('builds V2 through the shared pinned-toolchain script', () => {
    const config = source('vite.config.ts');
    expect(taskBlock(config, 'build:extract-v2')).toContain(
      "command: 'bash scripts/cloudflare/build-extract-v2.sh'"
    );

    const script = source('scripts/cloudflare/build-extract-v2.sh');
    expect(script).toContain(
      'packages/extract/crates/extract-v2/rust-toolchain.toml'
    );
    expect(script).toContain('WORKERS_CI');
    expect(script).toContain('--profile minimal');
    expect(script).toContain('--no-modify-path');
    expect(script).toContain(
      `exec "$BUN_BIN" run --filter '@animus-ui/extract' build:v2`
    );
    for (const command of [
      'CARGO_BIN',
      'CURL_BIN',
      'SH_BIN',
      'RUSTC_BIN',
      'BUN_BIN',
    ]) {
      expect(script, `${command} must be injectable`).toContain(`${command}=`);
    }
    expect(script).toContain('trap - EXIT');
  });

  it('makes every Worker build provision V2 before building the app', () => {
    const config = source('vite.config.ts');
    for (const target of Object.keys(workerBuilds)) {
      expect(taskBlock(config, `build:${target}`)).toContain(
        "dependsOn: ['build:extract-v2', 'build:ts']"
      );
    }
  });

  it('deduplicates V1, V2, and TypeScript builds in the CI graph', () => {
    const extract = manifest('packages/extract/package.json');
    expect(extract.scripts?.['build:v1']).toBe(
      'napi build --platform --release'
    );

    const config = source('vite.config.ts');
    expect(taskBlock(config, 'build:extract')).toContain(
      `command: "bun run --filter '@animus-ui/extract' build"`
    );
    expect(taskBlock(config, 'build:extract-v1')).toContain(
      `command: "bun run --filter '@animus-ui/extract' build:v1"`
    );

    const ci = taskBlock(config, 'verify:ci');
    expect(ci).toContain(
      "command: 'vp run _verify:ci:build && vp run _verify:ci:after-build'"
    );
    expect(ci).not.toContain('dependsOn:');

    const buildStage = taskBlock(config, '_verify:ci:build');
    expect(buildStage).not.toMatch(/^\s*'build:extract',\s*$/m);
    for (const task of ['build:extract-v1', 'build:extract-v2', 'build:ts']) {
      expect(buildStage.match(new RegExp(`'${task}'`, 'g'))).toHaveLength(1);
    }

    const afterBuild = taskBlock(config, '_verify:ci:after-build');
    for (const task of [
      'verify:lint',
      'verify:unit:rust',
      'verify:hygiene:rust',
      'verify:compile',
      'verify:types',
      'verify:unit:ts',
      'verify:workers:contracts',
      'verify:canary',
      'verify:parity',
      'verify:integration',
      'verify:showcase',
      'verify:vite',
      'verify:vinext',
      'verify:react-router',
    ]) {
      expect(afterBuild).toContain(`'${task}'`);
    }
  });

  it('stages the full graph after its unique native and TypeScript builds', () => {
    const config = source('vite.config.ts');
    const full = taskBlock(config, 'verify:full');
    expect(full).toContain(
      "'vp run _verify:full:build && vp run _verify:full:after-build'"
    );
    expect(full).not.toContain('dependsOn:');

    const buildStage = taskBlock(config, '_verify:full:build');
    expect(buildStage).not.toMatch(/^\s*'build:extract',\s*$/m);
    for (const task of ['build:extract-v1', 'build:extract-v2', 'build:ts']) {
      expect(buildStage.match(new RegExp(`'${task}'`, 'g'))).toHaveLength(1);
    }

    const afterBuild = taskBlock(config, '_verify:full:after-build');
    for (const task of [
      'verify:lint',
      'verify:compile',
      'verify:types',
      'verify:unit:ts',
      'verify:unit:rust',
      'verify:workers:contracts',
      'verify:canary',
      'verify:parity',
      'verify:integration',
      'verify:next',
      'verify:showcase',
      'verify:vite',
      'verify:vinext',
      'verify:react-router',
    ]) {
      expect(afterBuild).toContain(`'${task}'`);
    }
  });

  it('reads balanced Animus options after removing comments', () => {
    const options = animusOptions(
      `animusExtract({
        // A decoy close must not truncate the options: })
        verify: true,
        nested: { value: '}' },
        strict: true,
      })`,
      'fixture'
    );
    expect(options).toContain('verify: true');
    expect(options).toContain('strict: true');
    expect(options).toContain("nested: { value: '}' }");
  });

  it('verifies and fails extraction loudly in every Worker Vite config', () => {
    for (const configPath of Object.values(workerBuilds)) {
      const options = animusOptions(source(configPath), configPath);
      expect(options).toContain('verify: true');
      expect(options).toContain('strict: true');
    }
  });
});
