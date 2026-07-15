# Increment 04: peer-clamps

## Scope

- **Registry row**: 04 · mode: delegate · review: subagent
- **Resolves**: D3
- **Authors**: — (envelope: all §peer-range-policy requirements already
  authored)
- **Depends on (ordering — deps:)**: none
- **Inputs from (information — inputs:)**: none
- **Footprint**: `packages/vite-plugin/package.json`,
  `packages/next-plugin/package.json`
- **Pushes to a later increment**: none (the release-notes callout is
  cross-cutting row 2.1)

> Resolving signal: envelope-licensed (implements decided-now D3).

## Context Capsule

- **Objective**: Clamp the two plugins' host peer ranges to the majors the
  blocking fixtures actually prove: `vite >=8 <9` and `next >=15 <16`.
  Nothing else in either manifest changes.
- **In-scope guardrails** (from design.md Register):
  - G3: peer ranges SHALL NOT contain an open-ended `>=` for vite/next —
    check:
    `rg -n '"(vite|next)": ">=[0-9.]+"' packages/vite-plugin/package.json packages/next-plugin/package.json`
    — expected: empty — STOP
- **Requirements to draft**: none — envelope covers.
- **Existing spec context**: change-level `specs/peer-range-policy/spec.md`
  (all three requirements).
- **Relevant resolved decisions**: D3 — `webpack: ">=5.0.0"` stays; React
  peers untouched (DEF-2 owns that question).
- **Repo facts a cold agent needs**:
  - Current values: `packages/vite-plugin/package.json` peerDependencies
    has `"vite": ">=5.0.0"`; `packages/next-plugin/package.json` has
    `"next": ">=14.0.0"` and `"webpack": ">=5.0.0"`. `@mdx-js/mdx` peers
    (optional) stay untouched in both.
  - Fixture evidence: `e2e/vite-app` + showcase on Vite `^8.1.4`;
    `e2e/next-app` on Next `^15.5.20` (webpack build mode).
- **In-scope North Star criteria**: NS3 (evidence precedes claims).
- **Prohibitions**: no version-control commands; no writes outside the two
  manifests and this file; never write to design.md, tasks.md, journal.md,
  or specs/ — return drafts in the output contract.

## Plan

## Task 04.1: Clamp both ranges

- [x] **Step 1:** In `packages/vite-plugin/package.json`, change the
`peerDependencies` entry:

```json
    "vite": ">=8 <9"
```

(was `">=5.0.0"`).

- [x] **Step 2:** In `packages/next-plugin/package.json`, change the
`peerDependencies` entry:

```json
    "next": ">=15 <16"
```

(was `">=14.0.0"`). Leave `"webpack": ">=5.0.0"` as is.

- [x] **Step 3: Range sanity check** — the clamped ranges accept the
fixture versions and reject the excluded majors:

Run: `bun -e "const s=require('semver'); for (const [r,ok,bad] of [['>=8 <9','8.1.4','7.1.0'],['>=15 <16','15.5.20','16.0.0']]) { if (!s.satisfies(ok,r) || s.satisfies(bad,r)) throw new Error(r); } console.log('ranges ok')"`
Expected: `ranges ok`. (If `semver` is not resolvable at the root, run the
same check with `bunx semver@7 -r '>=8 <9' 8.1.4` — expected output
`8.1.4` — and `bunx semver@7 -r '>=8 <9' 7.1.0` — expected empty/non-zero;
likewise for the next range with 15.5.20 vs 16.0.0.)

- [x] **Step 4: Reinstall and prove the fixtures still resolve cleanly.**

Run: `bun install`
Expected: no peer-resolution warnings mentioning `vite` or `next` for the
`@animus-ui/*` plugins.

- [x] **Step 5: Prove the consumer lanes stay green under the clamped
manifests.**

Run: `bunx vp run verify:vite && bunx vp run verify:next`
Expected: both exit 0.

- [x] **Step 6:** If increment 02 has landed, also run
`bunx vp run verify:packed` — the packed consumer installs with npm, which
enforces peers strictly; this is the real install-time proof.
Expected: exit 0. If increment 02 has not landed yet, mark this step `[~]`
with a note (the packed lane will exercise it when it lands).

## Guardrail gate

- [x] G3: `rg -n '"(vite|next)": ">=[0-9.]+"' packages/vite-plugin/package.json packages/next-plugin/package.json` — result: **pass (empty)** — no output, rg exit 1 (no matches). Clamped values `">=8 <9"` / `">=15 <16"` do not match the open-ended `">=[0-9.]+"` shape.

## Output contract (delegate mode)

- [x] Plan checkboxes above ticked to reflect actual completion
- [x] Drafted requirement text: none owed (`authors: —`)
- [x] Guardrail gate results recorded with command output
- [x] Proposed journal entries (surprise / friction), 1–3 lines each —
      any peer warning from Step 4 verbatim
- [x] Surfaced variables (spawn candidates), or "none"

### Step results

- **Step 1 (vite clamp):** pass — `"vite": ">=5.0.0"` → `">=8 <9"`.
- **Step 2 (next clamp):** pass — `"next": ">=14.0.0"` → `">=15 <16"`;
  `"webpack": ">=5.0.0"` left as is; `@mdx-js/mdx` optional peer untouched.
- **Step 3 (range sanity):** pass — `bun -e` semver check exited 0 (no
  throw). `bunx semver@7` confirmed visibly: `>=8 <9` prints `8.1.4`
  (accept) / empty exit 1 for `7.1.0` (reject); `>=15 <16` prints `15.5.20`
  (accept) / empty exit 1 for `16.0.0` (reject).
- **Step 4 (bun install):** pass — `Checked 739 installs across 1045
  packages (no changes)`. No peer-resolution warnings mentioning vite/next
  for `@animus-ui/*` plugins.
- **Step 5 (verify:vite && verify:next):** pass — both exit 0.
  verify:vite built on vite 8.1.4, assertions passed; verify:next built on
  Next 15.5.20, assertions passed.
- **Step 6 (verify:packed):** pass — FINAL_EXIT=0. npm strict install
  ("added 115 packages") produced no ERESOLVE peer conflict under the
  clamped ranges; attw shows both plugins "No problems found"; packed
  vite+next builds and assertions all passed.

### Proposed journal entries

1. (surprise) `bun -e "…console.log('ranges ok')"` exited 0 but emitted no
   stdout in this harness; the semver check still proved correct (no throw =
   ranges valid). The packet's `bunx semver@7` fallback gave visible
   accept/reject proof. Minor: the primary one-liner is trust-by-exit-code
   here, not trust-by-print.
2. (friction, pre-existing / not peer-related) Both Next builds
   (verify:next and packed) emit a benign multi-lockfile warning — Next
   infers workspace root from `/Users/sugarat/agent-workspaces/me-im-counting/yarn.lock`
   above the repo. Unrelated to the peer clamp; builds still exit 0.
3. (observation, pre-existing) The packed next build logs one extraction
   line `[animus-extract] Transform failed for .animus/system-props.js: …
   path not present in the last analyze() call`, yet compiles successfully
   and passes assertions. Not introduced by this increment; flagging only so
   it is not mistaken for peer-clamp fallout.

**Peer warnings from Step 4 (verbatim):** none — `bun install` produced no
peer-resolution warnings.

### Surfaced variables (spawn candidates)

None.

## Spec authorship checklist (orchestrator; the tie-back before ticking)

- [ ] No spec text owed (envelope covers)
- [ ] No Ledger rows to flip (DEF-2 stays open — React untouched)
- [ ] Appended accepted journal entries (attributed `via inc 04 subagent`)
- [ ] Cross-cutting row 2.1 (release-notes callout) noted as now-actionable
- [ ] Reorientation entry written per cadence
- [ ] Ticked registry row 04 in tasks.md with `· ticked: <timestamp>`
