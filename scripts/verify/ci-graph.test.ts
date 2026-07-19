import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type WorkflowStep = {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
};

type WorkflowJob = {
  needs?: string | string[];
  'runs-on': string;
  steps: WorkflowStep[];
  strategy?: unknown;
};

type Workflow = {
  on: Record<string, unknown>;
  jobs: Record<string, WorkflowJob>;
};

const ROOT = resolve(import.meta.dirname, '../..');

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
      workflow_dispatch: null,
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
      release: {
        needs: [
          'lint',
          'clippy',
          'hygiene-rust',
          'verify',
          'verify-next',
          'verify-vite',
          'verify-workers',
          'verify-packed',
        ],
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
});
