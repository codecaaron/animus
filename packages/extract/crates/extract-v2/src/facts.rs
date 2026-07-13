//! Per-file fact extraction: the eager-evaluation half of the D4
//! experiment (increment 11). Everything here happens INSIDE the per-file
//! pass — chain discovery, stage evaluation, statics — producing owned
//! facts; no `program()` read occurs after cross-file facts resolve.
//!
//! Stage arguments are located by SPAN-INDEXED LOOKUP over the already-
//! stored AST (a second read, never a parse — G1). Evaluation semantics
//! come from the verbatim-ported evaluator (`eval.rs`); v1's stage-arg
//! contract is object-expressions-only, with the wrap-and-reparse error
//! shape replicated as an eval error fact rather than a panic.

use std::collections::BTreeMap;

use oxc::ast::ast::{Expression, ObjectExpression, Program};
use serde::Serialize;
use serde_json::Value;

use crate::chain_walk::{self, ChainDescriptor};
use crate::eval;
use crate::jsx_scan::{scan_compose_calls, ComposeFamilyInfo};
use crate::owned_ast::OwnedAst;
use crate::usage_facts::{collect_import_facts, collect_usage_facts, ImportFact, UsageFact};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedTransformFact {
    /// Dotted key path within the stage object (v1 `CapturedTransform.key`).
    pub key: String,
    /// User-authored function source text, owned (a fact of the INPUT —
    /// not generated code; recorded distinction per G2).
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageFacts {
    pub method: String,
    /// Evaluated stage object (raw, pre-theme-resolution).
    pub value: Option<Value>,
    /// Second argument (compound styles object), when present.
    pub second_value: Option<Value>,
    pub skipped: Vec<(String, String)>,
    pub captured: Vec<CapturedTransformFact>,
    /// v1-shaped evaluation error (whole-object bail), if any.
    pub eval_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainFacts {
    /// v1-identical class identity (default prefix "animus"; option-driven
    /// prefixes arrive with the row-07 config inputs). The corpus oracle
    /// pins this against v1 manifest class names.
    pub class_name: String,
    pub descriptor: ChainDescriptor,
    pub stages: Vec<StageFacts>,
    /// v1's `?` semantics: ANY stage evaluation error drops the whole
    /// component from the manifest. First error, v1-formatted.
    pub fatal_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileFacts {
    pub path: String,
    pub chains: Vec<ChainFacts>,
    /// Same-file static const values (feeds identifier resolution).
    pub statics: BTreeMap<String, Value>,
    /// Raw JSX/createElement usage facts (component-agnostic; cross-file
    /// filtering happens as fact algebra — usage_facts.rs).
    pub usage: Vec<UsageFact>,
    /// compose() families found in this file.
    pub compose: Vec<ComposeFamilyInfo>,
    /// Named-import specifiers (alias augmentation inputs).
    pub imports: Vec<ImportFact>,
    /// Named-export facts (re-export following for provenance/statics).
    pub exports: Vec<crate::usage_facts::ExportFact>,
    /// Extracted createTransform() declarations (evaluator registration
    /// inputs — v1 project_analyzer Phase 1 parity).
    pub transforms: Vec<crate::transforms::ExtractedTransform>,
    pub parse_diagnostics: Vec<String>,
}

/// Collect every ObjectExpression in the program keyed by its span —
/// the lookup table for stage-argument evaluation. Read-only descent.
fn index_objects<'a, 'b>(
    expr: &'b Expression<'a>,
    index: &mut BTreeMap<(u32, u32), &'b ObjectExpression<'a>>,
) {
    match expr {
        Expression::ObjectExpression(obj) => {
            index.insert((obj.span.start, obj.span.end), obj.as_ref());
            for prop in &obj.properties {
                if let oxc::ast::ast::ObjectPropertyKind::ObjectProperty(p) = prop {
                    index_objects(&p.value, index);
                }
            }
        }
        Expression::CallExpression(call) => {
            index_objects(&call.callee, index);
            for arg in &call.arguments {
                if let Some(e) = arg.as_expression() {
                    index_objects(e, index);
                }
            }
        }
        Expression::StaticMemberExpression(member) => {
            index_objects(&member.object, index);
        }
        Expression::ParenthesizedExpression(paren) => {
            index_objects(&paren.expression, index);
        }
        Expression::ArrayExpression(arr) => {
            for el in &arr.elements {
                if let Some(e) = el.as_expression() {
                    index_objects(e, index);
                }
            }
        }
        _ => {}
    }
}

fn build_object_index<'a, 'b>(
    program: &'b Program<'a>,
) -> BTreeMap<(u32, u32), &'b ObjectExpression<'a>> {
    use oxc::ast::ast::{Declaration, Statement};
    let mut index = BTreeMap::new();
    for stmt in &program.body {
        match stmt {
            Statement::VariableDeclaration(decl) => {
                for d in &decl.declarations {
                    if let Some(init) = &d.init {
                        index_objects(init, &mut index);
                    }
                }
            }
            Statement::ExportNamedDeclaration(export) => {
                if let Some(Declaration::VariableDeclaration(decl)) = &export.declaration {
                    for d in &decl.declarations {
                        if let Some(init) = &d.init {
                            index_objects(init, &mut index);
                        }
                    }
                }
            }
            _ => {}
        }
    }
    index
}

/// Identifier spans → names, for v1's identifier-stage-arg fallback
/// (`.styles(BASE)` resolves BASE from same-file statics — v1
/// lib.rs parse_object_from_source_with_statics identifier arm).
fn index_identifiers<'a>(
    expr: &Expression<'a>,
    index: &mut BTreeMap<(u32, u32), String>,
) {
    match expr {
        Expression::Identifier(id) => {
            index.insert((id.span.start, id.span.end), id.name.to_string());
        }
        Expression::CallExpression(call) => {
            index_identifiers(&call.callee, index);
            for arg in &call.arguments {
                if let Some(e) = arg.as_expression() {
                    index_identifiers(e, index);
                }
            }
        }
        Expression::StaticMemberExpression(member) => {
            index_identifiers(&member.object, index);
        }
        _ => {}
    }
}

fn build_identifier_index<'a>(program: &Program<'a>) -> BTreeMap<(u32, u32), String> {
    use oxc::ast::ast::{Declaration, Statement};
    let mut index = BTreeMap::new();
    for stmt in &program.body {
        match stmt {
            Statement::VariableDeclaration(decl) => {
                for d in &decl.declarations {
                    if let Some(init) = &d.init {
                        index_identifiers(init, &mut index);
                    }
                }
            }
            Statement::ExportNamedDeclaration(export) => {
                if let Some(Declaration::VariableDeclaration(decl)) = &export.declaration {
                    for d in &decl.declarations {
                        if let Some(init) = &d.init {
                            index_identifiers(init, &mut index);
                        }
                    }
                }
            }
            _ => {}
        }
    }
    index
}

fn eval_stage_object(
    obj: &ObjectExpression<'_>,
    statics: &rustc_hash::FxHashMap<String, Value>,
    source: &str,
) -> (Option<Value>, Vec<(String, String)>, Vec<CapturedTransformFact>, Option<String>) {
    match eval::eval_object_expr_with_statics(obj, Some(statics)) {
        Ok((value, skipped, captured)) => (
            Some(value),
            skipped.into_iter().map(|s| (s.key, s.reason)).collect(),
            captured
                .into_iter()
                .map(|c| CapturedTransformFact {
                    key: c.key,
                    source: source[c.span.start as usize..c.span.end as usize].to_string(),
                })
                .collect(),
            None,
        ),
        Err(bail) => (None, Vec::new(), Vec::new(), Some(bail.reason)),
    }
}

/// The per-file pass: discovery + eager stage evaluation + statics, all
/// against one stored AST, zero parses added.
pub fn extract_file_facts(ast: &OwnedAst) -> FileFacts {
    extract_file_facts_with_prefix(ast, "animus")
}

pub fn extract_file_facts_with_prefix(ast: &OwnedAst, prefix: &str) -> FileFacts {
    extract_file_facts_enriched(ast, prefix, &rustc_hash::FxHashMap::default())
}

/// Chain-fact extraction with SUPPLEMENTAL statics (v1 Phase 2b parity —
/// imported consts + keyframes bindings resolved by the engine's pass A;
/// journal 2026-07-13 10:50). Same-file statics win nothing over the
/// supplement in v1: Phase 2b starts from the file's own values and
/// OVERWRITES with resolved imports, so the supplement is applied last.
pub fn extract_file_facts_enriched(
    ast: &OwnedAst,
    prefix: &str,
    extra_statics: &rustc_hash::FxHashMap<String, Value>,
) -> FileFacts {
    let program = ast.program();
    let source = ast.source();

    let mut statics_fx = eval::collect_static_values(program);
    for (k, v) in extra_statics {
        statics_fx.insert(k.clone(), v.clone());
    }
    let object_index = build_object_index(program);

    let identifier_index = build_identifier_index(program);

    // Per-method dispatch mirrors v1 process_chain EXACTLY (inc-11 review
    // F1): variant stages use parse_variant_arg with NO statics and NO
    // transform capture; compound first arg evaluates WITH statics, second
    // arg WITHOUT (its captures discarded, its skips kept); other stages
    // evaluate WITH statics; identifier args resolve from same-file
    // statics; ANY stage error is CHAIN-FATAL (v1's `?` drops the whole
    // component) and stops further stage evaluation.
    let chains = chain_walk::walk_program(program)
        .into_iter()
        .map(|descriptor| {
            let mut stages: Vec<StageFacts> = Vec::new();
            let mut fatal_error: Option<String> = None;
            for stage in &descriptor.stages {
                if fatal_error.is_some() {
                    break;
                }
                let mut facts = StageFacts {
                    method: stage.method.clone(),
                    value: None,
                    second_value: None,
                    skipped: Vec::new(),
                    captured: Vec::new(),
                    eval_error: None,
                };
                let key = &stage.arg_span;
                if stage.method == "variant" {
                    match object_index.get(key) {
                        Some(obj) => match eval::parse_variant_arg(obj) {
                            Ok((cfg, skips)) => {
                                facts.value = Some(serde_json::json!({
                                    "prop": cfg.prop,
                                    "defaultVariant": cfg.default_variant,
                                    "base": cfg.base,
                                    "variants": Value::Object(cfg.variants),
                                }));
                                facts.skipped =
                                    skips.into_iter().map(|s| (s.key, s.reason)).collect();
                            }
                            Err(bail) => {
                                facts.eval_error =
                                    Some(format!("variant eval failed: {}", bail.reason));
                            }
                        },
                        None => {
                            facts.eval_error = Some(
                                "variant eval failed: failed to parse variant config".to_string(),
                            );
                        }
                    }
                } else {
                    let evaluated = match object_index.get(key) {
                        Some(obj) => {
                            let (value, skipped, captured, err) =
                                eval_stage_object(obj, &statics_fx, source);
                            match err {
                                None => Ok((value, skipped, captured)),
                                Some(e) => Err(e),
                            }
                        }
                        None => match identifier_index.get(key) {
                            Some(name) => match statics_fx.get(name) {
                                Some(v) => Ok((Some(v.clone()), Vec::new(), Vec::new())),
                                None => Err(format!(
                                    "identifier '{}' not resolvable to static object",
                                    name
                                )),
                            },
                            None => Err("failed to parse object expression".to_string()),
                        },
                    };
                    match evaluated {
                        Ok((value, skipped, captured)) => {
                            facts.value = value;
                            facts.skipped = skipped;
                            facts.captured = captured;
                        }
                        Err(e) => {
                            let label = if stage.method == "compound" {
                                "compound condition eval failed"
                            } else {
                                // matches v1's "{method} eval failed:" prefix
                                facts.eval_error =
                                    Some(format!("{} eval failed: {}", stage.method, e));
                                fatal_error = facts.eval_error.clone();
                                stages.push(facts);
                                continue;
                            };
                            facts.eval_error = Some(format!("{}: {}", label, e));
                            fatal_error = facts.eval_error.clone();
                            stages.push(facts);
                            continue;
                        }
                    }
                    // compound second arg: statics-BLIND, captures
                    // discarded, skips kept, failure chain-fatal (v1
                    // lib.rs "compound styles eval failed" + `?`).
                    if stage.method == "compound" {
                        if let Some(sspan) = stage.second_arg_span {
                            match object_index.get(&sspan) {
                                Some(obj) => match eval::eval_object_expr(obj) {
                                    Ok((v, skips, _captures)) => {
                                        facts.second_value = Some(v);
                                        facts
                                            .skipped
                                            .extend(skips.into_iter().map(|s| (s.key, s.reason)));
                                    }
                                    Err(bail) => {
                                        facts.eval_error = Some(format!(
                                            "compound styles eval failed: {}",
                                            bail.reason
                                        ));
                                    }
                                },
                                None => {
                                    facts.eval_error = Some(
                                        "compound styles eval failed: failed to parse object expression"
                                            .to_string(),
                                    );
                                }
                            }
                        }
                    }
                }
                if facts.eval_error.is_some() && fatal_error.is_none() {
                    fatal_error = facts.eval_error.clone();
                }
                let is_fatal = facts.eval_error.is_some();
                stages.push(facts);
                if is_fatal {
                    break;
                }
            }
            ChainFacts {
                class_name: crate::ids::class_name_for(&ast.path, &descriptor.binding, prefix),
                descriptor,
                stages,
                fatal_error,
            }
        })
        .collect();

    let imports = collect_import_facts(program);
    // v1 Phase-1 parity (project_analyzer ~482-493): createTransform alias
    // bindings come from named imports; the literal name always matches.
    let ct_bindings: rustc_hash::FxHashSet<String> = imports
        .iter()
        .filter(|imp| imp.imported == "createTransform" && imp.local != "createTransform")
        .map(|imp| imp.local.clone())
        .collect();
    let transforms =
        crate::transforms::extract_transforms(program, source, &ast.path, &ct_bindings);

    FileFacts {
        path: ast.path.clone(),
        chains,
        statics: statics_fx.into_iter().collect(),
        usage: collect_usage_facts(program),
        compose: scan_compose_calls(program),
        imports,
        exports: crate::usage_facts::collect_export_facts(program),
        transforms,
        parse_diagnostics: ast.diagnostics.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::owned_ast::{OwnedAst, ParseCounter};

    fn facts_for(source: &str) -> FileFacts {
        let counter = ParseCounter::new(0);
        let ast = OwnedAst::parse("test.tsx".into(), source.into(), &counter);
        let facts = extract_file_facts(&ast);
        // D4/G1 experiment invariant: fact extraction adds ZERO parses.
        assert_eq!(counter.load(std::sync::atomic::Ordering::SeqCst), 1);
        facts
    }

    #[test]
    fn evaluates_stage_objects_eagerly() {
        let facts = facts_for(
            r#"
            import { ds } from './sys';
            export const Box = ds
              .styles({ display: 'flex', p: 16 })
              .variant({ prop: 'size', variants: { sm: { fontSize: 14 } } })
              .asElement('div');
            "#,
        );
        assert_eq!(facts.chains.len(), 1);
        let stages = &facts.chains[0].stages;
        assert_eq!(stages.len(), 2);
        assert_eq!(stages[0].method, "styles");
        let v = stages[0].value.as_ref().unwrap();
        assert_eq!(v["display"], "flex");
        assert_eq!(v["p"], 16);
        assert_eq!(stages[1].method, "variant");
        assert_eq!(
            stages[1].value.as_ref().unwrap()["variants"]["sm"]["fontSize"],
            14
        );
    }

    #[test]
    fn statics_resolve_and_skips_surface() {
        let facts = facts_for(
            r#"
            const GAP = 16;
            export const Box = ds.styles({ gap: GAP, color: dynamic() }).asElement('div');
            "#,
        );
        let stage = &facts.chains[0].stages[0];
        assert_eq!(stage.value.as_ref().unwrap()["gap"], 16);
        assert_eq!(stage.skipped.len(), 1);
        assert_eq!(stage.skipped[0].0, "color");
        assert_eq!(facts.statics.get("GAP").unwrap(), &Value::from(16));
    }

    #[test]
    fn compound_second_arg_evaluates() {
        let facts = facts_for(
            r#"
            export const Btn = ds
              .styles({ display: 'flex' })
              .compound({ size: 'sm', tone: 'loud' }, { fontSize: 12 })
              .asElement('button');
            "#,
        );
        let compound = &facts.chains[0].stages[1];
        assert_eq!(compound.method, "compound");
        assert_eq!(compound.value.as_ref().unwrap()["size"], "sm");
        assert_eq!(compound.second_value.as_ref().unwrap()["fontSize"], 12);
    }

    #[test]
    fn identifier_stage_arg_resolves_from_statics() {
        // v1: `.styles(BASE)` resolves BASE via same-file statics
        // (inc-11 review F1b — the fixture that motivated the fix).
        let facts = facts_for(
            r#"
            const BASE = { p: 4 };
            export const Box = ds.styles(BASE).asElement('div');
            "#,
        );
        let stage = &facts.chains[0].stages[0];
        assert_eq!(stage.value.as_ref().unwrap()["p"], 4);
        assert!(stage.eval_error.is_none());
        assert!(facts.chains[0].fatal_error.is_none());
    }

    #[test]
    fn unresolvable_identifier_is_chain_fatal_with_v1_message() {
        let facts = facts_for(
            r#"
            export const Box = ds.styles(MYSTERY).asElement('div');
            "#,
        );
        let err = facts.chains[0].fatal_error.as_ref().unwrap();
        assert_eq!(
            err,
            "styles eval failed: identifier 'MYSTERY' not resolvable to static object"
        );
    }

    #[test]
    fn compound_second_arg_failure_is_chain_fatal() {
        // v1 evaluates the compound styles object statics-BLIND and a
        // structural bail (`...spread`) propagates via `?` — the WHOLE
        // component is dropped (inc-11 review F1c).
        let facts = facts_for(
            r#"
            export const Btn = ds
              .styles({ display: 'flex' })
              .compound({ size: 'sm' }, { ...spread })
              .asElement('button');
            "#,
        );
        let err = facts.chains[0].fatal_error.as_ref().unwrap();
        assert!(
            err.starts_with("compound styles eval failed:"),
            "got: {err}"
        );
        // Evaluation stopped at the failing stage (v1 short-circuit).
        assert_eq!(facts.chains[0].stages.len(), 2);
    }

    #[test]
    fn variant_stage_uses_variant_parser_without_capture() {
        // v1's variant path never captures transform fns (F1a): a
        // `transform` key inside variant styles is a skip in v1's variant
        // parser semantics, not a CapturedTransform.
        let facts = facts_for(
            r#"
            export const Box = ds
              .variant({ prop: 'size', variants: { sm: { transform: (v) => v } } })
              .asElement('div');
            "#,
        );
        let stage = &facts.chains[0].stages[0];
        assert_eq!(stage.method, "variant");
        assert!(stage.captured.is_empty());
        assert_eq!(stage.value.as_ref().unwrap()["prop"], "size");
    }

    #[test]
    fn captured_transform_carries_owned_source() {
        let facts = facts_for(
            r#"
            export const Box = ds
              .props({ w: { property: 'width', transform: (v) => v * 4 } })
              .asElement('div');
            "#,
        );
        let stage = &facts.chains[0].stages[0];
        assert_eq!(stage.captured.len(), 1);
        assert_eq!(stage.captured[0].key, "w.transform");
        assert!(stage.captured[0].source.contains("v * 4"));
    }
}
