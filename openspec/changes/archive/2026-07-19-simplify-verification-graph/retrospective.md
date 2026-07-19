# Retrospective: simplify-verification-graph

> Written: 2026-07-18 (after independent verification)
> Evidence is artifact + journal state; the journal is the primary source.

---

## 0. Evidence

- **Increments**: 3/3 — mode split: 0 inline / 3 delegated
- **Tasks done**: 70/70 — 65 increment checkboxes plus 5 registry/cross-cutting rows
- **Capabilities touched**: 12 behavioral, 0 `arch-*`; **requirements authored**: 41 with 104 scenarios
- **Guardrails**: 6 registered / 0 final trips (0 STOP, 0 WARN) / 0 promoted at archive
- **Journal**: 31 entries — surprise 4 · friction 3 · signal 1 · trip 0 · reorientation 10 · objection 10 · mode-change 0 · spawn 0 · seed/review/verification 3
- **Deferral outcomes**: 0 resolved as predicted / 0 surprised / 0 retired stale; DEF-1 cache semantics, DEF-2 SCM-affected selection, and DEF-3 `vp pack` migration are explicitly carried forward
- **Delegation outcomes**: 3 dispatched / 3 merged clean after re-review / 0 merge-rejected
- **Files touched** (from increment footprints): five consumer manifests; root Vite+/CI/contributor guidance; generic workspace/preflight/build/assert helpers; owner/CI/Worker graph contracts; nightly deployment; current consumer comments and receipt producers; hygiene guidance; ten deleted target wrappers; OpenSpec artifacts
- **New external dependencies**: none
- **OpenSpec validate state**: targeted pass; portfolio pass 136/136; registry lint 0 errors / 0 warnings
- **Verdicts**: artifact PASS WITH WARNINGS · implementation PASS · rollout n/a · archive NOW
- **Conformance**: independently verified clean `chore/cleanup-build@d415ea94ff95860daed3b532cb24e655d5a09145`; exact full proof and clean status confirmed before archive
- **Test coverage signal**: exact `verify:full` 31-task exit 0; graph contracts 42/42; Worker contracts 21+2+3; presenter 18/18; integration 139/139; parity 48/48 plus 14/14 seams
- **Active sessions / rough hours**: approximately 7 agent roles across 2.25 wall-clock hours

Increment summary:

| # | Increment | Mode | Resolved | Authored / result | Notes |
| --- | --- | --- | --- | --- | --- |
| 01 | package-owned consumer claims | delegated | D1, D6 | generic closure/preflight plus five owner claims | clean after four implementation-review repairs |
| 02 | public graph and CI rewire | delegated | D2, D4, D5 | root fast/full, owner-selected CI, parsed release topology | clean after three review repairs |
| 03 | obsolete orchestration removal | delegated | D3 | 27 root tasks, 21 current tasks and ten wrappers removed | two footprint expansions; clean after two review rounds |

## 1. Wins

- [evidence: `scripts/verify/owner-graph.test.ts`, increment 01] Package manifests now own complete consumer claims, while dependency closure and recovery recipes are derived rather than copied.
- [evidence: `vite.config.ts`, increment 02] Contributors have four ordinary workflow shapes: root fast, root full, one owner claim, or a fail-closed dependent filter.
- [evidence: `scripts/verify/ci-graph.test.ts`] CI retains phase-specific receipts and proves exact immutable tarball materialization → verification → publication.
- [evidence: increment 03, journal 18:27] The root task surface fell from 57 to 27 without removing atomic diagnostics, nightly order, Worker dry-runs, or the two active-hardening compatibility bridges.
- [evidence: `verify.md`] Cold review and independent verification found real overclaims, live-reference leaks, census blind spots, and spec leakage before completion.

## 2. Misses

- 🔴 [blocking | evidence: verify §13] Referenced implementation/test files remain untracked in a shared dirty worktree. Follow-up: land the exact intended change set under the repository's authorized git workflow, then rerun verification at the clean SHA before archive.
- 🟡 [painful | evidence: journal 18:10 and 18:22] The initial live-reference footprint and exact-name census missed a CI comment and `verify:build:*` hygiene guidance. Follow-up: retain family-pattern scanning over all current prose/config roots.
- 🟡 [painful | evidence: RF-12 / journal 18:41] The proposal passed structural validation while one normative sentence failed the schema's rationale lint. Follow-up: run taxonomy lints before ticking change-end rows, not only during verify.
- 🟡 [painful | evidence: change-end verification] The first sandboxed full run stalled at isolated `npm install`; npm-enabled packed proof and the final exact full run passed. Follow-up: document packed proof's network boundary in verification execution guidance.
- 📌 [nit | evidence: verify §8] Two ambient `docs/superpowers` planning files remain at a front-door path and include obsolete vocabulary. Follow-up: relocate/archive them in their owning work.
- 📌 [nit | evidence: systematic-debugging check] Selecting the entire hygiene directory loads two pre-existing suites that import absent `typescript`; the changed presenter suite passes 18/18. Follow-up: keep verification maps explicit until that separate dependency/tooling decision is resolved.

Verify §9 found no deferred manual checks. Verify §12 found no delegation/journal gap.

## 3. Plan deviations

| Increment / row | What changed | Journal trace | Why |
| --- | --- | --- | --- |
| envelope | Added manifest-derived closure, fail-closed selection, parsed release equality, and hardening coordination | 17:09 objections/reorientation | cold DX/CI reviewers falsified simpler but incomplete guards |
| 03 | Expanded footprint by `.github/workflows/ci.yaml` | 18:10 surprise/reorientation | current CI prose named a removed alias |
| 03 | Expanded footprint by hygiene presenter/guidance and broadened census roots/patterns | 18:22 objection/reorientation | wildcard spelling bypassed exact-name census |
| change-end | Split an interrupted sandboxed full attempt from the npm-enabled packed proof, then reran exact full | 18:35 verification | isolated npm install requires network access |
| verify | Reopened artifact completion for RF-12 | 18:41 objection/reorientation | mandatory taxonomy lint found rationale leakage |

No deviation lacks a journal trace.

## 4. Skill / workflow compliance

| Skill / workflow | Used |
| --- | --- |
| brainstorming | ✓ — perspective rotation and acceptance boundary before proposal |
| writing-plans | ✓ — three bounded OpenSpec increment packets |
| executing-plans (separate-session form) | n/a — this was a same-session OpenSpec apply with per-increment delegation |
| test-driven-development | ✓ — RED owner/CI/nightly/census contracts before GREEN |
| subagent-driven-development | ✓ — fresh implementers, one reused reviewer, clean re-reviews |
| requesting-code-review | ✓ — two cold envelope reviews plus implementation reviews |
| systematic-debugging | ✓ — isolated the unrelated broad hygiene-suite dependency failure |
| verification-before-completion | ✓ — focused gates, exact full claim, independent OpenSpec verifier |

### Deliberately Skipped Skills

(none; the separate-session `executing-plans` trigger did not apply.)

## 5. Surprises (journal triage)

| Journal entry | Triage | Note |
| --- | --- | --- |
| 17:35 · inc 01 | confirmed | filesystem `_assertions` and workspace identity differ; manifests now own identity/remediation |
| 18:03 · inc 02 | contextualized | Vite+ Vitest workers lack the Bun global; the CI parser uses a Bun subprocess |
| 18:10 · inc 03 | confirmed | stale CI prose was a real live reference and justified a one-file expansion |
| 18:27 · inc 03 | contextualized | generated receipts preserve old lane strings; generated output is excluded while producers remain scanned |

Unlogged surprises discovered now: none. The npm sandbox boundary was recorded as change-end verification friction, not treated as a product surprise.

## 6. Promote candidates → long-term learning

- [ ] 🔴 **A verification graph's public surface is claims plus evidence, not every phase/target permutation** → **Promote to** `specs-arch`
  > **Why**: 57 root tasks obscured five owner claims and still left contributors unsure what green meant.
  > **How to apply**: require owner `verify` claims, one root fast/full pair, and secondary atomic diagnostics for future consumer fixtures.

- [ ] 🟡 **Live-reference censuses must match retired families and wildcard spellings across current prose/config roots** → **Promote to** schema verifier guidance
  > **Why**: exact strings missed both a CI comment and executable hygiene advice.
  > **How to apply**: scan README/docs/config/source, exclude only explicit generated/history roots, and test a wildcard counterexample.

- [ ] 🟡 **Release topology tests must compare exact artifact sets, not merely phase order** → **Promote to** `specs-arch`
  > **Why**: pack → verify → publish ordering stayed green even when membership could have drifted.
  > **How to apply**: derive and compare materialized, verified, and published identities in parsed CI contracts.

- [ ] 🟡 **Run spec-taxonomy lints before change-end ticks** → **Promote to** OODA schema workflow
  > **Why**: strict structural validation did not catch rationale language that later blocked verification.
  > **How to apply**: add the three leakage commands to the change-end precheck as well as final verify.

- [ ] 📌 **Packed consumer proof has an explicit npm-network boundary** → **Promote to** `AGENTS.md`
  > **Why**: the sandboxed full claim became silent at isolated install although all prior evidence was healthy.
  > **How to apply**: state the network/cache expectation and distinguish a stalled install from a failed packed assertion.

- [ ] 📌 **Carry DEF-1/2/3 into their named external proofs** → **Promote to** follow-up changes
  > **Why**: cache semantics, SCM-aware selection, and `vp pack` output parity were intentionally not guessed into this simplification.
  > **How to apply**: resolve only on `external:vite-task-cache-proof`, `external:affected-selector-proof`, or `external:vite-pack-output-parity` evidence.

## 7. Pre-archive sync addendum · 2026-07-18 19:47 EDT

This addendum advances the retrospective snapshot without changing the newest independent verification verdict.

- **Main-spec sync**: complete across all 12 behavioral capabilities using the OODA schema's header-matched full-text replacement semantics: 37 MODIFIED, 3 ADDED, 1 REMOVED, and 4 RENAMED.
- **Current authored surface**: 41 delta requirements with 104 scenarios. The increase from §0 reflects 16 still-valid scenarios reconciled before sync plus two full requirements with eight scenarios added after cold semantic review.
- **Current journal**: 29 entries — surprise 4 · friction 3 · signal 0 · trip 0 · reorientation 9 · objection 10 · mode-change 0 · spawn 0 · seed/review/verification 3.
- **Sync verification**: 40/40 ADDED+MODIFIED blocks exactly match main; the reused cold reviewer returned SYNC CLEAN; both active changes and all 136 portfolio items strictly validate; both registry lints, all three delta taxonomy lints, and `git diff --check` are clean.
- **Archive decision**: still POSTPONE. The required implementation remains part of a dirty/untracked tree rather than a clean landed SHA, and `harden-verification-truth` still contains two live `change:simplify-verification-graph#03` dependencies whose grammar requires this change to remain open.
- **Archive continuation**: land the exact implementation through the repository's authorized workflow, independently reverify the clean SHA with an `archive now` result, convert the hardening dependencies to an honest historical/archive signal, then run `openspec archive -y --skip-specs` and the post-archive portfolio checks.

## 8. Archive clearance addendum · 2026-07-18 20:52 EDT

This addendum supersedes the §7 POSTPONE snapshot.

- **Landed identity**: clean `chore/cleanup-build@d415ea94ff95860daed3b532cb24e655d5a09145` contains the complete implementation and change artifacts.
- **Fresh implementation proof**: exact `bunx vp run verify:full` exits 0 across 31 tasks with the packed npm install, recursive graph, module loads, stable-TypeScript declarations, Vite/Next builds, and assertions complete.
- **Independent verdict**: the newest `verify.md` report records artifact PASS WITH WARNINGS, implementation PASS, and `archive now`; the remaining warning is historical planning prose outside current executable/contributor routing.
- **Cross-change coordination**: hardening row 02 no longer claims simplify is another open change. Its journal and increment packet preserve the satisfied dependency as clean SHA plus dated archive-path provenance.
- **Final archive route**: main specs are already exact, so archive with `openspec archive -y --skip-specs simplify-verification-graph`, then validate the active portfolio, main specs, hardening registry, archive contents, and absence of live simplify dependency tokens.
