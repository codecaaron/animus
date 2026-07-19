# Increment 02: synchronize the embedded-transform parity oracle

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans` to
> execute this packet task by task. Checkpoints are logical only; this packet
> contains no version-control action.

**Goal:** Synchronize the intentionally changed embedded-transform fixture with
the committed V2 parity pair through the repository's checked, exact refresh
workflow.

**Architecture:** Treat the later parity failure as the existing RED. Record
one checked intent and three exact transient drift rows, use the privileged
atomic pair refresh, return the register to empty, and require parity plus full
integration GREEN. No fixture, loader, extractor, or plugin source may change.

**Tech stack:** TypeScript parity harness, JSON baseline envelopes, Bash refresh
gate, Bun/Vite+, RepoWise Distill.

---

## Scope

- **Registry row**: 02 · mode: delegate · review: subagent
- **Resolves**: DEF-5 → D6
- **Authors**: — (the envelope requirement remains unchanged)
- **Depends on (ordering — deps:)**: 01
- **Inputs from (information — inputs:)**: none; the 11:06 DEF-5 signal is
  embedded below
- **Footprint**: `packages/_parity/baseline-intents.md`,
  `packages/_parity/register.json`, `packages/_parity/baselines/v2/*.json`,
  `packages/_parity/last-failure.txt`, and this packet's completion fields
- **Pushes to a later increment**: none

> Resolving signal: journal `2026-07-19 11:06 · inc 02 · signal` records exact
> two-mode fixture-only CSS, code, observables, and corpus-digest drift while
> 47/48 other units, fresh-process determinism, and the seam battery agree.

## Context Capsule

- **Objective**: Repair the oracle ownership gap created when row 01 changed
  `packages/_integration/fixtures/components/transforms.tsx` but ran only the
  integration owner claim. Refresh only the committed parity metadata, that
  unit, and the two named AST-equivalent selector comment code-map entries;
  leave no active register row and prove parity/integration together.
- **Established intent**: row 01's direct production-path oracle passes only
  when the embedded transform produces callback-specific `width: 8px`; raw
  fallback and the built-in transform would produce `4px`.
- **Atomic-resnapshot evidence**: the successful named refresh also updated
  raw code strings for only `selector-rules-create-element.tsx` and
  `selector-rules-unresolvable-token.tsx`. Both are reviewed comment-only
  corrections from `harden-selector-regression-oracles`; parity classified
  them AST-equivalent. Exact normalized comparisons prove every selector
  non-code field, every other selector code entry, and every other unit stable.
- **Exact RED**: in both modes, `integration/transforms.tsx` alone changes:
  - CSS `a8f689d51f6b832c1a3024e00cb15f83130e3c78cd8c708ccafc25b25803a622`
    → `760b26c47722f7c7936d9c45120631dc685c7474eeb36469f1ef84deb0ed9f58`;
  - code `22790ac78746ab5eba70735939a34d61af00b8f061895ead6d3f869cc1b0a33c`
    → `a6384cae245bef8af0e374e6c9313432242da435e5585ae390bbaafaf0bf946c`;
  - observables `8edb3872e21f031bd4bd19a9427af186509395e9bcbd3878ef6304445d127d94`
    → `d2e51fab188d4f910184cc5c80651d21b8adeb9701a67129f092934659950841`;
  - baseline corpus digest differs. Production and development have identical
    transitions; self-check is 48/48 and seam battery is 14/14.
- **Initial file hashes**: production baseline `af3180a4...babe`; development
  baseline `51ab8f52...a42d`; empty register `37517e5f...b570`; intent journal
  `cc630833...cf5`; recorded failure `86b7b77a...6f3d`.
- **Relevant resolved decision**: D6 checked intent + exact transient rows +
  atomic pair refresh + final empty register + parity/integration.
- **In-scope North Star**: NS1 callback-discriminating evidence; NS3 verified
  findings; NS5 parity-enumerated fixture and integration oracle agree.
- **Prohibitions**: never use mutative Git. Do not edit fixture, loader,
  extractor, plugin, parity TypeScript source, register schema, other corpus
  files, specs, design, tasks, journal, verify, or retrospective. The only
  generated write is the named repository refresh script to the two baseline
  JSON files. Do not hand-edit generated baseline JSON. Do not broaden or
  retain the transient register.

## Plan

### Task 02.1: Reconfirm the exact failing surface

- [x] Run G6 from `design.md` against the existing `last-failure.txt`. Expected
  counts `2`, `2`, `6`, `2` and only the three exact transitions above.
- [x] Run G10 and G11. STOP if the protected diff, transform fixture, either
  selector-comment fixture, or loader hash has drifted.
- [x] Confirm `packages/_parity/register.json` is exactly `[]` and the current
  intent id is absent:

```bash
jq -e '. == []' packages/_parity/register.json
! rg -n 'embedded-transform-fixture-20260719' packages/_parity/baseline-intents.md
```

### Task 02.2: Arm the checked refresh gate

- [x] Append this checked entry to `packages/_parity/baseline-intents.md`:

```markdown
- [x] `embedded-transform-fixture-20260719` — refresh after the reviewed real
      integration fixture replaced the stale string-transform path with a
      self-contained callback whose production-path oracle requires
      callback-specific `width: 8px`; later parity isolated the exact CSS,
      code, and observables drift to `integration/transforms.tsx` in both modes.
```

- [x] Replace the complete `[]` value in `packages/_parity/register.json` with
  these exact transient rows:

```json
[
  {
    "unit": "integration/transforms.tsx",
    "artifact": "css",
    "category": "intentional-correctness",
    "note": "Reviewed embedded transform fixture now proves callback-specific width: 8px output.",
    "status": "active",
    "baselineSha256": "a8f689d51f6b832c1a3024e00cb15f83130e3c78cd8c708ccafc25b25803a622",
    "candidateSha256": "760b26c47722f7c7936d9c45120631dc685c7474eeb36469f1ef84deb0ed9f58"
  },
  {
    "unit": "integration/transforms.tsx",
    "artifact": "code",
    "category": "intentional-correctness",
    "note": "Reviewed fixture source and transformed component shape changed together.",
    "status": "active",
    "baselineSha256": "22790ac78746ab5eba70735939a34d61af00b8f061895ead6d3f869cc1b0a33c",
    "candidateSha256": "a6384cae245bef8af0e374e6c9313432242da435e5585ae390bbaafaf0bf946c"
  },
  {
    "unit": "integration/transforms.tsx",
    "artifact": "observables",
    "category": "intentional-correctness",
    "note": "Reviewed fixture intentionally replaces sizing metadata with callback-resolved width output.",
    "status": "active",
    "baselineSha256": "8edb3872e21f031bd4bd19a9427af186509395e9bcbd3878ef6304445d127d94",
    "candidateSha256": "d2e51fab188d4f910184cc5c80651d21b8adeb9701a67129f092934659950841"
  }
]
```

- [x] Run `repowise distill vp run verify:unit:ts`. STOP on any failure.

### Task 02.3: Refresh atomically, then disarm the transient register

- [x] Run exactly:

```bash
repowise distill scripts/verify/refresh-parity-baseline.sh embedded-transform-fixture-20260719
```

Expected: the script validates checked intent, exact two-mode drift,
determinism, CSS validity, parse budgets, families, and writes the atomic pair;
exit zero with `BASELINE REFRESH: PASS`.

- [x] Immediately replace the entire transient register with its stable empty
  state:

```json
[]
```

- [x] Run G7 and the revised six-command G8. Then confirm both refreshed
  transform units contain callback output and no stale fallback:

```bash
jq -e '.units["integration/transforms.tsx"].css | contains("width: 8px") and (contains("flex-basis: 100") | not)' packages/_parity/baselines/v2/production.json
jq -e '.units["integration/transforms.tsx"].css | contains("width: 8px") and (contains("flex-basis: 100") | not)' packages/_parity/baselines/v2/development.json
```

### Task 02.4: Prove the repaired owner boundary

- [x] Run G9 in exact order: parity TypeScript units, committed parity, then
  full integration. No baseline write or waiver is allowed after this point.
- [x] Run G10 and G11 again; run `git diff --check`; inspect only the parity
  intent/register/baseline/last-failure diff. Confirm final register is `[]`,
  both envelopes name the new intent and same corpus digest, only the transform
  unit plus the two named selector code-map entries change below metadata, and
  no source file changed.
- [x] Update only this packet's completion fields with exact evidence,
  proposed journal entries, and surfaced variables. Do not edit `tasks.md`.

## Guardrail gate

- [x] G6 exact fixture-only RED — result: counts were exactly 2 CSS, 2 code,
  6 observables, and 2 corpus-digest reports. The only transitions were the
  recorded `integration/transforms.tsx` hashes in both modes.
- [x] G7 checked intent/final empty register — result: exactly one checked
  `embedded-transform-fixture-20260719` entry matched; final `jq -e '. == []'`
  returned `true`. Empty-register SHA-256 is
  `37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570`.
- [x] G8 normalized baseline pair changes only metadata + transform unit + two reviewed selector comment entries — result: all six revised normalized
  comparisons exited 0 with empty output. Both callback checks returned
  `true`; both envelopes name `embedded-transform-fixture-20260719` and share
  corpus SHA-256
  `231dd7127e27f85c1d860c058a4abe4b593c75f86c936787bb1d6117bdf62e06`.
- [x] G9 TypeScript units/parity/integration — result: TypeScript units passed
  266/266 across 26 files; parity passed 48/48 in production and development,
  with zero divergences and seam battery 14/14; integration passed 157/157
  across 11 files.
- [x] G10 protected foreign tracked diff — result:
  `a1a1a5c58a8d99904c0dcf488bb553b3cca2c11ee0bb9180cc1a709455d93887  -` before and after repair.
- [x] G11 transform fixture, two selector-comment fixtures, and loader hashes — result:
  `fcb666c835812153064d8c012da563aa967ac81f3cebb834bc14468c8587f818`,
  `0b512ac0334b7cf082e67df168514e8335629198d1267f13ec50b1e87ba904cf`,
  `d4fa8e35996102d0ca50918f15d00121cbfb7a189be2b46ee171377a3aa1cdc8`,
  and `03c1af1070cc31b39e82a79213d002ca458f8ab2a2a8aed68c8591614bc7f9bf`
  remained exact.

## Output contract (delegate mode)

- [x] Plan checkboxes above reflect actual completion
- [x] Authors is envelope-covered; no requirement draft is owed
- [x] Guardrail gate results include exact command evidence
- [x] Proposed journal entries (surprise / friction / signal), 1-3 lines each
- [x] Surfaced variables (spawn candidates) recorded below

### Execution evidence

- Status: DONE_WITH_CONCERNS. The exact named refresh exited 0 with
  `BASELINE REFRESH: PASS (embedded-transform-fixture-20260719)` after the
  pre-refresh TypeScript suite passed 266/266. The register was immediately
  restored to `[]`. The original G8 correctly stopped on two additional raw
  selector comment snapshots; same-reviewer re-review revised the guard to
  protect every non-code surface, other selector code entry, and other unit.
  All revised checks, G9, final hashes, and `git diff --check` are GREEN.
  Production/development baseline hashes are respectively
  `a1b2e39f7d4cbe130bbbe9770d1d48fc9ad7e43bd273c207a3e72a3e80cd0592`
  and `9227b850063f7d5d3f2ca2037f87ea0c2a61397a378861468cad82ef321128aa`.

### Proposed journal entries

- Surprise: the atomic resnapshot captured two already-reviewed,
  AST-equivalent selector fixture comment corrections in raw code maps. The
  initial G8 STOP exposed this coupling before the owner proof continued.
- Friction: G8 required one bounded re-review to distinguish comment-only code
  snapshots from transform behavior without weakening protection for other
  units or selector non-code surfaces.
- Signal: checked intent plus exact transient rows, atomic pair refresh, and an
  immediately empty register restored parity 48/48 in both modes while the
  integration owner remained 157/157.

### Surfaced variables (spawn candidates)

- `parity-raw-code-comment-sensitivity`: raw code-map snapshots intentionally
  preserve comments, so reviewed comment-only fixture edits can accompany a
  later atomic resnapshot; consider a separate policy decision if this recurs.

## Spec authorship checklist (orchestrator)

- [x] Confirm the existing pipeline-integration requirement remains unchanged and leakage-clean
- [x] Confirm DEF-5 is promoted to D6 with exact signal ownership
- [x] Append accepted journal entries attributed via inc 02 subagent
- [x] Write a reorientation entry with the full three-stance pass (K=1)
- [x] Tick registry row 02 with the reorientation timestamp
