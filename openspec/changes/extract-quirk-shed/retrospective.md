# Retrospective: extract-quirk-shed

> Written: 2026-07-13 (after verify passed)
> Evidence is artifact + journal state — no commit ranges or diffs exist. The
> journal is the primary source: §5 triages its entries rather than relying on
> recall.

---

## 0. Evidence

- **Increments**: 8/8 — registry mode split: 3 inline / 5 delegated. Journal
  mode changes caused 7 increments to be dispatched in practice.
- **Tasks done**: 159/159 — 151 packet tasks plus 8 registry rows.
- **Capabilities touched**: 7 behavioral, 0 `arch-*`; **requirements
  authored**: 19 requirements with 33 scenarios.
- **Guardrails**: 4 registered / 1 reconciled trip (1 STOP, 0 WARN) / 0
  promoted to `specs/arch-*` because archive is postponed. G2/G3's durable
  behavior is already captured by behavioral delta specs; G1 is fulfilled
  and G4 is release-boundary-specific.
- **Journal**: 59 entries — surprise 4 · friction 8 · signal 4 · trip 1 ·
  reorientation 8 · objection 26 · mode-change 2 · spawn 1 · seed 1 ·
  implementation 2 · test-red 2.
- **Deferral outcomes**: 5 resolved as predicted / 0 surprised / 0 retired
  stale. DEF-4 opened the shedding rows after the default flip; DEF-1 selected
  removal after its authored-config probe; DEF-2 and DEF-3 resolved at the
  row-06 review boundary; DEF-5 resolved after the plugin-consumption audit.
- **Delegation outcomes**: 7 dispatched / 7 merged clean / 0 merge-rejected.
  The orchestrator retained ownership of shared OpenSpec artifacts and reran
  the STOP gates after merges.
- **Files touched**: derived from increment plans —
  `packages/extract/crates/extract-v2/src/**`,
  `packages/extract/crates/system-loader/**`, `packages/extract/src/**`,
  `packages/_parity/**`, `packages/system/src/**`, Vite and Next plugin
  sources/tests, integration and consumer fixtures, `scripts/verify/**`,
  `.github/workflows/ci.yaml`, `vite.config.ts`, `.prettierignore`, root
  guidance, showcase documentation, and this change's OpenSpec artifacts.
- **New external dependencies**: none. The new shared loader is an internal
  Rust crate and reuses the existing dependency set.
- **OpenSpec validate state before archive**: targeted strict validation
  passes 1/1. Repo-wide strict validation reports four unrelated pre-existing
  portfolio failures: `color-mode-palette`, `content-migration`,
  `responsive-shell-layout`, and `enforce-workspace-topology`.
- **Verdicts (newest verify report)**: artifact PASS · implementation PASS ·
  rollout clear · archive decision postpone because required, reachable files
  remain untracked.
- **Conformance**: `unmerged-implementation` — verification ran on a dirty
  tree at `feat/random` / `199c27a2d174`; the tracked patch fingerprint is not
  landed and the complete untracked inventory is not reproducible from
  `HEAD`. Archive remains postponed until the entire verified inventory lands
  and final verification is rerun.
- **Test coverage signal**: TypeScript 17 files / 202 tests; focused parity 5
  files / 42 tests; Rust v1 272, shared loader 8 plus its ignored showcase test
  explicitly passing 1/1, v2 303; canary 199; integration 10 files / 138
  tests; serial CI 17/17 tasks. Final parity is 48/48 in each mode plus seam
  14/14, with zero drift or unregistered divergence.
- **Active sessions / rough hours**: one extended apply cycle, approximately
  15.5 elapsed hours including pauses, delegated work, and independent review.

Increment summary:

| # | Increment | Registry mode | Resolved | Authored | Notes |
| --- | --- | --- | --- | --- | --- |
| 01 | alias leak | inline | DEF-4 | deterministic CSS; alias diagnostics | Delegated by the 03:25 mode change; exposed wider comparison surfaces and spawned row 08. |
| 02 | eval-drop diagnostic | inline | — | eval-failed diagnostic | Delegated by the 03:25 mode change; covered both silent error mirrors. |
| 03 | use-client trivia | delegate | — | directive-trivia contract | Replaced the hand scanner with OXC directive semantics. |
| 04 | structured imports | delegate | — | referenced-runtime import contract | Kept only a dedicated transformed-code divergence. |
| 05 | selector-order removal | delegate | DEF-1 → D4 | Next and pipeline signature contracts | Removed dead serialized configuration across adapters and consumers. |
| 06 | duplicate-compose drop | delegate | — | — | Produced the final live-v1 set and the planned RED/restore handoff. |
| 07 | oracle inversion / loader boundary | inline | DEF-2 → D6; DEF-3 → D7 | 12 parity, transform, and verification-tier requirements | Established committed exact v2 baselines, the shared loader, default-v2 routing, and explicit-v1 compatibility. |
| 08 | warn diagnostic surfacing | delegate | DEF-5 → D5 | developer-visible alias warning | Spawned from row-01 friction and proved both plugin channels. |

---

## 1. Wins

- [evidence: increment 07; `packages/_parity/baselines/v2/**`; focused parity
  tests] The oracle is now immutable and exact: ordinary drift is read-only
  and red, privileged refresh requires exact registered drift plus a checked
  intent, production/development baselines update atomically, and the seam has
  its own atomic content-addressed baseline.
- [evidence: increment 07; `packages/extract/crates/system-loader/**`; default
  and explicit-v1 consumer gates] The engine-neutral loader is shared by both
  bindings. Default consumers route through v2 while the promised v1 escape
  hatch remains independently consumer-proven.
- [evidence: increments 01–06 and 08; 303 v2 Rust tests; 138 integration
  tests] The shed work converted silent or invalid behavior into parseable
  output, explicit diagnostics, semantic directive detection, structured
  imports, and the intended adapter signature.
- [evidence: journal RF-1…RF-25; independent spec and quality re-reviews]
  Adversarial review found real blind spots in exact comparison, atomic
  refresh, loader proof, freshness, CI, family validation, and remediation;
  every accepted finding was converted into a regression or artifact update.
- [evidence: `vite.config.ts`, `.github/workflows/ci.yaml`, root `AGENTS.md`;
  serial CI 17/17] Parity and all three Rust crates are standing verification
  responsibilities rather than optional local checks.

## 2. Misses

- 🔴 [blocking | evidence: verify §13] Required implementation and artifact
  files remain untracked, so the verified state cannot be reproduced from
  repository history. **Follow-up**: land the exact inventory from verify
  §13, rerun tree identity and final verification, then sync/archive.
- 🟡 [painful | evidence: journal 18:45 friction] The parallel local
  `verify:ci` graph can race `build:ts` cleanup against atomic tiers whose
  contract is to fail loud on missing prerequisites. **Follow-up**: design a
  phase-ordering solution separately; retain atomic fail-loud semantics. The
  serial canonical graph already provides deterministic 17/17 evidence.
- 🟡 [painful | evidence: journal 18:45 friction] A whole-tree Rust formatting
  probe exposed broad pre-existing v1/v2 rustfmt-version drift. **Follow-up**:
  normalize the repository's Rust formatting toolchain and baseline in a
  separate change; this change correctly limited format proof to the new
  shared-loader crate.
- 📌 [nit | evidence: journal 03:25 mode-change; verify §3] Rows 01 and 02
  retain historical `mode:inline` registry labels even though the journal
  delegated them. Their packets and merged evidence are complete, but mode
  changes should update registry metadata immediately. **Follow-up**: tighten
  the OODA schema/skill check around mode-change events.

Verify §9 found no deferred dogfood gap, and verify §12 found no unresolved
delegation or journal warning. The four portfolio validation failures are
unrelated pre-existing context, not change-local misses.

## 3. Plan deviations

| Increment / row | What changed | Journal trace | Why |
| --- | --- | --- | --- |
| 01–04 | Originally inline work was dispatched to subagents. | 03:25 · mode-change | Execution was packetized and independent; the orchestrator retained shared-artifact ownership and gate responsibility. |
| 03–06, 08 | Registry modes were normalized to delegated while row 07 remained inline. | 15:41 · mode-change / reorientation | Their semantic decisions were settled; row 07 still owned unresolved oracle and loader decisions. |
| 08 | A new warn-diagnostic consumer row was spawned. | 03:50 · friction / spawn; 15:41 · signal | Row 01 proved warnings reached manifests but not developer-visible plugin channels. |
| 05 | The selector-order fork resolved to removal rather than wiring. | 03:25 · signal; 15:41 · reorientation | The authored-config probe found no non-default consumer use. |
| 06 → 07 | Physical retirement work moved to the final row after a deliberate RED established the final divergence set. | 17:25 · signal / FULL reorientation | Oracle and loader mechanics could only be decided against the final live-v1 evidence. |
| 07 | Oracle inversion expanded from a retirement step into exact content-addressed baselines, atomic refresh, shared loader ownership, and CI/task policy. | 17:25 and 18:45 · FULL reorientations | The final divergence set and review findings showed that artifact-wide licenses and ordinary snapshot writes were too permissive. |

No plan deviation lacks a journal trace.

## 4. Skill / workflow compliance

| Skill / workflow | Used |
| --- | --- |
| `using-superpowers` | ✓ |
| `brainstorming` | ✓ |
| `writing-plans` (per increment packets) | ✓ |
| `executing-plans` | ✓ |
| `test-driven-development` | ✓ |
| `systematic-debugging` | ✓ |
| `dispatching-parallel-agents` / `subagent-driven-development` | ✓ |
| OpenSpec apply and independent verify workflows | ✓ |
| `verification-before-completion` | ✓ |

### Deliberately Skipped Skills

None. No required skill or workflow step was deliberately skipped.

## 5. Surprises (journal triage)

| Journal entry (timestamp · increment) | Triage | Note |
| --- | --- | --- |
| 03:50 · inc 01 | confirmed | Removing a component's only declaration changed fragment-key sets as well as sheet values. This widened the exact oracle's structural and per-artifact comparison surfaces. |
| 03:50 · inc 01 | confirmed | Alias warnings exist in production before reconciliation removes the carrying component. Diagnostics are therefore compared and baselined in both modes, and row 08 made them developer-visible. |
| 04:05 · inc 02 | confirmed | The single v1 empty-error arm had two v2 mirrors. Both now use the bail helper and have independent corpus witnesses. |
| 16:16 · inc 04 | contextualized | The first `transforms.` witness accidentally introduced invalid selector syntax. Moving the literal to `defaultVariant` isolated import selection and left only the intended transformed-code difference. |

Unlogged surprises discovered now: none.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **Composite verification needs explicit phase ordering without
  weakening atomic-tier preconditions** → **Promote to** `specs-arch`
  > **Why**: The parallel local CI graph raced TypeScript output cleanup
  > against tiers intentionally designed to reject missing upstream artifacts.
  > **How to apply**: In a follow-up task-graph change, model build and verify
  > phases explicitly while keeping every atomic tier read-only toward its
  > prerequisites.

- [ ] 📌 **A journaled mode change should update the registry mode in the same
  checkpoint** → **Promote to** schema
  > **Why**: Rows 01 and 02 remained historically labeled inline despite clean
  > delegated execution, forcing verify-time reconciliation.
  > **How to apply**: Add an OODA registry-lint/schema check that joins
  > `mode-change` events to the affected task rows before the next tick.

- [ ] 🟡 **Rust formatting proof needs one repository-wide pinned toolchain and
  a normalized baseline** → **Promote to** one-off
  > **Why**: A whole-tree format probe found unrelated v1/v2 drift, preventing
  > the broad check from serving as precise change evidence.
  > **How to apply**: Schedule a dedicated formatting-normalization change,
  > pin the formatter source of truth, and thereafter require the whole-tree
  > check for Rust edits.

> Unchecked items carry to the next cycle's retro. When writing the next
> retro, pull prior unchecked candidates from
> `openspec/changes/archive/*/retrospective.md` and decide per item: carry
> forward, promote now, or mark stale.

> Forward-pointer policy: never rewrite past claims; append
> `> **Update YYYY-MM-DD**: §X superseded by <follow-up>`.
