## Context

The `code-hygiene` cascade ships in `add-code-hygiene-protocol`. Its kernel (Layer A biome safe → B biome unsafe-scoped → C home-roll deleter → D knip → D1 reconciler) deletes correctly. The surface that REPORTS what happened was built reactively as each layer was added: counters scattered across `scripts/hygiene/run.sh`, terminal lines accreted layer-by-layer, no centralized signal vocabulary.

A 3-persona practice review (SRE/ops, DX critic, adversarial test engineer) and the session-90 near-miss (`globalStyles` wipe in showcase + next-app, caught by Aaron at runtime not by any signal) showed the surface is dishonest in three load-bearing ways. The proposal frames this as **trust-delegation failure**: hygiene's value is offloaded vigilance — the user/agent delegates dead-decl removal to the tool rather than reviewing every diff. Each of the three failure modes (cap-hit-every-run, dist-stale silent corruption, Layer D blast unannounced) forces fallback to manual diff review, at which point the tool has zero net value.

**Constraints:**
- The kernel is correct — this change must not regress deletion semantics.
- `verify:*` tier conventions exist (`require_*` precondition helpers, fail-loud actionable error messages); hygiene should integrate, not invent.
- Cross-repo portability is a stated long-arc goal ("canary → abstract") — design choices that produce a portable artifact at the end have downstream value.
- Bash + TypeScript heterogeneity: layers run in mixed environments; any shared substrate must work for both.

**Stakeholders:** Aaron (primary user, end-of-work invoker); future Claude Code agents (programmatic invocation, parsed exit codes); a hypothetical SRE inheriting the tool (the receipt format becomes their first-day artifact).

## Goals / Non-Goals

**Goals:**
- Restore the trust contract by making every signal (WARN, NOTE, INFO, ERROR, exit code) carry real semantic load.
- Introduce a **signal substrate** (`.hygiene/receipts.jsonl`) from which the trust-relevant signals are computed, replacing scattered in-line counters.
- Provide a **postmortem audit artifact** so that when the safety envelope fails, the user has structured visibility instead of `git diff` archaeology.
- Produce a **portable abstraction surface** (the receipt schema) that can be re-implemented in another repo without re-implementing the cascade itself.
- Address the seven specific friction points identified by the review (Tier 1/2 items in the proposal).

**Non-Goals:**
- Cross-run receipt history. `.hygiene/receipts.jsonl` is overwritten per run; multi-run trend analysis is out of scope.
- Replacing or restructuring the cascade kernel. The kernel's layer ordering, deletion semantics, and iteration loop stay as specified in `add-code-hygiene-protocol`.
- Auto-revert on safety envelope failure (explicitly retained as no-auto-revert per existing spec).
- Detecting build-time-only export consumption automatically (Vite virtual modules, MDX, Rust extractor inputs). The Layer D volume NOTE is a *nudge*, not a precondition; users still own the call to run `verify:build:*`.
- CRLF/BOM offset handling, `.gitattributes` filter behavior, JSON-escaped workspace names — accepted limitations.

## Decisions

### D1: Deletion-receipts as the signal substrate (vs. five alternatives)

**Decision:** Each cascade iteration writes JSONL records to `.hygiene/receipts.jsonl`; the orchestrator's signal layer derives from receipt analysis via a separate presenter module.

**Alternatives considered (probability ranked when this design was gut-checked):**
- *In-place instrumentation* (P~50%): each layer accumulates inline counters, run.sh constructs summary text. Lowest delta from current code. Rejected because signals stay scattered across 200+ LOC of bash, the trust contract isn't articulable as a contract, and no portable artifact emerges.
- *Telemetry envelope* (P~10%): each layer emits structured events to stdout, run.sh parses. Similar to receipts but ephemeral (no postmortem artifact); no audit trail after a failed safety envelope.
- *Kernel/presenter split with typed RunResult* (P~10%): run.sh → `kernel.ts` → `presenter.ts`. Clean, but requires reshaping the orchestrator into a TS process; loses the bash-coordination ergonomics for preconditions and verify-envelope shellouts.
- *Pure invariant assertion* (P~4%): binary pass/fail per invariant, no gradient. Loses the WARN/NOTE distinction, which is real signal — Layer D NOTE is correctly informational, not alerting.
- *State-machine orchestrator* (P~15%): named states with transition events. Strong fit for the temporal positioning of signals (preconditions/during/summary) but bigger refactor than receipts and produces no artifact for postmortem.

**Why receipts (P~7% but spirit-fit 9/10):**
- Receipts ARE the audit trail. Postmortem is free.
- The receipt schema is the cross-repo abstraction surface — port the cascade by implementing layers that emit the same schema.
- Signal computation becomes a pure function of an inspectable file, unit-testable against synthetic fixtures.
- Survives bash/TypeScript heterogeneity: any layer can append a JSON line; consumption is centralized.
- Decouples WHEN-signal-is-emitted from WHO-consumes-it: agents could parse receipts directly without involving the presenter.

### D2: Receipt v1 schema (JSONL, single-run scope)

**Decision:** One JSON object per line. v1 fields:

```json
{"v":1,"iter":2,"layer":"C","verb":"delete","target":"packages/system/src/util.ts:42","kind":"const-decl","extras":{"name":"unusedHelper"}}
```

| field | type | required | meaning |
|---|---|---|---|
| `v` | integer | yes | schema version (`1` for v1) |
| `iter` | integer | yes | cascade iteration number, starting at 1 |
| `layer` | `"A"\|"B"\|"C"\|"D"\|"D1"` | yes | which layer emitted |
| `verb` | `"delete"\|"format"\|"stub"` | yes | what the operation did. `format` for Layer A whitespace-only changes; `stub` for Layer D1 empty-module fixes; `delete` everywhere else |
| `target` | string | yes | `<file>:<line>` for intra-file edits; `<file>` for whole-file deletions; `<file>:<exportName>` for export removals; `<package-name>` for dependency removals |
| `kind` | string | yes | semantic category (`"named-import"`, `"const-decl"`, `"function-decl"`, `"class-decl"`, `"type-alias"`, `"interface"`, `"enum"`, `"private-member"`, `"destructured-field"`, `"export-clause"`, `"export-default"`, `"file"`, `"dependency"`, `"empty-module"`, `"format-only"`) |
| `extras` | object | optional | layer-specific extras. Layer C records biome category here as `extras.category`; Layer D records knip issue type as `extras.issueType`; Layer A records the rule that fired |

**Format rationale:** JSONL (newline-delimited JSON) so emitters can append atomically without parsing prior content; consumers (`jq`, `presenter.ts`) read line-by-line. Schema versioning (`v` field) lets future changes evolve without breaking the v1 contract.

**Single-run scope:** file is truncated at orchestrator startup (`: > .hygiene/receipts.jsonl`). No across-run history; no cleanup logic needed. Predictable lifecycle.

### D3: Per-layer emission contracts

**Decision:**
- **Bash layers (A, B, D):** wrap their tool invocations in `_receipts.sh` helpers. Layer A and Layer B parse biome's JSON output (already used by Layer C) and emit one receipt per fix-applied diagnostic. Layer D parses knip's JSON output and emits one receipt per removal.
- **TypeScript layers (C, D1):** `delete-unused.ts` and `reconcile-after-knip.ts` emit receipts directly via `appendFileSync('.hygiene/receipts.jsonl', JSON.stringify(record) + '\n')`. Each module gets a small `emitReceipt(layer, kind, target, extras?)` helper that reads `HYGIENE_ITER` from env to tag the iteration.
- **Iteration tagging:** `run.sh` exports `HYGIENE_ITER` for each iteration (1, 2, 3...) before invoking layers; emitters read it. This decouples iteration tracking (orchestrator concern) from emission (layer concern).

**Helper interface (`scripts/hygiene/_receipts.sh`):**

```bash
emit_receipt() {
  # Args: layer iter verb target kind [extras_json]
  local layer="$1" iter="$2" verb="$3" target="$4" kind="$5" extras="${6:-{}}"
  printf '{"v":1,"iter":%d,"layer":"%s","verb":"%s","target":%s,"kind":"%s","extras":%s}\n' \
    "$iter" "$layer" "$verb" "$(jq -Rsn --arg t "$target" '$t')" "$kind" "$extras" \
    >> "$RECEIPTS_FILE"
}
```

`jq -Rsn` handles arbitrary characters in target paths safely.

### D4: Presenter as a TypeScript module, orchestrator owns exit code

**Decision:** `scripts/hygiene/presenter.ts` reads `.hygiene/receipts.jsonl`, parses each line, and computes:
- per-iteration deletion counts (partition receipts by `iter`)
- cap-hit verdict: `convergent` if last iter's delete count is zero; `divergent` otherwise
- Layer D volume: count of `layer="D"` receipts where `kind="file"` (file removals) + count where `kind="export-clause"|"export-default"` (export removals)
- Layer C category-drift: cross-reference with a separately-emitted `.hygiene/biome-diagnostics.json` from Layer C startup to detect "biome reported diagnostics, but zero Layer C receipts produced" → drift suspected

The presenter writes to stdout in human-readable form AND writes a structured verdict JSON to `.hygiene/verdict.json`. The orchestrator reads `verdict.json`'s `suggestedExitCode` and uses it as the exit code; the orchestrator owns the actual `exit N` because exit codes are a bash-side concern.

**Why TS for the presenter:** unit-testable against synthetic JSONL fixtures via `bun test`; stronger typing than bash + jq for the receipt-shape; reuses the patterns established in `delete-unused.ts` and `reconcile-after-knip.ts`.

**Why split presenter from orchestrator:** the presenter is pure (file-in, decisions-out); the orchestrator coordinates side effects (preconditions, layers, envelope, exit). Separating them lets us test the trust contract in isolation.

### D5: Cap-hit verdict semantics (the spec change)

**Decision:** Iteration cap hit + zero deletes in final iteration → `INFO: cascade settled at iteration cap (idempotent A/B/D churn caused fingerprint drift)` + exit 0. Iteration cap hit + nonzero deletes in final iteration → `WARN: cascade did not converge — Layer C/D still deleting at iteration N` + exit non-zero.

**Rationale:** The current behavior conflates "we hit the cap" with "we have a problem." Empirically (session-90), every run hits the cap because A/B fingerprint churn (whitespace, mtime, gitattributes filter) prevents `git diff HEAD` from being empty even when no semantic change is happening. Receipt-derived per-iter delete counts give us a semantic-stability metric independent of fingerprint churn.

**Edge case:** the *first* iteration that achieves zero deletes — even if the cap isn't hit — should also be reported as `convergent in N iterations`. The presenter computes this for free.

### D6: Layer D volume threshold (≥1 file OR ≥5 exports)

**Decision:** When receipts include ≥1 `layer="D" kind="file"` record OR ≥5 `layer="D" kind∈{export-clause,export-default}` records (across all iterations), append the Layer D NOTE to the summary.

**Rationale:** Files are higher-impact than exports (more likely to be a build-time consumer); a single file removal warrants the NOTE. Exports threshold is set at 5 because below that, the changes are typically intra-package barrel cleanup with low blast radius. Numbers are tuneable via constants in `presenter.ts`; not exposed as CLI flags (defaults work).

**Negative-fingerprint check:** if the threshold were 0/0 (i.e., NOTE on any Layer D activity), the NOTE would fire on every run that knip touches anything → noise. If threshold were 5/20, the NOTE would miss session-90's globalStyles wipe (1 file, ≥1 export) → silent corruption. The chosen 1/5 threshold catches the dangerous case without spamming.

### D7: Category-drift detection (Layer C startup canary)

**Decision:** At Layer C startup (`delete-unused.ts main()`), after parsing biome's JSON output, count diagnostics that match `TARGET_CATEGORIES` after normalization. If the count is non-zero, proceed normally (emit receipts as deletions happen). If biome reported diagnostics but ZERO matched after normalization, write a sentinel record to receipts: `{"v":1,"iter":N,"layer":"C","verb":"drift-suspected","target":"<biome>","kind":"category-drift","extras":{"categoriesSeen":["lint/correctness/X",...]}}`. Presenter sees this and emits the WARN.

**Rationale:** Session-89 had this exact silent-no-op bug — biome 2.x renamed categories with a `lint/` prefix; Layer C's filter required the unprefixed string; deleter went silent. 21 synthetic unit tests passed because they used the wrong-prefix string. A live canary keyed on the actual mismatch closes that whole class of regression.

### D8: Dist-staleness as a bash precondition (not receipt-derived)

**Decision:** Add `require_dist_fresh_for_workspaces` to `scripts/verify/_preconditions.sh`. Walks each targeted workspace's `package.json` `main`/`module` paths, compares the dist file's mtime against the latest `src/**` mtime (via `find packages/<X>/src -type f -newer packages/<X>/dist/index.js`). On any stale dist:
- Fix mode: ERROR + exit non-zero before any layer runs.
- Scan mode: WARN + continue (preserves preview ergonomics).

**Why not receipt-derived:** preconditions run BEFORE any receipt is written. They gate entry into the cascade. A precondition that wrote a receipt would invert the architecture — receipts are the post-action audit, not the gate.

**Workspace targeting:** in scope=changed mode, only the workspaces touched by the diff are checked; in scope=all mode, every workspace with a `dist/` is checked. Mirrors the existing `--workspace` derivation logic.

### D9: --apply --all requires explicit confirmation (CLI-side, not signal)

**Decision:** When `run.sh` detects `--apply` AND `--all`:
- TTY mode (`[ -t 0 ]`): prompt `Type 'apply-all' to continue: ` and refuse if input differs.
- Non-TTY mode (agent invocation, CI not applicable here per spec): require `--yes-apply-all` flag; refuse with actionable error if absent.

**Rollout:** hard-gate immediately. Update agent-side hygiene invocations in this same change (the relevant agent skill is `.claude/skills/hygiene/` if it exists; otherwise, document the new contract in CLAUDE.md and the hygiene-related skills point at CLAUDE.md). One-week soft-warn period rejected — the gate is for highest-blast-radius operation; users will appreciate the friction.

### D10: Reconciler span-preserving rewrite

**Decision:** Replace the partial-clause synthesis path in `fixStaleBarrelReExports` (currently `el.getText(sf).join(', ')` reconstruction over `NamedExports`) with span-preserving deletions. For a barrel `export { a, b, c } from './m';` where `b` is dead, instead of emitting `export { a, c } from './m';` from text reconstruction, compute the deletion ranges of `b` (including the comma + whitespace) and apply them to the original source via the same reverse-offset splice pattern used by `delete-unused.ts`.

**Why:** the synthesis path strips per-element trivia — JSDoc above an element, biome-ignore comments, per-element `type` modifiers. Span-preserving deletion keeps everything that wasn't deleted exactly as it was.

**Test harness:** Add fixtures under `scripts/hygiene/__fixtures__/reconciler/` covering: JSDoc above an export element, biome-ignore directive, `export { type Foo, bar }` mixed type/value, and `export = X;` CJS form.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Receipt schema design risk: emitters disagree on shape over time, receipts become the new accreted surface. | v1 schema fixed in this design + spec; `v` field allows controlled evolution; receipts validated on parse via TS types in presenter. |
| Bash emission ergonomics: `jq -Rsn` invocation per record adds startup cost; on a 200-deletion run, that's 200 forks. | Acceptable in absolute terms (`jq` startup is ~5ms; 200×5ms = 1s on a multi-second cascade run). If it becomes a bottleneck, switch the bash helper to a single python/perl one-liner that does JSON-escape inline. |
| Receipt file race: bash layers and TS layers writing concurrently could interleave partial lines. | Layers run sequentially within an iteration; only one writer at a time. JSONL with newline as record terminator means partial writes self-detect (incomplete final line ignored by parser). |
| Postmortem usefulness depends on receipts being written even on crash. | `appendFileSync` (TS) and `>>` (bash) are line-flushed; SIGINT during a cascade leaves a valid partial JSONL. Document in CLAUDE.md as the postmortem entry point. |
| `--yes-apply-all` introduces a behavior change for any existing agent skill that runs `--apply --all`. | Audit `.claude/skills/` for hygiene invocations in the same change; update or document. |
| Dist-staleness precondition could be over-strict if a workspace has no `src/` watcher (e.g., legacy or fixture packages). | Helper skips workspaces under `legacy/` and any package whose `package.json` lacks a `main`/`module` field. |
| Layer D volume threshold (1 file, 5 exports) tuned on session-90 data; could be wrong for other repos at abstraction time. | Thresholds defined as named constants in `presenter.ts`; abstraction proposal can parameterize them. Not exposed as CLI flags now — defaults serve the canary. |
| Span-preserving reconciler rewrite could regress the existing synthesis path's behavior on edge cases not yet covered by fixtures. | Tier 3 fixtures (overload-JSDoc, `export = X`, namespace) added in same change; existing reconciler test suite (15 tests) extended to assert trivia preservation. |
| Cap-hit verdict relies on per-iter delete counts; if any layer fails to emit receipts on a deletion, the verdict mis-classifies. | Receipt emission is a hard contract per layer (spec requirement); presenter can fall back to current `git diff HEAD` fingerprint as a sanity check (i.e., if presenter says "convergent" but `git diff` is dirty in the final iter, downgrade to WARN). |

## Migration Plan

This change is fully additive — no existing behavior is removed; signals get more accurate, an audit artifact appears.

**Step 1 — substrate (no user-visible change):**
- Add `_receipts.sh` helper, `presenter.ts`, presenter unit tests.
- Wire `RECEIPTS_FILE` truncate at run.sh startup.
- Add receipt emission to all five layers (A/B/C/D/D1) without changing any current signaling logic.
- After this step, receipts are written but the orchestrator still uses its existing summary path.

**Step 2 — presenter takes over signaling:**
- Replace orchestrator's inline cap-hit message with presenter-derived verdict.
- Add Layer D volume NOTE.
- Add category-drift WARN.

**Step 3 — preconditions and CLI gates:**
- Add `require_dist_fresh_for_workspaces` precondition.
- Add `--yes-apply-all` gate.
- Refresh help text to show env-var resolution.

**Step 4 — reconciler & fixtures:**
- Span-preserving rewrite in `fixStaleBarrelReExports`.
- Add Tier 3 corner-case fixtures.
- Extend `resolveTarget` to handle `ts.isModuleDeclaration`.

**Step 5 — documentation:**
- Update CLAUDE.md § Code Hygiene Workflow.
- Document `.hygiene/receipts.jsonl` as the postmortem entry point.

**Rollback:** revert `presenter.ts` invocation in `run.sh` and the orchestrator falls back to its current inline-summary behavior. Receipts continue to be written but unused — harmless. Each step is independently revertable.

## Open Questions

- **Should presenter consume `.hygiene/receipts.jsonl` strictly, or also accept stdin for ad-hoc replay?** Lean: file-only for v1 (simpler); stdin replay is a future affordance.
- **Should the receipt schema include a `runId` (UUID) for cross-tool correlation?** Lean: not in v1 (single-run scope makes it redundant); add when cross-run history is added if ever.
- **Naming: `_receipts.sh` or `receipts.sh`?** Helper convention in `scripts/verify/` uses leading underscore for internal-use bash files (`_preconditions.sh`); follow that. Decision: leading underscore.
- **Should the dist-staleness check include `extract/dist/` (a NAPI-adjacent TS dist) or only the pure-TS dist set?** Lean: include — knip resolves cross-workspace via package.json regardless of NAPI. Verify in implementation; the precondition helper accepts any workspace with `main`/`module`, which extract has.
