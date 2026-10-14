import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `on:` triggers and `strategy:` matrices are GitHub's schemas, not this
 * suite's, so they stay unmodeled here and are compared whole.
 */
type WorkflowValue =
  | undefined
  | null
  | boolean
  | number
  | string
  | WorkflowValue[]
  | WorkflowMapping;

type WorkflowMapping = { [key: string]: WorkflowValue };

/**
 * A `with:` input. Actions forwards every input as a string, so only scalars
 * are writable there.
 */
type WorkflowInput = boolean | number | string;

// Decided by representation tag rather than by `typeof`: `[object Object]` is
// what separates a YAML mapping from a list.
function isMapping(value: WorkflowValue): value is WorkflowMapping {
  return Object.prototype.toString.call(value) === '[object Object]';
}

type WorkflowStep = {
  env?: Record<string, string>;
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, WorkflowInput>;
};

type WorkflowJob = {
  concurrency?: {
    'cancel-in-progress': boolean;
    group: string;
  };
  env?: Record<string, string>;
  if?: string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  'runs-on': string;
  steps: WorkflowStep[];
  strategy?: WorkflowValue;
};

type Workflow = {
  on: Record<string, WorkflowValue>;
  jobs: Record<string, WorkflowJob>;
};

const ROOT = resolve(import.meta.dirname, '../..');
const verificationDependencies = [
  'lint',
  'clippy',
  'hygiene-rust',
  'verify',
  'verify-next',
  'verify-vite',
  'verify-workers',
  'verify-packed',
];
/** A release no longer waits on the Worker builds, which run only on an
 *  explicit dispatch, and waits on the speed gate and its confirmation on a
 *  second runner, which run only where a release publishes. */
const releaseDependencies = [
  ...verificationDependencies.filter((job) => job !== 'verify-workers'),
  'bench',
  'bench-confirm',
];
/** Worker builds and deploys run only on a dispatch that asks for them. */
const workerDispatch =
  "github.event_name == 'workflow_dispatch' && inputs.deploy_workers == true";
const deployCondition = `github.ref == 'refs/heads/main' && ${workerDispatch}`;
const releaseCondition =
  "(github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')) || (github.event_name == 'workflow_dispatch' && inputs.publish_packages == true)";
const cloudflareAccountIdVariable = 'CLOUDFLARE_ACCOUNT_ID';
const cloudflareApiTokenVariable = 'CLOUDFLARE_API_TOKEN';

function readWorkflow(): Workflow {
  const workflowPath = resolve(ROOT, '.github/workflows/ci.yaml');
  const parsed = spawnSync(
    'bun',
    [
      '-e',
      'const source = await Bun.file(process.argv[1]).text(); process.stdout.write(JSON.stringify(Bun.YAML.parse(source)));',
      workflowPath,
    ],
    { encoding: 'utf8' }
  );
  if (parsed.status !== 0) {
    throw new Error(`Bun.YAML.parse failed: ${parsed.stderr}`);
  }

  const document: WorkflowValue = JSON.parse(parsed.stdout);
  if (
    !isMapping(document) ||
    !isMapping(document.on) ||
    !isMapping(document.jobs)
  ) {
    throw new Error(
      `${workflowPath} has no top-level 'on:' and 'jobs:' mappings`
    );
  }

  // SAFETY: the guard above establishes the `on:` and `jobs:` mappings every
  // test navigates; `Workflow` is this suite's expectation, asserted below.
  return document as Workflow;
}

function namedStep(job: WorkflowJob, name: string): WorkflowStep {
  const step = job.steps.find((candidate) => candidate.name === name);
  if (!step) {
    throw new Error(`CI job is missing step: ${name}`);
  }
  return step;
}

function commandLines(run: string | undefined): string[] {
  return (run ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeWhitespace(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function githubSecret(variable: string): string {
  return `\${{ secrets.${variable} }}`;
}

function shellLoopValues(run: string | undefined, variable: string): string[] {
  const loop = (run ?? '').match(
    new RegExp(`for ${variable} in ([\\s\\S]*?); do`)
  );
  if (!loop?.[1]) {
    throw new Error(`CI command is missing for ${variable} loop`);
  }

  const values = loop[1].replace(/\\\n/g, ' ').trim();
  const quotedValues = [...values.matchAll(/"([^"]+)"/g)].map(
    (match) => match[1]
  );
  return quotedValues.length > 0 ? quotedValues : values.split(/\s+/);
}

describe('parsed CI graph', () => {
  it('preserves triggers, jobs, runners, dependencies, and the native matrix', () => {
    const workflow = readWorkflow();

    expect(workflow.on).toEqual({
      push: { branches: ['main', 'next'], tags: ['v*'] },
      pull_request: { branches: ['main', 'next'] },
      schedule: [{ cron: '17 6 * * *' }],
      workflow_dispatch: {
        inputs: {
          deploy_workers: {
            description: expect.any(String),
            required: false,
            type: 'boolean',
            default: false,
          },
          publish_packages: {
            description: expect.any(String),
            required: false,
            type: 'boolean',
            default: false,
          },
        },
      },
    });
    expect(Object.keys(workflow.jobs)).toEqual([
      'lint',
      'test-rust',
      'clippy',
      'hygiene-rust',
      'build-extract',
      'verify',
      'verify-next',
      'verify-vite',
      'verify-workers',
      'verify-packed',
      'bench',
      'bench-confirm',
      'deploy-workers',
      'release',
    ]);
    expect(
      Object.fromEntries(
        Object.entries(workflow.jobs).map(([name, job]) => [
          name,
          { needs: job.needs ?? [], runsOn: job['runs-on'] },
        ])
      )
    ).toEqual({
      lint: { needs: [], runsOn: 'ubuntu-latest' },
      'test-rust': { needs: [], runsOn: 'ubuntu-latest' },
      clippy: { needs: [], runsOn: 'ubuntu-latest' },
      'hygiene-rust': { needs: [], runsOn: 'ubuntu-latest' },
      'build-extract': { needs: [], runsOn: '${{ matrix.runner }}' },
      verify: {
        needs: ['build-extract', 'test-rust'],
        runsOn: 'ubuntu-latest',
      },
      'verify-next': { needs: ['build-extract'], runsOn: 'ubuntu-latest' },
      'verify-vite': { needs: ['build-extract'], runsOn: 'ubuntu-latest' },
      'verify-workers': {
        needs: ['build-extract'],
        runsOn: 'ubuntu-latest',
      },
      'verify-packed': {
        needs: ['build-extract'],
        runsOn: 'ubuntu-latest',
      },
      bench: { needs: ['build-extract'], runsOn: 'ubuntu-latest' },
      'bench-confirm': {
        needs: ['build-extract', 'bench'],
        runsOn: 'ubuntu-latest',
      },
      'deploy-workers': {
        needs: verificationDependencies,
        runsOn: 'ubuntu-latest',
      },
      release: {
        needs: releaseDependencies,
        runsOn: 'ubuntu-latest',
      },
    });
    expect(workflow.jobs['build-extract']?.strategy).toEqual({
      'fail-fast': false,
      matrix: {
        include: [
          { target: 'aarch64-apple-darwin', runner: 'macos-14' },
          { target: 'x86_64-unknown-linux-gnu', runner: 'ubuntu-latest' },
          {
            target: 'aarch64-unknown-linux-gnu',
            runner: 'ubuntu-24.04-arm',
            optional: true,
          },
        ],
      },
    });
  });

  it('reuses current-run Linux artifacts and validates before secret-scoped deployment', () => {
    const workflow = readWorkflow();
    const deploy = workflow.jobs['deploy-workers'];

    expect(deploy.needs).toEqual(verificationDependencies);
    expect(normalizeWhitespace(deploy.if)).toBe(deployCondition);
    expect(deploy.permissions).toEqual({ contents: 'read' });
    expect(deploy.concurrency).toEqual({
      group: 'deploy-workers',
      'cancel-in-progress': false,
    });
    expect(deploy.env).toBeUndefined();

    expect(namedStep(deploy, 'Download v2 linux binary').with).toEqual({
      name: 'napi-v2-x86_64-unknown-linux-gnu',
      path: 'packages/extract/crates/extract-v2/',
    });
    expect(namedStep(deploy, 'Install dependencies').run).toBe(
      'bun install --frozen-lockfile'
    );

    const validate = namedStep(deploy, 'Validate Workers');
    const mutate = namedStep(deploy, 'Deploy Workers');
    expect(validate).toMatchObject({
      run: 'bash scripts/deploy/workers.sh validate',
    });
    expect(validate.env).toBeUndefined();
    expect(mutate).toMatchObject({
      run: 'bash scripts/deploy/workers.sh deploy',
      env: {
        [cloudflareAccountIdVariable]: githubSecret(
          cloudflareAccountIdVariable
        ),
        [cloudflareApiTokenVariable]: githubSecret(cloudflareApiTokenVariable),
      },
    });
    expect(deploy.steps.indexOf(validate)).toBeLessThan(
      deploy.steps.indexOf(mutate)
    );

    const secretBearingSteps = Object.entries(workflow.jobs).flatMap(
      ([jobName, job]) =>
        job.steps
          .filter((step) =>
            Object.keys(step.env ?? {}).some((name) =>
              name.startsWith('CLOUDFLARE_')
            )
          )
          .map((step) => ({ jobName, step }))
    );
    expect(secretBearingSteps).toEqual([
      { jobName: 'deploy-workers', step: mutate },
    ]);

    expect(JSON.stringify(deploy)).not.toMatch(
      /cargo|rust-toolchain|napi(?:-rs)?\s+build|build:extract-v[12]/i
    );
  });

  it('keeps deployment and package publication authorization independent', () => {
    const jobs = readWorkflow().jobs;

    expect(normalizeWhitespace(jobs.release.if)).toBe(releaseCondition);
    expect(jobs.release.needs).toEqual(releaseDependencies);
    // The speed gate runs exactly where a release publishes: a release
    // never waits on a skipped gate, and no other push spends its minutes.
    expect(normalizeWhitespace(jobs.bench.if)).toBe(releaseCondition);
    expect(jobs['deploy-workers'].needs).not.toContain('bench');
    expect(jobs.release.needs).not.toContain('deploy-workers');
    expect(normalizeWhitespace(jobs['verify-workers'].if)).toBe(workerDispatch);
  });

  it('keeps lane preparation, receipt artifacts, and package-owned claims', () => {
    const jobs = readWorkflow().jobs;
    const preparedLanes = [
      'verify',
      'verify-next',
      'verify-vite',
      'verify-workers',
      'verify-packed',
      'bench',
      'bench-confirm',
    ];

    for (const jobName of preparedLanes) {
      const job = jobs[jobName];
      expect(job, jobName).toBeDefined();
      expect(namedStep(job, 'Download v2 linux binary')).toMatchObject({
        uses: 'actions/download-artifact@v8',
        with: {
          name: 'napi-v2-x86_64-unknown-linux-gnu',
          path: 'packages/extract/crates/extract-v2/',
        },
      });
      expect(namedStep(job, 'Build TS').run).toBe('bunx vp run build:ts');
    }

    expect(namedStep(jobs.verify, 'Showcase Build + Assert').run).toBe(
      'bunx vp run @animus-ui/showcase#verify:build\n' +
        'bunx vp run @animus-ui/showcase#verify:assert\n'
    );
    expect(namedStep(jobs['verify-next'], 'Next consumer lane').run).toBe(
      'bunx vp run @animus-ui/next-app#verify:build\n' +
        'bunx vp run @animus-ui/next-app#verify:assert\n' +
        'bunx vp run @animus-ui/next-app#verify:prefixed\n'
    );
    expect(
      namedStep(jobs.bench, 'Fetch the pinned reference release').run
    ).toBe('bun scripts/bench/prepare.ts');
    // A row that does not pass on the gate's runner is measured again on a
    // fresh one, and the release waits on that second verdict.
    expect(commandLines(namedStep(jobs.bench, 'Speed gate').run)).toEqual([
      'bun scripts/bench/run.ts --confirm "$RUNNER_TEMP/confirm" || [ -s "$RUNNER_TEMP/confirm" ]',
      'rows=$(cat "$RUNNER_TEMP/confirm")',
      'echo "rows=$rows" >> "$GITHUB_OUTPUT"',
    ]);
    expect(jobs.bench).toMatchObject({
      outputs: { rows: '${{ steps.gate.outputs.rows }}' },
    });
    expect(jobs['bench-confirm'].env).toEqual({
      ROWS: '${{ needs.bench.outputs.rows }}',
    });
    expect(
      namedStep(jobs['bench-confirm'], 'Confirm the rows on a fresh runner').run
    ).toContain('bun scripts/bench/run.ts "${rows[@]}"');
    expect(namedStep(jobs['verify-vite'], 'Vite consumer lane').run).toBe(
      'bunx vp run @animus-ui/vite-app#verify:build\n' +
        'bunx vp run @animus-ui/vite-app#verify:assert\n' +
        'bunx vp run @animus-ui/vite-app#verify:prefixed\n'
    );

    const workerCommands = jobs['verify-workers'].steps
      .map((step) => step.run)
      .filter((run): run is string => run !== undefined);
    expect(
      workerCommands.filter(
        (command) => command === 'bunx vp run verify:workers:contracts'
      )
    ).toHaveLength(1);
    expect(workerCommands).toContain(
      "bunx vp run --fail-if-no-match -F './e2e/*' -F '!@animus-ui/next-app' -F '!animus-packed-app' -F './packages/showcase' verify"
    );

    const receipts = {
      verify: ['receipts-showcase', 'packages/showcase/.receipts/'],
      'verify-next': ['receipts-next', 'e2e/next-app/.receipts/'],
      'verify-vite': ['receipts-vite', 'e2e/vite-app/.receipts/'],
      'verify-packed': ['receipts-packed', 'e2e/packed-app/.staging/receipts/'],
      bench: ['receipts-bench', '.bench/receipts/'],
      'bench-confirm': ['receipts-bench-confirm', '.bench/receipts/'],
    } as const;
    for (const [jobName, [name, path]] of Object.entries(receipts)) {
      const upload = namedStep(jobs[jobName], 'Upload lane receipts');
      expect(upload.uses).toBe('actions/upload-artifact@v7');
      // .receipts is a dot-directory: without include-hidden-files the
      // upload finds nothing.
      expect(upload.with).toMatchObject({
        name,
        path,
        'include-hidden-files': true,
      });
    }

    const allCommands = Object.values(jobs)
      .flatMap((job) => job.steps)
      .map((step) => step.run ?? '')
      .join('\n');
    for (const rootAlias of [
      'verify:next',
      'verify:showcase',
      'verify:vite',
      'verify:vinext',
      'verify:react-router',
      'verify:build:showcase',
      'verify:build:vite',
      'verify:build:vinext',
      'verify:build:react-router',
      'verify:assert:showcase',
      'verify:assert:vite',
      'verify:assert:vinext',
      'verify:assert:react-router',
      'verify:dry-run:showcase',
      'verify:dry-run:vite',
      'verify:dry-run:vinext',
      'verify:dry-run:react-router',
    ]) {
      expect(allCommands).not.toContain(`vp run ${rootAlias}`);
    }
  });

  it('publishes via trusted publishing: id-token scoped to the release job', () => {
    const { jobs } = readWorkflow();
    expect(jobs.release.permissions).toEqual({
      contents: 'read',
      'id-token': 'write',
    });
    const releaseYaml = JSON.stringify(jobs.release);
    expect(releaseYaml).not.toContain('NODE_AUTH_TOKEN');
    expect(releaseYaml).not.toContain('npm whoami');
  });

  it('keeps immutable release bundle materialize, verify, and publication order', () => {
    const release = readWorkflow().jobs.release;
    const pack = namedStep(release, 'Pack immutable release bundle');
    const verify = namedStep(release, 'Verify immutable release bundle');
    const publish = namedStep(release, 'Publish immutable release bundle');
    const packIndex = release.steps.indexOf(pack);
    const verifyIndex = release.steps.indexOf(verify);
    const publishIndex = release.steps.indexOf(publish);

    expect(packIndex).toBeLessThan(verifyIndex);
    expect(verifyIndex).toBeLessThan(publishIndex);
    // The release packs with the packer `verify:packed` proves on every push;
    // npm pack and bun pm pack diverge in release-only ways. The `cd` is
    // load-bearing: a bare `packages/$pkg` passed as a packer argument reads
    // as a GitHub owner/repo shorthand, not a directory.
    expect(pack.run).toContain(
      '(cd "packages/$pkg" && bun pm pack --destination "$RELEASE_BUNDLE")'
    );
    // No v1 platform sub-packages: v2 binaries ship inside the main extract
    // tarball.
    expect(pack.run).not.toContain('packages/extract/npm');

    const exactTarballs = [
      'animus-ui-extract-${VERSION}.tgz',
      'animus-ui-properties-${VERSION}.tgz',
      'animus-ui-system-${VERSION}.tgz',
      'animus-ui-layergate-${VERSION}.tgz',
      'animus-ui-vite-plugin-${VERSION}.tgz',
      'animus-ui-next-plugin-${VERSION}.tgz',
      'animus-ui-cli-${VERSION}.tgz',
      'animus-ui-unplugin-${VERSION}.tgz',
    ];
    const materializedTarballs = [
      ...shellLoopValues(pack.run, 'pkg').map(
        (name) => `animus-ui-${name}-\${VERSION}.tgz`
      ),
    ];
    const validatedTarballs = shellLoopValues(pack.run, 'artifact');
    const publishedTarballs = shellLoopValues(publish.run, 'pkg').map(
      (name) => `animus-ui-${name}-\${VERSION}.tgz`
    );
    // Dependencies publish before their dependents.
    expect(publishedTarballs).toEqual(exactTarballs);
    expect(publish.run).toContain(
      'tarball="$RELEASE_BUNDLE/animus-ui-${pkg}-${VERSION}.tgz"'
    );
    expect(publish.run).toContain(
      'npm publish "$tarball" --access public --tag "$NPM_TAG" --ignore-scripts'
    );

    for (const membership of [
      materializedTarballs,
      validatedTarballs,
      publishedTarballs,
    ]) {
      expect(new Set(membership).size).toBe(membership.length);
      expect([...membership].sort()).toEqual([...exactTarballs].sort());
    }

    const verifyLines = commandLines(verify.run);
    const postpackIndex = verifyLines.indexOf(
      'bash scripts/verify/postpack-smoke.sh \\'
    );
    const suppliedTarballIndex = verifyLines.indexOf(
      '--tarball "$RELEASE_BUNDLE/animus-ui-extract-${VERSION}.tgz" \\'
    );
    // The bundle is checked at the tag's version: a verifier expecting any
    // other version refuses every release (v0.1.34 published nothing).
    const packedIndex = verifyLines.indexOf(
      'bash scripts/verify/packed.sh --release-version "$VERSION" --tarballs-dir "$RELEASE_BUNDLE"'
    );
    expect(postpackIndex).toBeGreaterThanOrEqual(0);
    expect(suppliedTarballIndex).toBeGreaterThan(postpackIndex);
    expect(packedIndex).toBeGreaterThan(suppliedTarballIndex);

    expect(release.needs).not.toContain('verify-workers');
  });

  it('scopes runner.temp release bundle paths to the release steps', () => {
    const release = readWorkflow().jobs.release;
    const releaseJobEnv = Object.values(release.env ?? {}).join('\n');

    expect(releaseJobEnv).not.toContain('runner.temp');

    for (const stepName of [
      'Pack immutable release bundle',
      'Verify immutable release bundle',
      'Publish immutable release bundle',
    ]) {
      expect(namedStep(release, stepName).env).toMatchObject({
        RELEASE_BUNDLE: '${{ runner.temp }}/animus-release-bundle',
      });
    }
  });
});
