# Design: extract-quirk-shed

## Context

The v2 engine reproduces v1's bugs by contract (spine design D3); the
register (`packages/_parity/register.json`) is the witnessed inventory.
This change sheds them once `extract-v2-default-flip` ships — each shed
is a v2 fix licensed by a register entry, so the differential harness
stays the gate. The final increment retires v1 from the oracle set and
inverts the harness reference to committed v2 baselines.

## Goals / Non-Goals

**Goals:** fix the six registered/journaled quirk families in v2;
register each divergence; invert the oracle; begin v1 retirement.

**Non-Goals:** new features; performance work; plugin API changes.

## Decisions

### D1 — Divergence by registration, never by loosening
**Choice:** every shed flips/adds a register entry (category
intentional-correctness); comparison code in the harness is untouchable
except via an explicit registry row.
**Rationale:** the spine built the category system for exactly this;
loosening compare.ts would make future regressions invisible.

### D2 — Blast-radius ordering
**Choice:** diagnostics-only sheds first (alias leak, silent eval-drop),
emission-changing second ('use client' trivia, import grep),
API-surface last (selectorOrder), duplicate-compose free, oracle
inversion final.
**Rationale:** each stage's oracle needs the previous stage's surfaces
still parity-locked; v1 stays reference for UNSHED surfaces throughout.

### D3 — v1 backports only for shared runtime contracts
**Choice:** a shed changes v1 only when the plugins consume the affected
contract from both engines (e.g. diagnostics shape); pure-output sheds
diverge without backport.
**Rationale:** v1 is in maintenance; its role is oracle, not recipient
of improvements.

## North Star

- NS1: every shed makes a silent failure loud or a wrong output right —
  no refactors ride along.
- NS2: 0 unregistered divergences at every increment; the register is
  the license.
- NS3: new diagnostics are spec'd contracts (extraction-diagnostics
  deltas), not incidental strings.

Adversarial cadence K: 2

## Decision Ledger

| ID | Decision | Status | Owner increment | Resolving signal | Review-by |
| --- | --- | --- | --- | --- | --- |
| DEF-1 | selectorOrder: wire into pseudo-selector ordering vs remove from SystemBuilder API | deferred | TBD | probe of showcase + next-app authored configs: any non-default order set → wire; none → remove | 3 reorientations \| 2026-09-01 |
| DEF-2 | Oracle-inversion mechanics (committed v2 baselines: snapshot format, refresh protocol, drift alarms) | deferred | TBD | all prior sheds landed (design happens with the full divergence set known) | 3 reorientations \| 2026-10-01 |
| DEF-3 | `loadSystemModule` port vs extraction at v1 retirement (carried from change:extract-v2-default-flip DEF-2) | deferred | TBD | v1 retirement increment starts | 3 reorientations \| 2026-10-01 |
| DEF-4 | Start gate: sheds ship only after the flip (G1) | resolved (2026-07-13, flip#02 ticked; G1 probe prints v2) | 01 | change:extract-v2-default-flip#02 — plugin defaults are v2 | 3 reorientations \| 2026-09-15 |
| DEF-5 | Plugin warn-diagnostic surfacing: vite/next diagnostic printers only emit kinds bail/skip; kind warn (incl. inc-01 alias warn) reaches the manifest but not the dev console — extraction-diagnostics 'surfaces in dev' scenario needs a user-visible arm | deferred | 08 | spawned by inc 01 (delegated agent friction report) | 2 reorientations \| 2026-08-15 |

## Guardrail Register

| ID | Invariant | Scope | On trip | Status |
| --- | --- | --- | --- | --- |
| G1 | SHALL NOT start shedding before extract-v2-default-flip ships (sheds must reach users as fixes, not parity breaks) | all | STOP | calibrated 2026-07-13: TRIPS today (vite-plugin default is 'v1') — expected until the flip lands; gates row 01 |
| G2 | SHALL NOT modify harness comparison code without a registry row naming it in footprint | all | STOP | calibrated 2026-07-13: compare.ts clean in worktree |
| G3 | SHALL NOT leave an unregistered divergence at any increment end | all | STOP | calibrated 2026-07-13: PARITY GATE PASS, 0 unregistered |
| G4 | SHALL NOT remove v1 before the final increment | all | STOP | calibrated 2026-07-13: v1 present |

```bash
# G1 — expected AFTER flip: prints 'v2'; today prints 'v1' (trip = block row 01)
rg -o "@default '(v[12])'" -r '$1' packages/vite-plugin/src/index.ts | head -1
```

```bash
# G2 — expected: empty (or the current increment's registry row lists packages/_parity/src in footprint)
git status --short packages/_parity/src/compare.ts packages/_parity/src/scoreboard.ts
```

```bash
# G3 — expected: final line "PARITY GATE: PASS"
bash scripts/verify/parity.sh | tail -1
```

```bash
# G4 — expected: exit 0
test -f packages/extract/index.js && test -f packages/extract/src/lib.rs
```
