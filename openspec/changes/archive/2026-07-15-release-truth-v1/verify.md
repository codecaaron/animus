# Verification Report(s)

> Produced after apply completes, to confirm the implementation matches
> specs / design / registry / increments / journal. Failed checks must be
> fixed in the corresponding artifact, then re-run verify. Evidence is
> artifact + journal state — this schema mutates no version control; the
> tree-identity line below is read-only evidence.
>
> This file may hold MULTIPLE reports, newest LAST, each self-contained
> under a `## Report:` header. A verifier re-running replaces their OWN
> report; a different verifier APPENDS — never overwrite another verifier's
> report. Completion = the NEWEST report's Overall Decision is not FAIL.
> Where another agent/session is available, the verifier is NOT the
> implementer; under degraded topology self-verify is allowed — note it.
>
> Severity vocabulary: FAIL (artifact wrong) · EVIDENCE-GAP (the record
> cannot be trusted as-is — blocks archive until recorded or reconciled) ·
> WARN (process debt or drift — noted, never blocks). Do not launder
> evidence gaps as warnings.

## Report: independent-verifier (opus subagent) · 2026-07-14 22:13

**Change**: `release-truth-v1`
**Verified at**: `2026-07-14 22:13`
**Verifier**: `independent-verifier (opus subagent)` — NOT the implementer (independent pass; implementation was authored by the orchestrator + delegate subagents recorded in journal.md)
**Tree identity** (read-only; consumed by archive's conformance check):
`feat/random` @ `5a954c0`
**Dirty state**: **dirty** — `git status --short` inventory below (§13) + patch fingerprint `git diff --binary | shasum -a 256` =
`5d558e366fd9fa6c8896334e21922d30ac11314e7602061c35393665a5f890f0`
(archive requires this exact patch to land AND all untracked new files present — see §13; **the fingerprint covers only tracked-file modifications, NOT untracked new files** such as `scripts/verify/packed.sh`, `packages/_assertions/src/receipt.ts`, `packages/extract/index-v2.d.ts`, `e2e/packed-app/**`. Fingerprint-match alone is therefore insufficient for the conformance check; archive must confirm a **clean tree at the landed SHA**.)

---

## 1. Structural Validation

- [x] TARGETED (hard gate): `openspec validate release-truth-v1 --json` reports
      `"valid": true`
- [x] Repo-wide (context): `openspec validate --all --json` run and
      reported; failures in UNRELATED open changes classified as warnings

**Result:**

```text
TARGETED: { "id": "release-truth-v1", "type": "change", "valid": true, "issues": [] }

REPO-WIDE: 131 items, 127 passed, 4 failed (changes 6/7, specs 121/124):
  - color-mode-palette (spec)          — requirements[4],[5] missing scenarios
  - content-migration (spec)           — missing "## Purpose" section
  - enforce-workspace-topology (change)— no deltas found (empty specs/)
  - responsive-shell-layout (spec)     — requirements[6],[7],[8] missing scenarios
All four are UNRELATED to release-truth-v1's capabilities. Cross-checked:
none touch this change's five capability headers; enforce-workspace-topology
(the one open change among them) has no delta overlap with this change.
```

| Item                             | Type   | Issues                       | Blocks this change?          |
| -------------------------------- | ------ | ---------------------------- | ---------------------------- |
| release-truth-v1                 | change | none (`valid: true`)         | no                           |
| color-mode-palette               | spec   | missing scenarios            | no (unrelated open work)     |
| content-migration                | spec   | missing Purpose              | no (unrelated open work)     |
| enforce-workspace-topology       | change | no deltas                    | no (unrelated open change)   |
| responsive-shell-layout          | spec   | missing scenarios            | no (unrelated open work)     |

---

## 2. Registry Completion (`tasks.md`)

- [x] Registry lint clean:
      `node openspec/schemas/ooda/scripts/registry-lint.mjs openspec/changes/release-truth-v1`
- [x] Every registry / cross-cutting line is `- [x]` (7 rows + 1 cross-cutting; no retired lazy rows)
- [x] Every ticked line carries `· ticked: <ts>` and the cited journal entry EXISTS
- [x] Open `gate:ops` lines: none exist

```text
registry-lint: 0 error(s), 0 warning(s) — 7 registry row(s), 1 cross-cutting row(s)
```

Ticked-timestamp → journal reorientation cross-check (all EXIST):

| Row | ticked    | Journal reorientation entry present |
| --- | --------- | ----------------------------------- |
| 01  | 20:29     | `20:29 · inc 01 · reorientation` ✓  |
| 02  | 21:41     | `21:41 · inc 02+07 · reorientation` ✓ |
| 07  | 21:41     | `21:41 · inc 02+07 · reorientation` ✓ |
| 04  | 21:56     | `21:56 · inc 04+05 · reorientation` ✓ |
| 05  | 21:56     | `21:56 · inc 04+05 · reorientation` ✓ |
| 03  | 22:13     | `22:13 · inc 03+06 · reorientation` ✓ |
| 06  | 22:13     | `22:13 · inc 03+06 · reorientation` ✓ |
| 2.1 | done note | CHANGELOG.md Unreleased section (confirmed) ✓ |

**Incomplete / unevidenced lines (if any):**

| Line | Reason incomplete / tick evidence gap | Blocks archive? |
| ---- | ------------------------------------- | --------------- |
| —    | none — all rows ticked and evidenced  | no              |

---

## 3. Per-Increment Completeness

| Increment                    | Mode     | Steps done | Ledger rows flipped?      | Requirements in specs/?          | Gate complete?                | Output contract merged? (delegate) | Inputs timing OK? | Complete? |
| ---------------------------- | -------- | ---------- | ------------------------- | -------------------------------- | ----------------------------- | ---------------------------------- | ----------------- | --------- |
| 01-ci-consumer-lanes         | delegate | 5/5        | D1 (lanes half) ✓         | §release-workflow ✓ (envelope)   | none in scope ✓               | merged (journal via inc 01) ✓      | n-a (inputs: —)   | ✅        |
| 02-packed-lane               | inline   | all ✓      | D2 ✓, D4 (packed half) ✓  | §packed-consumer-verification ✓  | G2 ✓ + G4 ✓ (both STOP)       | n/a (inline)                       | n-a (inputs: —)   | ✅        |
| 03-release-gate-flip         | delegate | 3.1+3.2 ✓  | D1 (gate half) ✓          | §release-workflow ✓ (envelope)   | G1 ✓ (STOP)                   | merged (journal via inc 03) ✓      | n-a (inputs: —)   | ✅        |
| 04-peer-clamps               | delegate | 6/6        | D3 ✓                      | §peer-range-policy ✓ (envelope)  | G3 ✓ (STOP)                   | merged (journal via inc 04) ✓      | n-a (inputs: —)   | ✅        |
| 05-claude-md-ownership       | delegate | all ✓      | D5 ✓                      | §verification-tier-policy ✓      | G5 ✓ (WARN)                   | merged (journal via inc 05) ✓      | n-a (inputs: —)   | ✅        |
| 06-lane-receipts             | delegate | all ✓      | D4 (existing-lanes half)✓ | §dual-engine-build ✓ (envelope)  | none in scope ✓               | merged (journal via inc 06) ✓      | n-a (inputs: —)   | ✅        |
| 07-publish-manifest-hygiene  | delegate | 07.3.2 `[~]` | D7 ✓                    | §packed-consumer-verification ✓  | no Register guardrails; lane is the check (see note) | merged (journal via inc 07) ✓ | n-a (inputs: —) | ✅ (with recorded DEF-5 deferral) |

Notes:
- **inc 02 (inline)**: plan checkboxes + Guardrail gate + Post-review addendum are all `[x]`; the trailing "Output contract (inline mode)" and "Spec authorship checklist" boxes are left `[ ]` per the packet's explicit "inline mode — collapse into the checklists above" instruction — cosmetic, work is evidenced by the ticked plan boxes + journal. → **WARN** (see Verdicts).
- **inc 07 step 07.3.2 `[~]`**: `attw --profile node16` passes 3/5 (extract, vite-plugin, next-plugin); properties + system are BLOCKED within footprint (pure-ESM cannot pass node16-from-CJS; extensionless bundler-emit `.d.ts`). Escalated to **DEF-5** and resolved at change-level by D7's revision (per-package supported-mode contract: `esm-only` profile for the two ESM packages + a named-rule DEF-5 allowlist). Coherent early-stop-within-footprint; not a gap. Automated equivalent named in §9.
- **inc 06 footprint drift**: registry row 06 footprint corrected `packages/showcase/scripts/** → scripts/assert-showcase-build.ts` (journal 22:00). Dispositioned in-registry. → WARN.
- **Inputs timing**: every registry row carries `inputs: —` (no `inputs:` rows), so no packet can predate an input tick. n-a across the board.

---

## 4. Deferral Closure & Staleness (Decision Ledger)

| ID    | Decision                                          | Status now                                   | Resolved by / carried to                      | Review-by breached?              | OK?  |
| ----- | ------------------------------------------------- | -------------------------------------------- | --------------------------------------------- | -------------------------------- | ---- |
| DEF-1 | v2 binary distribution form                       | deferred; **resolving signal recorded** (fat-tarball receipt, journal 20:27/21:26) | external:v2-distribution-change-proposal      | no (signal arrived at inc 02, well before 3 reorientations / 2026-09-01) | ✅   |
| DEF-2 | React 19 peer claim in `system`                   | deferred (intentionally untouched — out of scope) | external:react-19-fixture-lane            | no (recorded untouched in 04+05 reorientation; 2026-10-01 distant) | ✅   |
| DEF-3 | Packed-lane installer breadth (bun/pnpm/Yarn)     | deferred, carried forward                    | external:package-manager-matrix-change        | no (2026-10-01 distant)          | ✅   |
| DEF-4 | Alternate-engine sentinels in consumer fixtures   | deferred, carried forward                    | external:engine-sentinel-selection            | no (2026-09-01 distant)          | ✅   |
| DEF-5 | node16-resolvable ESM declarations properties/sys | deferred (added mid-flight, signal-gated 21:20/21:22); allowlist ACTIVE in lane | external:typescript-toolchain-dts-emit-change | no (2026-10-01 distant; created this change) | ✅   |

No Ledger row breached its Review-by (neither reorientation count — 4 occurred, all with dispositions — nor calendar date) without a reorientation disposing of it. No silently-dropped deferrals. DEF-5 was correctly introduced with a `signal`/reorientation trail rather than smuggled in.

---

## 5. Delta Spec Sync State

| Capability                     | Namespace (behavioral / arch) | Sync state                       | Notes                                                              |
| ------------------------------ | ----------------------------- | -------------------------------- | ----------------------------------------------------------------- |
| packed-consumer-verification   | behavioral                    | N/A → needs sync (new; pre-archive) | main spec absent; ADDED creates it on archive                     |
| peer-range-policy              | behavioral                    | N/A → needs sync (new; pre-archive) | main spec absent; ADDED creates it on archive                     |
| release-workflow               | behavioral                    | needs sync (pre-archive)         | main spec EXISTS; 2 ADDED reqs merge on archive (no header dup)   |
| verification-tier-policy       | behavioral                    | needs sync (pre-archive)         | main spec EXISTS; 3 ADDED reqs merge on archive (no header dup)   |
| dual-engine-build              | behavioral                    | needs sync (pre-archive)         | main spec EXISTS; 2 ADDED reqs merge on archive (no header dup)   |

All five are the normal pre-archive "needs sync" state (sync happens at archive). Confirmed: none of the 7 ADDED requirement headers already exist in the corresponding main specs (no double-add conflict on merge).

Portfolio collision re-check: this change's `specs/` are **ADDED-only** — `rg -n "^## (MODIFIED|REMOVED|RENAMED)"` returns empty, so there is no MODIFIED/REMOVED/RENAMED header to collide. Confirmed no other open change ADDs the same headers.

| Header (MODIFIED/REMOVED/RENAMED) | Other open changes touching it | Coordination |
| --------------------------------- | ------------------------------ | ------------ |
| — (none — ADDED-only)             | n/a                            | n/a          |

---

## 6. Design / Specs Coherence Spot Check

| Sampled item | design says                                              | specs match                                                                 | Gap  |
| ------------ | ------------------------------------------------------- | --------------------------------------------------------------------------- | ---- |
| D1           | `release.needs` = 6 job ids; lanes every CI run          | §release-workflow "Release gate composition" (6 jobs) + "every CI run"       | none |
| D2           | pack 5, publint+attw, npm isolated install, dual-engine  | §packed-consumer-verification (6 requirements)                              | none |
| D3           | vite `>=8 <9`, next `>=15 <16`, webpack stays (→`>=5<6`) | §peer-range-policy Vite/Next/webpack ranges (webpack `>=5 <6`)              | none |
| D4           | JSON receipt fields (engine + package form)              | §dual-engine-build "Engine identity in verification receipts"               | none |
| D7           | per-package attw profiles; scoped DEF-5 exemption        | §packed-consumer-verification "Tarball export and type lint" (scoped clause)| none |

**Drift warnings (non-blocking):** none. (Note: proposal.md labels release-workflow/verification-tier-policy/dual-engine-build as "Modified Capabilities" while the deltas are `## ADDED Requirements` to those existing capabilities — this is correct OpenSpec semantics, not drift.)

---

## 7. Implementation Completeness

- [x] No increment file has zero progress while its registry row is ticked
- [x] Every authored requirement has at least one `#### Scenario:` (confirmed via `openspec validate` `valid:true` + manual read of all five delta specs)

**Contradictions / gaps:** none.

---

## 8. Front-Door Routing Leak Detector (warning, non-blocking)

```bash
ls docs/superpowers/specs/*.md 2>/dev/null   # no matches
ls docs/superpowers/plans/*.md 2>/dev/null   # no matches
```

- [x] No files — no leaks.

| File | Content already captured in change? | Suggested action |
| ---- | ----------------------------------- | ---------------- |
| —    | —                                   | —                |

---

## 9. Deferred Dogfood vs Automated-Test Equivalence

| Deferred check (increment §)                                        | Equivalent automated test                                                                                                       | Coverage assessment                                                                                              | Real gap? |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------- |
| inc 07 §07.3.2 `[~]` — manual `attw --profile node16` sweep, all 5  | `verify:packed` tarball-lint stage (`scripts/verify/packed.sh`): per-package `attw` (`node16` for extract/vite-plugin/next-plugin, `esm-only`+DEF-5 allowlist for properties/system) + `publint --strict` for all five, CI-blocking | **Superset**: the automated lane applies the D7-correct per-package profile the manual uniform sweep could not; it is gating in CI (release.needs). Observed running: log shows all five publint + all five attw stages. | **no** — residual node16-from-ESM defect for properties/system is tracked as DEF-5 with allowlist removal tied to it |

§9 does not block (not empty; `[~]` row has a named superset automated equivalent).

---

## 10. Spec Taxonomy & Leakage Lint (BLOCKING)

```text
Lint 1 (SHALL use|adopt|leverage, outside arch-*):  (empty)
Lint 2 (because|as decided|we chose|per the design): (empty)
Lint 3 (\bD[0-9]+\b | Decision Ledger):              (empty)
```

- [x] Lint 1: empty
- [x] Lint 2: empty
- [x] Lint 3: empty

No Lint-1 matches → no dependency cross-check dispositions required.

Admission-test samples (this change has no `arch-*` capabilities — all five are behavioral; the architectural row is n/a):

| Sampled requirement                                                        | Namespace  | Test applied                                             | Passes? |
| -------------------------------------------------------------------------- | ---------- | ------------------------------------------------------- | ------- |
| §packed-consumer-verification/Isolated non-workspace installation          | behavioral | black-box: no-symlink + installed-version==packed-version, verifiable without reading lane source — proven live (§13 evidence: G2 empty, versions match) | ✅ |
| §peer-range-policy/Vite host peer range (`>=8 <9`)                          | behavioral | black-box: manifest value + npm ERESOLVE on off-major, verifiable from install output | ✅ |
| §arch-*/…                                                                   | architectural | n/a — no arch-* capability in this change            | n/a     |

---

## 11. Guardrail Gate History (BLOCKING)

| Increment                   | In-scope guardrails | Final gate result | Trips journaled? | OK?  |
| --------------------------- | ------------------- | ----------------- | ---------------- | ---- |
| 01-ci-consumer-lanes        | none in scope       | n-a               | n-a (no trips)   | ✅   |
| 02-packed-lane              | G2, G4 (STOP)       | pass, pass        | n-a (no trips)   | ✅   |
| 03-release-gate-flip        | G1 (STOP)           | pass              | n-a (no trips)   | ✅   |
| 04-peer-clamps              | G3 (STOP)           | pass              | n-a (no trips)   | ✅   |
| 05-claude-md-ownership      | G5 (WARN)           | pass              | n-a (no trips)   | ✅   |
| 06-lane-receipts            | none in scope       | n-a               | n-a              | ✅   |
| 07-publish-manifest-hygiene | none from Register  | n-a (lane is the check) | n-a        | ✅   |

No ticked row has an unrun or failed STOP gate. No `guardrail-trip` entries required (no trips occurred; all recalibrations were expected-state adjustments recorded in the Register Status column, not trips).

Scope-token validity + change-end runs:

- [x] Every Register row's Scope parses against the closed set: G1=`all` ✓, G2=`inc:02` (names real row 02) ✓, G3=`all` ✓, G4=`change-end` ✓, G5=`change-end` ✓
- [x] Every `change-end`-scoped check recorded below (G4 cited from record per verifier instruction — destructive `mv` skipped; G5 run now)

| Guardrail | Scope token valid? | change-end result (if applicable)                                                                                             |
| --------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| G1        | ✓ (all)            | RUN NOW: `release.needs: [lint, hygiene-rust, verify, verify-next, verify-vite, verify-packed]` — all six ids — **PASS**       |
| G2        | ✓ (inc:02)         | RUN NOW (post-lane, staging present): `find … -type l` empty — **PASS**; installed `@animus-ui/*` are real dirs, versions match |
| G3        | ✓ (all)            | RUN NOW: `rg '"(vite\|next\|webpack)": ">=[0-9.]+"'` empty — **PASS** (clamps `>=8 <9` / `>=15 <16` / `>=5 <6`)                |
| G4        | ✓ (change-end)     | CITED (destructive mv skipped per verifier instruction): packet 02 gate + journal 21:41 record vp exit=1, exact `ERROR: packages/system/dist/ missing. Run: …`, zero downstream stages, no rebuild — **PASS** |
| G5        | ✓ (change-end)     | RUN NOW: `rg -c "verify:packed" CLAUDE.md` = **4** (>= 2) — **PASS**                                                          |

---

## 12. Journal & Delegation Coherence

- [x] Every guardrail-trip / spawn / mode-change event has a journal entry (spawn of row 07 recorded 20:28; no trips; no mode changes)
- [x] Every increment file is envelope-licensed (seed entry 20:18 names rows 01–06) OR has a preceding `signal`: row 07 has spawn (20:28) + resolving-signal citation
- [x] Reorientation entries exist per cadence K=3: 20:29, 21:41, 21:56, 22:13 (four passes; K=3 + STOP-trip/surprise triggers all present)
- [x] Every FULL adversarial pass shows all three stances with objections-or-evidence-backed-zero:
      - 20:29 — falsifier + entropy auditor + heretic; 2 objections
      - 21:41 — falsifier (F1–F4) + entropy auditor (E1 evidence-backed zero, E2, E3) + heretic (H1–H3); 9 objections
      - 21:56 — falsifier + entropy auditor + heretic; 7 objections
      - 22:13 — falsifier (release-gate zero, evidence-backed) + heretic + entropy auditor; 2 accepted + notes
- [x] Every objection has a disposition (accepted → fix, rejected → reason, note/intentional recorded); no evidence-free "zero"
- [x] **BLOCKING**: every DELEGATED ticked row (01, 03, 04, 05, 06, 07) has its output contract recorded merged (packet "Output contract" sections + journal entries attributed `via inc NN subagent`, appended by the orchestrator per the stated SINGLE-WRITER RULE). No evidence of subagent writes to design.md / tasks.md / journal.md / specs/ — all subagent contributions are orchestrator-merged proposals.

**Gaps found:** none.

---

## 13. Packaging & Change Boundary (read-only — what ships, not what the dirty tree shows)

```text
git status --short:
 M .github/workflows/ci.yaml
 M .gitignore
 M CHANGELOG.md
 M CLAUDE.md
 M bun.lock
 M e2e/next-app/scripts/assert-build.ts
 M e2e/vite-app/scripts/assert-build.ts
 M package.json
 M packages/_assertions/src/index.ts
 M packages/extract/package.json
 M packages/extract/tsdown.config.ts
 M packages/next-plugin/package.json
 M packages/properties/tsdown.config.ts
 M packages/vite-plugin/package.json
 M packages/vite-plugin/tsdown.config.ts
 M scripts/assert-showcase-build.ts
 M scripts/verify/_preconditions.sh
 M vite.config.ts
?? e2e/packed-app/
?? openspec/changes/release-truth-v1/
?? packages/_assertions/__tests__/receipt.test.ts
?? packages/_assertions/src/receipt.ts
?? packages/extract/index-v2.d.ts
?? scripts/verify/packed.sh
```

- [ ] No untracked file is imported/referenced by tracked code/config — **VIOLATED in the literal sense, but see classification**: multiple untracked new files ARE referenced by modified (tracked) files. Because the referencing files are themselves modified-and-uncommitted, the whole change is one coherent atomic unit — at `HEAD` (5a954c0) there is NO dangling reference. Not an independent evidence gap beyond the known uncommitted-implementation postpone, **provided all files land atomically**.
- [x] Generated-only untracked files: none (all untracked files are hand-authored sources or change artifacts)
- [x] Every modified file OUTSIDE all registry footprints has a disposition below
- [x] Tree is dirty: inventory + patch fingerprint recorded in header (with the explicit untracked-not-covered caveat)

Untracked reachability:

| Untracked file                                | Referenced by tracked code/config?                                            | Classification            | Severity |
| --------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------- | -------- |
| `scripts/verify/packed.sh`                    | yes — `vite.config.ts` `run.tasks['verify:packed'].command`                    | needed-by-implementation  | see note |
| `packages/_assertions/src/receipt.ts`         | yes — `packages/_assertions/src/index.ts` `export * from './receipt'`          | needed-by-implementation  | see note |
| `packages/_assertions/__tests__/receipt.test.ts` | yes — run by `verify:unit:ts` glob                                          | needed-by-implementation  | see note |
| `packages/extract/index-v2.d.ts`              | yes — `packages/extract/package.json` `files` + `exports["./engine-v2"]`        | needed-by-implementation  | see note |
| `e2e/packed-app/**`                            | yes — copied/staged by `scripts/verify/packed.sh`; the committed consumer template | needed-by-implementation | see note |
| `openspec/changes/release-truth-v1/**`         | no (change artifacts / process record, not shipped code)                       | process-record            | —        |

**Note (the one EVIDENCE-GAP, recorded, reconciling with the postpone):** every "needed-by-implementation" untracked file above must land in the SAME commit(s) as the tracked modifications. Since `git diff --binary` (the recorded fingerprint) does **not** capture untracked content, **fingerprint-match alone cannot prove the change shipped whole.** Archive's conformance check MUST verify a **clean tree at the landed SHA** (not merely that the fingerprint landed). This is RECORDED here; it does not add a blocker beyond the already-required uncommitted-implementation postpone, but it constrains HOW archive verifies conformance.

Foreign diffs (files modified outside every registry row's footprint):

| File                    | In a registry footprint?                              | Classification         | Action                                    |
| ----------------------- | ----------------------------------------------------- | ---------------------- | ----------------------------------------- |
| `bun.lock`              | side-effect of inc 02 footprint (root `package.json` devDeps: `bun add -d publint attw`) | adjacent-intentional (lockfile) | owned — lands with inc 02 |
| `CHANGELOG.md`          | cross-cutting row 2.1 (release-notes callout)          | owned                  | lands with 2.1                            |
| all other modified files | yes — each maps to a declared registry footprint (see §3 per-increment) | owned                  | —                                         |

No foreign diff the implementation needs is left unowned. No `ambient-branch-drift` detected (no pre-existing unrelated modifications).

---

## 14. Review-Finding Intake

Aggregated from the four adversarial reviewer passes recorded in journal.md (20:29, 21:41, 21:56, 22:13). All dispositioned — none survive as ambient memory.

| ID    | Finding                                                                                   | Source              | Disposition                        | Evidence                                                                 | Follow-up            |
| ----- | ----------------------------------------------------------------------------------------- | ------------------- | ---------------------------------- | ------------------------------------------------------------------------ | -------------------- |
| RF-1  | "consumer lanes run on every push" overclaims (branches gate CI trigger)                  | falsifier (inc 01)  | accepted                           | spec reworded to "every CI run" (release-workflow)                        | none (fixed)         |
| RF-2  | setup skeleton triplicated → matrix job would collapse it                                 | heretic (inc 01)    | rejected (house style)             | matches existing verify-job convention; consolidation is a follow-up     | candidate follow-up  |
| RF-3  | registry platform packages leak into staging via optionalDependencies (isolation clause)  | falsifier F1 (02+07)| accepted                           | defense-in-depth pin to 5 packed + declared optionals; §13 shows extract-darwin-arm64 is a declared optional | none (fixed) |
| RF-4  | engine-binary-missing scenario untested; v1 silently falls back to registry               | falsifier F2 (02+07)| accepted                           | fault-injection proof recorded in packet 02 (v1/v2 both throw, restore)  | none (fixed)         |
| RF-5  | receipt `engineLoaded:'v2'` hardcoded literal — asserted not measured                     | falsifier F3 (02+07)| accepted                           | receipt now derives from staged config + installed plugin (measured)     | none (fixed)         |
| RF-6  | DEF-5 allowlist is blanket per-package; masks a NEW internal-resolution regression         | falsifier F4 (02+07)| intentional (recorded)             | attw has no per-path scoping; blast radius in D7; bundler mode still gates | DEF-5                |
| RF-7  | spec "Type resolution violation detected" overclaimed node16 gating for allowlisted pkgs  | entropy E2 (02+07)  | accepted                           | requirement reworded to per-package supported modes + scoped exemption   | none (fixed)         |
| RF-8  | `_preconditions.sh` "properties is CJS" comment wrong                                      | entropy E3 (02+07)  | accepted                           | comment fixed                                                            | none (fixed)         |
| RF-9  | ESM→CJS-only plugin conversion is tail-wagging-dog (asymmetric with properties/system)    | heretic H2 (02+07)  | rejected (revisit under DEF-5)     | next-plugin loader is genuinely CJS; conversion fixed publint; lanes green | revisit at DEF-5     |
| RF-10 | peer-conflict scenarios true for npm, false for bun (repo's primary PM)                    | falsifier (04+05)   | accepted                           | scenarios reworded to "peer-enforcing package manager", npm named ref    | none (fixed)         |
| RF-11 | Change-Type glob `packages/*/package.json` over-matched; `webpack:">=5.0.0"` escaped G3    | falsifier+heretic (04+05) | accepted                     | map row scoped to 5 publishables; webpack clamped `>=5 <6`; G3 regex extended | none (fixed)      |
| RF-12 | CLAUDE.md verify:ci row forward-referenced a packed CI job not yet present                 | entropy (04+05)     | accepted (sequencing disposition)  | resolved when inc 03 landed the verify-packed job (now TRUE — G1 confirms) | none (closed at 03)  |
| RF-13 | `engineLoaded` non-override branch was literal `'v2'` in all three assert scripts          | falsifier (03+06)   | accepted                           | scripts capture both config arms + fallback; re-proven + env-flip        | none (fixed)         |
| RF-14 | receipts written into gitignored dirs, never uploaded in CI (write-and-discard)           | heretic (03+06)     | accepted                           | `actions/upload-artifact` steps added to all four lane jobs; YAML re-validated | none (fixed)     |
| RF-15 | build-time-vs-assert-time engine skew (standalone assert against stale build)             | falsifier (03+06)   | intentional (note-only)            | real but requires split invocation; acknowledged                        | none                 |

No undispositioned finding remains → no §14 evidence gap.

---

## Implementation evidence (manual QA appendix)

| Driven action / command                                    | Observed                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `bunx vp run verify:lint`                                  | exit 0 — oxlint clean; oxfmt "All matched files use the correct format" (425 files)                                  |
| `bunx vp run verify:unit:ts`                               | exit 0 — 20 files, **219 tests passed** (includes new `receipt.test.ts`; matches journal's "219 tests green")        |
| `bunx vp run verify:packed`                                | exit 0 — receipts `verify:packed:vite=v2, verify:packed:next=v2`; `[packed-app:assert] all assertions passed`       |
| verify:packed lane stages (from log)                       | publint 5/5; attw extract/vite-plugin/next-plugin `--profile node16` "No problems found"; properties/system `--profile esm-only` DEF-5 allowlist (`internal-resolution-error` ignored); "isolation + version assertions ok" |
| G1 `rg "^  release:" -A2 ci.yaml`                          | `needs: [lint, hygiene-rust, verify, verify-next, verify-vite, verify-packed]` — six ids                            |
| G2 `find …/.staging/node_modules/@animus-ui -type l`       | empty; installed `@animus-ui/*` are real dirs; `extract-darwin-arm64` present = declared optional of packed extract  |
| G3 `rg '"(vite\|next\|webpack)": ">=[0-9.]+"'`             | empty — clamps `>=8 <9` / `>=15 <16` / `>=5 <6`                                                                      |
| G5 `rg -c "verify:packed" CLAUDE.md`                       | 4 (>= 2)                                                                                                             |
| receipt content (`.staging/receipts/packed.json`)          | two objects, measured `engineLoaded/engineDefault=v2`, `engineOverride:false`, `packageForm:packed`, host versions 8.1.4 / 15.5.20 |

---

## Verdicts

- **Artifact verdict** (do the records match reality): **PASS WITH WARNINGS**
- **Implementation verdict** (is the built thing viable/complete): **PASS** — full gate green locally (verify:lint, verify:unit:ts, verify:packed all exit 0; G1–G5 all pass); the 2/5 `attw --profile node16` shortfall for properties/system is the *designed* supported-mode contract (D7: `esm-only` profile) with a named, scoped DEF-5 allowlist, not an implementation defect.
- **Rollout verdict**: **clear** — no `gate:ops` rows, no OPS-`<n>` runbook steps; the peer-clamp breaking-change is called out in CHANGELOG Unreleased (cross-cutting 2.1).
- **Archive decision**: **postpone archive** — reason: the entire implementation is uncommitted working-tree state on `feat/random`; this schema performs no VCS actions, so archive's read-only conformance check (`git merge-base --is-ancestor <sha> main`) cannot pass until the branch lands on `main`. Additionally, because untracked new files are not captured by the patch fingerprint (§13), archive must confirm a **clean tree at the landed SHA**, not a fingerprint-match alone.

## Overall Decision (= the Artifact verdict; the retro precheck gates on this line)

- [ ] ✅ PASS — records match reality
- [x] ⚠️ PASS WITH WARNINGS — proceed, but note: records match reality and every gate is green; WARNs are process-debt/portfolio-hygiene only (inc 02 inline-mode checklist cosmetics; inc 06 footprint-drift already corrected in-registry; 4 unrelated repo-wide validation failures; bun.lock lockfile side-effect). One recorded EVIDENCE-GAP — untracked new files are not covered by the patch fingerprint — reconciles with the mandatory uncommitted-implementation postpone and constrains archive to verify by clean-tree-at-SHA.
- [ ] ❌ FAIL — fix the failing artifact and re-run verify

**Next step:**

1. Land `feat/random` on `main` as one atomic unit — **all** tracked modifications AND all untracked new files (`scripts/verify/packed.sh`, `packages/_assertions/src/receipt.ts` + its test, `packages/extract/index-v2.d.ts`, `e2e/packed-app/**`) together; a partial commit of only the tracked diff would leave CI unable to see the lane script/template (correct-but-unshippable).
2. At archive time run the read-only conformance check as **clean-tree-at-SHA** (not fingerprint-match — the fingerprint omits untracked content).
3. Guardrail promotion to specs/arch-* : n/a — this change authors behavioral specs only; the guardrails are release-gate invariants already reflected in §release-workflow / §peer-range-policy / §verification-tier-policy.
4. No open `gate:ops` rows → no ops-runbook check required.
5. Cross-change collision block: clear (ADDED-only; no header collisions with the six other open changes).
6. DEF-5 allowlist (`attw --ignore-rules internal-resolution-error`, properties/system only) is intentional and recorded — remove it when the typescript-toolchain declaration-emit change lands; it does not block this archive.
7. Then `openspec archive -y release-truth-v1` — only after step 1 lands (apply step 5).

---

## Report: `/root/nightly_openspec_reviewer` · 2026-07-15 portfolio verification

**Tree identity**: `feat/random` @ `18b7bcde8c63`
**Tracked fingerprint before this report**:
`2a03ca3e3d249c6ee724c52c43971d46f91c3c9a15975728b437541b37f035b0`

The fingerprint excludes untracked files and this appended report. Archive
requires a clean landed SHA rather than fingerprint equality alone.

### Current structural, registry, and deferral result

- `openspec validate --all --json`: **140/140 pass**; prior unrelated validation
  warnings are resolved at the current portfolio state.
- Registry lint: **0 errors, 0 warnings**; seven increments plus the release-note
  row remain complete.
- DEF-1 through DEF-5 remain explicitly signal-gated with their owners and
  review dates. No deferred package-manager, React, engine-sentinel, binary-form,
  or declaration-mode claim is promoted without evidence.

### Current sync, coherence, and gates

- All five delta capabilities are included in the completed six-change
  sequential sync into 25 main capabilities; deterministic second merge:
  **zero byte differences**.
- The six release blockers remain exactly lint, Rust hygiene, core verify,
  Next, Vite, and packed verification; Worker deployment remains nonblocking.
- Fresh `bunx vp run verify:ci`: **29/29 tasks**, exit 0. The run includes 222 TS
  tests, Rust units/hygiene, canary, parity **48/48** in both modes plus seam,
  integration, all Worker lanes, and the five-tarball packed lane with
  publint/attw, isolated supported-mode loading/types, and Vite/Next assertions.

### Boundary and review intake

**EVIDENCE-GAP**: required new verification/follow-up/spec files and other
referenced untracked inventory are absent from the tracked fingerprint. The
complete inventory and this report must land together.

`18b7bcde8c63` is not an ancestor of `main`. Current evidence closes the prior
process/validation warnings and exposes no new change-local finding, but does
not establish archive conformance.

### Verdicts

- **Artifact verdict**: **PASS**.
- **Implementation verdict**: **PASS**.
- **Rollout verdict**: **clear**.
- **Archive decision**: **POSTPONE** — land the complete inventory on `main`
  and rerun verification on a clean landed SHA.

## Overall Decision

**PASS** — release records and implementation agree at current HEAD; archive
remains postponed only for reproducible-tree/mainline conformance.
