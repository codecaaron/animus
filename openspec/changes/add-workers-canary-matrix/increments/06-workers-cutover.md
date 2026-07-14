# Increment 06: Workers Cutover Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans` to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking. Run no version-control command.

**Goal:** Make all four Worker applications independently buildable,
assertable, dry-runnable, and deployable from checked-in root commands, then
remove the obsolete Netlify path.

**Architecture:** Application-owned Wrangler files remain the deployment source
of truth while the root `vp` graph supplies dependency-aware builds and atomic
verification. A shared dry-run harness validates the checked-in Worker identity,
requires production output, and invokes the package-local credential-free
Wrangler command. The fast gate gains only contract tests; application builds
remain in focused, complete, and CI graphs.

**Tech Stack:** Vite+, Bun workspaces, Bash precondition helpers, Vitest,
Wrangler 4.110.0, OpenSpec verification policy.

---

## Scope

- **Registry row**: 06 · mode: delegate · review: subagent
- **Resolves**: local portions of D1, D2, D6, D7
- **Depends on**: accepted increments 02, 03, 04, and 05 / resolved D11
- **Footprint**: `vite.config.ts`, `scripts/verify/**`, `AGENTS.md`,
  `package.json`, `.gitignore`, `netlify.toml`, and this packet
- **Pushes later**: authenticated Worker creation, Git connection, production
  settings, and deployed URL smokes remain cross-cutting gate 2.1.
- **Prohibitions**: no application/framework source edits, dependency edits,
  root `wrangler.jsonc`, remote mutation, library adaptation, or Git commands.

## Context capsule

- Increments 02–05 already prove all four package-local Wrangler configs,
  production builds, artifact assertions, and local workerd behavior.
- D11 resolves DEF-2 without an Animus plugin change, so this increment only
  registers accepted behavior in the shared graph.
- Atomic tiers must fail loud when upstream output is missing or stale and must
  never silently rebuild upstream packages.
- `vp run verify` must remain free of showcase, Vite, Vinext, and React Router
  application builds. `vp run verify:full` must include all builds, assertions,
  and four credential-free deployment dry runs.

## File structure

- `scripts/verify/build-{vinext,react-router}.sh`: atomic app build tiers with
  the standard fresh-NAPI and fresh-package preconditions.
- `scripts/verify/assert-{vinext,react-router}.sh`: require production output and
  fresh assertion helpers before executing each accepted artifact assertion.
- `scripts/verify/dry-run-worker.sh`: one parameterized, credential-free Worker
  config/output check used by four target-specific `vp` tiers.
- `scripts/verify/workers-contracts.sh`: fast structural and hydration tests for
  the shared command surface and all Worker fixtures.
- `scripts/verify/workers-config.test.ts`: RED-first contract for root commands,
  task registration, ignored generated output, and Netlify absence.
- `vite.config.ts`: atomic, focused, complete, CI, and independent production
  build task ownership.
- `package.json`, `.gitignore`, `AGENTS.md`: public command surface, generated
  output hygiene, and authoritative verification/change-type documentation.

## Task 06.1: Write the failing cutover contract

- [x] **Step 1:** Extend `scripts/verify/workers-config.test.ts` with a reusable
  text reader and a new cutover suite. Keep the existing dependency-envelope
  tests intact and add the following declarations and suite:

  ```ts
  function source(path: string): string {
    const absolute = resolve(ROOT, path);
    expect(existsSync(absolute), `${path} must exist`).toBe(true);
    return readFileSync(absolute, 'utf8');
  }

  const deploymentScripts = {
    'deploy:showcase':
      "bun run --filter '@animus-ui/showcase' cf:deploy",
    'deploy:vite': "bun run --filter '@animus-ui/vite-app' cf:deploy",
    'deploy:vinext': "bun run --filter '@animus-ui/vinext-app' cf:deploy",
    'deploy:react-router':
      "bun run --filter '@animus-ui/react-router-app' cf:deploy",
  } as const;

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
        'verify:vinext',
        'verify:react-router',
        'build:vite',
        'build:vinext',
        'build:react-router',
      ]) {
        expect(config, `${task} must be registered`).toContain(`'${task}'`);
      }
    });

    it('ignores generated Cloudflare and React Router state', () => {
      const ignore = source('.gitignore');
      expect(ignore).toMatch(/^\.wrangler\/$/m);
      expect(ignore).toMatch(/^\.react-router\/$/m);
    });
  });
  ```

- [x] **Step 2:** Run the contract to prove RED.

  ```bash
  bunx vp test run scripts/verify/workers-config.test.ts
  ```

  Expected: the existing envelope tests pass and the cutover suite fails on the
  Netlify file/root command and missing shared tasks/ignore entries.

## Task 06.2: Add the new atomic shell tiers

- [x] **Step 1:** Create `scripts/verify/build-vinext.sh` with this content:

  ```bash
  #!/usr/bin/env bash
  set -euo pipefail

  # verify:build:vinext — Vinext App+Pages Worker production build.
  # Preconditions: fresh NAPI binaries and every imported Animus package dist.

  ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
  cd "$ROOT"

  source "$ROOT/scripts/verify/_preconditions.sh"

  require_fresh_napi
  require_fresh_napi_v2
  require_fresh_package_dist extract
  require_fresh_package_dist system
  require_fresh_package_dist vite-plugin
  require_fresh_package_dist properties
  require_fresh_package_dist test-ds

  exec bun run --filter '@animus-ui/vinext-app' build
  ```

- [x] **Step 2:** Create `scripts/verify/build-react-router.sh` with this content:

  ```bash
  #!/usr/bin/env bash
  set -euo pipefail

  # verify:build:react-router — React Router v8 SSR Worker production build.
  # Preconditions: fresh NAPI binaries and every imported Animus package dist.

  ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
  cd "$ROOT"

  source "$ROOT/scripts/verify/_preconditions.sh"

  require_fresh_napi
  require_fresh_napi_v2
  require_fresh_package_dist extract
  require_fresh_package_dist system
  require_fresh_package_dist vite-plugin
  require_fresh_package_dist properties
  require_fresh_package_dist test-ds

  exec bun run --filter '@animus-ui/react-router-app' build
  ```

- [x] **Step 3:** Create `scripts/verify/assert-vinext.sh` with this content:

  ```bash
  #!/usr/bin/env bash
  set -euo pipefail

  ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
  cd "$ROOT"

  source "$ROOT/scripts/verify/_preconditions.sh"

  require_dir e2e/vinext-app/dist 'vp run verify:build:vinext'
  require_fresh_package_dist _assertions

  exec bun run e2e/vinext-app/scripts/assert-build.ts
  ```

- [x] **Step 4:** Create `scripts/verify/assert-react-router.sh` with this content:

  ```bash
  #!/usr/bin/env bash
  set -euo pipefail

  ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
  cd "$ROOT"

  source "$ROOT/scripts/verify/_preconditions.sh"

  require_dir e2e/react-router-app/build 'vp run verify:build:react-router'
  require_fresh_package_dist _assertions

  exec bun run e2e/react-router-app/scripts/assert-build.ts
  ```

- [x] **Step 5:** Create `scripts/verify/dry-run-worker.sh` with this exact
  parameter contract and fail-loud behavior:

  ```bash
  #!/usr/bin/env bash
  set -euo pipefail

  if [ "$#" -ne 5 ]; then
    echo 'ERROR: dry-run-worker expects: package-dir workspace output-dir worker-name build-task' >&2
    exit 2
  fi

  package_dir="$1"
  workspace="$2"
  output_dir="$3"
  worker_name="$4"
  build_task="$5"

  ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
  cd "$ROOT"

  source "$ROOT/scripts/verify/_preconditions.sh"

  require_dir "$output_dir" "vp run $build_task"

  config="$package_dir/wrangler.jsonc"
  if ! rg -F "\"name\": \"$worker_name\"" "$config" >/dev/null; then
    echo "ERROR: $config does not identify Worker $worker_name" >&2
    exit 1
  fi

  echo "[workers:dry-run] validating $worker_name from $config"
  exec bun run --filter "$workspace" cf:dry-run
  ```

- [x] **Step 6:** Create `scripts/verify/workers-contracts.sh` so the fast tier
  permanently owns all accepted Worker fixture tests without building apps:

  ```bash
  #!/usr/bin/env bash
  set -euo pipefail

  ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
  cd "$ROOT"

  bunx vp test run \
    scripts/verify/workers-config.test.ts \
    e2e/vite-app/scripts/worker.test.ts

  cd "$ROOT/e2e/vinext-app"
  bunx vp test run --config vitest.config.ts \
    scripts/config.test.ts scripts/hydration.test.tsx

  cd "$ROOT/e2e/react-router-app"
  exec bunx vp test run --config vitest.config.ts \
    scripts/config.test.ts scripts/worker.test.ts scripts/hydration.test.tsx
  ```

- [x] **Step 7:** Run shell syntax checks.

  ```bash
  bash -n scripts/verify/build-vinext.sh \
    scripts/verify/build-react-router.sh \
    scripts/verify/assert-vinext.sh \
    scripts/verify/assert-react-router.sh \
    scripts/verify/dry-run-worker.sh \
    scripts/verify/workers-contracts.sh
  ```

  Expected: exit 0 with no output.

## Task 06.3: Register the Worker task graph

- [x] **Step 1:** Update `vite.config.ts` generated-output ignores. Add
  `**/.wrangler/**`, `**/.react-router/**`, and `**/build/**` to both lint and
  format ignores; add `.wrangler` and `.react-router` to test excludes. Keep
  `e2e/*/vite.config.ts` and checked-in source linted.

- [x] **Step 2:** Add these atomic tasks beside the existing build/assert tiers:

  ```ts
  'verify:workers:contracts': {
    command: 'bash scripts/verify/workers-contracts.sh',
    cache: false,
  },
  'verify:build:vinext': {
    command: 'bash scripts/verify/build-vinext.sh',
    cache: false,
  },
  'verify:build:react-router': {
    command: 'bash scripts/verify/build-react-router.sh',
    cache: false,
  },
  'verify:assert:vinext': {
    command: 'bash scripts/verify/assert-vinext.sh',
    dependsOn: ['verify:build:vinext'],
    cache: false,
  },
  'verify:assert:react-router': {
    command: 'bash scripts/verify/assert-react-router.sh',
    dependsOn: ['verify:build:react-router'],
    cache: false,
  },
  'verify:dry-run:showcase': {
    command:
      "bash scripts/verify/dry-run-worker.sh packages/showcase '@animus-ui/showcase' packages/showcase/dist animus verify:build:showcase",
    dependsOn: ['verify:build:showcase'],
    cache: false,
  },
  'verify:dry-run:vite': {
    command:
      "bash scripts/verify/dry-run-worker.sh e2e/vite-app '@animus-ui/vite-app' e2e/vite-app/dist animus-vite-canary verify:build:vite",
    dependsOn: ['verify:build:vite'],
    cache: false,
  },
  'verify:dry-run:vinext': {
    command:
      "bash scripts/verify/dry-run-worker.sh e2e/vinext-app '@animus-ui/vinext-app' e2e/vinext-app/dist animus-vinext-canary verify:build:vinext",
    dependsOn: ['verify:build:vinext'],
    cache: false,
  },
  'verify:dry-run:react-router': {
    command:
      "bash scripts/verify/dry-run-worker.sh e2e/react-router-app '@animus-ui/react-router-app' e2e/react-router-app/build animus-react-router-canary verify:build:react-router",
    dependsOn: ['verify:build:react-router'],
    cache: false,
  },
  ```

- [x] **Step 3:** Add independent production build targets beside
  `build:showcase`. Each may build shared TypeScript dependencies but no other
  application:

  ```ts
  'build:vite': {
    command: "bun run --filter '@animus-ui/vite-app' build",
    dependsOn: ['build:ts'],
    cache: false,
  },
  'build:vinext': {
    command: "bun run --filter '@animus-ui/vinext-app' build",
    dependsOn: ['build:ts'],
    cache: false,
  },
  'build:react-router': {
    command: "bun run --filter '@animus-ui/react-router-app' build",
    dependsOn: ['build:ts'],
    cache: false,
  },
  ```

- [x] **Step 4:** Add focused composites:

  ```ts
  'verify:vinext': {
    command: 'echo "verify:vinext complete"',
    dependsOn: ['verify:build:vinext', 'verify:assert:vinext'],
    cache: false,
  },
  'verify:react-router': {
    command: 'echo "verify:react-router complete"',
    dependsOn: [
      'verify:build:react-router',
      'verify:assert:react-router',
    ],
    cache: false,
  },
  ```

- [x] **Step 5:** Add `verify:workers:contracts` to the fast `verify` dependencies.
  Do not add any `verify:build:*` or `verify:dry-run:*` task to that fast gate.

- [x] **Step 6:** Add both new app build/assert pairs and all four
  `verify:dry-run:*` tasks to `verify:full`. Add the Worker contract, both new
  app build/assert pairs, and all four dry runs to `verify:ci` so the repository's
  CI-mirror graph owns the cutover. Preserve all existing dependencies.

## Task 06.4: Replace the root deployment surface and remove Netlify

- [x] **Step 1:** Replace the existing Netlify `deploy:showcase` command in
  `package.json` and add the four exact deployment scripts from Task 06.1:

  ```json
  "deploy:showcase": "bun run --filter '@animus-ui/showcase' cf:deploy",
  "deploy:vite": "bun run --filter '@animus-ui/vite-app' cf:deploy",
  "deploy:vinext": "bun run --filter '@animus-ui/vinext-app' cf:deploy",
  "deploy:react-router": "bun run --filter '@animus-ui/react-router-app' cf:deploy"
  ```

- [x] **Step 2:** Add these generated-state entries to `.gitignore`:

  ```gitignore
  # Cloudflare / framework generated state
  .wrangler/
  .react-router/
  ```

- [x] **Step 3:** Delete `netlify.toml`. Do not add a compatibility stub or
  retain any active Netlify command.

- [x] **Step 4:** Re-run the RED contract and fast Worker contracts.

  ```bash
  bunx vp test run scripts/verify/workers-config.test.ts
  vp run verify:workers:contracts
  ```

  Expected: all tests pass; no application production build runs.

## Task 06.5: Document verification ownership

- [x] **Step 1:** Update the root `AGENTS.md` Atomic Tiers table with rows for:
  `verify:workers:contracts`; Vinext and React Router build/assert tiers; and the
  four target-specific Worker dry-run tiers. State exact upstream requirements,
  fail-loud conditions, and typical runtime. Do not duplicate implementation
  commands outside the canonical command column.

- [x] **Step 2:** Update Composite Orchestrators with `verify:vinext` and
  `verify:react-router`. Update `verify:full` and `verify:ci` descriptions to say
  they include the complete Worker matrix. Preserve the statement that `verify`
  has no application builds.

- [x] **Step 3:** Add Change-Type Map ownership rows:

  ```markdown
  | `e2e/vinext-app/**` | `verify:workers:contracts && verify:vinext && verify:dry-run:vinext` |
  | `e2e/react-router-app/**` | `verify:workers:contracts && verify:react-router && verify:dry-run:react-router` |
  | `packages/showcase/wrangler.jsonc` | `verify:workers:contracts && verify:dry-run:showcase` |
  | Worker orchestration (`vite.config.ts`, `scripts/verify/**`, root deploy scripts, Worker ignores) | `verify:ci` |
  ```

  Merge these with existing broader rows where necessary so no path has
  contradictory guidance. Keep native Next and Vite ownership intact.

## Task 06.6: Prove every local cutover gate

- [x] **Step 1:** Run the four focused build/assert composites.

  ```bash
  vp run verify:showcase
  vp run verify:vite
  vp run verify:vinext
  vp run verify:react-router
  ```

  Expected: all four builds and artifact assertion suites pass.

- [x] **Step 2:** Run all credential-free deployment dry runs.

  ```bash
  vp run verify:dry-run:showcase
  vp run verify:dry-run:vite
  vp run verify:dry-run:vinext
  vp run verify:dry-run:react-router
  ```

  Expected: each command names its distinct Worker and Wrangler exits 0 without
  uploading or mutating remote state.

- [x] **Step 3:** Run the native Next regression required by Vinext coexistence.

  ```bash
  vp run verify:next
  ```

  Expected: the native Next build and assertions pass unchanged.

- [x] **Step 4:** Run the authoritative shared-surface gate.

  ```bash
  vp run verify:ci
  ```

  Expected: all CI-mirror dependencies, including the new Worker matrix, pass.

- [x] **Step 5:** Run OpenSpec and registry validation.

  ```bash
  openspec validate add-workers-canary-matrix --strict
  node openspec/schemas/ooda/scripts/registry-lint.mjs \
    openspec/changes/add-workers-canary-matrix
  ```

  Expected: strict validation succeeds and registry lint reports zero errors.

## Implementation record

- **TDD contract:** RED passed its intent check with 11 existing cases green and
  three cutover cases failing on the Netlify/root-command surface, missing task
  registration, and missing generated-state ignores. GREEN passes 14/14.
- **Atomic shell and Worker contracts:** `bash -n` exits 0 with no output. The
  fast Worker tier passes 16/16 root+Vite, 15/15 Vinext, and 20/20 React Router
  tests without an application production build.
- **Focused matrix:** showcase, Vite, Vinext, and React Router build/assert
  composites exit 0. Assertions cover 1 CSS/34 JS, 2 CSS/3 JS, 4 CSS/80 JS,
  and 2 CSS/12 JS files respectively.
- **Deployment and native regression:** all four target-specific dry runs exit 0,
  print the distinct checked-in Worker identity, and end with Wrangler's
  `--dry-run: exiting now.` Native Next builds and its 1 CSS/16 JS assertion
  pass unchanged.
- **CI mirror:** The first `vp run verify:ci` reached the new matrix but failed
  `vp fmt --check` on five files owned by accepted increments 02–04. Root applied
  formatting-only reorientation to those files, then a fresh `vp run verify:ci`
  passed all 26 uncached tasks, including 217 TypeScript unit tests, 341 Rust
  unit tests, parity, integration, four Worker builds/assertions, and four
  credential-free dry runs.
- **Spec and guardrails:** strict OpenSpec validation passes; registry lint
  reports 0 errors and 0 warnings. G1 finds the native Next plugin dependency;
  G2/G3 pass; G4/G5 have no matches; G6 confirms `netlify.toml` is absent and
  an active-command scan (excluding the negative contract test) has no Netlify
  match.
- **Residual diagnostics:** Wrangler's sandbox-blocked user-level debug-log
  write, Vinext's accepted same-name CSS warning, Vite adapter deprecations, and
  Next's pre-existing multiple-lockfile workspace-root warning remain
  non-blocking; every focused build, assertion, and dry run exits 0.

## Review correction 06.R1

The first independent review rejected four orchestration/documentation details.
This correction is part of increment 06 and must receive a clean re-review.

- [x] **R1.1 — Preserve public atomicity:** Remove `dependsOn` from every public
  `verify:assert:*` and `verify:dry-run:*` task. A direct atomic invocation must
  inspect existing output and let its shell precondition fail loud; it must not
  build. Make each focused `verify:{next,showcase,vite,vinext,react-router}` task
  the ordered wrapper: depend on its `verify:build:*` task and run the matching
  assertion shell command only after that dependency succeeds. Add one private
  `'_verify:dry-run:<target>:after-build'` chain per Worker target whose command
  is the same target-specific dry-run invocation and whose sole dependency is
  its build tier. `verify:full` and `verify:ci` use the focused assertion wrappers
  and private dry-run chains; the public atomic tasks remain independently
  runnable and fail-loud.
- [x] **R1.2 — Restore complete-graph coverage:** Add
  `verify:workers:contracts` to `verify:full`. Preserve its existing presence in
  the fast `verify` and CI-mirror graphs.
- [x] **R1.3 — Parse authoritative Worker identity:** Add
  `scripts/verify/read-worker-name.ts` using Wrangler's exported
  `unstable_readConfig({ config: configPath })`. It must print only a non-empty
  top-level `name` and exit nonzero otherwise. Replace the dry-run harness's
  source-text `rg` with this helper and an exact string comparison. Extend
  `workers-config.test.ts` with a temporary JSONC fixture containing comments,
  noncanonical whitespace, a nested decoy `name`, and a trailing comma; assert
  the helper returns only the top-level name.
- [x] **R1.4 — Close verification ownership:** Expand the `_assertions` change
  row to include Vinext and React Router assertion tiers. Expand the Vite fixture
  row from `src/**` to `e2e/vite-app/**` and require Worker contracts, focused
  Vite verification, and its dry run. Since the new canaries consume shared
  `vite-plugin` and `test-ds` output, add `verify:vinext` and
  `verify:react-router` to those existing shared-package rows as well.
- [x] **R1.5 — Re-prove:** Run shell syntax, the Worker contracts, direct atomic
  task precondition/structure tests, all focused composites, all four public dry
  runs after builds, `vp run verify:full`, `vp run verify:ci`, strict OpenSpec
  validation, and registry lint. Record exact results below and request the same
  reviewer for one re-review; stop independent review after a clean acceptance.

### Correction implementation record

- **TDD:** The correction contract began RED with 13/18 cases passing and five
  intended failures covering missing private dry-run chains, non-atomic public
  assertions and dry runs, incomplete full-graph composition, and the absent
  Wrangler config helper. GREEN passes all 18/18 cases, including an adversarial
  JSONC fixture with a comment, noncanonical whitespace, nested decoy `name`,
  and trailing commas; the helper prints only `top-level-worker`.
- **Atomicity and ordering:** `bash -n` exits 0 for all six Worker cutover shell
  scripts. All five public `verify:assert:*` tasks run their assertion shell only
  and exit 0 against existing output: Next 1 CSS/16 JS, showcase 1 CSS/34 JS,
  Vite 2 CSS/3 JS, Vinext 4 CSS/80 JS, and React Router 2 CSS/12 JS. A direct
  dry-run harness invocation against a deliberately absent output directory
  exits 1 with the exact `ERROR: ... missing. Run: vp run verify:build:showcase`
  precondition and does not build.
- **Focused and Worker matrix:** All five focused composites exit 0 and each
  reports exactly two tasks: its build followed by its assertion. After those
  builds, all four public dry-run atomics exit 0 without rebuilding and identify
  the distinct Workers `animus`, `animus-vite-canary`,
  `animus-vinext-canary`, and `animus-react-router-canary`; Wrangler ends each
  with `--dry-run: exiting now.` The Worker contract tier passes 20 root+Vite,
  15 Vinext, and 20 React Router tests.
- **Complete graphs:** A fresh `vp run verify:full` passes all 25 uncached tasks,
  including Worker contracts, five focused build/assert wrappers, and four
  private build/dry-run chains. A fresh `vp run verify:ci` passes all 26 uncached
  tasks with the four CI-owned focused wrappers and four private dry-run chains.
- **Specification and residual diagnostics:** Strict OpenSpec validation passes;
  registry lint reports 0 errors and 0 warnings across six registry rows and one
  cross-cutting row. Existing Rust warnings and sandbox-blocked Wrangler
  user-level debug-log writes remain non-blocking; every Wrangler dry run exits
  0 and no remote state is contacted or mutated.

## Self-review

- **Spec coverage:** Atomic/focused Vinext and React Router verification is Task
  06.2/06.3; all four dry runs are Task 06.2/06.3; independent builds and root
  deploy entries are Task 06.3/06.4; complete versus fast graph behavior is Task
  06.3; new top-level ownership is Task 06.5; Netlify removal is Task 06.4.
- **Boundary check:** No app source, library source, dependency, remote state, or
  root Wrangler file is in scope.
- **Placeholder scan:** The plan contains no deferred implementation placeholder;
  every new file, command, task name, dependency relation, and test expectation is
  explicit.
- **Type/name consistency:** Worker names and workspace filters match accepted
  app manifests and Wrangler configs exactly.
