## Why

`code-hygiene`'s value proposition is **offloaded vigilance**: at end-of-work, a human or agent delegates "find and remove the dead-decl artifacts of iterative work" to the tool rather than inspecting every diff manually. That delegation is only viable if the tool's signal layer is a *trust contract* — every WARN means "look here," every silence means "trust me," every exit code maps unambiguously to a verdict. When trust breaks, the user is forced back into manual diff review, at which point the tool has zero net value over hand-cleanup.

A 3-persona practice review of the freshly-installed cascade (SRE/ops, DX critic, adversarial test engineer) identified three behaviors that each break trust by forcing fallback to manual review:

- **Cap-hit warning fires on essentially every fix-mode run.** The orchestrator emits `WARN` whenever the iteration cap is hit, even when the final iteration produced zero deletions (i.e., genuine convergence with idempotent A/B/D fingerprint churn). Users learn the warning means nothing, then ignore it the time it does.
- **Cross-workspace dist-staleness is silent corruption.** Knip resolves cross-workspace imports against `package.json` `main`/`module` paths (i.e., `dist/`). If a workspace's `dist` is older than its `src`, knip can flag live exports as unused. No precondition check exists, despite `verify:*` tiers having an established `require_*` pattern.
- **Layer D high-volume removal is unannounced.** Build-time consumers (the Rust extractor's `globalStyles`, Vite plugin virtual modules, MDX) are invisible to knip even with `entry` hints, so deletions of these can ship without any nudge to run `verify:build:*`. Session-90 had a near-miss: `globalStyles = createGlobalStyles({...})` was wiped from showcase + next-app and only caught because Aaron noticed during dev.

The cascade's deletion semantics are correct. What was built reactively is the surface that *reports what happened*. This change treats that surface as a designed contract, with **deletion-receipts** as its substrate: every layer appends a structured record of each deletion to `.hygiene/receipts.jsonl`, and the orchestrator's signaling derives from receipt analysis rather than scattered in-line counters. Receipts double as a postmortem audit trail (you can inspect a structured log instead of doing `git diff` archaeology when the safety envelope fails) and as the **portability seam** for the canary→cross-repo arc — porting hygiene to another repo becomes "implement layers that emit this schema; reuse the presenter."

## What Changes

### Architecture: deletion-receipts as the signal substrate

Each cascade iteration writes a JSONL receipt file (`.hygiene/receipts.jsonl`, gitignored, overwritten per run) where every Layer A/B/C/D mutation appends one record. The orchestrator's signal layer (cap-hit verdict, Layer D volume, category-drift canary) becomes a pure function of the receipt stream — testable in isolation against synthetic receipt fixtures, and inspectable by a human/agent post-failure without re-running.

Items in Tier 1/2 are tagged **[receipt-derived]** when their signal logic reads from receipts, **[gate]** when they're preconditions before any receipt is written, or **[independent]** when they're correctness/CLI improvements with no signal dependency.

### Tier 1 — signaling honesty (blocking)

- **Cap-hit verdict differentiates churn from oscillation.** **[receipt-derived]** Compute the per-iteration deletion count by partitioning receipts by `iteration` field. If iteration N's delete count is zero, emit `INFO: cascade settled at iteration cap (idempotent A/B/D churn caused fingerprint drift)` and exit 0. Reserve `WARN` strictly for genuine non-convergence (iteration N has Layer C or D deletions). Honors spec contract: fix-mode exits non-zero only on real divergence.
- **Dist-staleness precondition.** **[gate]** Add `require_dist_fresh_for_workspaces` helper that mirrors the established `verify:*` tier pattern. Walks the targeted workspaces' `package.json` `main`/`module` paths, compares mtime against latest `src/**` mtime, fails loud with `ERROR: <pkg>/dist stale vs src. Run: bun run build:ts` before any cascade layer runs. Mandatory in fix mode; warning in scan mode (preserves preview ergonomics).
- **Layer D volume signal.** **[receipt-derived]** When receipts include ≥1 Layer D file removal or ≥5 Layer D export removals across all iterations, append a `NOTE` to the summary: `Layer D removed N exports / M files. Build-time consumers (vite virtual modules, MDX, custom plugins) are invisible to knip — run \`bun run verify:build:*\` before committing.` Informational nudge proportional to blast radius.

### Tier 2 — fidelity & discoverability (should-have)

- **Layer C category-drift canary.** **[receipt-derived]** If Layer C invocation reports biome diagnostics present but produces zero `layer:"C"` receipts (i.e., zero deletions because no diagnostic matched `TARGET_CATEGORIES` after normalization), emit `WARN: biome diagnostics present but none matched known categories — biome may have renamed. Categories seen: <list>`. Surfaces session-89-shape silent-no-op regressions on day one of any biome version bump.
- **Reconciler span-preserving rewrite.** **[independent]** Replace the partial-clause synthesis path in `fixStaleBarrelReExports` (`el.getText(sf).join(', ')` reconstruction) with span-preserving deletions over the original source. Preserves leading-trivia JSDoc, biome-ignore directives, comments, and per-element `type` modifiers. Mirrors the deletion-range pattern already established in `delete-unused.ts`.
- **`--apply --all` confirmation gate.** **[independent]** Require explicit `--yes-apply-all` (non-TTY / agent invocation) or interactive `Type 'apply-all' to continue:` prompt (TTY). Differentiates the highest-blast-radius invocation from the daily-driver `--apply` (changed scope).
- **Help text shows env vars + resolved defaults.** **[independent]** `--base` line gains `(env: HYGIENE_BASE_REF, currently: $BASE_REF)`; `--iterations` similarly. Move help-text construction after env-var resolution so help reflects the actual defaults the run will use.

### Tier 3 — corner-case integration tests (ship as fixtures, fix opportunistically)

- **Function-overload-with-JSDoc fixture.** Three-overload function with a JSDoc block between signature and implementation. Asserts the overload group's deletion absorbs interleaved JSDoc trivia rather than orphaning it above unrelated code.
- **`export = X` (CJS) re-export fixture.** Two-file fixture: `.d.ts` with `export = X;` and a barrel that re-exports under the import binding name. Asserts reconciler does NOT strip the live re-export (current `getExportsOfFile` maps `ExportAssignment` to `default`, which can mismatch CJS-style consumer barrels).
- **Namespace/module declaration walker extension.** Extend `resolveTarget` in `delete-unused.ts` to recognize `ts.isModuleDeclaration` so unused top-level `namespace` / `module` declarations are deleted rather than silently skipped (currently silently no-ops on an iteration, contributing to cap-hit).

### Out of scope

- CRLF/BOM offset handling, `.gitattributes` filter behavior, JSON-escaped workspace names — accepted as documented limitations rather than blocking changes.
- Decorator multi-line edge cases — folded into Tier 3 only if the overload-JSDoc fix's trivia-handling improvements don't already address them.
- Auto-revert on envelope failure — explicitly retained as no-auto-revert per existing spec.
- Cross-run receipt history (`.hygiene/receipts.jsonl` is overwritten per run, not appended across runs). Multi-run trend analysis is a future change if ever warranted.

### Tradeoffs explicitly named

The receipt substrate is a deliberate increase in upfront design cost relative to in-place instrumentation. The named tradeoffs:

- **Schema design risk.** Receipts must agree on a stable shape across four heterogeneous emitters (bash Layer A wrapping biome, bash Layer B wrapping biome, TypeScript Layer C, bash Layer D wrapping knip + TypeScript Layer D1). Mitigation: minimal v1 schema with explicit version field; design.md fixes the v1 fields and emission contract.
- **Per-layer emission cost.** Bash layers must shell out to `jq` or use heredoc-with-printf to emit JSONL; TypeScript layers append directly. Mitigation: `scripts/hygiene/_receipts.sh` helper exposing one function `emit_receipt <layer> <iter> <verb> <target> [extras...]`.
- **Single-run scope.** Receipts overwritten per run; no historical trend. Acceptable per scope decisions; future-friendly if changed.

## Capabilities

### Modified Capabilities

- `code-hygiene`: adds the deletion-receipts emission contract as a new substrate-level requirement; refines orchestrator-output requirements (cap-hit verdict semantics + exit-code contract) to derive from receipts; adds dist-staleness precondition; adds Layer D volume signal; adds Layer C category-drift canary; refines reconciler edit-strategy contract (span-preserving rather than synthesis-reconstruction); adds `--yes-apply-all` confirmation requirement for `--apply --all`; adds help-text-reflects-resolved-defaults requirement.

## Impact

**Code**:
- `scripts/hygiene/run.sh` — receipts-file lifecycle (truncate-at-start, gitignored), per-layer iteration tagging, post-cascade presenter invocation, dist-staleness gate, `--yes-apply-all` flag handling, help text refresh.
- `scripts/hygiene/_receipts.sh` — new helper exposing `emit_receipt` (bash callers) + format spec.
- `scripts/hygiene/presenter.ts` — new file. Reads `.hygiene/receipts.jsonl`, computes cap-hit verdict, Layer D volume, category-drift, emits final summary text + suggested exit code (orchestrator owns actual exit).
- `scripts/hygiene/delete-unused.ts` — emit Layer C receipts on each deletion; category-drift canary at `main()` startup; optional namespace/module support in `resolveTarget`.
- `scripts/hygiene/reconcile-after-knip.ts` — span-preserving rewrite for partial barrel-clause edits; emit Layer D1 receipts.
- `scripts/verify/_preconditions.sh` — new `require_dist_fresh_for_workspaces` helper following established `require_*` pattern.
- New fixture directory `scripts/hygiene/__fixtures__/` for adversarial-corner-case integration tests.
- New test file `scripts/hygiene/presenter.test.ts` — unit-tests presenter against synthetic receipt fixtures.
- `.gitignore` — add `.hygiene/`.

**Documentation**:
- `CLAUDE.md` § "Code Hygiene Workflow" — clarify `--apply --all` blast radius, document dist-freshness precondition, note build-time-only-export consideration with the new Layer D NOTE line as the canonical signal, document `.hygiene/receipts.jsonl` as the postmortem audit artifact.

**Contract**:
- Spec deltas under `code-hygiene` for the requirement refinements + new receipt-emission requirement.
- No breaking changes to existing CLI surface; `--yes-apply-all` is additive (omitted in agent invocations would be a behavior change — flag as advisory in spec text and roll out with one-week soft-warn period before hard-gate, OR hard-gate immediately and update agent-side hygiene invocations in the same change).

**Dependencies**:
- No new devDependencies. All work uses existing `typescript`, `bash`, `bun`, `jq` (already present on dev/CI machines).

**Pre-requisites**:
- `add-code-hygiene-protocol` archive should land first OR alongside this change so the spec deltas target the promoted `openspec/specs/code-hygiene/spec.md` rather than the in-flight version. Either order works; flag for sequencing. (Status at proposal time: `add-code-hygiene-protocol` is `isComplete: true` and ready to archive.)
