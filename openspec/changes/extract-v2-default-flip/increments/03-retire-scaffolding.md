# Increment 03: retire-scaffolding

## Scope

- **Registry row**: 03 · mode: inline · review: self
- **Resolves** (Decision Ledger rows): — (implements D3)
- **Authors** (spec requirements): — (no spec deltas; retirement of
  provably-dead surfaces)
- **Depends on (ordering — deps:)**: increment 02
- **Inputs from (information — inputs:)**: increment 02 — consumes: the
  flip landed (v2 default in both plugins + fixtures); DEF-1 resolved →
  D4 (accept-and-document), so the Proxy's guarded surfaces are all
  implemented and its fate is sealed as removable.
- **Footprint**: packages/extract/index-v2.js,
  openspec/changes/archive/2026-07-13-extract-v2-spine/tools/**,
  openspec/changes/extract-v2-default-flip/**
- **Pushes to a later increment**: none

> Resolving signal that licensed creating this increment now: DEF-1 —
> journal `signal` entry 2026-07-13 03:20 (resolved ACCEPT-AND-DOCUMENT
> → D4 at increment 02's review, the ledger's designated alternate
> signal).

## Context Capsule

- **Objective**: The `index-v2.js` fail-loud NOT_IMPLEMENTED Proxy is
  removed (every surface it guarded — extract, analyzeProject,
  transformFile, clearAnalysisCache, loadSystemModule — is implemented
  or intentionally v1-routed by the adapters); the module exports the
  native binding directly while keeping the fail-loud missing-binary
  error. The three archived change-local parity tools subsumed by the
  3-leg `verify:parity` tier (code-parity.ts, css-parity.ts,
  chain-parity.ts) are retired from the archive with a RETIRED note so
  the archive stays self-explanatory.
- **In-scope guardrails** (from design.md Register):
  - G1: SHALL NOT weaken verify:parity — check:
    `rg -c 'cli.ts|seam-battery' scripts/verify/parity.sh` (>=5) and
    `bash scripts/verify/parity.sh | tail -1` = `PARITY GATE: PASS` — STOP
  - G2: SHALL NOT remove v1 or its loader — check:
    `test -f packages/extract/index.js && test -f packages/extract/src/lib.rs && rg -q 'load_system_module' packages/extract/src/lib.rs` — STOP
  - G3: postpack smoke — check: `bash scripts/verify/postpack-smoke.sh` — STOP
- **Requirements to draft**: none.
- **Existing spec context**: none touched.
- **Relevant resolved decisions**: D3 (retire archived change-local
  tools + the index-v2.js Proxy; keep everything the harness or plugins
  touch); D4 (A3 accepted — adapters intentionally route
  loadSystemModule to v1; the v2 module no longer needs a fail-loud
  Proxy for it because the adapters never ask the v2 module for it).
- **Upstream inputs**: from 02 — flip landed; both plugins' engineApi
  adapters call only implemented v2 surfaces (ExtractEngine handle) and
  route loadSystemModule to v1 explicitly.
- **In-scope North Star criteria**: NS1 (consumers observe nothing);
  NS2 (harness untouched — the retired tools are exactly the ones the
  3-leg tier subsumed; `packages/_parity/tools/seam-battery.ts` is
  harness, NOT in scope).
- **Prohibitions**: no version-control commands; no writes outside the
  footprint plus this file. Do NOT touch `packages/_parity/**`,
  `scripts/verify/parity.sh`, or archive files other than the three
  named tools (+ the RETIRED note).
- **Ground truth (verified 2026-07-13)**:
  - `packages/extract/index-v2.js`: header says "(skeleton)"; Proxy
    wraps `native` with a NOT_IMPLEMENTED list whose error text points
    at `openspec/changes/extract-v2-spine` (stale — archived) and says
    "keep engine: 'v1'" (stale — v2 is default post-flip).
  - Archive tools dir
    `openspec/changes/archive/2026-07-13-extract-v2-spine/tools/`
    contains: analyze-run.ts, chain-parity.ts, code-parity.ts,
    css-parity.ts, determinism-check.sh, determinism-run.ts,
    evidence-prepatch-diff.txt. D3/brainstorm name code/css/chain-parity
    as the subsumed retire-set; determinism + analyze + evidence files
    stay (evidence basis, not scaffolding).
  - `rg -ln 'chain-parity|code-parity|css-parity' --glob '!openspec/changes/archive/**'`
    matches only this change's brainstorm.md — no living code or script
    references the retired tools.

## Plan

## Task 03.1: index-v2.js Proxy retirement

- [x] **Step 1:** Replace the module tail of
  `packages/extract/index-v2.js`: delete the `NOT_IMPLEMENTED` array and
  the `module.exports = new Proxy(...)` block; export the native binding
  directly with `module.exports = loadNative();` (drop the intermediate
  `const native`).
- [x] **Step 2:** Update the header comment: drop "(skeleton)" and the
  not-yet-implemented-surface language; keep the fail-loud
  missing-binary contract line.
- [x] **Step 3:** Probe: `node -e "const m = require('./packages/extract/index-v2.js'); console.log(typeof m.ExtractEngine)"`
  — expected: `function`.

## Task 03.2: archived-tool retirement

- [x] **Step 1:** Delete
  `openspec/changes/archive/2026-07-13-extract-v2-spine/tools/code-parity.ts`,
  `.../tools/css-parity.ts`, `.../tools/chain-parity.ts`.
- [x] **Step 2:** Create `.../tools/RETIRED.md` noting: retired
  2026-07-13 by extract-v2-default-flip increment 03 per its design D3;
  code/css/chain-parity subsumed by the 3-leg `verify:parity` tier
  (`scripts/verify/parity.sh` + `packages/_parity`); remaining files are
  evidence/determinism artifacts kept as the archive's evidence basis.

## Task 03.3: proofs

- [x] **Step 1:** `bash scripts/verify/postpack-smoke.sh` — expected:
  `both engines load` (G3).
- [x] **Step 2:** `vp run verify:vite` — expected: green (v2 default
  path exercises the un-proxied module end-to-end).
- [x] **Step 3:** G1 + G2 commands — expected: pass.

## Guardrail gate

- [x] G1: parity count >=5 AND `PARITY GATE: PASS` — result: pass (count=6; `PARITY GATE: PASS`, 2026-07-13 03:28)
- [x] G2: v1 + loader present — result: pass (exit 0, 2026-07-13 03:28)
- [x] G3: postpack smoke — result: pass (`both engines load`, 2026-07-13 03:27)

## Output contract (inline mode — collapsed into the checklists above)

- [x] Plan checkboxes ticked to reflect actual completion
- [x] Guardrail gate results recorded
- [x] Proposed journal entries: retirement entry appended
- [x] Surfaced variables: none

## Spec authorship checklist (orchestrator)

- [x] No spec authorship at this row
- [x] No Ledger rows flip at this row (D3 was decided-now)
- [x] Journal entries appended
- [x] Reorientation per cadence (off-beat: entropy auditor)
- [x] Ticked registry row 03 in tasks.md with `· ticked: 2026-07-13 03:29`
