## Why

The animus monorepo's task orchestration, linting, building, testing, and cleaning are spread across five independent tools (bun + biome + tsdown + bun test + napi-cli + bash) with no unifying execution model — no content-addressed task caching, no orchestrator-mediated topological ordering beyond `bun --filter`, and no shared CLI surface. VoidZero's Vite+ has matured to alpha with bun support and unifies these concerns under one binary; the architecture is now coherent enough to commit to as the **target** orchestrator, while deferring the actual cutover until Vite+ reaches GA (or per-slice risk-acceptance).

## What Changes

This change installs the **target orchestration architecture** as a capability plus the **migration trigger criteria**. It does NOT execute the migration. Subcommand-level cutovers land as follow-on policy changes (one per cutover slice). Per the team's capability-vs-policy decomposition pattern (`add-rust-dep-hygiene` / `add-ts-static-analysis`, session 87), this proposal is intentionally STRICT-VALID-CAPABILITY-ONLY.

- Establish a tool-neutral **orchestration capability** owning: task DAG with content-addressed caching, library packing, application bundling, unified lint/format/typecheck, unified test runner.
- Name **Vite+** as the chosen instance with documented rationale (in-ecosystem: Vite, Vitest, Rolldown, tsdown; bun support shipped; MIT licensed; alpha status a documented blocker for execution).
- Define **migration trigger criteria**: Vite+ reaches GA OR per-slice risk-acceptance documented in the corresponding follow-on policy change. Bun support is already landed (one criterion met).
- Define **invariants that survive any orchestrator swap**: loud-fail atomic-tier preconditions, `_preconditions.sh` (or successor) as single authoritative implementation, Change-Type Map in root `CLAUDE.md`, dependency-derived ordering, dist-staleness checks (existence AND mtime-vs-src), atomic-tier isolation.
- Declare **explicit scope exclusions**: Rust NAPI build (`cargo` + `@napi-rs/cli`) and Rust unit tests (`cargo test`) remain outside the orchestrator's purview regardless of which orchestrator is bound.
- Enumerate the **follow-on policy changes** required to execute the migration, one per cutover slice.

This change is **NOT breaking** — no script, dependency, or tier changes land in this proposal. Implementation lands per follow-on.

## Capabilities

### New Capabilities

- `orchestration-architecture`: Defines the target single-orchestrator model (task DAG + content-addressed caching + lint/format/typecheck + test + library pack + app build), the migration trigger criteria, the invariants any orchestrator implementation MUST preserve, and the explicit scope exclusions for Rust pipelines.

### Modified Capabilities

- `build-orchestration`: Spec-level acknowledgement that the canonical orchestrator surface is the abstract one defined by `orchestration-architecture`; current binding to `bun run` documented as one valid implementation.
- `verification-tier-policy`: Atomic-tier contract (loud-fail, isolation, shared `_preconditions.sh`, Change-Type Map) re-anchored as orchestrator-invariant; tier names retained; underlying invocations spec-level decoupled from `bun run`.
- `workspace-build-ordering`: Dependency-derived ordering re-anchored as orchestrator-invariant; current binding to `bun run --filter` documented as one valid implementation.
- `bun-workspace`: Scope narrowed to "bun is the package manager and workspace resolver"; orchestration semantics that overlap with `orchestration-architecture` are removed from this spec's purview.
- `bun-test`: Scope narrowed to "`bun test` is the current test-runner binding"; spec-level test-runner contract is owned by `orchestration-architecture`.
- `code-hygiene`: Cascade structure (Layer A → B → C → D) re-anchored as tooling-neutral; current biome+knip binding documented; future vp check / oxlint binding pre-authorized.
- `rolldown-build`: Refresh stale references (legacy `core` / `theming` / `ui` packages) to the current package set; reframe as the library-bundler binding for the orchestration-architecture's "library packing" surface.

## Impact

- **`openspec/specs/`**: 1 new spec directory (`orchestration-architecture/`) + 7 modified spec deltas. No spec deletions in this change.
- **No code changes**: `package.json`, `scripts/verify/*.sh`, `scripts/verify/_preconditions.sh`, package build configs unchanged. Implementation is deferred to follow-on policy changes.
- **No CI changes**: `.github/workflows/ci.yaml` unchanged. CI continues to invoke `bun run` commands until per-slice cutovers land.
- **No `CLAUDE.md` changes**: the Verification Tier Table and Change-Type Map remain authoritative for current commands. Per-slice follow-ons update them when bindings change.
- **Follow-on policy changes** (enumerated for downstream proposal scaffolding):
  - `migrate-orchestrator-to-vp-run` — replaces `bun run --filter` semantics with `vp run` + Vite Task
  - `migrate-lint-to-vp-check` — replaces biome with `vp check`; resolves the atomic-tier conflation between separate `verify:lint`/`verify:compile`/`verify:types` tiers and the unified `vp check` command
  - `migrate-build-to-vp-pack` — replaces tsdown configs with rolldown configs invoked via `vp pack`; refreshes the `rolldown-build` spec
  - `migrate-test-to-vp-test` — replaces `bun test` with `vp test` (Vitest); preserves dist-resolution semantics for the `verify:integration` tier
  - `resolve-clean-surface` — verifies whether `vp cache` exists, scopes its coverage, and binds the cleaning surface accordingly (with shell `rm -rf` retained for non-Vite artifacts: Rust `target/` and `.node` binaries)
- **External dependency**: each follow-on is blocked on Vite+ reaching GA OR per-slice maintainer-signed risk-acceptance documented in that follow-on's `proposal.md`.
- **Tradeoff**: adopting Vite+ couples the repo to VoidZero's roadmap and (eventually) any commercial Vite+ tier. Mitigated by tool-neutral orchestrator-invariant abstractions in `orchestration-architecture/spec.md` — any orchestrator satisfying the architecture spec is a valid replacement.
