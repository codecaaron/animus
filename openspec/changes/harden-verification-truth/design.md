## Context

Animus has substantial verification coverage, but several gates can certify a
different artifact, execution path, or risk state from the one they claim to
protect. The current worktree is intentionally dirty with related Clippy and
verification edits, so this change must preserve those edits and use only
non-mutative Git inspection. The stakeholders are package consumers, release
operators, and contributors relying on local/CI verification.

## Goals / Non-Goals

**Goals:**

- Make packed verification and publication operate on the same immutable
  tarballs and dependency closure.
- Make consumer evidence observe the executed/served path.
- Close broad suppression surfaces without adding config-restatement tests.
- Bring existing active tests and supported Worker consumers into the gates
  that claim to cover them.

**Non-Goals:**

- Introduce a generic compliance or policy framework.
- Add more package targets, host versions, or cross-target runners.
- Make hygiene infer arbitrary build ownership in this change.
- Rework extraction semantics or parity baselines.

## Decisions

### D1: Pack once after release materialization
- **Choice**: The release job stamps manifests, builds packages, assembles
  native binaries, produces explicit npm tarballs, runs packed verification
  against those tarballs, then publishes those exact paths.
- **Rationale**: Byte identity removes the gap between a green oracle and the
  published artifact.
- **Alternatives considered**: Keep the prerequisite packed job and re-pack in
  release (rejected: proves different state); compare directory hashes
  (rejected: npm packing semantics still differ).

### D2: Test the unmasked internal dependency graph
- **Choice**: Remove internal `overrides` from the packed fixture, install all
  five tarballs as direct dependencies, and recursively validate every
  installed internal package instance against the tested tarball version map.
- **Rationale**: Root overrides currently force a coherent graph even when the
  embedded dependency edges are stale.
- **Alternatives considered**: Keep overrides plus inspect top-level versions
  (rejected: nested or substituted dependencies remain hidden).

### D3: Release-gate the supported Worker matrix
- **Choice**: Add one CI Worker consumer job using the existing
  build/assert/dry-run tasks for showcase, Vite, Vinext, and React Router, and
  make release depend on it.
- **Rationale**: Supported package consumers must fail before publication, not
  at the next nightly deployment.
- **Alternatives considered**: Depend on the nightly workflow (rejected:
  asynchronous and post-release); duplicate per-app jobs (rejected: needless
  workflow volume).

### D4: Engine identity comes from the loaded adapter path
- **Choice**: Each plugin build writes a small observed-engine marker from the
  module path actually loaded; lane receipts consume that marker and never
  inspect configuration or plugin source.
- **Rationale**: A receipt must be evidence from execution, not a prediction
  about execution.
- **Alternatives considered**: Rename the field to configured engine (rejected:
  loses rollback proof); retain regex plus a routing test (rejected: still
  inferential and duplicative).

### D5: Fail closed on broad suppressions
- **Choice**: Prohibit crate-wide `allow(warnings)` and `allow(clippy::all)`,
  reject non-empty cargo-machete ignores, remove or incident-bind the attw
  exemption, and make hygiene whole-file deletion require manual review.
- **Rationale**: Broad suppressions can absorb unrelated future failures while
  every mandated command remains green.
- **Alternatives considered**: Documentation-only owner review (rejected:
  unenforced); generic deviation ledger (rejected: recreates the exploit).

### D6: Behavior-first regression coverage
- **Choice**: Tests execute validators, asset assertions, adapter selection, or
  shell helpers against failing fixtures. No test will assert that workflow or
  configuration source contains a string.
- **Rationale**: The remediation must prove outcomes and avoid the ceremony that
  triggered this audit.
- **Alternatives considered**: Workflow/source contract tests (rejected:
  maliciously satisfiable without behavior).

### D7: Freshness follows loader target selection
- **Choice**: A shared host-target resolver selects the exact v1/v2 binary used
  for freshness comparison, including Linux libc.
- **Rationale**: A foreign binary's timestamp says nothing about the code the
  host loader executes.
- **Alternatives considered**: Check every present binary (rejected: foreign
  artifacts may intentionally be old); retain lexical first-match (rejected:
  nondeterministic relative to runtime).

### D8: Active tests are discovered by owned roots
- **Choice**: The TypeScript unit tier includes the full active package roots
  that own unit tests, while the native canary remains a separate atomic tier.
- **Rationale**: A red active test must not coexist with green composites.
- **Alternatives considered**: Maintain an individual-file registry (rejected:
  future omission repeats the bug).

## North Star

**Adversarial cadence K**: 1

- **NS1**: Green verification describes the artifact and execution path that a
  consumer will actually receive.
- **NS2**: Evidence is emitted by protected behavior, not inferred from adjacent
  configuration.
- **NS3**: Suppressions are incident-bound and cannot absorb unrelated drift.
- **NS4**: Prefer a small black-box check over a second model of the task graph.
- **NS5**: Release-local packed verification is provisional — revisit when
  CI can transport one immutable release bundle across prerequisite jobs.

## Decision Ledger

| ID | Decision | Status | Owner increment | Resolving signal | Review-by |
| --- | --- | --- | --- | --- | --- |
| DEF-1 | Shared versus host-specific engine marker transport | deferred | 02 | Failing Vite and Next adapter tests identify stable build hooks | 2 reorientations \| 2026-07-18 |
| DEF-2 | Source rewrite versus emit-toolchain fix for DEF-5 | deferred | 03 | Fresh declarations plus attw output pass without the ignored rule | 2 reorientations \| 2026-07-18 |
| DEF-3 | Automatic build selection after hygiene file deletion | deferred | 04 | Change-Type Map can map every removed file to complete consumer tiers | 3 reorientations \| 2026-08-01 |
| DEF-4 | Cross-target NAPI load verification | deferred | external:cross-target-runners | Executable runners exist for every supported target | 3 reorientations \| 2026-08-15 |

## Guardrail Register

| ID | Invariant (SHALL NOT ...) | Scope | On trip | Status |
| --- | --- | --- | --- | --- |
| G1 | Packed verification SHALL NOT mask internal dependency edges with overrides | inc:01 | STOP | armed(inc 01); calibrated 2026-07-16: 5 violating keys |
| G2 | Release SHALL NOT publish package directories after verifying different tarballs | inc:01 | STOP | armed(inc 01); calibrated 2026-07-16: directory publishes present |
| G3 | Receipts SHALL NOT infer loaded engine identity from source or config regexes | inc:02 | STOP | armed(inc 02); calibrated 2026-07-16: four inference sites |
| G4 | Active Rust sources SHALL NOT contain blanket warning or Clippy suppression; token scan does not interpret generated macro output | all | STOP | active; calibrated 2026-07-16: empty |
| G5 | Cargo dependency hygiene SHALL NOT accept non-empty cargo-machete ignores | all | STOP | active; calibrated 2026-07-16: `[]` |
| G6 | Packed type verification SHALL NOT ignore all `internal-resolution-error` diagnostics | inc:03 | STOP | armed(inc 03); calibrated 2026-07-16: one broad ignore |
| G7 | Hygiene SHALL NOT return success for a whole-file deletion without relevant build proof | inc:03 | STOP | proposed; behavior test lands in inc 03 |

Checks — verbatim commands:

**G1** — expected after increment 01: exit 0

```bash
jq -e '((.overrides // {}) | keys | length) == 0' e2e/packed-app/package.json
```

**G2** — expected after increment 01: matches publish commands whose argument is a `.tgz` path

```bash
rg -n 'npm publish .*\.tgz' .github/workflows/ci.yaml
```

**G3** — expected after increment 02: empty output

```bash
rg -n 'Engine facts are MEASURED|config\.match\(|pluginSrc\.match\(' scripts/assert-showcase-build.ts e2e/vite-app/scripts/assert-build.ts e2e/next-app/scripts/assert-build.ts scripts/verify/packed.sh
```

**G4** — expected: exit 0 with no output

```bash
if rg -n '#!?\s*\[\s*(allow|expect)\s*\(\s*(warnings|clippy::all)' packages/extract -g '*.rs'; then exit 1; fi
```

**G5** — expected: `[]`

```bash
cargo metadata --manifest-path packages/extract/Cargo.toml --no-deps --format-version 1 | jq -c '[.packages[] | select(((.metadata["cargo-machete"].ignored // []) | length) > 0) | {name,ignored:.metadata["cargo-machete"].ignored}]'
```

**G6** — expected after increment 03: empty output

```bash
rg -n -- '--ignore-rules internal-resolution-error' scripts/verify/packed.sh
```

**G7** — expected after increment 03: selected test passes

```bash
bunx vp test run scripts/hygiene/presenter.test.ts -t 'requires manual review after whole-file deletion'
```

## Risks / Trade-offs

- [Risk] Release verification becomes slower -> Mitigation: reuse existing
  packed checks against prebuilt tarballs and avoid a second rebuild.
- [Risk] npm install may surface currently hidden stale dependency edges ->
  Mitigation: fail before publish and report the exact package/version edge.
- [Risk] Engine marker hooks differ by host -> Mitigation: resolve DEF-1 from
  failing host-specific tests before choosing a shared abstraction.
- [Risk] Fail-closed hygiene interrupts automation -> Mitigation: only
  whole-file deletion stops; lower-risk export cleanup retains existing flow.
- [Trade-off] Empty cargo-machete ignores require a policy change for a future
  false positive -> acceptable because the escape hatch otherwise has no bound.
- [Trade-off] A token guard cannot see generated macro output -> acceptable
  because crate/module attributes in authored active sources are the plausible
  bypass; the blind spot is explicit.

## Migration Plan

Land in three increments: exact release artifacts first, observed verification
paths second, suppression hardening third. Each increment is independently
revertible. Acceptance requires its focused tests, guardrails, OpenSpec strict
validation, and the Change-Type Map's minimum verification tiers. No production
deployment is performed by this change.
