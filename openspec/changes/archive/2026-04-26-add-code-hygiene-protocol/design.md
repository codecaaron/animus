## Context

Agents and humans finish changes carrying dead artifacts (unused imports, vars, exports, files, deps) they don't remember adding. The `verify:*` tier family is read-only by contract and will never mutate files. A separate end-of-work hygiene surface is needed — invocable by both humans and agents, explicitly NOT part of CI.

Two prior in-flight changes attempted this. Empirical verification THIS session (2026-04-24):
- fallow 2.x runs at ~5.3s on this repo; knip 6.6.2 runs at ~0.86s — knip is ~6× faster and catches real unused deps that fallow's `publicPackages: ["@animus-ui/*"]` wildcard was suppressing.
- `remove-unused-vars@0.0.12` crashes against biome 2.x JSON output (`TypeError: source.length` inside `createByteToCharConverter`). The package's `transformBiome()` still parses biome 1.x shape (`location.path.file`, `location.sourceCode`, `location.span[0]`); biome 2.x emits different fields (`location.path: string`, `location.start/end: {line, column}`). Package's own `node --test` matrix fails 7/7 on the biome branch. No open upstream fix. No usable fork.
- `tsr` (line/tsr) is a read-only archived mirror (user-verified). Not viable.

Biome 2.4.9 auto-fix semantics (empirically verified this session at `/tmp/hygiene-probe3/`):
- `noUnusedImports` unsafe: DELETES named imports, preserves side-effect imports (by design)
- `noUnusedVariables` unsafe: RENAMES `const`/`function`/`let` to `_`-prefix; offers NO fix for `class`/`type`/`interface`/`enum`/destructured-field
- `noUnusedFunctionParameters` unsafe: RENAMES to `_`-prefix (including trailing params — arity preserved, correct)
- `noUnusedPrivateClassMembers` unsafe: DELETES fields and method bodies cleanly
- `biome check --write` (safe, no `--unsafe`) applies NONE of these four — only formatting + `useConst`

Knip v6 capability surface (verified against knip.dev this session):
- `--fix` scopes: `dependencies`, `exports`, `types`, `files`, `catalog`
- `--allow-remove-files` opt-in for file deletion
- No `--dry-run`; git is the rollback mechanism
- No `--changed-since` / git-diff flag; scoping is workspace-granular via `--workspace`
- `classMembers` issue type REMOVED in v6 (breaking vs v5 / fallow)
- No NAPI plugin — platform tarballs need `ignoreDependencies`
- Plugin config overrides REPLACE, not merge

These empirical results define the decision space.

## Goals / Non-Goals

**Goals:**
- Deterministic, predictable cleanup of unused artifacts across the TS surface
- DELETE semantics (not rename) for dead decls
- Two scopes: `changed` (diff-based, default) and `all` (full repo)
- Two modes: `scan` (report only, default — safe default for agents) and `fix` (mutating, with safety envelope)
- Agent + human invocation parity through a single flag-driven entrypoint
- Grounding in this-session-verified tool behavior (no recall-based claims)

**Non-Goals:**
- CI / GitHub Actions wiring — explicitly end-of-work only
- Rust hygiene (orthogonal `add-rust-dep-hygiene` covers `cargo-machete`)
- Refactoring, import-reordering beyond biome's safe rules, any non-deletion rewrite
- Rename-based "fixes" for top-level decls
- MDX content scanning beyond knip's out-of-box plugin behavior
- Detection of unused non-private class members (biome covers private; knip v6 removed `classMembers`; accept as known gap)

## Decisions

### D1: Tool triad = biome + knip + home-roll deleter

**Alternatives considered:**
- `fallow + remove-unused-vars + biome` (prior arcs) — rejected: fallow 6× slower, `remove-unused-vars` broken against biome 2.x, `publicPackages` wildcard hid real unused deps.
- `biome + tsr + knip` — rejected: `tsr` is archived/read-only.
- `biome + home-roll-cross-file + home-roll-intra-file` — rejected: reimplementing knip's module-graph analysis is significant scope; knip does it well.

**Rationale:** Each tool occupies a disjoint domain. Biome = per-file lint detection + safe/unsafe auto-fix. Knip = cross-file module graph (exports, files, deps). Home-roll deleter = intra-file DELETE for decls biome refuses to delete. Composition is additive with clean boundaries.

### D2: Cascade order A → B → C → D, loop to convergence

- **Layer A. biome safe** (`biome check --write <files>`): formatting, `useConst`, other safe rules. Run first so downstream tools see canonical whitespace.
- **Layer B. biome unsafe-scoped** (`biome check --write --unsafe --only=correctness/noUnusedImports --only=correctness/noUnusedPrivateClassMembers <files>`): only the two rules biome deletes cleanly. Repeated `--only` flags are the session-88-verified benign form (`memory/feedback_no_biome_unsafe.md`). `--only` scoping is MANDATORY to exclude `noConsole`'s console-warn-stripping auto-fix.
- **Layer C. home-roll deleter**: consumes biome `--reporter=json` for `noUnusedVariables` diagnostics and deletes the enclosing declaration.
- **Layer D. knip fix** (`knip --fix --fix-type exports,types,dependencies,files --allow-remove-files [--workspace ...]`): cross-file export + file + dep cleanup.

**Rationale for ordering:** Intra-file cleanup (A/B/C) before cross-file (D) — every intra-file deletion reduces knip's workload. D's file-deletion can in turn make imports in other files unused, feeding back into A/B on the next iteration.

**Iteration:** loop until either (a) one full A→B→C→D pass produces zero git-diff change, or (b) iteration cap reached (default 5, flag-configurable via `--iterations`). Rationale: cross-file deletions cascade; loop until fixed-point.

### D3: Reject biome rename-to-underscore for top-level decls

Biome 2.4.9's `noUnusedVariables` unsafe auto-fix renames `const unusedFoo` to `_unusedFoo`. **Rejected** because rename leaves dead decls polluting the file, obscures what's live vs dead, and creates maintenance burden. Home-roll deleter applies the opposite semantic (DELETE the enclosing declaration statement).

**Exception:** `noUnusedFunctionParameters` rename-to-underscore IS the correct semantic for positional params (preserves arity contract — callers expect the function to accept N arguments). The cascade does NOT auto-apply this rule's fix; biome's warning is left for human review when the dev needs to decide whether the arity still matters.

### D4: Home-roll deleter algorithm

Runs `biome check --reporter=json <files>` internally. Parses biome 2.x diagnostic shape:

```jsonc
{
  "diagnostics": [
    {
      "category": "correctness/noUnusedVariables",
      "severity": "error" | "warning" | "info",
      "location": {
        "path": "packages/system/src/foo.ts",
        "start": { "line": 12, "column": 7 },
        "end":   { "line": 12, "column": 17 }
      },
      "message": { /* textual */ }
    }
  ]
}
```

(Biome 1.x shape `location.path.file` / `location.sourceCode` / `location.span[0]` is different; the deleter does NOT touch that shape.)

**Algorithm:**

1. Group diagnostics by `location.path`.
2. For each file:
   a. Read source.
   b. `ts.createSourceFile(path, source, ts.ScriptTarget.Latest, /* setParentNodes */ true)`.
   c. Convert biome's 1-indexed `line`/`column` to a character offset via a simple line-scan.
   d. For each diagnostic offset: descend the AST to the narrowest containing node; walk up until hitting one of: `VariableStatement`, `FunctionDeclaration`, `ClassDeclaration`, `TypeAliasDeclaration`, `InterfaceDeclaration`, `EnumDeclaration`, or (destructured-field case) `BindingElement`.
   e. Record the `(pos, end)` range.
   f. Special case: a `VariableStatement` containing multiple declarators — if only one is dead, remove just the matching `VariableDeclaration` + its trailing comma; preserve the rest.
   g. Special case: `BindingElement` in an `ObjectBindingPattern` or `ArrayBindingPattern` — remove the element + neighboring comma.
3. Sort ranges in reverse offset order and splice out each one. Reverse order preserves earlier offsets while splicing later ones.
4. Write the modified source back.

**Contract test** (`scripts/hygiene/delete-unused.test.ts`): fixtures run biome against a known-bad probe file, pipe output through the deleter, and assert the post-deletion file matches a golden. Tests assert against biome 2.x field names explicitly so a biome 3.x bump fails loud on a single known test rather than silently corrupting files.

### D5: Knip workspace derivation for `scope=changed`

Knip v6 has no `--changed-since`. Derivation:

1. `git diff --name-only "$BASE" -- '*.ts' '*.tsx' '*.js' '*.mjs' '*.cjs' '*.json'`
2. For each file, find the containing workspace: walk up the directory tree until hitting a `package.json` with a `"name"` field. Record the `name`.
3. De-duplicate. If the only match is the repo root (e.g., scripts-only changes), pass `--workspace .` or skip knip (knip operates at workspace granularity; root-only changes have no cross-file export semantics to check).
4. Invoke `knip --workspace <name1> --workspace <name2> ...`.

**Edge:** root-level config changes (e.g., `.knip.json`, `biome.json`, `tsconfig.base.json`) map to root — handle by invoking knip at root scope OR skipping; decision: skip in `changed` mode since a config-only diff has no symbol-graph delta.

### D6: Scan-mode snapshot mechanics

Knip has no `--dry-run`; scan mode needs a reproducible preview. Mechanism:

1. **Require clean worktree.** If `git status --porcelain` is non-empty, abort with: "scan mode requires clean worktree. Commit or stash changes and re-run." No force-flag.
2. **Snapshot for recovery:** `SNAPSHOT_SHA=$(git stash create)` — creates an orphan commit pointing at HEAD-tree state; can be recovered via `git stash store` or `git show <sha>` even after reset.
3. **Run cascade destructively** — same code path as fix mode, minus the safety envelope.
4. **Capture report:** `git diff --stat` + `git diff --name-status`.
5. **Restore:** `git reset --hard HEAD && git clean -fd`.
6. **Print snapshot SHA** at end: "recovery snapshot: $SNAPSHOT_SHA (recover via: `git stash store $SNAPSHOT_SHA` then `git stash pop`)".

Rationale for clean-worktree hard-requirement: the `reset --hard` + `clean -fd` restoration is catastrophic against uncommitted work. Adding a permissive force-flag invites accidents; the snapshot SHA is a recovery path but not a substitute for prevention.

### D7: Safety envelope — no auto-revert

Fix mode, post-convergence:

1. `bun run verify:compile`
2. `bun run verify:lint`

On ANY failure:
- Print the failing tool's output.
- Print `git status` + file list of hygiene mutations.
- Print recovery options: `git reset --hard HEAD` to discard, fix forward, or `git add -p` to keep partial.
- Exit non-zero. Do NOT auto-revert.

**Rationale:** Agent and human both know their working context better than the orchestrator does. A hygiene run on an already-dirty branch could entangle legitimate in-progress work with the hygiene mutations; automatic revert would destroy both. Keep agency with the invoker.

### D8: Invocation ergonomics — single flag-driven bash entrypoint

`scripts/hygiene/run.sh` is the sole orchestrator. Flags:

- `--mode=scan|fix` (default: `scan`)
- `--scope=changed|all` (default: `changed`)
- `--base=<git-ref>` (default: `main`; env override `HYGIENE_BASE_REF`)
- `--iterations=<n>` (default: `5`)

Bun script wrappers in `package.json`:

- `"hygiene": "bash scripts/hygiene/run.sh"` → passes flags through via `$@` semantics of bun scripts
- Invoke as `bun run hygiene`, `bun run hygiene --apply`, `bun run hygiene --all`, `bun run hygiene --apply --all`
- Internally, `--apply` sets `--mode=fix`; `--all` sets `--scope=all`. Raw `--mode=...` / `--scope=...` still work.

Agent invocation is identical — agents invoke via the Bash tool with the same flags. No skill shortcut is required for the MVP.

### D9: Supersession plan for prior in-flight changes

`add-diff-scoped-hygiene-cleanup` and `add-ts-static-analysis` are archived as part of this change's tasks, BEFORE this change itself is archived. Supersession steps per prior change:

1. Add a top-of-proposal note: `> SUPERSEDED by add-code-hygiene-protocol. Not implemented; see the new change for the authoritative design.`
2. `openspec archive <name> --skip-specs -y` (or equivalent — specs were never promoted, so archive-without-promoting is the intent).
3. Do NOT promote the prior changes' draft specs to `openspec/specs/`. Discard them.

This keeps the audit trail (prior changes remain in `openspec/changes/archive/`) without letting their design anchor future work or masquerade as authoritative.

## Risks / Trade-offs

- **[Risk: `noConsole` auto-fix strips `console.warn`]** → **Mitigation**: `--only=correctness/noUnusedImports,correctness/noUnusedPrivateClassMembers` in Layer B excludes it. Established repo feedback rule (`memory/feedback_no_biome_unsafe.md`). Verified safe against probe fixtures this session.
- **[Risk: home-roll deleter coordinate drift on biome version bump]** → **Mitigation**: contract test `scripts/hygiene/delete-unused.test.ts` asserts biome 2.x JSON field shape. Fails loud on biome 3.x.
- **[Risk: knip has no `--changed-since`]** → **Mitigation**: external workspace-derivation in `scope=changed` mode (D5). Granularity drop from file to workspace is acceptable since knip's analyses are inherently cross-file anyway.
- **[Risk: scan-mode `reset --hard` could destroy work if worktree is dirty]** → **Mitigation**: scan requires clean worktree (hard error); `git stash create` snapshot SHA is recovery path; SHA printed at end of each run.
- **[Risk: iteration loop non-termination on adversarial input]** → **Mitigation**: iteration cap (default 5, flag-configurable); early-exit on "no change across a full pass."
- **[Risk: safety envelope failure leaves partial mutations]** → **Mitigation**: explicit design choice to NOT auto-revert; clear documentation + actionable output listing recovery options. Trade-off is explicit — we prefer no-data-loss over no-partial-state.
- **[Risk: `knip@6.6.2` is fresh (released 2026-04-23)]** → **Mitigation**: pin to `^6` in `package.json` to pick up patch releases; if stability issues surface, tighten to exact version.
- **[Trade-off: DELETE-only, no rename]** → users wanting to mark symbols as intentionally-unused during dev use `// biome-ignore` inline suppression or `@public` / custom `@lintignore` JSDoc tags for knip. Not automating rename-as-signal is a deliberate choice.
- **[Known gap: unused non-private class members]** → biome covers private; knip v6 removed `classMembers`. Accepted as uncovered. Revisit if pain.

## Migration Plan

**Rollout:**
1. Implement per `tasks.md` (archive priors → install knip → scripts → preconditions → docs).
2. `bun install` picks up `knip@^6`.
3. Smoke test: `bun run hygiene` on clean worktree, verify the snapshot/restore cycle works and produces a readable diff report.
4. Smoke test: `bun run hygiene --apply` on a branch with known dead code, verify cascade converges and envelope passes.

**Rollback:** `git revert` the change commit; `bun install` restores prior lockfile. No CI state, no schema state, no external service state to unwind.

**Archival order (within this change):**
1. `openspec archive add-diff-scoped-hygiene-cleanup --skip-specs -y` (supersession note added first)
2. `openspec archive add-ts-static-analysis --skip-specs -y` (supersession note added first)
3. Implement `add-code-hygiene-protocol` end-to-end.
4. `openspec archive add-code-hygiene-protocol` (promotes `code-hygiene` spec to `openspec/specs/`).

## Open Questions

- **Q1**: Should the `hygiene` script default to `scan` (safe, current plan) or require explicit `--mode` (explicit, avoids surprise)? Defaulting to scan is the safer default — mutation is always behind `--apply`. Going with default=scan unless reviewed otherwise.
- **Q2**: Does knip auto-enable a Biome plugin on this repo, and does it produce useful signal? UNCLEAR from docs this session. Defer to calibration task — run knip with default config once, inspect, adjust `.knip.json` if needed.
- **Q3**: Expand home-roll deleter to handle other delete-candidate biome rules (`noUnusedLabels`, etc.)? MVP scope is `noUnusedVariables` + destructured-field subset of `noUnusedFunctionParameters`. Enlarge only if a concrete pain case emerges.
- **Q4**: Should we add a `.claude/skills/hygiene/` agent-shortcut skill in this change, or defer to a follow-on? Deferring — the skill would be a thin wrapper over `bun run hygiene --apply` that adds agent-specific framing (what to watch for, how to react to envelope failures). Low value for MVP; high value later once invocation patterns are established.
