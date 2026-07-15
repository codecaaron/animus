# Brainstorm: extract-quirk-shed

> **Evidence basis (exploration already happened — captured, not re-run):**
> the archived `2026-07-13-extract-v2-spine` change built v2 as a
> BUG-COMPATIBLE mirror of v1 by contract (design D3), and its register
> (`packages/_parity/register.json`) plus journal quirk entries are a
> complete, witnessed inventory of the bugs v2 reproduces on purpose.
> Every item below has either an active register entry, a corpus witness,
> or a journal entry with v1 line references. This change is the planned
> second half of that contract: once v2 is the shipped default
> (`extract-v2-default-flip`), divergence from v1 becomes INTENTIONAL and
> registered rather than forbidden.

## 1. KNOWN-NOW vs DEFERRED

**Known now (each with its witness):**
- **Unresolved-token-alias raw passthrough emits INVALID CSS with no
  diagnostic** — active register css-validity entries
  (extract/contextual-vars.tsx, extract/token-alias.tsx,
  integration/selector-rules, extract-all); latent v1 bug FOUND BY the
  harness validity check on first run. Shed = emit a diagnostic and drop
  or fallback the bad declaration; the css-validity leg then goes
  fully green.
- **`'use client'` detected only at byte offset 0** — register
  known-quirk (parity/use-client-comment.tsx): a leading comment defeats
  detection and imports land ABOVE the directive (breaks Next). First
  post-flip correctness candidate named all the way back in the spine
  envelope.
- **Import emission decided by substring-grep over generated replacement
  text** — register known-quirk (extract-all): user strings containing
  e.g. `transforms.` trigger spurious imports.
- **Silent drop of eval-failed chains** — journal 2026-07-13 08:45: v1
  project_analyzer.rs 967-969 Err arm is EMPTY (no diagnostic); v2
  mirrors in analyze_css.rs. Shed = emit a bail diagnostic; consumers
  finally SEE why a component fell back to runtime.
- **duplicate-compose**: v2 is ALREADY correct (v1 double-replaces the
  first span with mangled output) — active intentional-correctness
  entry; shed = drop the entry when v1 leaves the oracle set. Zero code.
- **selectorOrder is a dead config surface** — v1 parses it into
  underscore-discarded bindings at BOTH entry points (lib.rs:113, 859)
  while SystemBuilder.ts advertises it (register: v1-feature-drift).
  Shed = wire it into pseudo-selector ordering OR remove it from the
  builder API.
- **Shed mechanics (from the spine's register design):** each shed flips
  or adds a register entry (category intentional-correctness, status
  active) so the differential STAYS the gate — divergence is licensed by
  registration, never by loosening comparison.

**Deferred (with resolving signals):**
- **selectorOrder direction (wire vs remove)** — *resolving signal:* one
  probe of showcase/next-app authored configs — if nothing sets a
  non-default order, remove; if anything does, wire.
- **Which sheds require a v1-side fix too** — v1 stays shipped until
  retirement; a shed that changes SHARED runtime contracts (e.g.
  diagnostics consumed by the plugins) may need a v1 backport. *Resolving
  signal:* per-shed plugin-consumption grep at increment start.
- **Oracle inversion** — when v1 retires, the differential's reference
  becomes committed v2 baselines instead of live v1. *Resolving signal:*
  final increment of this change; design lands there, not now.

## 2. Candidate NORTH STAR criteria

- **Every shed makes a previously-silent failure LOUD or a
  previously-wrong output RIGHT** — no refactors ride along.
- **The register is the license**: 0 unregistered divergences at every
  increment; a shed that can't be expressed as a register entry is
  out of scope.
- **Diagnostics are contracts** (extraction-diagnostics spec): new bail
  warnings added by sheds get spec deltas, not just code.

## 3. Candidate GUARDRAILS

- The change SHALL NOT begin before `extract-v2-default-flip` ships
  (v2 must be the default so sheds reach users as fixes, not as
  parity breaks). *Check:* plugin default greps in the first increment
  gate.
- The change SHALL NOT loosen compare.ts/classifiers to make a shed
  pass. *Check:* harness source diff gate — comparison code changes
  require an explicit registry row.
- Consumer oracles SHALL stay green after every shed (fixtures may gain
  INTENTIONAL byte changes — each requires a refreshed committed
  baseline + journal entry, never a skipped assert). *Check:* the three
  build+assert tiers per increment.
- The change SHALL NOT delete v1 until its final increment (oracle
  role). *Check:* same canary probe as the flip change.

## 4. Decision chain

The spine's D3 (bug-compat first) explicitly created this backlog: every
quirk was REPRODUCED, witnessed, and registered instead of fixed, so that
parity claims stayed falsifiable. The register's category system
(known-quirk / intentional-correctness / v1-feature-drift / ordering) was
designed at inc-02 precisely so this change could flip entries rather
than fight the harness. Dependency order within the shed list follows
blast radius: diagnostics-only sheds first (alias leak, silent drop),
emission-changing sheds second (directive, import grep), API-surface
sheds last (selectorOrder). duplicate-compose is free. The oracle
inversion is deferred to the end because every earlier shed still
benefits from live v1 as the reference for the UNSHED surfaces.
