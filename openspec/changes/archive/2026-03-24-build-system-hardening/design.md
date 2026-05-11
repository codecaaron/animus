## Context

The Animus monorepo has a layered build pipeline:

```
Rust Crate (cargo/napi)
  └→ TS Packages (tsdown + tsc, ordered: core → theming → runtime → system → vite-plugin → ui)
       └→ Showcase (vite build, uses vite-plugin for extraction)
```

Each layer produces artifacts that downstream layers consume. Caches exist at every layer:

| Cache | Location | Cleared by `clean`? | Risk |
|-------|----------|---------------------|------|
| Vite transforms | `node_modules/.vite/` | No | HIGH |
| NAPI binary | `packages/extract/*.node` | No | HIGH |
| TS dist | `packages/*/dist/` | Yes | MED |
| Rust target | `packages/extract/target/` | Yes | LOW |

The React alias incident (session 2026-03-24) demonstrated that `node_modules/.vite/` can serve stale transforms indefinitely, with no error signal. The NAPI binary persists across Rust signature changes — if a function gains a parameter, the old `.node` binary will silently accept the wrong arity.

The `verify` scripts validate TS build + tests + linting but NOT the showcase extraction build, which is the only proof that the full pipeline works end-to-end.

## Goals / Non-Goals

**Goals:**
- Single command to reach guaranteed-fresh state from any cache corruption scenario
- `verify:full` gates on extraction proof (showcase build), not just TS compilation
- Developer knowledge captured in package-level CLAUDE.md files so debugging expertise survives across sessions
- Cache tier awareness — light clean for common issues, full clean for nuclear reset

**Non-Goals:**
- Changing the build tool (bun, tsdown, cargo) — these are stable
- CI/CD pipeline changes — this is local DX only
- Automatic cache invalidation — too complex, manual tiered clean is sufficient
- Changing the extraction pipeline itself — this is tooling around it

## Decisions

### Decision 1: Three clean tiers instead of one

**Choice:** `clean` (existing, unchanged), `clean:light`, `clean:full`

**Rationale:** Most stale-cache issues are Vite transform cache or stale dist. A light clean that removes just these takes <1s and fixes 80% of cases. A full clean that also removes Rust target + NAPI binary + tsbuildinfo takes longer (Rust rebuild is 30-60s) but guarantees fresh state. Keeping `clean` unchanged avoids breaking existing muscle memory.

**Alternative considered:** Single `clean --level=light|full` flag. Rejected because bun scripts don't support flags elegantly, and separate script names are more discoverable.

### Decision 2: Showcase build as verification gate

**Choice:** Add `test:showcase` (already exists as `bun run --filter './packages/showcase' build`) to `verify:full`.

**Rationale:** The showcase IS the integration test. It exercises: system serialization → Rust extraction → Vite transform → CSS generation → React rendering. If showcase builds, extraction works. If it doesn't, something is broken regardless of what unit tests say.

**Alternative considered:** Separate `verify:extraction` script. Rejected — `verify:full` should mean "verify EVERYTHING." If you want just TS, use `verify`.

### Decision 3: CLAUDE.md addendum, not replacement

**Choice:** Append a `## Monorepo Build System` section to root CLAUDE.md rather than replacing the SYZYGY bootstrap.

**Rationale:** The SYZYGY bootstrap serves a different purpose (cognitive framework). Build system knowledge is additive context, not a replacement. Package-level CLAUDE.md files carry the detailed per-package knowledge.

### Decision 4: CLAUDE.md content scope

**Choice:** Each package CLAUDE.md covers: purpose, build commands, cache locations, known failure modes, debugging procedures, verification commands. No architecture docs (that's in specs). No API docs (that's in types).

**Rationale:** The target audience is a developer (or AI agent) who just encountered a confusing failure. They need: "what caches exist, how to clear them, what to rebuild, how to verify." Not "how does the AST walker work."

## Risks / Trade-offs

- **[Risk] CLAUDE.md goes stale** → Mitigated by keeping content focused on stable structural knowledge (cache locations, build order) rather than volatile implementation details. Cache locations change rarely.
- **[Risk] `verify:full` becomes too slow with showcase build** → Mitigated by keeping `verify` (without showcase) as the fast path. `verify:full` is for "something might be broken" situations where correctness > speed.
- **[Risk] `clean:full` removes Rust target, forcing 30-60s rebuild** → This is the point. When you need fresh state, you need fresh state. `clean:light` exists for the fast path.
