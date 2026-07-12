# Retrospective: <change-name>

> Written: <YYYY-MM-DD> (after verify passed)
> Evidence is artifact + journal state — no commit ranges or diffs exist. The
> journal is the primary source: §5 is a triage of its entries, not recall.

---

## 0. Evidence

- **Increments**: <completed>/<total> — mode split: <n> inline / <n> delegated
- **Tasks done**: <x>/<y> (`grep -rc '^\s*- \[x\]' increments/ tasks.md`)
- **Capabilities touched**: <n> behavioral, <n> arch-*; **requirements authored**: <n>
- **Guardrails**: <n> registered / <n> trips (<n> STOP, <n> WARN) / <n> promoted to specs/arch-* at archive
- **Journal**: <n> entries — surprise <n> · friction <n> · signal <n> · trip <n> · reorientation <n> · objection <n> · mode-change <n> · spawn <n>
- **Deferral outcomes** (join journal `signal` entries vs Ledger predictions): <resolved-as-predicted n / surprised n / retired-stale n — one line each for the latter two>
- **Delegation outcomes**: <dispatched n / merged clean n / merge-rejected n + why>
- **Files touched**: <named paths from increment plans — derived, NOT a diff>
- **New external dependencies**: <name + license + version, or "none">
- **OpenSpec validate state at archive**: <targeted pass / fail / not-run;
  repo-wide context noted>
- **Verdicts (newest verify report)**: artifact <PASS/…> · implementation
  <PASS/NO-GO/spike-taxonomy/…> · rollout <clear/ops-gated/…> · archive
  decision <archive now / postpone / do not archive + reason>
- **Conformance**: verified SHA ancestor of default branch? <yes / NO —
  `unmerged-implementation`: archive postponed until the implementation
  lands>; if verified dirty: patch fingerprint landed? <yes / no / n-a>
- **Test coverage signal**: <e.g. vitest count, or "n/a">
- **Active sessions / rough hours**: <estimate>

Increment summary:

| # | Increment | Mode | Resolved | Authored | Notes |
|---|---|---|---|---|---|
| 01 | <slug> | inline | Dn… | §cap/Req | — |

---

## 1. Wins

- [evidence: <file/test/increment/journal entry>] <description>

## 2. Misses

- 🔴 [blocking | evidence: ...] <description>
- 🟡 [painful  | evidence: ...] <description>
- 📌 [nit      | evidence: ...] <description>

> Verify §9 real gaps and §12 warnings land here with follow-ups. A surprise
> remembered at retro time but ABSENT from the journal is also a miss (the
> capture mechanism failed) — log it here and in §5.

## 3. Plan deviations

Each row should trace to a journal entry (spawn / mode-change /
reorientation). A deviation with no journal trace is itself a §2 miss.

| Increment / row | What changed | Journal trace | Why |
|---|---|---|---|
| 02-<slug> | ... | <entry timestamp/type or NONE> | ... |

## 4. Skill / workflow compliance

| Skill | Used |
|---|---|
| superpowers:brainstorming |  |
| superpowers:writing-plans (per increment) |  |
| superpowers:executing-plans (if used) |  |
| superpowers:test-driven-development (if used) |  |
| superpowers:dispatching-parallel-agents / subagent-driven-development (if any delegated rows) |  |

> Default expectation: the planning skills are ✓. Any ✗ requires the
> subsection below.

### Deliberately Skipped Skills

- **`<skill name>`**
  - **What was skipped**: <the whole skill, or a specific sub-step>
  - **Why this cycle**: <concrete trigger — a specific increment, log line, or
    observed behavior; NOT "not needed" / "too small" / "no time">
  - **How to prevent recurrence**: schema graph fix (name the schema.yaml
    section) / skill description tightening / CLAUDE.md trigger /
    scope-judgment rule / one-off — schema boundary case (state why)

> Repeated same-skip with the same prevention answer across cycles → §6.

## 5. Surprises (journal triage)

Triage every journal `surprise` entry — do not re-remember:

| Journal entry (ts · inc) | Triage | Note |
|---|---|---|
| <ts · inc 03> | confirmed / contextualized / superseded | <esp. deferrals that did NOT resolve as the Ledger predicted> |

Unlogged surprises discovered now (each is also a §2 capture miss):

- <description>

## 6. Promote candidates → long-term learning

Candidates come from §5 triage, guardrail history (durable guardrails →
**specs-arch** promotion, executed before archive per apply step 5), and §4
prevention answers. Each candidate:

- [ ] 🔴 **<short rule>** → **Promote to** <memory / CLAUDE.md / schema / skill / specs-arch / one-off>
  > **Why**: <past incident or strong preference motivating this>
  > **How to apply**: <which file / cycle phase / decision moment this kicks in>

> Unchecked items carry to the next cycle's retro. When writing the next
> retro, pull prior unchecked candidates from
> `openspec/changes/archive/*/retrospective.md` and decide per item: carry
> forward, promote now, or mark stale.

> Forward-pointer policy: never rewrite past claims; append
> `> **Update YYYY-MM-DD**: §X superseded by <follow-up>`.
