## Context

Phase α (`migrate-lint-to-vp-check`) shipped the user-facing lint/format cutover from biome to oxlint+oxfmt. The hygiene cascade (Layers A/B/C/D/D1) was explicitly retained on biome because biome 2.x `--reporter=json` output drives coordinate-based deletion in Layer C and emission of structured receipts in Layers A/B. Phase β executes the deferred cutover: hygiene cascade Layers A/B/C rebind from biome to oxlint, `@biomejs/biome` removed from devDependencies, `biome.json` deleted, `require_biome()` retired.

Pre-this-slice state (post-Phase-α):

- `verify:lint` runs oxlint+oxfmt via `vp lint && vp fmt --check` (Phase α). User-facing biome wrappers in `package.json` deleted (Phase α).
- `scripts/hygiene/run.sh` invokes biome via `BIOME=(bunx --bun @biomejs/biome)` at lines 234, 244, 247, 263, 266, 277, 279.
- `scripts/hygiene/delete-unused.ts` parses biome 2.x diagnostic JSON shape (lines 25-31).
- `scripts/hygiene/_emit-biome-receipts.ts` parses same shape for Layer A/B receipt emission.
- `scripts/hygiene/presenter.ts:201` emits `WARN: biome diagnostics present...` text.
- 25+ tests across `scripts/hygiene/{delete-unused,_emit-biome-receipts,presenter,reconcile-after-knip}.test.ts` consume biome-shaped synthetic JSON fixtures and (in `delete-unused.test.ts:74`) spawn the real biome binary as a contract test.
- `@biomejs/biome: 2.4.9` in root `devDependencies`. `biome.json` at repo root.
- `scripts/verify/_preconditions.sh:102-104` defines `require_biome()` consumed by `require_code_hygiene_deps` at line 124.

Empirical probe completed (this session, against `.oxprobe/violation.ts`):

- `vp lint --format=json` exists and emits structured diagnostics. Confirmed via `bunx vp lint --help` and round-trip on the fixture.
- Output shape is NOT byte-compatible with biome 2.x. Adapter required (D1 below).
- Rule-name surface differs: oxlint's `no-unused-vars` covers what biome split into `noUnusedVariables` + `noUnusedFunctionParameters` + `noUnusedImports` (3 distinct biome rules). Discriminator must shift from rule-name (biome) to message-text prefix (oxlint).
- `vp lint --fix` (default safe) does NOT remove unused declarations. `vp lint --fix-suggestions` removes unused IMPORTS but leaves top-level const/function. `vp lint --fix-dangerously` removes neither in our test (counter-intuitive but matches oxlint's "dangerous = behavior-change" semantic, which import removal isn't).

Stakeholders: Aaron (sole repo author / sole maintainer). Sole-maintainer convention; risk acceptance documented in `proposal.md` Risk Acceptance section.

## Goals / Non-Goals

**Goals:**

- Replace biome with oxlint as the linter backend for hygiene cascade Layers A/B/C. Layer D (knip) and Layer D1 (reconcile-after-knip) unchanged.
- Adapt `delete-unused.ts` to consume oxlint's JSON shape (D1) and use message-text prefix as the rule-class discriminator (D2).
- Reorganize the layer scope based on what `vp lint --fix-suggestions` already covers: Layer A grows to include unused-import removal (was Layer B); Layer B contracts to noUnusedPrivateClassMembers-only (and may be eliminated entirely if oxlint has no equivalent rule).
- Remove `@biomejs/biome` from devDependencies. Delete `biome.json`. Remove `require_biome()` helper.
- Update 5 requirements in `code-hygiene/spec.md` to remove biome-specific language. Preserve all layer-semantic contracts (A safe-fix, B scoped-delete, C intra-file deleter, D knip, D1 reconcile), receipt schema, convergence semantics, safety envelope, end-of-work-only contract.
- Preserve the live-integration test at `delete-unused.test.ts:74` rebound to spawn `vp lint --format=json` instead of biome. This is the load-bearing regression-detection mechanism per `feedback_live_integration_vs_synthetic.md`.

**Non-Goals:**

- No `biome-ignore` directive migration in `packages/*/src/**`. Existing comments stay as-is; their migration to `oxlint-disable-` syntax is a separate cleanup slice (mechanical grep+replace OR per-comment validation). Tasks.md includes a grep-probe step to enumerate them so the maintainer can decide.
- No tsdown → rolldown migration (`migrate-build-to-vp-pack`).
- No `bun test` → Vitest migration (`migrate-test-to-vp-test`).
- No `vp cache` cleaning surface adoption (`resolve-clean-surface`).
- No new linter rules added to the cascade. The set of categories Layer A/B/C act on stays semantically identical: unused decls (intra-file), unused imports, unused private class members, format violations.
- No CI workflow changes. Hygiene is end-of-work-only.

## Decisions

**D1: JSON-shape adapter, not pass-through.**

Oxlint's JSON output shape (probed empirically):

```json
{
  "diagnostics": [
    {
      "code": "eslint(no-unused-vars)",
      "filename": ".oxprobe/violation.ts",
      "labels": [{"span": {"offset": 6, "length": 11, "line": 1, "column": 7}}],
      "help": "Consider removing this declaration.",
      "message": "Variable 'unusedConst' is declared but never used. Unused variables should start with a '_'.",
      "severity": "error",
      "url": "https://oxc.rs/...",
      "causes": [],
      "related": []
    }
  ],
  "number_of_files": 1,
  "number_of_rules": 147,
  ...
}
```

Biome 2.x shape (consumed by current `delete-unused.ts:25-31`):

```ts
type BiomeLoc = {
  path: string;
  start: { line; column };
  end: { line; column };
};
type BiomeDiagnostic = { category: string; location: BiomeLoc };
type BiomeReport = { diagnostics: BiomeDiagnostic[] };
```

Field-by-field mapping:

| Biome 2.x                               | Oxlint                                        | Notes                                                |
| --------------------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| `diagnostic.category`                   | `diagnostic.code`                             | oxlint wraps as `eslint(rule-name)`; strip wrapper   |
| `diagnostic.location.path`              | `diagnostic.filename`                         | top-level field, no nesting                          |
| `diagnostic.location.start.line`        | `diagnostic.labels[0].span.line`              | both 1-indexed                                       |
| `diagnostic.location.start.column`      | `diagnostic.labels[0].span.column`            | both 1-indexed                                       |
| `diagnostic.location.end.{line,column}` | derived from `labels[0].span.{offset,length}` | end = offset + length, mapped to line/col via source |

Adapter strategy: introduce an `OxlintReport` type alongside `BiomeReport`, write a `normalizeDiagnostic(d: OxlintDiagnostic): NormalizedDiag` function that produces the same shape `applyDeletions` already consumes internally. The downstream logic (`findNodeAtOffset`, `resolveTarget`, `expandToLineBounds`, `rangeForVarDeclOfMany`, `rangeForBindingElement`, `findOverloadGroupStart`) is shape-agnostic — it operates on TypeScript AST nodes once the source-offset is computed. Only the input parser changes substantively.

Alternative considered: write an oxlint-output → biome-shape converter and leave `applyDeletions` untouched. Rejected because (a) BiomeReport type names and `category` field name reading "biome" in the live code is misleading post-migration; (b) the converter doesn't simplify anything — same field-mapping logic, just wrapped differently.

**D2: Rule-class discrimination via message-text prefix, not rule-name.**

Biome distinguishes 4 rule classes via 4 distinct `category` strings:

- `correctness/noUnusedVariables` — top-level `const`/`let`/`var`/`function`/`class`/`type`/`interface`/`enum`
- `correctness/noUnusedFunctionParameters` — function parameter (positional or destructured)
- `correctness/noUnusedImports` — unused named import
- `correctness/noUnusedPrivateClassMembers` — unused private member

Oxlint folds the first three into one rule (`no-unused-vars`) plus uses `eslint-plugin-import`'s `no-unused-modules` for some import cases (PENDING verification). The discriminator within `no-unused-vars` is the diagnostic message prefix:

| oxlint message prefix                              | corresponds to biome rule           |
| -------------------------------------------------- | ----------------------------------- |
| `"Variable '<X>' is declared but never used..."`   | `noUnusedVariables` (const/let/var) |
| `"Function '<X>' is declared but never used..."`   | `noUnusedVariables` (function)      |
| `"Class '<X>' is declared but never used..."`      | `noUnusedVariables` (class)         |
| `"Type '<X>' is declared but never used..."`       | `noUnusedVariables` (type alias)    |
| `"Interface '<X>' is declared but never used..."`  | `noUnusedVariables` (interface)     |
| `"Enum '<X>' is declared but never used..."`       | `noUnusedVariables` (enum)          |
| `"Identifier '<X>' is imported but never used..."` | `noUnusedImports`                   |
| `"Parameter '<X>' is declared but never used..."`  | `noUnusedFunctionParameters`        |

The discriminator function `classifyUnusedVar(message: string): "decl" | "import" | "param"` parses the first word after `"`. Implementation: regex match against `^[A-Z][a-z]+ '/^Identifier '/^Argument '`. Fragile to oxlint message-text drift but the live-integration test at `delete-unused.test.ts:74` provides regression detection (per session-89 lesson, per `feedback_live_integration_vs_synthetic.md`).

Alternative considered: introspect oxlint's `code` field at finer granularity (e.g., is there a `eslint(no-unused-imports)` plugin code distinct from `eslint(no-unused-vars)`?). PENDING verification — if the plugin distinguishes, prefer code-based discrimination. Tasks.md probes both paths.

**D3: Layer A scope grows; Layer B removed entirely.**

Empirical finding from probe: `vp lint --fix-suggestions` removes unused imports automatically. Under biome, `correctness/noUnusedImports` was Layer B's responsibility (because biome's `--write` safe-fix did NOT remove imports — they required `--unsafe`). Under oxlint, `--fix-suggestions` covers it without unsafe-mode.

Rebinding consequence:

- **Layer A**: invokes `vp lint --fix-suggestions` (was `biome check --write`). Now removes unused imports in addition to safe format-fixes. Layer A's emission contract still holds — emit one receipt per observed diagnostic, log as `verb="format"` with `kind="format-only"` for non-deletion fixes and `kind="named-import"` with `verb="delete"` for import removals. `_emit-oxlint-receipts.ts` discriminates.
- **Layer B**: REMOVED. Empirical probe (this session) confirmed oxlint has `no-unused-private-class-members` in its rule registry (per `vp lint --rules`) — it follows ESLint 1:1 semantics, which means the rule targets ECMAScript `#field` syntax only and does NOT fire on TypeScript `private` keyword fields. Animus uses `private` keyword everywhere (no `#field` usage in `packages/*/src/**`), so the rule has empty scope under our codebase. Layer B is removed from the cascade entirely; the cascade becomes A → C → D → D1.

This decision affects the spec: `Single flag-driven hygiene entrypoint` requirement (which references "layers A (biome safe), B (biome unsafe-scoped delete), C (home-roll deleter), D (knip fix), D1 (reconcile-after-knip)") is updated to remove "biome safe" / "biome unsafe-scoped" qualifiers and to optionally remove Layer B if it becomes empty. Tasks.md includes the verification probe before committing the spec change.

Alternative considered: keep Layer B even if empty, as a placeholder for future linter-specific safe-rule scoping. Rejected because (a) empty layer is dead code, (b) cascade convergence verdicts (per `presenter.ts`) treat each layer as a deletion source — an empty layer would always emit zero receipts, contributing nothing to verdict computation.

**D4: `_emit-biome-receipts.ts` renamed, not in-place edited.**

The file is renamed `_emit-oxlint-receipts.ts` to make the linter binding visible in the filename. `run.sh:251` and `run.sh:270` invocations updated. Test file (if exists) renamed in lockstep.

Alternative considered: rename to `_emit-linter-receipts.ts` (linter-neutral). Rejected because (a) the file consumes a specific linter's JSON shape; the filename should reflect that surface; (b) future linter rebinding would create the same naming question — solving it once with `_emit-oxlint-receipts.ts` is honest about the current binding without being abstractly correct.

**D5: `biome-ignore` directive comments left as-is in source.**

`packages/*/src/**` contains an unknown number of `// biome-ignore lint/<rule>: <reason>` directive comments. Under oxlint, these become inert (no rule-disabling effect). They're not invalid syntax — just inert comments. Mass-migrating them to `oxlint-disable-` syntax is a separate cleanup slice with its own scope (mechanical grep+replace, but each one needs review for whether the ignore is still needed under oxlint's rule set).

This slice's scope: enumerate `biome-ignore` occurrences via grep, document the count in tasks.md, leave them in place. The maintainer decides separately whether to migrate.

**D6: Spec MODIFIED blocks: 5 requirements, all linter-specific language removed.**

Per `feedback_openspec_modified_semantics.md`, MODIFIED delta blocks REPLACE the full requirement content on archive. This slice modifies 5 requirements in `openspec/specs/code-hygiene/spec.md`:

1. `Side-effect imports are preserved` — remove biome rationale
2. `Positional function parameters preserve arity via rename, not delete` — remove biome rule reference
3. `Preconditions fail loud with actionable messages` — replace biome scenario with oxlint scenario
4. `noConsole auto-fix is excluded from Layer B` — generalize rule reference (still applicable to oxlint's `no-console`)
5. `Layer C category-drift is detected at startup` — `category` → `code`, `categoriesSeen` → `codesSeen`

Each MODIFIED block contains the full new text of the requirement, not a diff. Tasks.md confirms no concurrent change in flight modifies these requirements (otherwise archive ordering becomes load-bearing).

**D7: Live-integration test rebinding preserves regression-detection capability.**

`delete-unused.test.ts:74`'s live test currently spawns `bunx --bun @biomejs/biome check --reporter=json <fixture>` and asserts that oxc-rejected categories surface as `lint/correctness/noUnusedVariables`. This is the test that caught session 89's silent no-op (the biome 2.x `lint/`-prefix change).

Under oxlint, the equivalent test spawns `bunx vp lint --format=json <fixture>` and asserts:

- `diagnostics[].code` matches expected pattern (e.g., `eslint(no-unused-vars)`)
- `diagnostics[].filename` is the fixture path
- `diagnostics[].labels[0].span.line/column` are 1-indexed and point at the violation

If oxlint changes any of: the `code` wrapper format (`eslint(...)` → something else), the `filename` field name, the `labels` array shape, the `span` field schema — the live test fails loud. Same regression-detection mechanism, different contract surface.

## Risks / Trade-offs

- **[oxlint message-text drift between versions]** → Mitigated by D2 + D7 (live-integration test exercises the real binary every test run). Same mechanism that caught session 89.
- **[Phase β unblocks `@biomejs/biome` removal but couples to vp@0.1.20]** → ACCEPTED. vp+oxlint version pinning is the trade. Future linter rebind (e.g., to a different vp version's bundled oxlint) is a separate slice.
- **[Layer B empty-or-shrunken depending on oxlint's noUnusedPrivateClassMembers equivalent]** → Mitigated by D3 verification probe in tasks.md. If empty, Layer B removed; if rule exists, Layer B retained.
- **[`biome-ignore` comments inert under oxlint]** → ACCEPTED per D5. Tasks.md provides grep enumeration; maintainer decides on migration timing. Risk: latent oxlint violations that biome was suppressing become live errors. Mitigation: post-Phase-β `vp run verify:lint` should be clean against current HEAD before merging; if it's not, the inert directives were masking real violations and need to be addressed.
- **[Test rewrite synthetic-fixture risk]** → Mitigated per `feedback_live_integration_vs_synthetic.md`: rewrite fixtures by capturing live oxlint output rather than hand-authoring.
- **[knip interaction with linter-driven A/B/C state changes]** → Mitigated: cascade convergence is receipt-derived; iteration-cap-based verdict surfaces divergence loudly. Spec invariant survives.
- **[require_biome removal and dependent code paths]** → Mitigated by tasks.md grep-probe before removal.
- **[Spec MODIFIED collision risk]** → Mitigated by tasks.md confirm-no-concurrent-change step.

## Migration Plan

1. **Author this proposal + design + tasks + spec deltas.** (This step.)
2. **Empirical probes** (tasks.md §1):
   - Verify oxlint has `no-unused-private-class-members` equivalent rule (D3 unblocking).
   - Probe oxlint's diagnostic message text for function-parameter case (D2 message-prefix completion).
   - Probe `vp lint -D <rule>` deny-rule scoping syntax (Layer B replacement for biome's `--only=<rule>`).
   - Grep `biome-ignore` directive count in `packages/*/src/**` (D5 baseline).
   - Grep `require_biome` references outside `require_code_hygiene_deps` (zero expected; sanity check).
3. **Layer C rewrite** (tasks.md §2): adapter for oxlint JSON shape; message-text discriminator; tests rewritten with captured-from-live fixtures.
4. **Layer A/B rebinding** (tasks.md §3): `run.sh` updated; `_emit-biome-receipts.ts` renamed and rewritten; presenter drift WARN updated.
5. **Spec deltas** (tasks.md §4): 5 MODIFIED requirements drafted, validated.
6. **Dependency removal** (tasks.md §5): `@biomejs/biome` removed from `package.json`; `biome.json` deleted; `require_biome` removed from `_preconditions.sh`.
7. **End-to-end smoke** (tasks.md §6): `vp run hygiene` (scan mode) on a clean worktree; `vp run hygiene --apply` on a synthetic fixture; convergence verdict matches expected; receipts schema valid; safety envelope passes.
8. **Final verification** (tasks.md §7): `vp run verify:full` clean; `openspec validate migrate-hygiene-cascade-to-oxlint --strict` clean; rollback procedure verified on throwaway branch.
9. **Merge to `next`.** Single commit. Phase β shipped.

**Rollback path**: revert the commit. `package.json` re-adds `@biomejs/biome: 2.4.9`; `bun install` materializes it. `biome.json` restored from git history. `_preconditions.sh` `require_biome` restored. `scripts/hygiene/{delete-unused,run.sh,_emit-biome-receipts,presenter}.{ts,sh}` restored to biome bindings. Test files restored. Spec MODIFIED blocks reverted. Single-commit rollback.

## Open Questions

- **Oxlint's `noUnusedPrivateClassMembers` equivalent.** RESOLVED — rule exists in oxlint registry but follows ESLint 1:1 semantics (targets `#field` only, not TS `private` keyword). Empty scope under Animus codebase. Layer B REMOVED.
- **Oxlint's deny-rule flag syntax.** N/A — Layer B removed; no scoped invocation needed in this slice.
- **Oxlint diagnostic message-text for function parameters.** PENDING — probe in tasks.md §1. The discriminator function (D2) needs the exact prefix to discriminate function-parameter cases from other unused-vars cases.
- **`biome-ignore` directive migration timing.** RESOLVED — out of scope for this slice (D5). Maintainer decides separately.
- **Spec MODIFIED concurrency.** PENDING — confirm at archive time that no sibling change in flight modifies the same 5 code-hygiene requirements.
