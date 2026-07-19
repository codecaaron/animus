# Journal: simplify-verification-graph

<!-- Append-only. Position in this file, not timestamp, is authoritative. -->

### 2026-07-18 17:09 · envelope · seed
Journal opens at apply start. Envelope-licensed rows: 01, 02, 03 (D1-D6 decided at propose) → later increment creation requires a resolving signal.

### 2026-07-18 17:09 · envelope · objection
Cold DX/CI review found owner-specific prerequisite lists duplicated the workspace graph and omitted `test-ds` → accepted; D1/G3 and increment 01 now require manifest-derived transitive closure plus aggregated remediation.

### 2026-07-18 17:09 · envelope · objection
Cold review proved Vite+ filters can exit green with missing evidence and the owner contract was not mandatory → accepted; canonical filters are fail-closed and owner discovery is registered in `verify:unit:ts`.

### 2026-07-18 17:09 · envelope · objection
Cold CI review found nightly lacked v1 materialization and G5 did not protect release pack→verify→publish wiring → accepted; nightly order and parsed CI topology proof were added to the envelope.

### 2026-07-18 17:09 · envelope · objection
Cold review found unreconciled baseline capabilities and future engine-marker ownership in `harden-verification-truth` → accepted; twelve capability deltas, compatibility bridges, and the serialized cross-change generic-helper/packed-marker rebase now strictly validate.

### 2026-07-18 17:09 · envelope · reorientation
- Observe: strict validation passes for both active changes; proof inventory and packed graph are green; both independent cold reviewers returned CLEAN after objections were revised.
- Orient: D1-D6 now predict a manifest-owned, fail-closed graph; NS1-NS5 are directly guarded and NS6 remains deferred. No DEF row was resolved without its signal and no lazy row is stale (first reorientation, 2026-07-18). Stances run: full pass (falsifier: accepted closure/filter/release/cross-change objections above; entropy auditor: zero remaining objections because registry dependencies and capability deltas now match the plans; heretic: moving scripts alone would not simplify DX, so exactly four ordinary workflow shapes is now an acceptance condition).
- Decide: continue with increment 01; retain cache/SCM/vp-pack deferrals and the three-increment decomposition.
- Act: revised design/specs/packets, expanded G3/G5, and rebased `harden-verification-truth` increments 01→02→03 around the new generic helpers.

### 2026-07-18 17:35 · inc 01 · surprise
Via inc 01 subagent: Vite+ package tasks execute from the owner directory, but filesystem directory `_assertions` does not imply workspace identity `@animus-ui/assertions` → caller identity and remediation now come from manifests.

### 2026-07-18 17:35 · inc 01 · friction
Via inc 01 subagent: static task-name ordering did not prove that the shell chain executes or short-circuits → owner commands now run against a controlled `vp` double in the mandatory contract.

### 2026-07-18 17:35 · inc 01 · objection
Implementation review found incorrect `_assertions` remediation, non-executable reachability checks, unsafe assertion paths, and discarded resolver directories → accepted and repaired; re-review returned SPEC CLEAN / QUALITY CLEAN.

### 2026-07-18 17:35 · inc 01 · reorientation
- Observe: RED progressed from missing resolver to missing owner claims; final owner suite is 10/10, G2/G3/G6 are green, and `verify:unit:ts` is 237/237. No `[~]` deferrals; Wrangler user-log EPERM was nonfatal and did not affect dry-run exit/evidence.
- Orient: D1/D6 predictions hold: one manifest-derived closure, executable owner chains, exact aggregated recovery, and no second owner registry. State advances NS1, NS2, NS3, and NS5; DEF-1/2/3 remain deferred with no unearned signal and are not stale (second reorientation, 2026-07-18). Stances run: full pass (falsifier: zero remaining objections because black-box missing/stale/path/phase-failure cases pass; entropy auditor: zero objections because no deferred row or spec decision moved; heretic: zero objections because the owner interface reduced ordinary selection while retaining diagnostics).
- Decide: continue to increment 02; keep the Wrangler sandbox warning as contextual friction, not a graph change.
- Act: accepted the reviewer repairs, retained old aliases/wrappers for migration, and landed increment 01 evidence.

### 2026-07-18 18:03 · inc 02 · surprise
Via inc 02 subagent: Vitest workers invoked by Vite+ do not expose the Bun global → the parsed CI contract delegates `Bun.YAML.parse` to a Bun subprocess and consumes structured JSON.

### 2026-07-18 18:03 · inc 02 · friction
Via inc 02 subagent: Vite+ has no non-executing filtered task-plan mode → fail-closed missing-task probes verify filter parsing without starting production builds.

### 2026-07-18 18:03 · inc 02 · objection
Implementation review found the Next receipt lane overclaimed a full owner proof, Change-Type Map examples omitted executable `vp run` prefixes, and the release contract did not compare exact bundle membership → accepted; the lane is phase-specific, contributor commands are executable, and exact eight-tarball equality is now enforced across pack, verify, and publish. Re-review returned SPEC CLEAN / QUALITY CLEAN.

### 2026-07-18 18:03 · inc 02 · reorientation
- Observe: RED captured three intended legacy-graph failures; final owner/CI suite is 17/17, packed/CI G5 is 8/8, G1/G3/G4 are green, strict validation passes, and no broad builds ran.
- Orient: D2/D4/D5 predictions hold: root exposes one fast and one full current-host claim, owner filters are fail-closed, CI owns environment topology, and no local command implies CI equivalence. NS1, NS3, NS4, and NS5 advance; DEF-1/2/3 remain deferred without a resolving signal and are not stale (third reorientation, 2026-07-18). Stances run: full pass (falsifier: the repaired Next overclaim and exact artifact-set check close the discovered proof gaps; entropy auditor: zero unresolved review findings and no decision/spec drift; heretic: the public interface now has exactly four ordinary workflow shapes while diagnostics remain reachable).
- Decide: continue to increment 03 and delete only aliases/wrappers made redundant by package ownership; retain the two active-hardening compatibility bridges.
- Act: accepted reviewer repairs, removed the false `verify:ci` surface, rewired CI to owner phases/claims, and recorded parsed topology and release invariants.

### 2026-07-18 18:10 · inc 03 · surprise
The RED live-reference census found `.github/workflows/ci.yaml` still describing the removed `verify:showcase` alias → accepted as current misleading guidance, not hidden as a historical exception; increment 03's footprint expands by that one already-change-owned file.

### 2026-07-18 18:10 · inc 03 · reorientation
- Observe: the census correctly fails on 23 obsolete root consumer tasks, nightly lacks v1 materialization and uses old phase aliases, and one CI comment still names the old Showcase composite.
- Orient: D3 still predicts owner-qualified phases and deletion of redundant root families; the comment is a footprint omission, not a new decision. NS1 and NS5 require current guidance to name the surviving owner interface. Stances run: full pass (falsifier: accepting the comment leak prevents a false clean census; entropy auditor: the one-file expansion is already owned by increment 02 and changes no CI behavior; heretic: excluding current CI prose would optimize the metric while preserving contributor confusion).
- Decide: expand increment 03 by `.github/workflows/ci.yaml` solely for the stale command comment; do not weaken census scope.
- Act: amended the packet/registry footprint and authorized the implementer to replace that comment with the package-owned phase diagnostic.

### 2026-07-18 18:22 · inc 03 · objection
Implementation review found the live hygiene presenter and its guidance still emitted `vp run verify:build:*`, while the census rejected only exact retired task names and omitted root README/docs → accepted; increment 03 expands by the two hygiene files, their recommendation becomes `vp run verify:full`, and the live-prose census broadens by retired-family patterns without admitting generated/history/change artifacts.

### 2026-07-18 18:22 · inc 03 · reorientation
- Observe: all declared increment checks were green, but cold review falsified G4 with a wildcard spelling of the deleted root build family in executable guidance.
- Orient: D3 requires all live callers/guidance to migrate before deletion; exact-name matching was an implementation loophole. NS1 and NS4 are not satisfied while a green hygiene run recommends a nonexistent command. Stances run: full pass (falsifier: the wildcard is a concrete counterexample to the clean census; entropy auditor: the two-file expansion is the minimum repair and changes no design decision; heretic: a smaller task graph with broken generated advice is worse DX, so the metric cannot outrank executable guidance).
- Decide: accept both findings, expand only the two write targets, and scan root README/docs as read-only current prose.
- Act: amended the packet/registry footprint and returned the findings to the same implementer/reviewer loop.

### 2026-07-18 18:27 · inc 03 · friction
Via inc 03 subagent: the four private after-build dry-run tasks had already left the current graph in increment 02 → increment 03 removed 21 remaining root tasks rather than double-counting 25.

### 2026-07-18 18:27 · inc 03 · surprise
Via inc 03 subagent: generated `.receipts/` preserve historical lane strings until regeneration → the live-source census excludes generated output directories while producer code and current prose remain mandatory.

### 2026-07-18 18:27 · inc 03 · reorientation
- Observe: final root graph has 27 tasks versus calibrated 57; ten wrappers are deleted; nightly/owner graph is 34/34, Worker contracts are 21+2+3, packed/CI is 8/8, presenter is 18/18, and both active changes strictly validate. The only unrelated failure was an intentionally overbroad hygiene-directory run loading two pre-existing suites whose absent `typescript` dependency is outside this change; the changed presenter suite is green.
- Orient: D3 holds after two falsifying review passes: all live current guidance now selects surviving claims/diagnostics, retired-family wildcard variants are rejected, and only the two hardening-owned assertion bridges remain. NS1-NS5 are satisfied; DEF-1/2/3 remain explicitly carried forward with no resolving signal and no stale review-by breach (fifth reorientation, 2026-07-18). Stances run: full pass (falsifier: zero remaining objections after wildcard/root-prose re-review; entropy auditor: zero unresolved findings and both active changes validate; heretic: the final graph cuts root breadth by more than half while preserving phase-level failure evidence and release/nightly topology).
- Decide: close increment 03 and proceed to independent change-level verification; do not archive from the dirty tree.
- Act: merged implementer evidence, accepted both cold-review repairs, and received SPEC CLEAN / QUALITY CLEAN on re-review.

### 2026-07-18 18:35 · change-end · review-findings
| ID | Finding | Source | Disposition | Evidence / follow-up |
| --- | --- | --- | --- | --- |
| RF-1 | Owner prerequisites duplicated the graph and omitted `test-ds` | cold DX/CI review | accepted | manifest-derived transitive production closure in `workspace-graph.ts`; owner contracts green |
| RF-2 | Filter selection could succeed with no evidence | cold DX/CI review | accepted | all filters use `--fail-if-no-match`; mandatory owner inventory registered in `verify:unit:ts` |
| RF-3 | Nightly omitted v1 and release proof did not bind exact bytes | cold CI review | accepted | nightly v1→v2→TS order; parsed exact eight-tarball pack→verify→publish equality |
| RF-4 | Active hardening change conflicted on marker/helper ownership | cold CI review | accepted | hardening packets rebased onto generic helpers and two retained assertion bridges; strict-valid |
| RF-5 | `_assertions` remediation, resolver directories, assertion paths, and static phase checks were unsound | inc 01 review | accepted | manifest identity, preserved resolver directories, repo-bounded paths, executable short-circuit tests; clean re-review |
| RF-6 | Next receipt lane overclaimed a complete owner proof | inc 02 review | accepted | CI now runs `#verify:build` then `#verify:assert` |
| RF-7 | Change-Type commands were not copy-pasteable | inc 02 review | accepted | every migrated segment carries `vp run`; regression contract added |
| RF-8 | Release test checked order but not exact materialized membership | inc 02 review | accepted | exact eight-tarball equality across materialization, validation, publication |
| RF-9 | CI prose still named `verify:showcase` | inc 03 RED census | accepted | one-file footprint expansion; owner-qualified phase comment |
| RF-10 | Hygiene presenter emitted deleted wildcard family | inc 03 review | accepted | both live guidance surfaces now recommend `vp run verify:full` |
| RF-11 | Census rejected exact names only and omitted root prose | inc 03 review | accepted | retired-family patterns plus README/current-doc roots; generated/history/legacy/change exclusions |
| RF-12 | Delta spec embedded design rationale via mandatory-lint word `because` | independent verifier | accepted | requirement now states only the fail-closed observable contract; taxonomy lints rerun before final report |

### 2026-07-18 18:35 · change-end · verification
- Targeted and repo-wide OpenSpec validation pass: 136/136 items; registry lint reports 0 errors and 0 warnings.
- Exact `bunx vp run verify:full` exits 0 across 31 tasks after npm access is available for the isolated packed install. An earlier sandboxed attempt reached the packed install after all preceding tasks passed, then was interrupted after network silence; standalone packed proof and the final exact full run both exit 0.
- Focused evidence remains green: owner/Worker config 34/34, packed/CI 8/8, Worker contracts 21+2+3, hygiene presenter 18/18, integration 139/139, parity 48/48 plus 14/14 seams, current live-reference census empty.
- Non-change baseline note: an intentionally overbroad `scripts/hygiene/` test selection loads two suites that import absent `typescript`; the changed presenter suite passes and no change repair was made.
- All RF-1 through RF-11 are accepted and repaired; no rejected, deferred, or undispositioned review finding remains.

### 2026-07-18 18:35 · change-end · reorientation
- Observe: all three increments, five registry/cross-cutting rows, STOP gates, exact full current-host claim, strict portfolio validation, and clean implementation re-reviews are complete.
- Orient: the graph now exposes claims instead of target-phase permutations: 27 root tasks, exactly four ordinary workflows, five owner claims, two narrow compatibility bridges, and preserved CI/nightly/release evidence. NS1-NS5 are met. DEF-1 cache semantics, DEF-2 SCM-aware affected mode, and DEF-3 Vite+ pack migration remain deliberately out of scope, named for retrospective carry-forward, and have not breached review-by. Stances run: full pass (falsifier: RF-1 through RF-11 are closed with executable evidence; entropy auditor: registry/spec/journal/implementation agree and both active changes validate; heretic: the surviving graph is materially smaller without erasing diagnostics or pretending local proof equals CI).
- Decide: mark cross-cutting rows complete and request independent OpenSpec verification; postpone archive because this shared worktree is dirty and no git mutation is authorized.
- Act: ticked 2.1/2.2 and assembled the final evidence packet for the verifier.

### 2026-07-18 18:41 · verify · objection
Independent verification found `verification-tier-policy` explaining the Vite+ rationale inside a normative requirement with `because`, violating the blocking spec-taxonomy lint → accepted as RF-12; the requirement now states only the fail-closed observable contract.

### 2026-07-18 18:41 · verify · reorientation
- Observe: implementation/full verification remains green, but artifact verification correctly stopped on one mandatory rationale-lint hit.
- Orient: this is spec leakage, not behavior drift; removing the rationale preserves D2's observable requirement and makes the delta admissible. Stances run: full pass (falsifier: the exact lint hit disproved the earlier artifact-complete claim; entropy auditor: one sentence changes and no scenario/decision moves; heretic: a PASS with a known blocking lint would make the verification artifact ceremonial).
- Decide: repair the spec, rerun all three taxonomy lints plus strict validation, and return the same independent verifier to the report.
- Act: removed the rationale clause and added RF-12 with accepted disposition.

### 2026-07-18 19:47 · pre-archive · objection
Cold archive review returned ARCHIVE NOT CLEAN: the newest independent report still says POSTPONE until the exact dirty/untracked implementation lands and is reverified at a clean SHA, while two active `harden-verification-truth` artifacts still depend on `change:simplify-verification-graph#03` as an open change. Accepted; archive remains blocked rather than overriding the recorded evidence gate or leaving a semantically dangling dependency.

### 2026-07-18 19:47 · sync · objection
Cold sync review found that generic scenario-preserving sync would retain obsolete semantics under this schema's full-replacement rule. Sixteen still-valid main scenarios were first reconciled into the delta; the first re-review then found two legacy `verification-tier-policy` requirements outside the original delta that still named the retired NAPI command and four deleted wrappers. Accepted; both requirements were added as full MODIFIED replacements around `vp run build:extract`, the canonical three-entry dist probe, retained diagnostics, and generic consumer helpers.

### 2026-07-18 19:47 · pre-archive · reorientation
- Observe: all twelve capability deltas are manually synchronized using OODA full-text replacement semantics: 37 MODIFIED, 3 ADDED, 1 REMOVED, and 4 RENAMED; 40/40 ADDED+MODIFIED blocks exactly match main. The reused cold reviewer returned SYNC CLEAN after checking all 16 preserved scenarios, both repaired requirements, removal/rename results, helper reachability, and hardening compatibility. Both active changes strictly validate, the portfolio passes 136/136, both registry lints are clean, all three delta taxonomy lints are empty, and `git diff --check` passes.
- Orient: the spec state is archive-ready, but the repository evidence state is not. The clean sync does not resolve the dirty/untracked implementation gap or convert hardening's open-change dependency into historical evidence. Stances run: full pass (falsifier: two stale main requirements disproved the first mechanical-sync claim and are now repaired; entropy auditor: exact block equality and portfolio validation show no remaining sync divergence; heretic: moving the change merely to make the active list shorter would trade visible coordination for a false archive claim).
- Decide: keep `simplify-verification-graph` active; after the exact implementation lands and is independently reverified at a clean SHA, rebase the two hardening dependency tokens, update the newest verify/retrospective decision, and archive with `openspec archive -y --skip-specs` because specs are already synchronized.
- Act: recorded the clean sync and archive blocker; performed no archive move, hardening edit, build, or mutative git operation.
