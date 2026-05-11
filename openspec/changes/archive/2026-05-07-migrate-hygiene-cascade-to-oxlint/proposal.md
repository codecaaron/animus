## Why

`migrate-lint-to-vp-check` (Phase α) shipped the user-facing lint/format cutover from biome to oxlint+oxfmt for the `verify:lint` atomic tier. That slice explicitly retained biome for the hygiene cascade because Layers A, B, and C consume biome 2.x `--reporter=json` output to drive coordinate-based deletion of intra-file dead declarations. This proposal (Phase β) executes that deferred cutover: rebind the hygiene cascade Layers A/B/C from biome to oxlint, remove `@biomejs/biome` from devDependencies, delete `biome.json`, and retire the `require_biome()` helper.

Three forcing functions:

1. **Phase α left a known governance artifact gap.** `migrate-lint-to-vp-check`'s Risk Acceptance documented retroactive proposal authoring as a one-time process violation. Phase β is the slice that closes the underlying technical gap (biome still installed because hygiene needs it). Until Phase β ships, `@biomejs/biome` cannot be removed and the repo carries two linter installations.

2. **Empirical JSON shape probe completed (this session).** Oxlint's `--format=json` output was probed against a fixture with deliberate `noUnusedVariables`, `noUnusedFunctionParameters`, and `noUnusedImports` violations. The shape is NOT byte-compatible with biome 2.x; an adapter pass is required (see `design.md` D1 for shape mapping). The mechanical port hypothesis was falsified — Phase β is a substantive rewrite of the Layer C deleter, not a JSON-key rebinding.

3. **Rule-name surface is asymmetric.** Biome's `noUnusedVariables` / `noUnusedFunctionParameters` / `noUnusedImports` (3 rules) collapse into oxlint's single `no-unused-vars` rule discriminated by diagnostic message-text prefix ("Variable 'X' is declared..." / "Function 'X' is declared..." / "Identifier 'X' is imported..."). The deleter's per-rule branching logic (`delete-unused.ts:307-313` filters `noUnusedFunctionParameters` to BindingElement-only) must be re-implemented as message-text discrimination. Fragile but tractable.

## What Changes

### Hygiene cascade Layer rebinding

- **Layer A (safe fixes)**: replace `bunx --bun @biomejs/biome check --write` with `bunx vp lint --fix-suggestions` (or equivalent — oxlint's `--fix` taxonomy verified via probe). Layer A's empirical scope expands slightly: oxlint's `--fix-suggestions` already removes unused imports, which biome required Layer B to handle separately. Layer A now covers safe-format-fixes AND unused-import deletion in one pass.
- **Layer B (unsafe-scoped delete)**: REMOVED. Under biome, Layer B handled `correctness/noUnusedImports` + `correctness/noUnusedPrivateClassMembers`. Under oxlint: unused-imports moves to Layer A (covered by `--fix-suggestions`); `no-unused-private-class-members` exists in oxlint's registry but follows ESLint 1:1 semantics (targets ECMAScript `#field` only, not TS `private` keyword) — Animus uses `private` keyword exclusively, giving the rule empty scope. Layer B is removed from the cascade; the cascade becomes A → C → D → D1.
- **Layer C (home-roll deleter)**: rewritten to consume oxlint JSON shape. `delete-unused.ts` becomes the JSON-shape adapter:
  - `BiomeReport` → `OxlintReport` type definitions
  - `category` field → `code` field (with `eslint(...)` wrapper unwrap)
  - `location.path` → `filename` (top-level field)
  - `location.start.{line,column}` → `labels[0].span.{line,column}`
  - `TARGET_CATEGORIES = {"correctness/noUnusedVariables", "correctness/noUnusedFunctionParameters"}` → `TARGET_CODES = {"eslint(no-unused-vars)"}` plus message-text discriminator function `classifyUnusedVar(message)` returning `"const"|"function"|"import"|"destructured"|"function-param"`
  - `noUnusedFunctionParameters` BindingElement-only filter (line 307-313) replaced with message-text-prefix branching
- **Layer D / D1 (knip)**: unchanged. Knip is independent of the linter; its JSON shape (`exports`, `files`, `dependencies`) stays as-is.

### Cascade orchestrator

- **`scripts/hygiene/run.sh`**: replace 7 biome invocations (lines 234, 244, 247, 263, 266, 277, 279) with their oxlint equivalents. The `BIOME=(bunx --bun @biomejs/biome)` array (line 234) becomes `OXLINT=(bunx vp lint)`. Layer-A and Layer-C functions invoke `--format=json` (matching the new flag name); Layer-B's `--only=...` filter syntax replaced with oxlint's `-D rule-name` deny-rule pattern (or equivalent — tasks.md verification).
- **`scripts/hygiene/_emit-biome-receipts.ts`** → renamed to `_emit-oxlint-receipts.ts` with the same emission contract (`v1` schema receipts with `iter`/`layer`/`verb`/`target`/`kind`) but the input-side parser updated to oxlint shape.
- **`scripts/hygiene/presenter.ts:201`**: `WARN: biome diagnostics present...` text updated to `WARN: oxlint diagnostics present...`. The category-drift detection logic generalizes: oxlint's `code` field replaces biome's `category` field as the drift discriminator.

### Test suite rewrite

- **`scripts/hygiene/delete-unused.test.ts`**: 21 tests. Most are JSON-shape contract tests against synthetic fixtures; rewrite all synthetic JSON to oxlint shape. The live-integration test at line 74 (`spawnSync('bunx', ['--bun', '@biomejs/biome', 'check', '--reporter=json', path])`) is the load-bearing one — replace with `spawnSync('bunx', ['vp', 'lint', '--format=json', path])`. Per `feedback_live_integration_vs_synthetic.md`, the live test catches synthetic-fixture-vs-real-tool divergence; preserve it through the cutover.
- **`scripts/hygiene/_emit-biome-receipts.test.ts`** (if exists): rewrite for oxlint shape.
- **`scripts/hygiene/presenter.test.ts:245-285`**: 4 tests reference `<biome>` as drift target and `WARN: biome diagnostics present`. Update to `<oxlint>` and `WARN: oxlint diagnostics present`.
- **`scripts/hygiene/reconcile-after-knip.test.ts:444-457`**: tests assert `biome-ignore` directive preservation. The directive comment syntax stays as `biome-ignore`-prefixed for repo continuity (existing comments in `packages/*/src/**` are not migrated as part of this slice). Test text unchanged; rationale documented in tasks.md as deliberate non-scope item.

### Dependency + config removal

- **Remove `"@biomejs/biome": "2.4.9"`** from root `package.json` `devDependencies`.
- **Delete `biome.json`** at repo root.
- **Remove `require_biome()`** from `scripts/verify/_preconditions.sh:102-104` and `require_code_hygiene_deps`'s biome-precondition call (line 124).
- **Update `_preconditions.sh`** to add `require_oxlint()` (or use `require_vp` since oxlint is bundled in vp@0.1.20). Most likely path: replace `require_biome` with `require_vp_lint` that probes `bunx vp lint --version`.

### Spec deltas

- **`code-hygiene` spec** (`openspec/specs/code-hygiene/spec.md`): MODIFY 5 requirements to replace biome-specific text with linter-neutral text:
  - `Side-effect imports are preserved` (lines 50-58): remove "Biome does not flag side-effect imports as unused by design" rationale; replace with "The active linter does not flag side-effect imports."
  - `Positional function parameters preserve arity via rename, not delete` (lines 60-68): remove "Biome's `noUnusedFunctionParameters` unsafe auto-fix renames..." reference; replace with rule-name-neutral text. Document under-the-hood that oxlint folds noUnusedFunctionParameters into no-unused-vars.
  - `Preconditions fail loud with actionable messages` (lines 168-181): replace "biome missing" scenario with "linter missing" scenario (oxlint via vp).
  - `noConsole auto-fix is excluded from Layer B` (lines 194-202): biome-specific rule reference. Update to "Layer B's linter invocation SHALL use rule-scoping that excludes any rule whose auto-fix would strip diagnostic logging output." (Generalizes; oxlint may have an equivalent `no-console` rule with similar fix behavior.)
  - `Layer C category-drift is detected at startup` (lines 249-264): biome 2.x JSON-shape-coupled. Update to oxlint shape: drift is detected via `code` field rather than `category` field; sentinel receipt extras becomes `extras.codesSeen` instead of `extras.categoriesSeen`.

### CI workflow

- **`.github/workflows/ci.yaml`**: hygiene cascade is end-of-work-only and never CI-invoked per the existing spec. No CI changes needed unless biome was referenced anywhere in CI (verified: only biome reference in CI was the line 26 `bun run check`, removed in Phase α).

This change is **NOT BREAKING for consumers** of `@animus-ui/*` packages. It IS breaking for any developer or agent that has scripts invoking `bunx --bun @biomejs/biome` directly outside the cascade — those callers must rebind to `bunx vp lint` (or accept that biome is no longer installed). At time of authoring, no such external scripts exist in the repo (verified via grep).

## Capabilities

### New Capabilities

(none — this slice rebinds an existing capability's tooling)

### Modified Capabilities

- `code-hygiene`: 5 requirements modified to remove biome-specific language and replace with linter-neutral text. Layer semantics preserved (A safe-fix + format, B scoped-delete, C home-roll intra-file deleter, D knip cross-file, D1 reconciler). Receipt schema preserved verbatim. Drift-detection mechanism preserved with field-name update (`category` → `code`). Cascade convergence semantics, safety envelope, recovery snapshot, end-of-work-only contract — all preserved unchanged.

## Impact

- **Code**:
  - `scripts/hygiene/delete-unused.ts` — rewritten as oxlint adapter
  - `scripts/hygiene/run.sh` — 7 biome invocations replaced
  - `scripts/hygiene/_emit-biome-receipts.ts` → `_emit-oxlint-receipts.ts`
  - `scripts/hygiene/presenter.ts:201` — drift WARN text + drift discriminator
  - `scripts/hygiene/delete-unused.test.ts` — 21 tests, all JSON fixtures rewritten + 1 live-integration test rebound
  - `scripts/hygiene/_emit-biome-receipts.test.ts` (if exists) — JSON fixtures rewritten
  - `scripts/hygiene/presenter.test.ts:245-285` — 4 tests text-updated
  - `scripts/verify/_preconditions.sh` — `require_biome` removed, `require_vp_lint` added (or equivalent)
  - `package.json` — `@biomejs/biome: 2.4.9` removed from devDependencies
  - `biome.json` — DELETED
  - `openspec/specs/code-hygiene/spec.md` — 5 MODIFIED requirements
- **Dependencies**: `@biomejs/biome: 2.4.9` REMOVED from devDependencies. Net dep count decreases by 1. `vite-plus@0.1.20` already installed (no change). `knip@^6` retained (unchanged). `typescript@6.0.3` retained (per typescript-toolchain).
- **CI**: no changes (hygiene is end-of-work-only, never CI-invoked).
- **Out of scope** (deferred to future slices):
  - `biome-ignore` directive comments in `packages/*/src/**` — left as-is. These serve as historical markers; oxlint's `oxlint-disable-` directives are the going-forward syntax (already adopted in `packages/showcase/src/pages/Examples.tsx:824`). Migration of `biome-ignore` to `oxlint-disable` is a separate cleanup slice (potentially mechanical via grep + replace, but not a hygiene-cascade concern).
  - `migrate-build-to-vp-pack` (umbrella enumeration) — tsdown → rolldown via `vp pack`. Independent of hygiene cascade.
  - `migrate-test-to-vp-test` (umbrella enumeration) — bun test → Vitest. Independent.
  - `resolve-clean-surface` (umbrella enumeration) — `vp cache` adoption. Independent.
- **Tradeoff**: oxlint's `no-unused-vars` rule covers what biome split into 3 separate rules. Per-rule branching in `delete-unused.ts` becomes per-message-text-prefix branching, which is more fragile (oxlint's diagnostic message text is part of the API surface that could change between versions). Mitigation: the `live-integration` test at `delete-unused.test.ts:74` exercises the real oxlint binary on every test run, so a message-text change would surface as a test failure rather than silent rejection — preserves the same regression-detection capability that biome's `lint/`-prefix change validated in session 89.

## Risk Acceptance

oxlint v1.x is more mature than biome 2.x for full-coverage repository linting in some senses (faster, more plugins) but has a less stable diagnostic message-text format (oxlint diagnostics text is part of the user-facing API but not version-pinned the same way as JSON field names). The hygiene cascade Layer C depends on this message-text format for rule discrimination.

**Specific exposure for this slice (hygiene cascade rebind):**

- **Message-text-coupled discriminator fragility.** Layer C now distinguishes `noUnusedVariables` (top-level decl) from `noUnusedImports` (import) from `noUnusedFunctionParameters` (binding element) by parsing oxlint's diagnostic message prefix. If a future oxlint version reformats these messages, the discriminator could silently mismatch. Mitigation: live-integration test at `delete-unused.test.ts:74` runs against the real oxlint binary on every cascade-test invocation. Any message-text change surfaces as a test failure; the version-bump regression class is contained by the same mechanism that caught session 89's silent no-op.
- **Phase α / Phase β interaction risk.** Phase α retained `_preconditions.sh:102-104` `require_biome()` to keep the hygiene tier callable. Phase β removes that helper. If any latent code path references `require_biome` outside `require_code_hygiene_deps`, it breaks silently. Mitigation: tasks.md includes a grep-probe for `require_biome` references before removal; expected zero matches.
- **Test-suite rewrite blast radius.** 25+ tests need JSON-fixture rewrite. The synthetic fixtures encode the deleter's "what should be deleted vs preserved" contract; rewriting them risks introducing semantic drift. Mitigation: per `feedback_live_integration_vs_synthetic.md`, the live-integration test at line 74 is the source of truth for shape correctness — rewrite synthetic fixtures by running the live test against a known fixture and copying the output, rather than hand-authoring.
- **Spec MODIFIED block semantics.** Per `feedback_openspec_modified_semantics.md`, MODIFIED delta blocks REPLACE the full requirement content on archive. This slice modifies 5 requirements in code-hygiene; if a sibling change also modifies any of these 5, the latest archive wins. Mitigation: confirm at archive time that no concurrent code-hygiene MODIFIED block is in flight.
- **biome-ignore directive non-migration.** Existing `biome-ignore` comments in source code remain valid syntax for biome but become inert after biome removal. They're treated as ordinary comments by oxlint (no rule-disabling effect) — could mask latent oxlint violations that biome was suppressing. Mitigation: tasks.md includes a step to grep for `biome-ignore` directives in `packages/*/src/**` and either (a) migrate to `oxlint-disable-` syntax mechanically, or (b) verify each one is no longer needed. Grep-and-classify before removal.
- **knip is unchanged but interacts with linter changes via convergence.** Layer D (knip) runs after Layers A/B/C; its input is the post-A/B/C state of the worktree. If oxlint-driven A/B/C diverge from biome's behavior (e.g., oxlint removes an import biome would have left, or vice versa), Layer D's input differs subtly. Mitigation: cascade convergence is receipt-derived per `presenter.ts`; the iteration-cap-based verdict surfaces divergence loudly. Spec invariant `Cascade iterates to convergence or iteration cap` survives the rebind.

**Maintainer signature**: implicit per sole-maintainer convention. Acceptance scope: hygiene cascade rebind only. Does NOT extend to `migrate-build-to-vp-pack`, `migrate-test-to-vp-test`, `resolve-clean-surface`, or any future vp-related cutover.
