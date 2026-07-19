<!--
brainstorm.md is the immutable strategic exploration record once design.md
exists. design.md supersedes this file if the two ever conflict.
-->

# Embedded transform integration exploration

This capture consolidates exploration already completed on 2026-07-19. Its
evidence is the current implementation and tests in:

- `packages/_integration/__tests__/extraction.test.ts`
- `packages/_integration/fixtures/components/transforms.tsx`
- `packages/extract/src/theme_resolver.rs`
- `packages/extract/crates/extract-v2/src/theme.rs`
- `openspec/specs/pipeline-integration-testing/spec.md`
- `openspec/specs/named-transforms/spec.md`
- `openspec/changes/archive/2026-04-11-embedded-transform-eval/`

The exploration also used two read-only probes against the current NAPI
extractor. The checked-in transform fixture emitted a raw `flex-basis: 100`
and no `__TRANSFORM__` marker. A synthetic self-contained `createTransform`
fixture that doubled a group-level `width: 4` emitted `width: 8px` and no
marker. The latter distinguishes successful callback evaluation from both raw
fallback and the built-in size transform, which would each produce `4px`.

## Decision chain

1. RepoWise labelled `extraction.test.ts` a high-churn file without a governing
   decision. Repository history and the canonical integration and behavioral
   test specifications contradict that diagnosis, so the hotspot lead is a
   false positive rather than a reason to refactor the suite.
2. Reading the test exposed a narrower real weakness: the placeholder
   assertion runs only when the output already contains a placeholder. An
   output with no transform exercise therefore passes vacuously.
3. Reading the paired fixture showed that it declares `transform: 'size'`
   inside `.props()`. Current named-transform authority requires
   self-contained `createTransform` callbacks; the fixture does not prove that
   path.
4. The archived embedded-evaluation decision and current Rust implementation
   show that valid transforms execute in-process. Placeholder emission is only
   the legacy path when no evaluator exists, while evaluation errors retain a
   v1-compatible raw fallback.
5. The canonical pipeline integration specification still describes
   `resolveTransformPlaceholders` as the active path. That text conflicts with
   the implemented embedded-evaluation authority and the live probes.
6. The smallest honest correction is therefore a test-owned increment: make
   the fixture define a self-contained named transform, assert its
   discriminating `8px` output unconditionally, assert that no legacy marker
   escaped, and amend the pipeline integration capability through an OpenSpec
   delta. No production Rust behavior needs to change.

## Known now

- The analyzer's broad hotspot diagnosis is false; the file has governing
  specifications and its recent changes are test-surface evolution.
- The current conditional marker assertion can pass without exercising a
  named transform.
- A self-contained named transform is extracted and evaluated by the current
  Rust/NAPI pipeline.
- `width: 8px` from an input of `width: 4` is an observable, non-vacuous proof
  that the fixture's callback ran.
- The integration capability should describe in-process evaluation, not live
  TypeScript registry post-processing.
- The change can remain independently revertible by limiting source edits to
  the transform fixture and its integration test, with the associated OODA
  artifacts recording the contract correction.

## Deferred

- Whether v1's silent raw fallback on transform evaluation error should be
  replaced with diagnostics is deferred. Resolving signal: an approved v2
  transform-evaluation increment with explicit compatibility and diagnostic
  acceptance tests.
- Whether `resolveTransformPlaceholders` can be removed from post-processing is
  deferred. Resolving signal: repository-wide reachability evidence showing no
  supported caller or compatibility surface, followed by its own tests and
  change proposal.
- Whether other integration fixtures contain similarly vacuous assertions is
  deferred. Resolving signal: a separate, evidence-backed queue audit that
  identifies a concrete unexercised behavior and its discriminating oracle.
- Whether RepoWise's hotspot heuristics should be tuned is deferred. Resolving
  signal: repeated, categorized false-positive measurements across enough
  files to justify changing analyzer configuration rather than documenting
  individual verdicts.

## Candidate north stars

- Integration tests demonstrate the production extraction path with outputs
  that distinguish the intended behavior from compatible fallbacks.
- Test assertions are unconditional for the behavior named by the test.
- Canonical capability text follows the current engine boundary: transform
  callbacks execute in Rust, while TypeScript post-processing is not presented
  as the normal path.
- Queue work turns analyzer leads into the smallest evidence-backed increment;
  a false-positive lead is recorded rather than forced into a refactor.
- Provisional: the fixture may use the name `size` because the doubled output
  distinguishes the extracted callback from the built-in behavior. Revisit if
  transform registration starts rejecting or shadowing built-in names; the
  signal is a focused integration failure or an explicit registry invariant.

## Candidate guardrails

- The change SHALL NOT alter production Rust transform semantics. Check:
  `git diff -- packages/extract/src packages/extract/crates` contains no new
  paths from this increment.
- The change SHALL NOT weaken v1/v2 compatibility fallbacks. Check: the focused
  diff contains only the integration fixture, integration test, and this
  OpenSpec change.
- The test SHALL NOT pass when the fixture callback is absent or ineffective.
  Check: first add the unconditional `width: 8px` assertion against the old
  fixture and observe the focused integration test fail.
- The test SHALL NOT accept a leaked legacy placeholder. Check: assert
  `rawCss` does not contain `__TRANSFORM__` on every run, without a conditional
  guard.
- The change SHALL NOT claim that a static-analysis lead is ground truth.
  Check: design and verification record the hotspot verdict separately from
  the concrete test defect.
- The increment SHALL remain reviewable and independently revertible. Check:
  tasks and increment registry name one fixture/test/spec unit and do not mix
  unrelated queue items.
- Existing unrelated working-tree increments SHALL remain untouched. Check:
  compare read-only status and scoped diffs before and after implementation.
