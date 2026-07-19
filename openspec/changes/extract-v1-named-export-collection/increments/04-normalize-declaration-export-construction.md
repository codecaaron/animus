# Increment 04: normalize V1 declaration-export construction

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans` to
> execute this packet task by task. Checkpoints are logical only; this packet
> contains no version-control action.

**Goal:** Give declaration-backed local `ExportInfo` construction one private
owner while preserving exact supported order/fields and intentionally ignored
declaration coverage.

**Architecture:** Characterize `collect_declaration_exports()` through the
public parser first. Then add one private `local_export()` value constructor
and replace the collector's three nested push branches with ordered iterator/
option extension. Do not change AST coverage, named/default/import policy, or
binding resolution.

**Tech stack:** Rust 1.97, OXC AST, Cargo, Vite+ verification, RepoWise Distill.

---

## Scope

- **Registry row**: 04 · mode: delegate · review: subagent
- **Resolves**: D6, D7, D8, DEF-3
- **Authors**: — (epic envelope)
- **Depends on (ordering — deps:)**: 01
- **Inputs from (information — inputs:)**: none
- **Footprint**: `packages/extract/src/import_resolver.rs` and this packet's
  completion fields only
- **Pushes to a later increment**: none; DEF-1, DEF-2, and DEF-4 through DEF-6
  remain externally signaled deferrals
- **Epic lifecycle**: completing this packet closes row 04 only. Do not create
  epic-level verify/retrospective/archive artifacts.

> Resolving signal: `external:v1-declaration-export-contract`, recorded in the
> journal at 2026-07-19 13:55 after fresh RepoWise/live-source reorientation.

## Context Capsule

- **Objective**: add one exact supported/ignored declaration matrix before
  production editing, prove it against current behavior, then centralize the
  repeated local export value construction without changing coverage.
- **Verified finding disposition**: `collect_declaration_exports()` is
  unchanged by row 01 and remains 39 NLOC / CCN 9 / cognitive 22 / nesting 4,
  with medium nested-complexity and complex-method findings. The broader
  parser plan is stale because it still points at the completed row-01 span;
  it is explicitly not authority for this packet.
- **Exact current outcomes**: simple variable declarators emit one local export
  each in source order; named function/class declarations emit one local
  export; each has `source: None` and `is_default: false`; destructuring and
  type-only declarations emit none.
- **Current baselines**: reviewed row-01 target SHA-256
  `34eea14e1cfaccc76da61f5eae433b8c982d8f6ce53ff31a7aa5a66d9df3e0c1`;
  target diff `e75f06b50b98cb67537407ef92ad8fda799a7b1700164fffe618778dae9bed0c`;
  row-01 matrix-only function
  `cdf4131362399c5d3aac828265d11abaca8690af29216bc42755ade117d8682c`;
  foreign tracked diff
  `d3757dd3068d58cb8928d583ff1b72ec9570f99706215700544754bee894241f`;
  G8 `0/0/3`; focused G9 zero tests; sixteen local tests pass; normalized
  formatter diagnostic
  `35dec0da7b73e8e03df01d681973d9e5b017572d84ec0a53fad65c79130982eb`.
- **Existing spec context**:
  `§arch-v1-module-info-parsing-boundary/Behavior-stable V1 declaration-export construction`
  covers this row; no further requirement draft is owed.
- **Prohibitions**: never use mutative Git. Do not write outside the declared
  footprint plus this packet's completion fields. Do not edit the epic design,
  registry, journal, spec, manifests, dependencies, public items, callers,
  import/default/named export parsing, `binding_pattern_name`, re-export/path/
  static resolution, formatter-baseline code, V2, or ambient dirty work.

## Plan

### Task 04.1: Characterize declaration coverage and fields

- [x] Confirm G11 pre-edit hashes, G5 foreign hash, G8 `0/0/3`, G10 hashes,
  G7 formatter hash, sixteen local tests, and the G9 filter's zero-test state.
  STOP on drift.
- [x] Immediately after `named_exports_preserve_existing_matrix()`, add one
  test named `declaration_exports_preserve_supported_and_ignored_bindings`.
  Use a case matrix through `parse_info()` for:
  - `export const First = 1, Second = 2;` → ordered `First`, `Second` locals;
  - `export function greet() {}` → one `greet` local;
  - `export class Widget {}` → one `Widget` local;
  - `export const { first, second } = source;` → no exports;
  - `export interface Props { value: string }` → no exports;
  - `export type Alias = string;` → no exports.
  Map every actual export to
  `(exported_name, local_name, source, is_default)` and assert the exact vector
  with the case name as failure context.
- [x] Run G9 against the unchanged production collector. Expected: one pass.
- [x] Rerun all local resolver tests. Expected: seventeen passes.
- [x] Rerun G8. Expected structural RED remains `0/0/3`.

### Task 04.2: Centralize local export value construction

- [x] Add this one private helper immediately before
  `collect_declaration_exports()`:

```rust
fn local_export(name: String) -> ExportInfo {
    ExportInfo {
        exported_name: name.clone(),
        local_name: Some(name),
        source: None,
        is_default: false,
    }
}
```

- [x] Replace only `collect_declaration_exports()` with this equivalent body:

```rust
fn collect_declaration_exports(decl: &Declaration<'_>, exports: &mut Vec<ExportInfo>) {
    match decl {
        Declaration::VariableDeclaration(var_decl) => exports.extend(
            var_decl
                .declarations
                .iter()
                .filter_map(|declarator| binding_pattern_name(&declarator.id))
                .map(local_export),
        ),
        Declaration::FunctionDeclaration(func) => {
            exports.extend(func.id.as_ref().map(|id| local_export(id.name.to_string())))
        }
        Declaration::ClassDeclaration(class) => exports.extend(
            class
                .id
                .as_ref()
                .map(|id| local_export(id.name.to_string())),
        ),
        // TS type-only declarations don't produce runtime bindings we care about.
        _ => {}
    }
}
```

- [x] Run G8. Expected structural GREEN `1/4/0`.
- [x] Run G9 and all local resolver tests. Expected one and seventeen passes.

### Task 04.3: Prove boundaries and formatting

- [x] Run G1, G5, G7, G10, and the active post-edit G11 matrix hash. Expected:
  empty public diff, exact hashes, and unchanged row-01 matrix. Manually confirm
  the zero-context target diff changes no multiline public signature.
- [x] Run `git diff --check` and review the row-04 delta against the exact
  row-01 baseline. Expected: one private constructor, one collector rewrite,
  and one direct test matrix only.

### Task 04.4: Run the exact mapped V1 owner claim

- [x] Run G6 in order: strict Clippy → Rust units → NAPI canary → integration.
- [x] If a command prints exact prerequisite remediation, run only that
  remediation. If its execution session yields, wait on that same session
  until the nested `exec_command` result itself exposes a real exit code. An
  outer `functions.exec` cell reporting `Script completed` without the nested
  result is not completion evidence; in that case prove process termination
  plus binary/input mtimes before retrying freshness. Never launch a duplicate
  build.
- [x] Re-run G1, G5, G7–G11 post-edit invariants, local tests, and
  `git diff --check` after G6.

### Task 04.5: Complete the packet

- [x] Fill every Evidence and Completion field with exact commands, counts,
  hashes, and RepoWise omission refs.
- [x] Do not edit the registry row, journal, verify report, retrospective, or
  archive state. Return control for independent Phase 2 review.

## Verification Mapping

| Requirement / decision | Proof |
| --- | --- |
| D6 one local constructor | G8 `1/4/0`; target-only review |
| D7 exact supported/ignored coverage | G9 pre/post; seventeen local tests |
| D8 preserve row 01 and delivery | G1, G5, G7, G10, G11, G6, diff-check |

## Evidence

- **Preconditions**: exact row-01 target
  `34eea14e1cfaccc76da61f5eae433b8c982d8f6ce53ff31a7aa5a66d9df3e0c1`,
  target diff
  `e75f06b50b98cb67537407ef92ad8fda799a7b1700164fffe618778dae9bed0c`,
  matrix
  `cdf4131362399c5d3aac828265d11abaca8690af29216bc42755ade117d8682c`,
  and foreign
  `d3757dd3068d58cb8928d583ff1b72ec9570f99706215700544754bee894241f`
  hashes matched. G8 was `0/0/3`; G9 selected zero tests; G10 and G7 matched;
  local resolver tests passed 16/16 at `repowise#132e1f2b10f0`.
- **Characterization**: the supported/ignored matrix passed 1/1 against the
  unchanged collector with 284 filtered; local resolver tests then passed
  17/17 at `repowise#e8fe2930cd3c`.
- **Structural transition**: G8 moved from `0/0/3` to final `1/4/0`. The first
  post-edit check stopped at `1/3/0` because the old call regex did not match
  `.map(local_export)`; independently reviewed production-bounded G8 repaired
  the measurement without changing source.
- **Focused/local tests**: post-refactor and final G9 each passed 1/1 with 284
  filtered; final local resolver tests passed 17/17 with 268 filtered at
  `repowise#aefdc1be1a86`.
- **Boundary/formatter guardrails**: G1 was empty and zero-context review found
  no multiline public-signature change. G5 remained
  `d3757dd3068d58cb8928d583ff1b72ec9570f99706215700544754bee894241f`.
  G10 remained, in order,
  `d3a539f2287ec41a03dbdbb44399c2c438df446e4c62974d5a1e099d8ddb792c`,
  `70b21697acff55422ff4df9d132d8abbcd5c6361506b6658ba2a50ca6ebf4818`,
  `68ac8b39b6b4832fff197c63d5b226f81193074ffbf26860fc951c5f4f5979b8`,
  and `ae4f0901cce5e6313ddc94fbc5ede358df4a1469eca40eea6bbdc6eb71486e68`;
  active G11 matrix remained
  `cdf4131362399c5d3aac828265d11abaca8690af29216bc42755ade117d8682c`.
  G7 first stopped at
  `a56c1de5b0f1b43e13dba3cb65ca471e827f077a194772e88f1a7f00ffe17be5`;
  after applying only Rust 1.97's authored function-arm formatting, it matched
  baseline `35dec0da7b73e8e03df01d681973d9e5b017572d84ec0a53fad65c79130982eb`.
  `git diff --check` exited 0.
- **Mapped verification**: strict Clippy passed; Rust units passed 642 with 1
  ignored (`285 + 9 + 348`) at `repowise#a56fe087e5be`; canary passed 200/200
  with 4 snapshots and 432 expects; integration passed 157/157 across 11 files.
  The first canary printed `vp run build:extract`. Its outer `functions.exec`
  yielded cell 406 and later returned `Script completed` with empty output but
  no surfaced nested exit code, so no success is inferred from that wrapper.
  Root process proof established the original process tree terminated; source
  mtime `1784484523`, V1 binary `1784484860`, V2 binary `1784484861`, and both
  freshness predicates exited 0 before the successful canary retry.
- **RepoWise omissions expanded**: `repowise#132e1f2b10f0`,
  `repowise#e8fe2930cd3c`, `repowise#9d9b8dfe73f2`,
  `repowise#af009ccdf950`, `repowise#a56fe087e5be` (filtered expansion),
  `repowise#f75696370fe8`, and `repowise#aefdc1be1a86`.

## Completion

- **Status**: complete; all row-mapped gates green and independent Phase 2
  review CLEAN with no blocking or nonblocking findings.
- **Source diff**: final target SHA-256
  `3870557812e27dffc459c9ce6d1f6d230023872393bbeff177ad056e61839989`;
  full target diff SHA-256
  `f75696370fe8d8a522e57f0edb19557122d96db21d32f8a49debe4bb43741dfc`
  (`173 insertions/53 deletions`, including reviewed row 01). Row-04 delta is
  one private `local_export`, one iterator/Option collector rewrite, and one
  direct supported/ignored matrix; no other source region changed.
- **Independent review**: Phase 1 repairs were independently reviewed CLEAN;
  Phase 2 independently reproduced target/boundary/row-01/formatter/
  structural/focused/local/G6 evidence and returned CLEAN with no findings.
- **Residuals**: DEF-1, DEF-2, and DEF-4 through DEF-6 remain lazy; epic-level
  verify/retrospective/archive remain intentionally absent.
