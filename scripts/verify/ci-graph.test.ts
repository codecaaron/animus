import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type WorkflowStep = {
  env?: Record<string, string>;
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
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
  strategy?: unknown;
};

type Workflow = {
  on: Record<string, unknown>;
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
const deployCondition =
  "github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.deploy_workers == true))";
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

  return JSON.parse(parsed.stdout) as Workflow;
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

function deploymentExpected(
  eventName: string,
  ref: string,
  deploy: boolean
): boolean {
  return (
    ref === 'refs/heads/main' &&
    (eventName === 'push' ||
      eventName === 'schedule' ||
      (eventName === 'workflow_dispatch' && deploy))
  );
}

function releaseExpected(
  eventName: string,
  ref: string,
  publish: boolean
): boolean {
  return (
    (eventName === 'push' && ref.startsWith('refs/tags/v')) ||
    (eventName === 'workflow_dispatch' && publish)
  );
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
      'deploy-workers': {
        needs: verificationDependencies,
        runsOn: 'ubuntu-latest',
      },
      release: {
        needs: verificationDependencies,
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

    expect(namedStep(deploy, 'Download linux binary')).toMatchObject({
      uses: 'actions/download-artifact@v4',
      with: {
        name: 'napi-x86_64-unknown-linux-gnu',
        path: 'packages/extract/',
      },
    });
    expect(namedStep(deploy, 'Download linux binary').with).toEqual({
      name: 'napi-x86_64-unknown-linux-gnu',
      path: 'packages/extract/',
    });
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
    expect(jobs.release.needs).toEqual(verificationDependencies);
    expect(jobs.release.needs).not.toContain('deploy-workers');

    const cases = [
      {
        label: 'main push',
        eventName: 'push',
        ref: 'refs/heads/main',
        deploy: false,
        publish: false,
        expectedDeploy: true,
        expectedRelease: false,
      },
      {
        label: 'main schedule',
        eventName: 'schedule',
        ref: 'refs/heads/main',
        deploy: false,
        publish: false,
        expectedDeploy: true,
        expectedRelease: false,
      },
      {
        label: 'pull request',
        eventName: 'pull_request',
        ref: 'refs/pull/42/merge',
        deploy: false,
        publish: false,
        expectedDeploy: false,
        expectedRelease: false,
      },
      {
        label: 'next push',
        eventName: 'push',
        ref: 'refs/heads/next',
        deploy: false,
        publish: false,
        expectedDeploy: false,
        expectedRelease: false,
      },
      {
        label: 'version-tag push',
        eventName: 'push',
        ref: 'refs/tags/v1.2.3',
        deploy: false,
        publish: false,
        expectedDeploy: false,
        expectedRelease: true,
      },
      {
        label: 'manual deploy-only main',
        eventName: 'workflow_dispatch',
        ref: 'refs/heads/main',
        deploy: true,
        publish: false,
        expectedDeploy: true,
        expectedRelease: false,
      },
      {
        label: 'manual publish-only main',
        eventName: 'workflow_dispatch',
        ref: 'refs/heads/main',
        deploy: false,
        publish: true,
        expectedDeploy: false,
        expectedRelease: true,
      },
      {
        label: 'manual dispatch on tag',
        eventName: 'workflow_dispatch',
        ref: 'refs/tags/v1.2.3',
        deploy: true,
        publish: true,
        expectedDeploy: false,
        expectedRelease: true,
      },
      {
        label: 'manual dispatch on another branch',
        eventName: 'workflow_dispatch',
        ref: 'refs/heads/feature',
        deploy: true,
        publish: true,
        expectedDeploy: false,
        expectedRelease: true,
      },
    ];

    for (const policyCase of cases) {
      expect(
        deploymentExpected(
          policyCase.eventName,
          policyCase.ref,
          policyCase.deploy
        ),
        `${policyCase.label} deployment policy`
      ).toBe(policyCase.expectedDeploy);
      expect(
        releaseExpected(
          policyCase.eventName,
          policyCase.ref,
          policyCase.publish
        ),
        `${policyCase.label} release policy`
      ).toBe(policyCase.expectedRelease);
    }
  });

  it('keeps lane preparation, receipt artifacts, and package-owned claims', () => {
    const jobs = readWorkflow().jobs;
    const preparedLanes = [
      'verify',
      'verify-next',
      'verify-vite',
      'verify-workers',
      'verify-packed',
    ];

    for (const jobName of preparedLanes) {
      const job = jobs[jobName];
      expect(job, jobName).toBeDefined();
      expect(namedStep(job, 'Download linux binary')).toMatchObject({
        uses: 'actions/download-artifact@v4',
        with: {
          name: 'napi-x86_64-unknown-linux-gnu',
          path: 'packages/extract/',
        },
      });
      expect(namedStep(job, 'Download v2 linux binary')).toMatchObject({
        uses: 'actions/download-artifact@v4',
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
        'bunx vp run @animus-ui/next-app#verify:assert\n'
    );
    expect(namedStep(jobs['verify-vite'], 'Vite consumer lane').run).toBe(
      'bunx vp run @animus-ui/vite-app#verify:build\n' +
        'bunx vp run @animus-ui/vite-app#verify:assert\n'
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
    } as const;
    for (const [jobName, [name, path]] of Object.entries(receipts)) {
      const upload = namedStep(jobs[jobName], 'Upload lane receipts');
      expect(upload.uses).toBe('actions/upload-artifact@v4');
      expect(upload.with).toMatchObject({ name, path });
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
    expect(pack.run).toContain(
      'npm pack "packages/$pkg" --pack-destination "$RELEASE_BUNDLE" --ignore-scripts'
    );
    expect(pack.run).toContain(
      'npm pack "packages/extract/npm/$platform" --pack-destination "$RELEASE_BUNDLE" --ignore-scripts'
    );

    const exactTarballs = [
      'animus-ui-extract-darwin-arm64-${VERSION}.tgz',
      'animus-ui-extract-linux-x64-gnu-${VERSION}.tgz',
      'animus-ui-extract-linux-arm64-gnu-${VERSION}.tgz',
      'animus-ui-extract-${VERSION}.tgz',
      'animus-ui-properties-${VERSION}.tgz',
      'animus-ui-system-${VERSION}.tgz',
      'animus-ui-vite-plugin-${VERSION}.tgz',
      'animus-ui-next-plugin-${VERSION}.tgz',
    ];
    const materializedTarballs = [
      ...shellLoopValues(pack.run, 'pkg').map(
        (name) => `animus-ui-${name}-\${VERSION}.tgz`
      ),
      ...shellLoopValues(pack.run, 'platform').map(
        (name) => `animus-ui-extract-${name}-\${VERSION}.tgz`
      ),
    ];
    const validatedTarballs = shellLoopValues(pack.run, 'artifact');
    const publishedTarballs = commandLines(publish.run)
      .map(
        (line) => line.match(/^npm publish "\$RELEASE_BUNDLE\/([^"]+)"/)?.[1]
      )
      .filter((name): name is string => name !== undefined);

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
    const packedIndex = verifyLines.indexOf(
      'bash scripts/verify/packed.sh --tarballs-dir "$RELEASE_BUNDLE"'
    );
    expect(postpackIndex).toBeGreaterThanOrEqual(0);
    expect(suppliedTarballIndex).toBeGreaterThan(postpackIndex);
    expect(packedIndex).toBeGreaterThan(suppliedTarballIndex);

    expect(
      commandLines(publish.run).filter((line) => line.startsWith('npm publish'))
    ).toEqual([
      'npm publish "$RELEASE_BUNDLE/animus-ui-extract-darwin-arm64-${VERSION}.tgz" --access public --tag "$NPM_TAG" --ignore-scripts',
      'npm publish "$RELEASE_BUNDLE/animus-ui-extract-linux-x64-gnu-${VERSION}.tgz" --access public --tag "$NPM_TAG" --ignore-scripts',
      'npm publish "$RELEASE_BUNDLE/animus-ui-extract-linux-arm64-gnu-${VERSION}.tgz" --access public --tag "$NPM_TAG" --ignore-scripts',
      'npm publish "$RELEASE_BUNDLE/animus-ui-extract-${VERSION}.tgz" --access public --tag "$NPM_TAG" --ignore-scripts',
      'npm publish "$RELEASE_BUNDLE/animus-ui-properties-${VERSION}.tgz" --access public --tag "$NPM_TAG" --ignore-scripts',
      'npm publish "$RELEASE_BUNDLE/animus-ui-system-${VERSION}.tgz" --access public --tag "$NPM_TAG" --ignore-scripts',
      'npm publish "$RELEASE_BUNDLE/animus-ui-vite-plugin-${VERSION}.tgz" --access public --tag "$NPM_TAG" --ignore-scripts',
      'npm publish "$RELEASE_BUNDLE/animus-ui-next-plugin-${VERSION}.tgz" --access public --tag "$NPM_TAG" --ignore-scripts',
    ]);
    expect(release.needs).toContain('verify-workers');
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
