## Context

This is a research/audit change, not an implementation change. The goal is to systematically investigate 9 integration patterns surfaced by examining blockworks os-admin as a production Animus consumer.

Each pattern produces one of three outcomes:
1. **Works correctly** — document it
2. **Fragile but functional** — document risks, consider hardening
3. **Broken or missing** — create a follow-up change for the fix

## Goals / Non-Goals

**Goals:**
- Audit each integration pattern with concrete evidence (code, build output, browser behavior)
- Produce a compatibility matrix: pattern × status × action needed
- Create follow-up proposals for any broken patterns discovered
- Document working patterns in vite-plugin CLAUDE.md or a consumer guide

**Non-Goals:**
- Fixing anything in this change — research only, fixes are separate changes
- Covering Next.js integration patterns (separate audit)
- Testing every Vite plugin combination (focus on blockworks' actual stack)

## Decisions

### Decision 1: Structured audit format

Each of the 9 patterns gets a dedicated investigation producing:
- **Status**: works / fragile / broken / unknown
- **Evidence**: build output, browser devtools, test results
- **Action**: document / harden / fix (with follow-up change reference)

### Decision 2: Priority ordering by risk

Investigate highest-risk patterns first:
1. Tailwind layer collision (cascade correctness)
2. Plugin ordering (build correctness)
3. CSS-in-JS coexistence (runtime correctness)
4. optimizeDeps interaction (dev server correctness)
5. build.cssMinify interaction (output correctness)
6. Monorepo workspace packages (extraction completeness)
7. CSS Modules coexistence (co-tooling)
8. Library mode (distribution)
9. SSR handling (future-proofing)

### Decision 3: Use blockworks as the reference consumer

All investigations use blockworks os-admin as the concrete test case. Abstract "what if" scenarios are secondary to observed behavior in a real app.

## Risks / Trade-offs

**[Risk] Audit finds many broken patterns** → Each becomes a separate change. The audit itself doesn't fix anything — it surfaces the work. Better to know than to not know.

**[Risk] Blockworks may not exercise all patterns** → Some patterns (library mode, SSR) are forward-looking. For these, use the showcase or a minimal reproduction instead.

**[Risk] Findings may be version-specific** → Tailwind v3 vs v4, Vite 5 vs 6, etc. Document versions tested.
