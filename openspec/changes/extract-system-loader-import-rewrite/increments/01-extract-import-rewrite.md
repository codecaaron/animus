# Increment 01: extract system-loader import rewriting

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans` to
> execute this packet task by task. Checkpoints are logical only; this packet
> contains no version-control action.

**Goal:** Extract the private import-specifier renderer while preserving every
existing rewritten byte and all surrounding shared-loader boundaries.

**Architecture:** Keep OXC parsing, require-key lookup, declaration spans,
rewrite-op insertion, export routing, and bundle execution in their current
owners. Move only non-empty import-specifier rendering into one borrowed,
private helper and pin the old outputs with a direct pre/post matrix.

**Tech stack:** Rust 1.97, OXC AST/parser, Cargo, Vite+ verification, RepoWise
Distill.

---

## Scope

- **Registry row**: 01 · mode: delegate · review: subagent
- **Resolves**: D1, D2, D3, D4, D5, DEF-8
- **Authors**: — (envelope)
- **Depends on (ordering — deps:)**: none
- **Inputs from (information — inputs:)**: none; the row was envelope-licensed
  and already executing before the later STOP/resumption signal
- **Footprint**: `packages/extract/crates/system-loader/src/lib.rs` and this
  packet's completion fields only
- **Pushes to a later increment**: none; DEF-1 through DEF-7 remain externally
  signaled deferrals; DEF-8 resolved to D5 before resumption

> Resolving signal that licensed creating this increment now: the envelope
> decided D1-D4 after live RepoWise/source evidence isolated a clean private
> branch with exact string outputs and no active OpenSpec owner.
>
> Mid-run resumption signal: `change:harden-embedded-transform-integration#02`
> completed at 2026-07-19 11:37 after G6 had already stopped this row. It
> resolves DEF-8 to D5 but is not a packet-creation `inputs:` edge.

## Context Capsule

- **Objective**: Add one exact import-output matrix while the inline
  implementation remains present, prove it GREEN and the helper structure RED,
  then extract only non-empty specifier rendering. Preserve require-key lookup,
  bare imports, span operations, exports, runtime evaluation, public APIs, and
  every pre-existing dirty increment.
- **Verified finding disposition**: `rewrite_module_for_bundle()` is a valid
  critical-method lead (208 NLOC, CCN 30, cognitive complexity 136, nesting 8).
  RepoWise plan `d616f5bdcb084ef8b0158521888ad178` isolates the import branch;
  whole-function flattening and the other file findings are outside this row.
- **Exact current outcomes**:
  - unresolved import key → `__stub__/<specifier>`;
  - bare import (`None`) and explicit empty clause (`Some([])`) →
    `__require('<key>')`;
  - same-name named binding → `{ name }`; alias → `{ imported: local }`;
  - default binding precedes named destructuring, joined by `;\n`;
  - namespace binding produces one direct `const`;
  - default plus namespace currently produces only the namespace binding.
- **Current baselines**: target SHA-256
  `e961b0b4b415e0eb4163e55644398728af59005a9ca2bc30a4d35aeaed88b169`;
  protected foreign tracked diff
  `73cdd94fbb9e62a831fc9dc36ab749e72c6d24ddd7cea416416556eebd8668e8`;
  system-loader units 8 passed/1 ignored at `repowise#6f66414ad971`;
  focused test filter currently finds zero tests with nine filtered.
- **Relevant resolved decisions**: D1 one private renderer for non-empty
  specifiers; D2 exact characterization before edit; D3 preserve namespace
  dominance; D4 full shared-loader boundary protection and mapped verification;
  D5 resume only after the fixture owner repairs the committed parity oracle.
- **Existing spec context**:
  `§arch-system-loader-import-rewrite/Isolated byte-stable import rewriting`
  already covers this row; no requirement draft is owed.
- **In-scope North Star**: NS1 exact bytes; NS2 one renderer owner; NS3 stable
  surrounding boundaries; NS4 full downstream oracle; NS5 provisional
  namespace dominance.
- **Prohibitions**: never use mutative Git. Do not write outside the declared
  footprint plus this packet's checkboxes/results. Do not edit `design.md`,
  `tasks.md`, `journal.md`, `specs/`, manifests, dependencies, export arms,
  reverse-span application, trailing exports, dependency resolution,
  `execute_bundle()`, extraction, eval, public APIs, or V1/V2 engine code.

## Plan

### Task 01.1: Characterize existing import outputs first

- [x] Confirm the target is still clean, its SHA-256 is the packet baseline,
  and G5 still matches before editing:

```bash
git status --short -- packages/extract/crates/system-loader/src/lib.rs
shasum -a 256 packages/extract/crates/system-loader/src/lib.rs
git diff -- . ':(exclude)packages/extract/crates/system-loader/src/lib.rs' | shasum -a 256
```

Expected: empty target status, target hash `e961b0...b169`, foreign hash
`73cdd9...e8e8`. STOP on drift and report it without editing.

- [x] Add this test inside the existing `#[cfg(test)] mod tests` in
  `packages/extract/crates/system-loader/src/lib.rs`, immediately after
  `strip_module_with_imports_and_exports()`:

```rust
    #[test]
    fn import_rewrite_preserves_existing_output_matrix() {
        let stub_map = HashMap::new();

        assert_eq!(
            rewrite_module_for_bundle("import 'bare';", "/entry.ts", &stub_map).unwrap(),
            "__require('__stub__/bare')"
        );
        assert_eq!(
            rewrite_module_for_bundle(
                "import {} from 'empty';",
                "/entry.ts",
                &stub_map,
            )
            .unwrap(),
            "__require('__stub__/empty')"
        );
        assert_eq!(
            rewrite_module_for_bundle(
                "import { same, source as local } from 'pkg';",
                "/entry.ts",
                &stub_map,
            )
            .unwrap(),
            "const { same, source: local } = __require('__stub__/pkg')"
        );
        assert_eq!(
            rewrite_module_for_bundle(
                "import Default, { same, source as local } from 'pkg';",
                "/entry.ts",
                &stub_map,
            )
            .unwrap(),
            "const Default = __require('__stub__/pkg').default;\nconst { same, source: local } = __require('__stub__/pkg')"
        );
        assert_eq!(
            rewrite_module_for_bundle(
                "import * as namespace from 'pkg';",
                "/entry.ts",
                &stub_map,
            )
            .unwrap(),
            "const namespace = __require('__stub__/pkg')"
        );
        assert_eq!(
            rewrite_module_for_bundle(
                "import Default, * as namespace from 'pkg';",
                "/entry.ts",
                &stub_map,
            )
            .unwrap(),
            "const namespace = __require('__stub__/pkg')"
        );

        let resolved_map = HashMap::from([(
            ("/entry.ts".to_string(), "pkg".to_string()),
            "/canonical/pkg.ts".to_string(),
        )]);
        assert_eq!(
            rewrite_module_for_bundle(
                "import { same } from 'pkg';",
                "/entry.ts",
                &resolved_map,
            )
            .unwrap(),
            "const { same } = __require('/canonical/pkg.ts')"
        );
    }
```

- [x] Run G3 before production editing. Expected: one passing test, including
  distinct OXC `None` and `Some([])` import-declaration paths. If an expected
  string is wrong, STOP and return the observed mismatch; do not change
  production to satisfy the test.

- [x] Run G2 before production editing. Expected honest structural RED:
  `0`, `0`, `3`.

- [x] Rerun the full system-loader unit baseline. Expected: 9 passed and 1
  ignored after adding the new test.

```bash
RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/crates/system-loader/Cargo.toml --lib
```

### Task 01.2: Extract only non-empty specifier rendering

- [x] Insert this private helper immediately before
  `rewrite_module_for_bundle()`:

```rust
fn rewrite_import_specifiers(
    specifiers: &[oxc::ast::ast::ImportDeclarationSpecifier<'_>],
    require_key: &str,
) -> String {
    let mut destructure_parts = Vec::new();
    let mut default_name: Option<String> = None;
    let mut namespace_name: Option<String> = None;

    for specifier in specifiers {
        match specifier {
            oxc::ast::ast::ImportDeclarationSpecifier::ImportSpecifier(import) => {
                let imported = match &import.imported {
                    oxc::ast::ast::ModuleExportName::IdentifierName(id) => {
                        id.name.to_string()
                    }
                    oxc::ast::ast::ModuleExportName::IdentifierReference(id) => {
                        id.name.to_string()
                    }
                    oxc::ast::ast::ModuleExportName::StringLiteral(literal) => {
                        literal.value.to_string()
                    }
                };
                let local = import.local.name.to_string();
                if imported == local {
                    destructure_parts.push(imported);
                } else {
                    destructure_parts.push(format!("{}: {}", imported, local));
                }
            }
            oxc::ast::ast::ImportDeclarationSpecifier::ImportDefaultSpecifier(default) => {
                default_name = Some(default.local.name.to_string());
            }
            oxc::ast::ast::ImportDeclarationSpecifier::ImportNamespaceSpecifier(namespace) => {
                namespace_name = Some(namespace.local.name.to_string());
            }
        }
    }

    let mut parts = Vec::new();
    if let Some(namespace_name) = namespace_name {
        parts.push(format!(
            "const {} = __require('{}')",
            namespace_name, require_key
        ));
    } else {
        if let Some(default_name) = default_name {
            parts.push(format!(
                "const {} = __require('{}').default",
                default_name, require_key
            ));
        }
        if !destructure_parts.is_empty() {
            parts.push(format!(
                "const {{ {} }} = __require('{}')",
                destructure_parts.join(", "),
                require_key
            ));
        }
    }
    parts.join(";\n")
}
```

- [x] Inside only the `Statement::ImportDeclaration` arm, replace the old
  `parts`/specifier-state/early-continue block with this replacement
  construction, retaining the existing require-key lookup and `RewriteOp`
  spans:

```rust
                let replacement = match &decl.specifiers {
                    Some(specifiers) if !specifiers.is_empty() => {
                        rewrite_import_specifiers(specifiers, &require_key)
                    }
                    _ => format!("__require('{}')", require_key),
                };

                ops.push(RewriteOp {
                    start: decl.span.start as usize,
                    end: decl.span.end as usize,
                    replacement,
                });
```

- [x] Run G2. Expected final structural GREEN: `1`, `2`, `0`.

- [x] Run G3 and the full system-loader unit command. Expected: focused 1/1;
  full 9 passed/1 ignored.

### Task 01.3: Format, verify, and self-review

- [x] Run read-only Rust 1.97 formatting. If it reports a target hunk, apply
  only that formatter-proven hunk; do not format unrelated files.

```bash
RUSTUP_TOOLCHAIN=1.97.0 rustfmt --edition 2021 --check packages/extract/crates/system-loader/src/lib.rs
```

- [x] Run G1-G5 exactly. Any mismatch is a STOP trip.
- [x] Run G6 in exact order. Follow only a printed fail-loud prerequisite
  remediation, using `repowise distill` for that command as well.
- [x] Run `git diff --check`; inspect the target-only diff and confirm it
  contains one exact output test, one private helper, and one bounded call-site
  replacement with no export/eval/runtime changes.
- [x] Update only this packet's completion fields with exact evidence,
  proposed journal entries, and surfaced variables. Do not edit `tasks.md`.

## Guardrail gate

- [x] G1 public system-loader boundary:
  `git diff --unified=0 -- packages/extract/crates/system-loader/src/lib.rs | rg '^[+][^+].*pub (struct|fn|enum|const|type)|^[-][^-].*pub (struct|fn|enum|const|type)' || true`
  — result: exit 0 with empty output; no public boundary changed
- [x] G2 one helper/one call/old state absent: run the three G2 commands from
  `design.md` — result: pre-production `0`, `0`, `3`; final `1`, `2`, `0`
- [x] G3 exact import matrix:
  `RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/crates/system-loader/Cargo.toml tests::import_rewrite_preserves_existing_output_matrix --lib`
  — result: exit 0; 1 passed, 0 failed, 9 filtered out
- [x] G4 protected export/runtime token search:
  `git diff --unified=0 -- packages/extract/crates/system-loader/src/lib.rs | rg '^[+-][^+-].*(Statement::Export|trailing_exports|ops\.sort_by_key|replace_range|execute_bundle|extract_system_config|ctx\.eval)' || true`
  — result: exit 0 with empty output; no protected export/runtime token changed
- [x] G5 protected foreign diff:
  run all three revised G5 commands from `design.md`: protected diff excluding
  only the target and reviewed repair artifacts; exact five repair-artifact
  hashes; retained three-transition diagnostic search — result: protected
  diff `73cdd94fbb9e62a831fc9dc36ab749e72c6d24ddd7cea416416556eebd8668e8`;
  repair artifacts `37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570`,
  `3d19fc34bd8d8cba529f7240780b641bf092fd83ec7338338356c2e317cf07e8`,
  `9227b850063f7d5d3f2ca2037f87ea0c2a61397a378861468cad82ef321128aa`,
  `a1b2e39f7d4cbe130bbbe9770d1d48fc9ad7e43bd273c207a3e72a3e80cd0592`,
  `86b7b77ab2259afcbc5bb08f85cabdb517adecf2ac47c7eaa25d59141fe36f3d`;
  retained diagnostic found CSS, code, and observables transitions in both
  production and development modes
- [x] G6 mapped chain: strict Clippy → Rust dependency hygiene → Rust units →
  NAPI canary → parity → integration — result: strict Clippy and Rust dependency
  hygiene exited 0; Rust units 638 passed/1 ignored at
  `repowise#bd2833b48b50`; initial canary stopped fail-loud on the stale NAPI
  binary, exact remediation `repowise distill vp run build:extract` exited 0,
  and the fresh canary passed 200/200 with 0 failures, 4 snapshots, and 432
  expects; resumed parity passed production 48/48 and development 48/48 with
  0 divergences plus seam battery 14/14; integration passed 157/157 across 11
  files

## Output contract (delegate mode)

- [x] Plan checkboxes above reflect actual completion
- [x] Authors is envelope-covered; no requirement draft is owed
- [x] Guardrail gate results include exact command evidence
- [x] Proposed journal entries (surprise / friction / signal), 1-3 lines each
- [x] Surfaced variables (spawn candidates) recorded below

### Execution evidence

Result: DONE. The target-only diff is one exact output matrix, one private
helper, and one bounded import-arm call-site replacement (`+120/-73`). Rust
1.97 `rustfmt --check` and `git diff --check` both exited 0. The target diff has
no public, export, reverse-span, execution, extraction, or eval boundary change.

Pre-production evidence: the focused matrix passed 1/1 with 9 filtered; G2 was
the honest structural RED `0/0/3`; full loader units then passed 9 with 1
ignored at `repowise#ffcef52fc482`. Post-extraction evidence: G2 was `1/2/0`,
the focused matrix passed 1/1 with 9 filtered, and full loader units passed 9
with 1 ignored at `repowise#7b9058d2c102`.

G6 was paused when parity correctly rejected externally stale committed oracle
artifacts. After reviewed row 02 repaired that boundary, the revised G5 checks
kept the target and repair surfaces distinct, and the resumed parity and
integration commands passed with the counts recorded above.

### Proposed journal entries

- Surprise: the exact output matrix was GREEN against the inline renderer while
  the helper-shape gate was the intended RED `0/0/3`.
- Friction: G6 stopped on externally stale checked-intent parity artifacts; the
  reviewed `harden-embedded-transform-integration#02` repair restored the oracle
  without widening this increment's production footprint.
- Signal: one borrowed helper now owns non-empty import rendering, while the
  complete shared-loader verification map remains green.

### Surfaced variables (spawn candidates)

- `system-loader-namespace-default-contract`: namespace dominance remains a
  provisional byte-preservation rule; revisit only when an explicit product or
  language-contract signal authorizes a semantic change.

## Spec authorship checklist (orchestrator)

- [x] Confirm §arch-system-loader-import-rewrite/Isolated byte-stable import rewriting remains authored and leakage-clean
- [x] Confirm DEF-8 resolves to D5 on the reviewed external signal and no other Decision Ledger row resolves in this increment
- [x] Append accepted journal entries attributed via inc 01 subagent
- [x] Write a reorientation entry with the full three-stance pass (K=1)
- [x] Tick registry row 01 with the reorientation timestamp
