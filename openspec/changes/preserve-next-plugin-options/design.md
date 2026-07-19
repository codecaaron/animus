## Context

RepoWise ranks `packages/next-plugin/src/plugin.ts` as a 98th-percentile,
fix-heavy hotspot with a single-owner concentration. Current OpenSpec
requirements already govern the plugin's behavior, so the analyzer's missing
decision label is not itself a license for a broad refactor. Live tracing did
find a public adapter defect: `withAnimus` manually copies only part of
`AnimusNextOptions`, silently dropping `extensions` and `layers` before the
real plugin sees them. The public README also demonstrates an obsolete call
shape. Existing Rust, integration, and completed OODA increments in the dirty
worktree are protected scope.

## Goals / Non-Goals

**Goals:**

- Preserve every typed `AnimusNextOptions` value across the public
  `withAnimus` to `AnimusWebpackPlugin` boundary.
- Add a public-boundary regression test that fails against the current partial
  copy and proves `extensions` and `layers` reach the real plugin.
- Align the package README with the curried wrapper contract.
- Strengthen the canonical `next-config-wrapper` requirement accordingly.

**Non-Goals:**

- Refactoring or decomposing `AnimusWebpackPlugin`.
- Changing plugin filesystem, cache, hash, extraction, or error-tolerance
  behavior.
- Changing the `AnimusNextOptions` type or adding options.
- Modifying or archiving prior dirty increments.

## Decisions

### D1: Forward the typed options object as one unit

- **Choice**: Construct `AnimusWebpackPlugin` with the original `options`
  object received by `withAnimus`.
- **Rationale**: Whole-object forwarding fixes the current omissions and
  removes the adapter-maintained allowlist that allowed new typed options to
  drift silently.
- **Alternatives considered**: Add `extensions` and `layers` to the existing
  copied object; rejected because the synchronization failure would remain.
  Introduce a separate mapper; rejected because there is no transformation or
  validation boundary to justify one.

### D2: Test the exported wrapper with the real plugin instance

- **Choice**: Exercise `withAnimus`, invoke its webpack hook in an isolated
  temporary project root, locate the injected `AnimusWebpackPlugin`, and assert
  that `getOptions()` returns the original object including `extensions` and
  `layers`.
- **Rationale**: This proves the public behavior at the boundary where the
  regression occurs without coupling the test to constructor source text or
  mocking the plugin.
- **Alternatives considered**: Unit-test `AnimusWebpackPlugin` directly;
  rejected because the plugin already retains the options it receives and the
  bug is in the wrapper. Mock the constructor; rejected because it would test
  mock plumbing rather than the real adapter.

### D3: Correct the adjacent public example in the same contract increment

- **Choice**: Rewrite the README setup example as
  `withAnimus(options)(nextConfig)`.
- **Rationale**: The obsolete two-argument example contradicts the same public
  wrapper contract and would direct consumers to a type/runtime failure.
- **Alternatives considered**: Defer the documentation fix; rejected because
  it is a one-line, directly verified neighbor correction with no separate
  behavior or deployment risk.

### D4: Keep the established descriptive missing-system diagnostic

- **Choice**: Specify and test the existing diagnostic that identifies the
  missing `system` option and demonstrates the curried wrapper invocation.
- **Rationale**: Source history shows this diagnostic has been stable since the
  wrapper's first commit, is more actionable than the stale canonical string,
  and already reflects the current API shape.
- **Alternatives considered**: Change production code to the shorter
  `[animus] 'system' option is required`; rejected because it would discard
  useful remediation guidance solely to match documentation that never
  matched the implementation.

### D5: Compose the consumer webpack hook before Animus injection

- **Choice**: When a consumer webpack hook exists, call it first and add the
  Animus plugin, aliases, and loader to the configuration object it returns.
- **Rationale**: Both archived wrapper specifications require this order, and
  a live replacement-config reproduction shows the current reverse order can
  discard every Animus addition.
- **Alternatives considered**: Preserve the current injection-first order;
  rejected because a valid consumer hook may return a replacement config.
  Merge the original and returned configs afterward; rejected because it
  invents precedence semantics instead of augmenting the consumer-authoritative
  result.

## North Star

**Adversarial cadence K**: 1

- **NS1**: Every valid `AnimusNextOptions` value crosses the public wrapper
  boundary without an adapter-maintained property allowlist.
- **NS2**: Public examples, canonical requirements, and executable tests
  describe the same curried `withAnimus` API.
- **NS3**: Changes in the high-churn plugin area remain at the narrowest
  behavior-owning seam — provisional; revisit when
  `external:next-plugin-seam-audit` produces a measured, regression-covered
  decomposition target.

## Decision Ledger

| ID | Decision | Status | Owner increment | Resolving signal | Review-by |
| --- | --- | --- | --- | --- | --- |
| DEF-1 | Whether and where to decompose `AnimusWebpackPlugin` | retired (journal 2026-07-19 05:11) | `external:next-plugin-seam-audit` | `external:next-plugin-seam-audit` produces a measured complexity or defect reduction and a complete seam test inventory | 3 reorientations \| 2026-08-19 |
| DEF-2 | Whether tolerant filesystem and package-resolution catches should fail loud | retired (journal 2026-07-19 05:11) | `external:next-plugin-failure-policy-audit` | `external:next-plugin-failure-policy-audit` produces a reproducible case and a canonical strict-versus-best-effort policy | 3 reorientations \| 2026-08-19 |
| DEF-3 | Whether build-cache MD5 fingerprints need replacement | retired (journal 2026-07-19 05:11) | `external:next-plugin-fingerprint-review` | `external:next-plugin-fingerprint-review` shows a trust-boundary use or measured collision correctness risk | 3 reorientations \| 2026-08-19 |
| DEF-4 | Whether RepoWise recognizes the new wrapper governance | retired (journal 2026-07-19 05:11) | `external:repowise-index-refresh` | `external:repowise-index-refresh` indexes the landed OpenSpec and source revision | 3 reorientations \| 2026-08-19 |

## Guardrail Register

| ID | Invariant (SHALL NOT ...) | Scope | On trip | Status |
| --- | --- | --- | --- | --- |
| G1 | SHALL NOT modify `packages/next-plugin/src/plugin.ts`; blind spot: generated or indirect behavior changes outside the file are covered by G5 | all | STOP | active (calibrated 2026-07-19: exit 0, empty) |
| G2 | SHALL NOT retain a hand-copied plugin-options allowlist; blind spot: this checks only the constructor block, while the behavioral test covers values | footprint:packages/next-plugin/src/with-animus.ts | STOP | active (recalibrated 2026-07-19 after journal 04:37 trip: whole-object constructor present, no copied constructor fields) |
| G3 | SHALL NOT retain the obsolete README two-argument wrapper call | inc:01 | STOP | active (inc 01 landed 2026-07-19: obsolete call absent) |
| G4 | SHALL NOT alter the preserved pre-existing tracked Rust/integration diffs; blind spot: separately untracked completed OODA directories are protected by footprint review | all | STOP | active (calibrated 2026-07-19: SHA-256 `f6f120b895f350f209739f1bda6b4e4ef8d65588063b600fb5ba2b26e271235e`) |
| G5 | SHALL NOT regress compile, TypeScript unit, or Next consumer owner claims | change-end | STOP | active (calibrated 2026-07-19: baseline claims pass) |

Checks — verbatim commands:

**G1** — expected: exit 0 and empty output

```bash
git diff --exit-code -- packages/next-plugin/src/plugin.ts
```

**G2** — expected: one whole-object constructor match, then exit 0 and no
hand-copied constructor-option matches

```bash
sed -n '/\/\/ Inject AnimusWebpackPlugin/,/config.plugins.push(plugin)/p' packages/next-plugin/src/with-animus.ts | rg -n 'new AnimusWebpackPlugin\(options\)'
if sed -n '/\/\/ Inject AnimusWebpackPlugin/,/config.plugins.push(plugin)/p' packages/next-plugin/src/with-animus.ts | rg -n 'system: options\.system|exclude: options\.exclude|extensions: options\.extensions|strict: options\.strict|verbose: options\.verbose|prefix: options\.prefix|engine: options\.engine|layers: options\.layers'; then exit 1; fi
```

**G3** — expected: exit 0 and empty output

```bash
if rg -n 'withAnimus\(nextConfig,' packages/next-plugin/README.md; then exit 1; fi
```

**G4** — expected: the exact SHA-256
`f6f120b895f350f209739f1bda6b4e4ef8d65588063b600fb5ba2b26e271235e`

```bash
git diff -- openspec/specs/pipeline-integration-testing/spec.md packages/_integration packages/extract/crates/extract-v2/src/analyze_css.rs packages/extract/crates/extract-v2/src/cross_file.rs packages/extract/crates/extract-v2/src/pipeline.rs packages/extract/tests/canary.test.ts | shasum -a 256
```

**G5** — expected: all commands exit 0

```bash
set -e
repowise distill vp run verify:compile
repowise distill vp run verify:unit:ts
repowise distill vp run @animus-ui/next-app#verify
```

## Risks / Trade-offs

- [Risk] Instantiating the wrapper in a test writes `.animus/styles.css` ->
  Mitigation: run it under a unique temporary project root and remove that root
  after every test.
- [Risk] Static module state suppresses the one-time gitignore warning across
  tests -> Mitigation: do not assert warning state; assert only plugin injection
  and options, which are independent of the warning.
- [Risk] A whole-object reference could later be mutated by a caller ->
  Mitigation: this is existing plugin semantics for the constructed options
  object; this change removes an undocumented shallow copy but adds no supported
  mutation contract. Tests assert initial forwarding only.
- [Trade-off] The focused test imports an internal plugin class to inspect the
  wrapper result -> acceptable because it remains within the owning package
  test suite and verifies a public wrapper behavior through the real injected
  instance.

## Migration Plan

N/A — no deployment or data migration. Acceptance requires RED-GREEN proof,
guardrail checks, mapped repository verification, independent review, and
strict OpenSpec validation. Rollback is the independently revertible wrapper,
test, README, and specification increment; no Git mutation is performed here.
