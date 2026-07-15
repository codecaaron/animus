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

### D4 — Remove the dead `selectorOrder` config output
**Choice:** `SystemBuilder.toConfig()` and `SerializedConfig` stop
emitting `selectorOrder`; active plugin and integration consumers pass a
placeholder in the retained optional NAPI slot until v1 retires. Docs
stop advertising the field.
**Rationale:** the DEF-1 probe found no authored configuration that sets
a non-default order, both engines discard the value, and retaining a
public output with no behavior is misleading.

### D5 — Surface warn diagnostics through both plugin channels
**Choice:** Vite and Next surface manifest diagnostics of kind `warn` on
their always-on developer warning channels, with file, component, and
message context, in every analysis path that consumes a manifest.
**Rationale:** increment 01 made unresolved aliases diagnosable in the
manifest, but a developer cannot act on a diagnostic that neither plugin
prints.

### D6 — Invert to immutable, content-addressed v2 baselines
**Choice:** the standing parity oracle becomes committed canonical v2
surfaces, split by production/development mode and versioned by an
explicit envelope. Ordinary verification never writes oracle files and
fails on any stale-baseline delta, even when the delta has an active
license. A separate refresh command requires a journaled intent, green
fresh-process/thread determinism, valid family/CSS invariants, and exact
`{unit, artifact, baselineSha256, candidateSha256, category}` register
coverage before it may replace baselines. Unit-set drift is compared in
both directions.
**Rationale:** live v1 has served its migration purpose. Exact content
hashes prevent an artifact-wide license from absorbing an unrelated
future change, while a privileged two-phase refresh prevents a red run
or the candidate process itself from silently redefining the oracle.

### D7 — Extract the system loader into an engine-neutral Rust crate
**Choice:** move the existing `loadSystemModule` implementation into an
engine-neutral internal crate consumed by both NAPI bindings during the
retirement window. Export it from the v2 binding and route the default
plugin path through that export; retain the v1 binding only as the
explicit compatibility escape hatch after it leaves the parity oracle.
**Rationale:** system loading is independent of extraction-engine
selection, but its OXC/QuickJS pipeline is too substantial to duplicate.
An internal shared crate removes the v2 default's dependency on the v1
binary and starts retirement without breaking the reversible `engine:
'v1'` contract in the same release.

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
| DEF-1 | selectorOrder: wire into pseudo-selector ordering vs remove from SystemBuilder API | resolved → D4 (2026-07-13, authored-config probe found no non-default use) | 05 | REMOVE signal journaled 2026-07-13 03:25 | fulfilled at row 03 reorientation |
| DEF-2 | Oracle-inversion mechanics (committed v2 baselines: snapshot format, refresh protocol, drift alarms) | resolved → D6 (2026-07-13, row-06 full reorientation) | 07 | row 06 produced the final live-v1 divergence set; review found artifact-wide licenses and ordinary snapshot writes too permissive | fulfilled at row 06 reorientation |
| DEF-3 | `loadSystemModule` port vs extraction at v1 retirement (carried from change:extract-v2-default-flip DEF-2) | resolved → D7 (2026-07-13, extract to shared engine-neutral crate) | 07 | row 06 started the retirement boundary; loader audit found a standalone OXC/QuickJS pipeline already independent of analysis | fulfilled at row 06 reorientation |
| DEF-4 | Start gate: sheds ship only after the flip (G1) | resolved (2026-07-13, flip#02 ticked; G1 probe prints v2) | 01 | change:extract-v2-default-flip#02 — plugin defaults are v2 | 3 reorientations \| 2026-09-15 |
| DEF-5 | Plugin warn-diagnostic surfacing: warn reaches the manifest but not the dev console — extraction-diagnostics 'surfaces in dev' scenario needs a user-visible arm | resolved → D5 (2026-07-13, increment-01 consumer audit confirmed the gap) | 08 | spawn evidence and two reorientation audits | fulfilled at row 03 reorientation |

## Guardrail Register

| ID | Invariant | Scope | On trip | Status |
| --- | --- | --- | --- | --- |
| G1 | SHALL NOT start shedding before extract-v2-default-flip ships (sheds must reach users as fixes, not parity breaks) | all | STOP | fulfilled 2026-07-13: flip row 02 landed before shedding; the Vite default probe prints `v2` |
| G2 | SHALL NOT modify harness comparison code without a registry row naming it in footprint | all | STOP | fulfilled 2026-07-13: row 07 explicitly owns comparator/register hardening; focused exact-oracle tests pass |
| G3 | SHALL NOT leave an unregistered divergence at any increment end | all | STOP | calibrated 2026-07-13: PARITY GATE PASS, 0 unregistered |
| G4 | SHALL NOT remove v1 from the oracle/default-loader boundary before the final increment proves the committed v2 oracle, shared v2 loader path, and explicit v1 escape hatch | all | STOP | retirement boundary satisfied 2026-07-13: standing oracle and default loader are v2; the explicit v1 compatibility binding remains consumer-proven |

```bash
# G1 — expected after flip: prints 'v2' (trip = block shedding)
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
# G4 retirement replacement — expected: exit 0
test -f packages/extract/crates/system-loader/src/lib.rs && \
  rg -q 'loadSystemModule' packages/extract/crates/extract-v2/index.d.ts && \
  test -f packages/extract/index.js
```
