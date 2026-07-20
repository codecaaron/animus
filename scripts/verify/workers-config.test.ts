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

const workerTargets = ['showcase', 'vite', 'vinext', 'react-router'] as const;
const workerOwners = {
  showcase: '@animus-ui/showcase',
  vite: '@animus-ui/vite-app',
  vinext: '@animus-ui/vinext-app',
  'react-router': '@animus-ui/react-router-app',
} as const;
const cloudflareAccountIdVariable = 'CLOUDFLARE_ACCOUNT_ID';
const cloudflareApiTokenVariable = 'CLOUDFLARE_API_TOKEN';

function runWorkers(
  mode?: string,
  environment: Record<string, string | undefined> = {}
): {
  commands: string[];
  status: number | null;
  stderr: string;
  stdout: string;
} {
  const directory = mkdtempSync(resolve(tmpdir(), 'animus-workers-'));
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
      [
        resolve(ROOT, 'scripts/deploy/workers.sh'),
        ...(mode === undefined ? [] : [mode]),
      ],
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

function expectedValidationCommands(): string[] {
  return [
    "-e const m=require('./packages/extract/crates/extract-v2/animus-extract-v2.linux-x64-gnu.node'); if (!Object.keys(m).length) throw new Error('V2 NAPI exports missing')",
    'vp run build:ts',
    ...workerTargets.map(
      (target) => `vp run ${workerOwners[target]}#verify:build`
    ),
    ...workerTargets.map(
      (target) => `vp run ${workerOwners[target]}#verify:assert`
    ),
    ...workerTargets.map(
      (target) => `vp run ${workerOwners[target]}#verify:dry-run`
    ),
  ];
}

function expectedDeploymentCommands(): string[] {
  return workerTargets.map((target) => `run deploy:${target}`);
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

  it('removes the superseded standalone workflow and orchestrator', () => {
    expect(
      existsSync(resolve(ROOT, '.github/workflows/deploy-workers-nightly.yml'))
    ).toBe(false);
    expect(existsSync(resolve(ROOT, 'scripts/deploy/workers-nightly.sh'))).toBe(
      false
    );
    expect(existsSync(resolve(ROOT, 'scripts/deploy/workers.sh'))).toBe(true);
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

describe('Workers deployment behavior', () => {
  it.each([undefined, 'invalid'])(
    'requires a validate or deploy mode (%s)',
    (mode) => {
      const result = runWorkers(mode);

      expect(result.status).toBe(2);
      expect(result.commands).toEqual([]);
    }
  );

  it('validates direct native loads and every owner in complete phases', () => {
    const result = runWorkers('validate', {
      [cloudflareAccountIdVariable]: undefined,
      [cloudflareApiTokenVariable]: undefined,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.commands).toEqual(expectedValidationCommands());
  });

  it('deploys only the four targets and logs their source SHA', () => {
    const result = runWorkers('deploy');

    expect(result.status, result.stderr).toBe(0);
    expect(result.commands).toEqual(expectedDeploymentCommands());
    for (const target of workerTargets) {
      expect(result.stdout).toContain(
        `target=${target} source-sha=0123456789abcdef`
      );
    }
  });

  it.each(['validate', 'deploy'])(
    '%s runs zero commands for a non-main ref',
    (mode) => {
      const result = runWorkers(mode, { GITHUB_REF: 'refs/heads/next' });

      expect(result.status).not.toBe(0);
      expect(result.commands).toEqual([]);
    }
  );

  it.each(['validate', 'deploy'])(
    '%s runs zero commands for a missing SHA',
    (mode) => {
      const result = runWorkers(mode, { GITHUB_SHA: undefined });

      expect(result.status).not.toBe(0);
      expect(result.commands).toEqual([]);
    }
  );

  it.each([
    ['a missing account ID', { [cloudflareAccountIdVariable]: undefined }],
    ['a missing API token', { [cloudflareApiTokenVariable]: undefined }],
  ])('deploy runs zero commands for %s', (_label, environment) => {
    const result = runWorkers('deploy', environment);

    expect(result.status).not.toBe(0);
    expect(result.commands).toEqual([]);
  });

  it.each([
    ['native load', expectedValidationCommands()[0]],
    ['build', 'vp run @animus-ui/vite-app#verify:build'],
    ['assertion', 'vp run @animus-ui/vinext-app#verify:assert'],
    ['dry-run', 'vp run @animus-ui/showcase#verify:dry-run'],
  ])('stops validation when the %s phase fails', (_phase, command) => {
    const result = runWorkers('validate', { FAIL_COMMANDS: command });
    const commandIndex = expectedValidationCommands().indexOf(command);

    expect(result.status).not.toBe(0);
    expect(result.commands).toEqual(
      expectedValidationCommands().slice(0, commandIndex + 1)
    );
  });

  it('attempts every deploy and summarizes all failed targets', () => {
    const result = runWorkers('deploy', {
      FAIL_COMMANDS: ['run deploy:vite', 'run deploy:react-router'].join('\n'),
    });

    expect(result.status).not.toBe(0);
    expect(result.commands).toEqual(expectedDeploymentCommands());
    expect(result.stderr).toContain('deploy failed: vite');
    expect(result.stderr).toContain('deploy failed: react-router');
    expect(result.stderr).toContain(
      'Worker deployment failed for targets: vite react-router'
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
