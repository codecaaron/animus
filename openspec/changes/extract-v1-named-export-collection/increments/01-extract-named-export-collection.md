# Increment 01: extract V1 named-export collection

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans` to
> execute this packet task by task. Checkpoints are logical only; this packet
> contains no version-control action.

**Goal:** Give V1 named-export collection one private owner while preserving
exact `ExportInfo` order and fields plus all adjacent module-resolution policy.

**Architecture:** Characterize `parse_module_info()` while the named-export
branch is inline. Then move only `Statement::ExportNamedDeclaration` detail
into `collect_named_exports()`; statement dispatch, imports, default exports,
declaration extraction, binding resolution, and public types stay put.

**Tech stack:** Rust 1.97, OXC AST, Cargo, Vite+ verification, RepoWise Distill.

---

## Scope

- **Registry row**: 01 · mode: delegate · review: subagent
- **Resolves**: D1, D2, D3, D4, D5
- **Authors**: — (envelope)
- **Depends on (ordering — deps:)**: none
- **Inputs from (information — inputs:)**: none
- **Footprint**: `packages/extract/src/import_resolver.rs` and this packet's
  completion fields only
- **Pushes to a later increment**: none; DEF-1 through DEF-6 remain externally
  signaled deferrals
- **Epic lifecycle**: completing this packet closes row 01 only. Do not create
  epic-level verify/retrospective/archive artifacts; the orchestrator will
  promote the next evidenced row separately.

> Resolving signal that licensed creating this increment now: live RepoWise,
> source, caller, test, archived-decision, and dirty-tree evidence isolated one
> clean private branch. Journal seed 2026-07-19 13:17 records row 01 as
> envelope-licensed.

## Context Capsule

- **Objective**: Add one direct ordered-field matrix before production editing,
  prove it on the inline implementation, then extract only named-export
  collection into one private helper.
- **Verified finding disposition**: `import_resolver.rs` health 5.85, stable
  hotspot risk 85%, three dependents, no test gap. `parse_module_info` is 72
  NLOC / CCN 13 / cognitive 42 / nesting 5. High-confidence RepoWise plan
  `50ce675b9639444d8ec10bfaa9b83a4e` isolates the named-export paragraph and
  estimates three CCN removed. This is a lead, not deletion/change authority;
  the direct matrix and narrow private seam provide that authority.
- **Exact current outcomes**:
  - local specifier: outward and local names match, `source: None`;
  - renamed local specifier: outward name differs, local source binding is
    retained, `source: None`;
  - direct/renamed re-export: the same name relationship is retained with the
    exact source string;
  - declaration-backed variable/function/class exports delegate to
    `collect_declaration_exports` and keep source `None`;
  - multiple variable declarators preserve source order;
  - every named export has `is_default: false`.
- **Current baselines**: target SHA-256
  `9f2c8665caa7687518010aa41349ace914fdd31b18c4dab8afbee447cd31a17f`;
  protected foreign tracked diff
  `d3757dd3068d58cb8928d583ff1b72ec9570f99706215700544754bee894241f`;
  G2 `0/0/1`; focused G3 zero tests; fifteen existing local tests pass;
  normalized formatter diagnostic
  `35dec0da7b73e8e03df01d681973d9e5b017572d84ec0a53fad65c79130982eb`.
- **Existing spec context**:
  `§arch-v1-module-info-parsing-boundary/Isolated V1 named-export collection`
  covers this row; no requirement draft is owed.
- **In-scope North Star**: NS1 exact ordered fields; NS2 one named-export owner;
  NS3 stable neighboring policy; NS4 V1-only rollback unit; NS5 exact V1 map.
- **Prohibitions**: never use mutative Git. Do not write outside the declared
  footprint plus this packet's completion fields. Do not edit `design.md`,
  `tasks.md`, `journal.md`, `specs/`, manifests, dependencies, public items,
  callers, import parsing, default exports, declaration extraction semantics,
  re-export traversal, path/static resolution, formatter-baseline code, V2, or
  any pre-existing dirty increment.

## Plan

### Task 01.1: Characterize existing named-export outcomes

- [x] Confirm the target remains clean, target/foreign hashes match, G2 is
  `0/0/1`, and the G3 filter selects zero tests. STOP on any drift.
- [x] In `#[cfg(test)] mod tests`, immediately after
  `parses_named_export()`, add this direct matrix only:

```rust
    #[test]
    fn named_exports_preserve_existing_matrix() {
        let cases = vec![
            (
                "local specifier",
                "const Box = 1; export { Box };",
                vec![("Box", Some("Box"), None, false)],
            ),
            (
                "renamed local specifier",
                "const Anchor = 1; export { Anchor as Link };",
                vec![("Link", Some("Anchor"), None, false)],
            ),
            (
                "direct re-export",
                "export { Box } from './Box';",
                vec![("Box", Some("Box"), Some("./Box"), false)],
            ),
            (
                "renamed re-export",
                "export { Anchor as Link } from './Anchor';",
                vec![("Link", Some("Anchor"), Some("./Anchor"), false)],
            ),
            (
                "ordered multiple re-export specifiers",
                "export { First, Second as Alias } from './values';",
                vec![
                    ("First", Some("First"), Some("./values"), false),
                    ("Alias", Some("Second"), Some("./values"), false),
                ],
            ),
            (
                "variable declaration",
                "export const First = 1, Second = 2;",
                vec![
                    ("First", Some("First"), None, false),
                    ("Second", Some("Second"), None, false),
                ],
            ),
            (
                "function declaration",
                "export function greet() {}",
                vec![("greet", Some("greet"), None, false)],
            ),
            (
                "class declaration",
                "export class Widget {}",
                vec![("Widget", Some("Widget"), None, false)],
            ),
        ];

        for (name, source, expected) in cases {
            let info = parse_info(source);
            let actual = info
                .exports
                .iter()
                .map(|export| {
                    (
                        export.exported_name.as_str(),
                        export.local_name.as_deref(),
                        export.source.as_deref(),
                        export.is_default,
                    )
                })
                .collect::<Vec<_>>();
            assert_eq!(actual, expected, "{name}");
        }
    }
```

- [x] Run G3 before production editing. Expected: one passing test. On any
  mismatch, STOP and report the observed baseline; do not change production to
  satisfy the matrix.
- [x] Rerun all local resolver tests. Expected: sixteen passing tests.
- [x] Rerun G2. Expected structural RED remains `0/0/1`.

### Task 01.2: Extract only named-export collection

- [x] Add `ExportNamedDeclaration` to the existing OXC AST import list.
- [x] Add one private helper immediately before
  `collect_declaration_exports()`:

```rust
fn collect_named_exports(
    export_decl: &ExportNamedDeclaration<'_>,
    exports: &mut Vec<ExportInfo>,
) {
    if export_decl.specifiers.is_empty() {
        if let Some(decl) = &export_decl.declaration {
            collect_declaration_exports(decl, exports);
        }
        return;
    }

    let source = export_decl.source.as_ref().map(|value| value.value.to_string());
    for spec in &export_decl.specifiers {
        exports.push(ExportInfo {
            exported_name: module_export_name_str(&spec.exported),
            local_name: Some(module_export_name_str(&spec.local)),
            source: source.clone(),
            is_default: false,
        });
    }
}
```

- [x] Replace only the inline named-export body with
  `collect_named_exports(export_decl, &mut exports);`. Do not alter the branch
  comment, match order, or any adjacent branch.
- [x] Run G2. Expected structural GREEN: `1/2/0`.
- [x] Run G3. Expected: one passing test.
- [x] Rerun all local resolver tests. Expected: sixteen passing tests.

### Task 01.3: Prove boundaries and formatting

- [x] Run G1 and G4. Expected: no public header/field diff; all three hashes
  exact. Manually confirm the zero-context target diff has no multiline public
  signature change.
- [x] Run G5. Expected: exact protected foreign hash.
- [x] Run G7. Expected: exact normalized baseline hash. Do not run a
  whole-file mutating formatter. If the hash differs, format only the authored
  helper/test/import regions and retry; STOP if any baseline-owned line would
  need to change.
- [x] Run `git diff --check` and manually review the target-only diff. Expected:
  one import, one private helper, one production call, and one test matrix.

### Task 01.4: Run the exact mapped V1 owner claim

- [x] Run G6 in order: strict Clippy → Rust units → NAPI canary → integration.
- [x] If an atomic command fails loud with `ERROR:` or `PREPARE:`, run only the
  exact printed remediation, record it, and retry that command. Never weaken a
  gate or blindly loop a successful build.
- [x] Re-run G1–G5, G7, and `git diff --check` after G6.

### Task 01.5: Complete the packet

- [x] Fill every Evidence and Completion field below with exact commands,
  counts, hashes, and any RepoWise omission refs.
- [x] Do not edit the registry row, journal, verify report, retrospective, or
  archive state. Return control to the orchestrator for independent Phase 2
  review and the next epic reorientation.

## Verification Mapping

| Requirement / decision | Proof |
| --- | --- |
| D1 / NS2 one private owner | G2 `1/2/0`; target-only review |
| D2 / NS1 exact outcomes | G3 pre/post; sixteen local tests |
| D3 / NS3 adjacent policy | G1; three exact G4 hashes |
| D4 formatter discipline | exact G7 normalized hash |
| D5 / NS5 owner claim | G5; G6; `git diff --check` |
| NS4 V1-only rollback unit | sole target diff; no V2/shared files |

## Evidence

- **Preconditions**: target status empty; target SHA-256
  `9f2c8665caa7687518010aa41349ace914fdd31b18c4dab8afbee447cd31a17f`;
  protected foreign tracked patch
  `d3757dd3068d58cb8928d583ff1b72ec9570f99706215700544754bee894241f`;
  fifteen existing local tests passed; proposed G3 selected zero tests.
- **Characterization RED/GREEN**: the G3 name selected `0` tests before the
  matrix, then passed `1/1` against the inline implementation and `1/1` after
  extraction. Eight cases pin local, renamed, direct/renamed/multiple
  re-export, variable, function, and class outcomes including ordered fields.
- **Structural RED/GREEN**: production-bounded G2 moved exactly
  `0/0/1 → 1/2/0` (definition / production definition-plus-call / old inline
  source state).
- **Focused/local tests**: final G3 `1/1`; final resolver filter `16/16`, with
  `repowise#ac3094732395`, `repowise#fb0e8880e168`, and fresh
  `repowise#225c5b95acbc` expanded rather than rerun.
- **Boundary and formatter guardrails**: G1 empty and manual target review found
  no multiline public-signature change; G4 exact
  `d3a539...792c`, `70b216...4818`, `83fc04...1c5b`; G5 exact
  `d3757d...41f`; G7 exact normalized baseline
  `35dec0...82eb`; `git diff --check` clean. The first G7 diagnostic added only
  authored helper formatting beside the known baseline hunk; only those helper
  lines were formatted before the exact hash passed.
- **Mapped verification**: strict Clippy exit 0; Rust units 641 passed with one
  ignored (V1 284, system-loader 9 with one ignored, V2 348), omission
  `repowise#58732ed1f019` queried and expanded; canary 200/200 with four
  snapshots and 432 expectations; integration 157/157 across eleven files.
  Canary's first freshness failure printed `vp run build:extract`. That exact
  RepoWise-wrapped build was already running when its yielded execution session
  was misreported as complete. Root waited for the original process only,
  proved source mtime `1784482415` older than V1 `1784482732` and V2
  `1784482736`, ran both freshness helpers successfully, then resumed canary
  once. No second build or weakened gate was used.
- **Diff summary**: one target, `+94/-21`: one OXC type import, one private
  helper, one production call replacing the inline branch, and one direct test
  matrix. No public type, caller, import/default/declaration/re-export/path
  policy, V2, dependency, or manifest change.

## Completion

- **Status**: complete; all row-mapped gates green; independent Phase 2 review
  CLEAN with no blocking or nonblocking findings.
- **Authored files**: `packages/extract/src/import_resolver.rs` and this
  packet's completion fields only.
- **Final target SHA-256**:
  `34eea14e1cfaccc76da61f5eae433b8c982d8f6ce53ff31a7aa5a66d9df3e0c1`.
- **Foreign patch SHA-256**:
  `d3757dd3068d58cb8928d583ff1b72ec9570f99706215700544754bee894241f`.
- **Omission references expanded**: `repowise#ac3094732395`,
  `repowise#fb0e8880e168`, `repowise#58732ed1f019`, and
  `repowise#225c5b95acbc`.
- **Notes / false positives**: the complexity lead is valid and the private
  seam was preserved. The apparent completed-build/freshness synchrony defect
  was false: a yielded, still-running release-LTO session was mistaken for an
  exit. Process termination and artifact mtimes closed the STOP without a
  repository verification change. The obsolete root consumer-build task names
  reported during this row were also invocation false positives; canonical
  owner-scoped tasks already exist and no compatibility proxy was added.
