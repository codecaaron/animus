import { spawnSync } from 'node:child_process';
import {
  chmodSync,
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
  scripts?: Record<string, string>;
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

const deploymentScripts = {
  'deploy:showcase': "bun run --filter '@animus-ui/showcase' cf:deploy",
  'deploy:vite': "bun run --filter '@animus-ui/vite-app' cf:deploy",
  'deploy:vinext': "bun run --filter '@animus-ui/vinext-app' cf:deploy",
  'deploy:react-router':
    "bun run --filter '@animus-ui/react-router-app' cf:deploy",
} as const;

const nightlyTargets = ['showcase', 'vite', 'vinext', 'react-router'] as const;
const nightlyOwners = {
  showcase: '@animus-ui/showcase',
  vite: '@animus-ui/vite-app',
  vinext: '@animus-ui/vinext-app',
  'react-router': '@animus-ui/react-router-app',
} as const;
const cloudflareAccountIdVariable = 'CLOUDFLARE_ACCOUNT_ID';
const cloudflareApiTokenVariable = 'CLOUDFLARE_API_TOKEN';

function runNightlyWorkers(
  environment: Record<string, string | undefined> = {}
): {
  commands: string[];
  status: number | null;
  stderr: string;
  stdout: string;
} {
  const directory = mkdtempSync(resolve(tmpdir(), 'animus-workers-nightly-'));
  const commandLog = resolve(directory, 'commands.log');
  const commandDouble = resolve(directory, 'command-double.sh');
  writeFileSync(
    commandDouble,
    `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$COMMAND_LOG"
if grep -Fxq -- "$*" <<< "\${FAIL_COMMANDS:-}"; then
  exit 23
fi
`
  );
  chmodSync(commandDouble, 0o755);

  try {
    const result = spawnSync(
      '/bin/bash',
      [resolve(ROOT, 'scripts/deploy/workers-nightly.sh')],
      {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          BUNX_BIN: commandDouble,
          BUN_BIN: commandDouble,
          COMMAND_LOG: commandLog,
          GITHUB_REF: 'refs/heads/main',
          GITHUB_SHA: '0123456789abcdef',
          [cloudflareAccountIdVariable]: 'test-account',
          [cloudflareApiTokenVariable]: 'test-token',
          ...environment,
        },
      }
    );
    return {
      commands: existsSync(commandLog)
        ? readFileSync(commandLog, 'utf8').trim().split('\n')
        : [],
      status: result.status,
      stderr: result.stderr,
      stdout: result.stdout,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function expectedNightlyCommands(): string[] {
  return [
    'vp run build:extract-v1',
    'vp run build:extract-v2',
    'vp run build:ts',
    ...nightlyTargets.map(
      (target) => `vp run ${nightlyOwners[target]}#verify:build`
    ),
    ...nightlyTargets.map(
      (target) => `vp run ${nightlyOwners[target]}#verify:assert`
    ),
    ...nightlyTargets.map(
      (target) => `vp run ${nightlyOwners[target]}#verify:dry-run`
    ),
    ...nightlyTargets.map((target) => `run deploy:${target}`),
  ];
}

describe('Workers deployment topology', () => {
  it('keeps repository and Worker Node pins aligned', () => {
    const nodeVersion = source('.node-version').trim();
    const toolVersion =
      source('.tool-versions').match(/^nodejs\s+(\S+)$/m)?.[1];

    expect(toolVersion).toBeTruthy();
    expect(nodeVersion).toBe(toolVersion);
  });

  it('keeps the Vite canary assets-only', () => {
    const config = jsonc('e2e/vite-app/wrangler.jsonc');
    expect(config).toMatchObject({
      name: 'animus-vite-canary',
      assets: { not_found_handling: 'single-page-application' },
    });
    expect(config).not.toHaveProperty('main');
    expect(config.assets).not.toHaveProperty('run_worker_first');
  });

  it('exposes four independent deploy commands and no competing Netlify path', () => {
    const scripts = manifest('package.json').scripts ?? {};
    expect(scripts).toMatchObject(deploymentScripts);
    expect(Object.values(scripts).join('\n')).not.toMatch(/netlify/i);
    expect(existsSync(resolve(ROOT, 'netlify.toml'))).toBe(false);
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
});

describe('Workers nightly workflow', () => {
  it('is main-only, scheduled, manual, and minimally permissioned', () => {
    const workflow = source('.github/workflows/deploy-workers-nightly.yml');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain("cron: '17 6 * * *'");
    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('group: deploy-workers-nightly');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).not.toContain('build:extract-v1');
  });

  it('frozen-installs and invokes the orchestrator once', () => {
    const workflow = source('.github/workflows/deploy-workers-nightly.yml');
    expect(workflow).toContain('- run: bun install --frozen-lockfile');
    expect(
      workflow.match(/run: bash scripts\/deploy\/workers-nightly\.sh/g)
    ).toHaveLength(1);
  });

  it('scopes Cloudflare secrets to the orchestrator step', () => {
    const workflow = source('.github/workflows/deploy-workers-nightly.yml');
    const orchestratorStepStart = workflow.indexOf(
      '      - name: Build, validate, and deploy Workers'
    );
    expect(orchestratorStepStart).toBeGreaterThanOrEqual(0);
    const orchestratorStep = workflow.slice(orchestratorStepStart);

    expect(workflow).not.toMatch(/^    env:/m);
    expect(orchestratorStep).toContain('        env:');
    expect(orchestratorStep).toContain(
      'CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}'
    );
    expect(orchestratorStep).toContain(
      'CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}'
    );
    expect(workflow.match(/CLOUDFLARE_ACCOUNT_ID:/g)).toHaveLength(1);
    expect(workflow.match(/CLOUDFLARE_API_TOKEN:/g)).toHaveLength(1);
  });
});

describe('Workers nightly deployment behavior', () => {
  it('builds and validates every target before deploying in order', () => {
    const result = runNightlyWorkers();

    expect(result.status, result.stderr).toBe(0);
    expect(result.commands).toEqual(expectedNightlyCommands());
    for (const target of nightlyTargets) {
      expect(result.stdout).toContain(
        `target=${target} source-sha=0123456789abcdef`
      );
    }
  });

  it.each([
    ['a non-main ref', { GITHUB_REF: 'refs/heads/next' }],
    ['a missing SHA', { GITHUB_SHA: undefined }],
    ['a missing account ID', { [cloudflareAccountIdVariable]: undefined }],
    ['a missing API token', { [cloudflareApiTokenVariable]: undefined }],
  ])('runs zero commands for %s', (_label, environment) => {
    const result = runNightlyWorkers(environment);

    expect(result.status).not.toBe(0);
    expect(result.commands).toEqual([]);
  });

  it.each([
    ['build', 'vp run @animus-ui/vite-app#verify:build'],
    ['assertion', 'vp run @animus-ui/vinext-app#verify:assert'],
    ['dry-run', 'vp run @animus-ui/showcase#verify:dry-run'],
  ])('runs zero deploy commands when the %s phase fails', (_phase, command) => {
    const result = runNightlyWorkers({ FAIL_COMMANDS: command });

    expect(result.status).not.toBe(0);
    expect(result.commands).toContain(command);
    expect(
      result.commands.filter((entry) => entry.startsWith('run deploy:'))
    ).toHaveLength(0);
  });

  it('attempts every deploy and summarizes all failed targets', () => {
    const result = runNightlyWorkers({
      FAIL_COMMANDS: ['run deploy:vite', 'run deploy:react-router'].join('\n'),
    });

    expect(result.status).not.toBe(0);
    expect(result.commands).toEqual(expectedNightlyCommands());
    expect(result.stderr).toContain('deploy failed: vite');
    expect(result.stderr).toContain('deploy failed: react-router');
    expect(result.stderr).toContain(
      'nightly Worker deployment failed for targets: vite react-router'
    );
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
});
