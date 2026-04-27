## Context

The animus monorepo currently orchestrates work through five independently-evolved tools — `bun` (package manager + workspace runner + test runner), `@biomejs/biome` (lint + format), `tsdown` (TS library bundler), `napi-cli` (Rust NAPI build), and a 14-script shell pipeline under `scripts/verify/` backed by a sophisticated shared `scripts/verify/_preconditions.sh` helper. The shell pipeline encodes the loud-fail atomic-tier contract that is the semantic backbone of `verification-tier-policy`. There is no orchestrator-mediated task DAG, no content-addressed caching, and no shared CLI surface across these tools.

VoidZero's Vite+ (`vp` CLI, https://viteplus.dev) reached alpha and now lists bun among its supported package managers. It unifies the relevant concerns under one binary: `vp run` (task graph + caching via Vite Task), `vp check` (lint + format + typecheck), `vp build` (apps), `vp pack` (libraries via Rolldown + standalone binaries), `vp test` (Vitest), `vp env`, `vp install`, `vp dev`. The animus team has tracked Vite+ as the prospective orchestrator since 2026-04-02 (memory file `project_viteplus_orchestrator.md`); the original blocking criterion was bun support, which has now landed.

Stakeholders: Aaron (sole repo author / sole maintainer). The capability-vs-policy decomposition pattern was established in session 87 (`add-rust-dep-hygiene`, `add-ts-static-analysis`) and is the proven shape for tooling-adoption proposals here.

## Goals / Non-Goals

**Goals:**
- Install a tool-neutral `orchestration-architecture` capability spec describing the target single-orchestrator model.
- Define unambiguous migration trigger criteria (Vite+ GA OR per-slice maintainer-signed risk-acceptance).
- Lock the invariants that any orchestrator implementation MUST preserve: loud-fail atomic-tier preconditions with the `ERROR: X. Run: Y` shape; `_preconditions.sh` (or successor) as single authoritative implementation; Change-Type Map in root `CLAUDE.md`; dependency-derived build ordering; dist-staleness checks (existence AND mtime-vs-src); atomic-tier isolation (no silent upstream rebuilds).
- Re-anchor 7 existing specs (`build-orchestration`, `verification-tier-policy`, `workspace-build-ordering`, `bun-workspace`, `bun-test`, `code-hygiene`, `rolldown-build`) to architecture-driven contracts so their bindings can swap without spec edits.
- Enumerate the follow-on policy changes that will execute the migration, one per cutover slice.

**Non-Goals:**
- No code changes — `package.json`, `scripts/verify/*.sh`, `_preconditions.sh`, package build configs all unchanged.
- No CI changes — `.github/workflows/ci.yaml` continues to invoke `bun run` commands.
- No `CLAUDE.md` changes — the live tier table and Change-Type Map remain authoritative until per-slice cutovers land.
- No execution of the migration in this change.
- No commitment to specific `vp` subcommand mappings — that is the explicit purview of the follow-ons.
- Out of orchestrator scope permanently: Rust NAPI build (`cargo` + `@napi-rs/cli`) and Rust unit tests (`cargo test`). Specs covering those (`rust-extraction-pipeline`, `ci-napi-binary-verification`, etc.) are not touched here.

## Decisions

**D1: Capability-and-criteria over command-by-command.**
Install the mechanism surface (orchestrator architecture + criteria + invariants); defer specifics to follow-on policy changes. Acid test from `feedback_capability_vs_policy`: *can the orchestrator be swapped without changing the spec?* With tool-neutral text, yes. Alternative considered: one mega-change covering all subcommand cutovers. Rejected because (a) blocks all movement on Vite+ GA all-or-nothing; (b) couples 7 spec deltas with 5 cutover slices into one un-reviewable diff; (c) loses the per-slice risk-acceptance affordance and the ability to roll back any single slice independently.

**D2: Vite+ named explicitly with rationale, not abstracted away.**
The capability spec is tool-neutral; the chosen instance is named in the proposal and design. Alternative considered: pure abstraction with no named tool. Rejected because the architecture WAS designed around Vite+'s feature set (Vite Task DAG + caching, Rolldown packing, Vitest, Oxc) — pretending otherwise erases load-bearing context and makes the rationale unreadable.

**D3: Migration trigger criteria are dual (GA OR per-slice risk-acceptance).**
Strict GA-only blocks the team from any movement until VoidZero ships GA, with no incremental learning path. Per-slice risk-acceptance permits incremental cutover with documented exposure. Each follow-on `proposal.md` MUST surface a risk-acceptance section if executed pre-GA.

**D4: Rust pipelines permanently excluded from orchestrator scope.**
Cargo + napi-cli own the NAPI build; `cargo test` owns Rust unit tests. This is not deferral — it is a permanent boundary. Vite+ does not enter the Rust pipeline regardless of maturity. This boundary appears explicitly in the new capability spec.

**D5: `_preconditions.sh` as load-bearing semantic, not implementation detail.**
The shell helper IS the loud-fail contract. Any orchestrator binding MUST preserve its semantics: file-mtime staleness checks, `ERROR: X missing/stale. Run: Y` message shape, atomic-tier isolation. The helper file MAY be superseded by an orchestrator-native equivalent, but the contract MUST hold and be expressible by the new mechanism. Worst case: the orchestrator invokes `bash scripts/verify/<tier>.sh` as task body, preserving the shell helper as load-bearing.

**D6: `vp check` atomic-tier conflation is an open question, not a decided merge.**
Vite+'s `vp check` unifies lint + format + typecheck. The `verification-tier-policy` spec mandates separate `verify:lint` / `verify:compile` / `verify:types` tiers with independent fail surfaces and Change-Type Map row mappings. The capability spec preserves the three-tier contract as the architecture-level invariant. The lint follow-on (`migrate-lint-to-vp-check`) will choose between: (a) keeping three tiers with flag-subset invocations of `vp check` if such flags exist (currently UNVERIFIED), or (b) proposing an amendment to `verification-tier-policy` to merge the three tiers (a substantial separate change). Both paths pre-authorized.

**D7: `vp cache` is unverified; the cleaning surface is NOT bound in this capability.**
The user's prompt named `vp cache` as the proposed cleaning surface. As of today, viteplus.dev's documented subcommand list does NOT include `vp cache`. Per session integrity discipline, this is treated as a fictional-API risk and quarantined. The cleaning binding is owned by the `resolve-clean-surface` follow-on, which MUST first verify whether `vp cache` exists / what it covers, then bind the cleaning surface. Shell `rm -rf` will retain coverage of non-Vite artifacts (Rust `target/` and `*.node` binaries) regardless of the resolution.

## Risks / Trade-offs

**[Vendor lock-in to VoidZero]** → Mitigated by tool-neutral capability spec; the architecture contract names no specific subcommands. An alternative orchestrator (Nx, Turborepo, Moon) satisfying the contract is a valid replacement. The proposal documents the lock-in as an explicit tradeoff.

**[Vite+ alpha instability if executed pre-GA]** → Mitigated by D3's per-slice risk-acceptance requirement. Each follow-on executed pre-GA MUST contain a maintainer-signed exposure assessment in its `proposal.md`.

**[Spec delta drift with sibling in-flight changes]** → Per `feedback_openspec_modified_semantics`, MODIFIED delta blocks replace full requirement content on archive in archive-order; sibling overwrites are silent. The animus repo has 4 other in-flight changes (`add-rust-dep-hygiene`, `fix-mdx-component-usage-scanning`, `fix-selector-rule-extraction`, `rc-channel-graduation`, `refine-code-hygiene-dx`). The `code-hygiene` spec in particular is in active flux. Mitigation: `tasks.md` MUST include a pre-archive re-sync step that diffs each MODIFIED requirement against the current spec state and against any sibling change's delta on the same requirement, surfacing conflicts before archive.

**[`vp check` ↔ three-tier conflation]** → Surfaced in D6 with both resolution paths pre-authorized in the lint follow-on.

**[`_preconditions.sh` may not be expressible as orchestrator-native hooks]** → Mitigated by D5: the contract is invariant; the file stays if no native equivalent emerges; orchestrator can shell out to existing scripts.

**[`vp cache` confabulation risk]** → Surfaced in D7. Capability spec does NOT bind cleaning; the follow-on verifies before commitment. Documents the verification gap explicitly.

**[Bun version pin (`.tool-versions`) interaction with `vp env`]** → `vp env` "Manages your runtime and package manager selection." Open question whether this conflicts with `.tool-versions` or layers cleanly. Deferred to orchestrator follow-on. Mitigation: the capability spec preserves `.tool-versions` as the authoritative bun-version pin (existing requirement in `verification-tier-policy`), so the follow-on can detect conflict without losing that anchor.

**[Capability spec under-specifies, leaving follow-ons too much latitude]** → Counter-risk to D1. Mitigated by enumerating invariants concretely (loud-fail shape, Change-Type Map presence, dist-staleness check pattern, etc.) in the new capability's spec text. The architecture is tool-neutral but contract-rich.

## Migration Plan

This change does NOT execute a migration. The migration plan IS the enumerated follow-on sequence:

1. **`migrate-orchestrator-to-vp-run`** — first cutover. Establishes `vp run` as task-graph driver. Tier scripts continue to call existing tools internally; only the outer dispatch changes. Lowest blast radius.
2. **`migrate-build-to-vp-pack`** — second. Replaces `tsdown` with `vp pack` (Rolldown). Both are VoidZero-owned, so semantic shift is small. Refreshes the stale `rolldown-build` spec.
3. **`migrate-lint-to-vp-check`** — third. Biome → `vp check`. Includes per-rule biome→oxlint mapping audit. Resolves D6.
4. **`migrate-test-to-vp-test`** — fourth. `bun test` → `vp test` (Vitest). Touches test discovery and `verify:integration`'s dist-resolution behavior.
5. **`resolve-clean-surface`** — fifth. Verifies `vp cache` and binds the cleaning surface. Resolves D7.

Each follow-on:
- Is a separate openspec change with its own proposal / design / specs deltas / tasks.
- MUST run `verify:full` plus spot-check showcase, next, and vite consumer builds before merge.
- Documents its own rollback path in its design.md (typically: revert the spec deltas and the script edits in one PR).

Rollback for THIS capability change: revert this change's archived state and remove the new `orchestration-architecture` capability. Since no code changed, the rollback is purely a spec rollback.

## Open Questions

- Does Vite+ expose flag-based subsets of `vp check` allowing separate lint / format / typecheck invocation? (Resolves D6.)
- Does `vp cache` exist as a subcommand or as part of `vp env` / Vite Task? What is its actual scope? (Resolves D7.)
- Does `vp env` conflict with or layer cleanly over `.tool-versions`?
- How does `vp run`'s task DAG derive — from `package.json` scripts, from `package.json` `dependencies`, or from a Vite Task-specific config? (Affects orchestrator follow-on's required config artifacts.)
- Does Vitest under `vp test` require renaming any `__tests__` directories or adding `vitest.config.ts` files to match `bun test`'s current discovery patterns?
- Will Vite+ ship a commercial Enterprise tier post-GA? (Affects vendor-lock-in risk severity assessment in any follow-on executed post-GA.)
