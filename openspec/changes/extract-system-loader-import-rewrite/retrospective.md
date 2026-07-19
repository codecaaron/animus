# Retrospective: extract-system-loader-import-rewrite

> Written: 2026-07-19 (after newest verify passed with warnings)
> Evidence is artifact + journal state. The journal is the primary temporal
> source; no VCS mutation or commit-range claim is used.

---

## 0. Evidence

- **Increments**: 1/1 created and completed — mode split: 0 inline / 1
  delegated; seven additional inline-mode lazy rows remain intentionally
  uncreated and signal-gated.
- **Tasks done**: 31/38 checkbox rows; the seven open rows are DEF-1 through
  DEF-7 carry-forward owners, not skipped executable work.
- **Capabilities touched**: 0 behavioral, 1 arch-*; **requirements authored**:
  1 requirement with 3 executable scenarios.
- **Guardrails**: 6 registered / 1 trip (1 STOP, 0 WARN) / 0 promoted at
  archive; the durable boundary checks are already authored in the new arch
  capability.
- **Journal**: 12 entries — seed 1 · surprise 1 · friction 1 · signal 1 · trip
  1 · reorientation 4 · objection 3 · mode-change 0 · spawn 0.
- **Deferral outcomes**: 1 resolved as predicted (DEF-8 → D5 after the exact
  cross-change signal) / 0 surprised / 0 retired stale / 7 carried forward in
  lazy rows 02-08.
- **Delegation outcomes**: 1 bounded implementer dispatched / 1 merged clean
  after a STOP and reviewed resumption / 0 merge-rejected; one independent
  reviewer lineage handled Phase 1, packet repair, Phase 2, and aggregate
  verification.
- **Files touched**: `packages/extract/crates/system-loader/src/lib.rs`
  (derived from completed row 01's footprint).
- **New external dependencies**: none.
- **OpenSpec validate state**: targeted 1/1 pass; portfolio 149/149 pass;
  registry 8 rows with 0 errors / 0 warnings.
- **Verdicts**: artifact PASS WITH WARNINGS · implementation PASS · rollout
  n/a · archive postponed for mixed dirty/unmerged conformance.
- **Conformance**: `fd16879` is an ancestor of `origin/main`, but tracked dirty
  fingerprint
  `115b28c5ec3c111aa6d83a356b7941b568ca6dd69da1dc848fe22c2b0d03f72b`
  and the eight untracked change artifacts have not been shown to land;
  `unmerged-implementation` postpones archive.
- **Test coverage signal**: pre/post focused matrix 1/1; loader units 9 passed
  with 1 ignored; change-end Clippy and dependency hygiene clean; Rust 638
  passed with 1 ignored; canary 200/200; parity 48/48 in both modes plus seam
  14/14; integration 157/157.
- **Active sessions / rough hours**: one continuous orchestrated session,
  approximately 1.25 wall-clock hours for this increment including the
  cross-owner repair wait and aggregate verification.

Increment summary:

| # | Increment | Mode | Resolved | Authored | Notes |
| --- | --- | --- | --- | --- | --- |
| 01 | extract import rewriting | delegate | D1-D5; DEF-8 → D5 | §arch-system-loader-import-rewrite/Isolated byte-stable import rewriting | Phase 1/re-reviews/Phase 2 clean; one external-oracle STOP |

---

## 1. Wins

- [evidence: focused matrix and G2] The implementation separated structural
  improvement from behavior: the exact matrix was GREEN against the inline
  code, the helper shape was honestly RED `0/0/3`, and the final shape is
  `1/2/0` without output drift.
- [evidence: `system-loader/src/lib.rs`] One private borrowed helper now owns
  non-empty import rendering while require-key lookup, spans, exports,
  reverse application, execution, and public APIs remain in their prior owners.
- [evidence: Phase 1 objection] Independent review distinguished OXC's bare
  `None` from explicit-empty `Some([])` before source mutation and added a
  direct assertion for both paths.
- [evidence: 11:06 STOP and D5/G5] The stale parity oracle was attributed to
  its fixture owner instead of being waived, refreshed under the loader row,
  or blamed on the new helper. The original protected foreign hash remained
  exact throughout.
- [evidence: fresh aggregate G6] The full shared-loader claim converged across
  strict Clippy, dependency hygiene, Rust units, NAPI canary, committed parity,
  seam battery, and integration.

## 2. Misses

- 🟡 [painful | evidence: 10:53 objection] The first packet treated bare and
  explicit-empty imports as one edge even though the OXC AST represents them
  differently. Follow-up: characterize structurally distinct parser states,
  not only semantically similar source forms, during packet review.
- 📌 [nit | evidence: 11:42 objection] D5/G5 was corrected in `design.md`, but
  the packet's live completion checkbox retained the obsolete broad hash
  command. Follow-up: after any guardrail amendment, search all packet and
  report references before resumption.
- 🟡 [painful | evidence: 11:56 verification objection] The first closure
  modeled a later STOP repair as if it had been a packet-creation `inputs:`
  edge and left seven DEF rows without schema-valid carry-forward rows. Both
  were fixed before a report was written. Follow-up: run temporal-edge and
  DEF-to-lazy-row checks before ticking the final row.
- 🟡 [painful | evidence: verify §13] The mixed dirty worktree prevents archive
  despite complete implementation evidence. Follow-up: land or split the exact
  change-owned target and eight OODA artifacts without absorbing adjacent Rust,
  parity, integration, system, or next-plugin increments, then reverify
  conformance.
- 📌 [nit | evidence: verify §8] Six unrelated ignored front-door plan/design
  files remain; their respective owners retain cleanup.

There is no blocking code or evidence miss. Verify §9 found no deferred manual
check, and §12 found no remaining delegation-coherence warning.

## 3. Plan Deviations

| Increment / row | What changed | Journal trace | Why |
| --- | --- | --- | --- |
| 01 | Suspended at parity before integration | 11:06 guardrail-trip + reorientation | earlier fixture change left the committed corpus digest and one unit stale |
| 01 | Added D5 and revised G5 before resumption | 11:37 signal + 11:39 reorientation | preserve external fixture ownership and original foreign-diff evidence |
| 01 | Repaired stale live packet command | 11:42 objection | cold-start packet contradicted amended authoritative guardrail |
| registry | Removed retroactive `inputs:` edge and added lazy rows 02-08 | 11:56 objection + reorientation | represent actual time order and satisfy explicit DEF carry-forward protocol |

No mode change or speculative source-row spawn occurred.

## 4. Skill / Workflow Compliance

| Skill / workflow | Used |
| --- | --- |
| brainstorming | ✓ — RepoWise/source/test evidence bounded the private seam before OODA proposal |
| writing-plans | ✓ — one cold-start delegate packet, amended only at journaled review/reorientation checkpoints |
| executing-plans | N/A — delegated execution used the mutually exclusive subagent path |
| test-driven-development | ✓ — exact behavior GREEN plus structural RED preceded production extraction |
| subagent-driven-development | ✓ — one implementer and independent reviewer; root retained shared artifact ownership |
| verification-before-completion | ✓ — full change-end G6 rerun and independent aggregate report preceded retrospective |

### Deliberately Skipped Skills

None. `executing-plans` was a mutually exclusive execution path, not a skipped
obligation. Parallel dispatch was unnecessary because there was one executable
row; the lazy rows had no signals.

## 5. Surprises (Journal Triage)

| Journal entry | Triage | Note |
| --- | --- | --- |
| 2026-07-19 11:06 · inc 01 | confirmed and resolved externally | a parity-enumerated integration fixture had changed under an earlier owner without synchronizing the committed pair; row 01 correctly stopped and the fixture owner repaired it |

The related tracked `last-failure.txt` write was captured as friction, not
reclassified as a surprise. It remains preserved as exact attribution evidence.

Unlogged surprises discovered now: none.

## 6. Promote Candidates → Long-Term Learning

- [ ] 🟡 **A later repair that resumes a stopped row is a journal signal, not a
  retroactive `inputs:` edge** → **Promote to** OODA schema / verify guidance

  > **Why**: declaring the fixture repair as packet input contradicted the
  > actual creation/execution order and produced an avoidable evidence gap.
  > **How to apply**: at verification, compare each `inputs:` token to packet
  > creation evidence; model post-STOP dependencies through DEF promotion and
  > a journaled resumption signal unless a new packet row is spawned.

- [ ] 🟡 **Every unresolved DEF needs its named lazy row before final
  verification** → **Promote to** OODA apply pre-verification checklist

  > **Why**: exact Ledger owners/signals and review-by values were not enough
  > for archive carry-forward; seven missing lazy rows blocked the first
  > aggregate pass.
  > **How to apply**: before ticking the last executable row, join every
  > deferred Ledger ID against `tasks.md` lazy rows and stop on any unmatched
  > ID unless an existing retrospective already carries it.

- [ ] 📌 **Guardrail amendments must update every live packet invocation** →
  **Promote to** writing-plans / OODA packet re-review

  > **Why**: the authoritative G5 boundary was correct while one stale packet
  > checkbox still instructed an unreproducible broad hash.
  > **How to apply**: after changing any G<n>, `rg` that identifier across the
  > change tree and require same-reviewer approval of all executable copies.

- [x] 🟢 **Byte-stable shared-loader extraction requires executable boundary
  and downstream-oracle gates** → **Promote to** specs-arch

  > **Why**: structural counts alone cannot prove semantics or shared-engine
  > safety.
  > **How to apply**: the new
  > `arch-system-loader-import-rewrite/Isolated byte-stable import rewriting`
  > requirement already binds exact matrix, public/token guards, foreign hash,
  > and complete G6 evidence; archive will sync it when conformance permits.

Archive remains postponed. Lazy rows 02-08 stay uncreated until their exact
Ledger signals appear; none authorizes speculative continuation now.
