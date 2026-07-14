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
      /^nodejs 22\.22\.0$/m
    );
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
    const ci = taskBlock(config, 'verify:ci');

    expect(full).toContain("'verify:workers:contracts'");
    for (const target of Object.keys(assertionCommands)) {
      expect(full).toContain(`'verify:${target}'`);
      expect(full).not.toContain(`'verify:assert:${target}'`);
    }
    for (const target of Object.keys(dryRunCommands)) {
      expect(full).toContain(`'_verify:dry-run:${target}:after-build'`);
      expect(full).not.toContain(`'verify:dry-run:${target}'`);
      expect(ci).toContain(`'verify:${target}'`);
      expect(ci).toContain(`'_verify:dry-run:${target}:after-build'`);
      expect(ci).not.toContain(`'verify:assert:${target}'`);
      expect(ci).not.toContain(`'verify:dry-run:${target}'`);
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
