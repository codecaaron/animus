# Increment 01: flatten V1 object-source routing

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans` to
> execute this packet task by task. Checkpoints are logical only; this packet
> contains no version-control action.

**Goal:** Flatten the private V1 object-source router while preserving exact
literal, capture, static-identifier, and error behavior.

**Architecture:** Keep parsing, OXC ownership, evaluation, capture slicing, and
diagnostics in `lib.rs`. Replace only the nested source-shape route with two
structural guards and one expression match; protect the V2 facts phase by hash.

**Tech stack:** Rust 1.97, OXC AST/parser, `serde_json`, `rustc_hash`, Cargo,
Vite+ verification, RepoWise Distill.

---

## Scope

- **Registry row**: 01 · mode: delegate · review: subagent
- **Resolves**: D1, D2, D3, D4
- **Authors**: — (envelope)
- **Depends on (ordering — deps:)**: none
- **Inputs from (information — inputs:)**: none
- **Footprint**: `packages/extract/src/lib.rs` and this packet's completion
  checkboxes/results only
- **Pushes to a later increment**: none; DEF-1 through DEF-5 remain externally
  signaled deferrals

> Resolving signal that licensed creating this increment now: the envelope
> decided D1-D4 after live RepoWise and source evidence isolated a clean,
> private helper with a fully characterizable output matrix.

## Context Capsule

- **Objective**: Add one direct behavior matrix while the nested implementation
  is still present, prove the matrix GREEN and the structural target RED, then
  flatten only `parse_object_from_source_with_statics()`. Preserve callers,
  exact errors, parse counting, capture bytes, runtime behavior, V2, and all
  pre-existing dirty work.
- **Verified finding disposition**: the helper's six-level nesting and cognitive
  complexity 24 are valid. The broader `process_chain` and file-wide
  duplication leads are not licensed by this increment.
- **Live callers**: `parse_object_from_source()` plus `process_chain()` stages
  `styles`, `compound` condition, `states`, `system`, and `props`.
- **Exact current outcomes**:
  - literal object → `eval_object_expr_with_statics`; return partial value,
    ordered skips, and capture sources sliced from the wrapped input;
  - object-valued static identifier → cloned value, empty skips/captures;
  - missing map/name or scalar identifier →
    `identifier '<name>' not resolvable to static object`;
  - unsupported parenthesized expression or invalid outer shape →
    `failed to parse object expression`.
- **Existing contracts**: canonical `rust-extraction-pipeline` static style
  evaluation and processing-context requirements; canonical
  `per-property-bail` partial-value/skip diagnostics; Rust units, NAPI canary,
  and integration.
- **Decisions**: D1 two structural guards plus one match; D2 one object-valued
  identifier guard; D3 direct characterization-first GREEN plus structural
  RED; D4 V1-only with V2 hash.
- **North Star**: NS1 exact values/skips/captures/errors; NS2 flat routing; NS3
  caller/parse/public boundaries; NS4 downstream oracles; NS5 V2 independent.
- **Prohibitions**: no mutative Git. Do not write outside the declared footprint
  plus this packet's completion fields. Never edit design/tasks/journal/specs,
  callers outside the helper, process-chain stages, parse-variant routing, V2,
  manifests, dependencies, public APIs, or integration fixtures.

## Plan

### Task 01.1: Characterize every object-source outcome first

- [x] Confirm the pre-edit V1 crate baseline with
  `RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/Cargo.toml --lib`.
- [x] Add the following colocated top-level test module after
  `parse_variant_from_source()` in `packages/extract/src/lib.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn object_source_routing_preserves_values_captures_and_errors() {
        let (value, skips, captures) = parse_object_from_source_with_statics(
            r#"{
                color: 'red',
                animation: dynamicValue,
                display: 'flex',
                background: buildBackground(),
                sizing: { property: 'width', transform: (v) => v * 2 },
            }"#,
            None,
        )
        .expect("literal object should evaluate partially");

        assert_eq!(
            value,
            serde_json::json!({
                "color": "red",
                "display": "flex",
                "sizing": { "property": "width" },
            })
        );
        let ordered_skips: Vec<(&str, &str)> = skips
            .iter()
            .map(|skip| (skip.key.as_str(), skip.reason.as_str()))
            .collect();
        assert_eq!(
            ordered_skips,
            vec![
                ("animation", "variable reference (non-static)"),
                ("background", "function call (non-static)"),
            ]
        );
        assert_eq!(captures.len(), 1);
        assert_eq!(captures[0].key, "sizing.transform");
        assert_eq!(captures[0].fn_source, "(v) => v * 2");

        let mut static_values: FxHashMap<String, Value> = FxHashMap::default();
        static_values.insert(
            "STATIC_OBJECT".to_string(),
            serde_json::json!({ "display": "flex" }),
        );
        static_values.insert("SCALAR".to_string(), serde_json::json!(7));

        let (value, skips, captures) =
            parse_object_from_source_with_statics("STATIC_OBJECT", Some(&static_values))
                .expect("object-valued identifier should resolve");
        assert_eq!(value, serde_json::json!({ "display": "flex" }));
        assert!(skips.is_empty());
        assert!(captures.is_empty());

        assert_eq!(
            parse_object_from_source_with_statics("MISSING", Some(&static_values))
                .err()
                .as_deref(),
            Some("identifier 'MISSING' not resolvable to static object")
        );
        assert_eq!(
            parse_object_from_source_with_statics("SCALAR", Some(&static_values))
                .err()
                .as_deref(),
            Some("identifier 'SCALAR' not resolvable to static object")
        );
        assert_eq!(
            parse_object_from_source_with_statics("UNBOUND", None)
                .err()
                .as_deref(),
            Some("identifier 'UNBOUND' not resolvable to static object")
        );
        assert_eq!(
            parse_object_from_source_with_statics("42", None)
                .err()
                .as_deref(),
            Some("failed to parse object expression")
        );
    }
}
```

- [x] Run G3 before production editing and record honest GREEN against the
  nested implementation.
- [x] Run the first three G2 counts before production editing and record honest
  RED at 0/0/0. Run the target-scoped old-route search and record its one match.

### Task 01.2: Flatten only source-shape routing

- [x] Replace only `parse_object_from_source_with_statics()` with the following
  body; keep its signature and all surrounding callers unchanged:

```rust
pub(crate) fn parse_object_from_source_with_statics(
    source: &str,
    static_values: Option<&FxHashMap<String, Value>>,
) -> Result<(Value, Vec<SkippedProperty>, Vec<ResolvedCapture>), String> {
    let allocator = Allocator::default();
    // Wrap in parens to make it a valid expression statement
    let wrapped = format!("({})", source);
    crate::project_analyzer::count_parse();
    let result = Parser::new(&allocator, &wrapped, SourceType::ts()).parse();
    let program = &result.program;

    let Some(oxc_ast::ast::Statement::ExpressionStatement(expr_stmt)) = program.body.first() else {
        return Err("failed to parse object expression".to_string());
    };
    let Expression::ParenthesizedExpression(paren) = &expr_stmt.expression else {
        return Err("failed to parse object expression".to_string());
    };

    match &paren.expression {
        Expression::ObjectExpression(obj) => {
            let (value, skips, captures) =
                eval_object_expr_with_statics(obj, static_values).map_err(|e| e.reason)?;
            // Convert captured spans to source text using the wrapped string
            let resolved = captures
                .into_iter()
                .map(|cap| ResolvedCapture {
                    key: cap.key,
                    fn_source: wrapped[cap.span.start as usize..cap.span.end as usize].to_string(),
                })
                .collect();
            Ok((value, skips, resolved))
        }
        Expression::Identifier(ident) => {
            let Some(value) = static_values
                .and_then(|values| values.get(ident.name.as_str()))
                .filter(|value| value.is_object())
            else {
                return Err(format!(
                    "identifier '{}' not resolvable to static object",
                    ident.name
                ));
            };
            Ok((value.clone(), Vec::new(), Vec::new()))
        }
        _ => Err("failed to parse object expression".to_string()),
    }
}
```

- [x] Rerun G2 and G3, then the full V1 crate module command. Expected final
  G2 counts: 1/1/1 with empty target-scoped old route; focused 1/1; full suite
  baseline plus one.

### Task 01.3: Format, verify, and self-review

- [x] Run `RUSTUP_TOOLCHAIN=1.97.0 cargo fmt --manifest-path packages/extract/Cargo.toml -- --check` read-only. If known ambient drift remains, verify no hunk begins in changed ranges and do not format unrelated files.
- [x] Run G1-G5. Any STOP trip halts the increment.
- [x] Run G6 in exact order and follow only a printed prerequisite remediation.
- [x] Run `git diff --check`; inspect only the target diff; confirm it contains
  one behavior matrix plus the bounded flat router rewrite.
- [x] Update only this packet's completion fields with exact evidence, proposed
  journal entries, and surfaced variables. Do not edit `tasks.md`.

## Guardrail gate

- [x] G1: public `lib.rs` boundary — result: exact diff search exited 0 with
  empty output; no public item was added, removed, or changed.
- [x] G2: two guards/one match/no old target route — result: before production
  editing, the counts were honestly 0/0/0 and the target-scoped old-route
  search returned one match. After the two recorded STOP/reorientation cycles,
  the formatter-owned final check is 1/1/1 and the target-scoped old-route
  search exits 0 with empty output.
- [x] G3: exact object-source matrix — result:
  `RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/Cargo.toml tests::object_source_routing_preserves_values_captures_and_errors --lib`
  exited 0 with 1 passed and 280 filtered before and after production editing.
- [x] G4: V2 facts hash — result:
  `7a96b7c54f5d5fe006a9b34a12692576c77981daba55423099c0cbe421bf55fc  packages/extract/crates/extract-v2/src/facts.rs`.
- [x] G5: protected dirty-diff hash — result:
  `e153036189f2cf07aaf2098663b53b4496f510a69a61010eb65d2de324ce731b  -`.
- [x] G6: Clippy/Rust units/NAPI canary/integration — result: exact ordered
  commands exited 0. Clippy was clean; Rust units passed 281 + 8 + 348 = 637
  with 1 ignored (`repowise#7f5c92313c6e`); the first canary failed loud because
  `packages/extract/src/lib.rs` made the NAPI binary stale, exact remediation
  `repowise distill vp run build:extract` exited 0, and the fresh canary passed
  200/200; integration passed 157/157 across 11 files.

## Output contract (delegate mode)

- [x] Plan checkboxes above reflect actual completion
- [x] Authors is envelope-covered; no requirement draft is owed
- [x] Guardrail results include exact command evidence
- [x] Proposed journal entries (surprise / friction / signal), 1-3 lines each
- [x] Surfaced variables (spawn candidates) recorded below

### Execution evidence

- Status: DONE_WITH_CONCERNS. The pre-edit V1 baseline passed 280/280 at
  `repowise#77adbaf7dd1e`; the direct characterization remained GREEN before and
  after the helper edit, and the final V1 suite passed 281/281 at
  `repowise#a37e57c9b244`. Manifest-wide read-only formatting still reports
  known ambient drift, but the final target-specific Rust 1.97 check has no
  hunk beginning in either changed range. Final `git diff --check` exited 0;
  target-only inspection contains exactly one behavior matrix plus the bounded
  flat router rewrite.

### Proposed journal entries

- Surprise: the first guardrail revision assumed a multiline shape, while live
  Rust 1.97 required the original single-line guard plus a split evaluator
  binding. The two recorded STOP/reorientation cycles aligned the packet with
  formatter evidence without broadening scope.
- Friction: manifest-wide read-only rustfmt exits 1 on ambient drift. The final
  target-specific check reports no hunk in the changed helper or test, and no
  unrelated formatting writes were made.
- Signal: the behavior matrix was GREEN on the nested implementation while G2
  was structurally RED, then remained GREEN after G2 reached 1/1/1.

### Surfaced variables (spawn candidates)

- `ambient-rustfmt-drift`: a possible later cleanup increment; explicitly not
  absorbed into this bounded V1 router change.

## Spec authorship checklist (orchestrator)

- [x] Confirm §arch-extract-v1-object-source-routing/Flat V1 object-source routing remains authored and leakage-clean
- [x] Confirm no Decision Ledger row resolves in this increment
- [x] Append accepted journal entries attributed via inc 01 subagent
- [x] Write a reorientation entry with the full three-stance pass (K=1)
- [x] Tick registry row 01 with the reorientation timestamp
