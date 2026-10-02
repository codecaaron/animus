//! Per-file fact extraction: chain discovery, stage evaluation and statics
//! over one stored AST, producing owned facts and adding no parse.

use std::collections::{BTreeMap, BTreeSet};

use oxc::ast::ast::{CommentKind, Expression, ObjectExpression, Program};
use serde::Serialize;
use serde_json::Value;

use crate::chain_walk::{self, ChainDescriptor};
use crate::eval;
use crate::jsx_scan::{scan_compose_calls, ComposeFamilyInfo};
use crate::owned_ast::OwnedAst;
use crate::transforms::{CallbackBinding, CallbackDefinition, TransformReferences};
use crate::usage_facts::{collect_import_facts, ImportFact, UsageFact};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedTransformFact {
    /// Dotted key path within the stage object.
    pub key: String,
    /// User-authored function source text, copied from the input file.
    pub source: String,
    /// The callback the prop binds, with its declaring component; `None`
    /// until an inline callback is keyed to its component.
    #[serde(skip)]
    pub callback: Option<CallbackBinding>,
}

type EvaluatedStageObject = (
    Option<Value>,
    Vec<eval::SkippedProperty>,
    Vec<CapturedTransformFact>,
    Option<String>,
);

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
    /// Whole-object evaluation bail for this stage, if any.
    pub eval_error: Option<String>,
    /// The identifier a `.variant(IDENT)` stage passed as its whole config.
    #[serde(skip)]
    pub config_identifier: Option<String>,
    /// `.props()` custom props whose `transform` callback extraction lost:
    /// `(prop, reason)`, from the evaluator's skips or a const config.
    #[serde(skip)]
    pub dropped_transforms: Vec<(String, String)>,
    /// `.props()` custom props whose whole config the evaluator skipped,
    /// directly (also present in `skipped`) or in a const config.
    #[serde(skip)]
    pub dropped_configs: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainFacts {
    pub class_name: String,
    pub descriptor: ChainDescriptor,
    pub stages: Vec<StageFacts>,
    /// Any stage evaluation error drops the whole component from the
    /// manifest; this holds the first such error.
    pub fatal_error: Option<String>,
}

/// Directive-prologue boundary owned by the parser: OXC applies lexical
/// grammar and ASI, so emission must not re-infer it from bytes.
#[derive(Debug, Clone)]
pub struct DirectivePrologueFact {
    /// Byte offset just past the last directive's same-line trailing trivia.
    pub end: u32,
    /// True when any directive's raw text is exactly `use client`.
    pub has_use_client: bool,
    /// OXC-confirmed directive spans and comment-delimiter spans whose
    /// removal would invalidate this prologue fact.
    protected_ranges: Vec<(u32, u32)>,
}

impl DirectivePrologueFact {
    /// Remap this boundary across an import strip. Returns false when a
    /// removal destroys directive/comment structure or exceeds the source.
    pub(crate) fn remap_after_strip(
        &mut self,
        source_len: usize,
        removals: &[(usize, usize)],
    ) -> bool {
        let original_end = self.end as usize;
        if original_end > source_len {
            return false;
        }

        let invalidated = removals.iter().any(|&(removed_start, removed_end)| {
            removed_start > removed_end
                || removed_end > source_len
                || self
                    .protected_ranges
                    .iter()
                    .any(|&(protected_start, protected_end)| {
                        removed_start < protected_end as usize
                            && (protected_start as usize) < removed_end
                    })
        });
        if invalidated {
            return false;
        }

        let Some(removed_before_end) =
            removals
                .iter()
                .try_fold(0usize, |total, &(removed_start, removed_end)| {
                    if removed_start >= original_end {
                        Some(total)
                    } else {
                        let bounded_end = removed_end.min(original_end);
                        total.checked_add(bounded_end.saturating_sub(removed_start))
                    }
                })
        else {
            return false;
        };
        let Some(remapped_end) = original_end.checked_sub(removed_before_end) else {
            return false;
        };
        let Ok(remapped_end) = u32::try_from(remapped_end) else {
            return false;
        };
        self.end = remapped_end;
        true
    }
}

fn is_ecmascript_horizontal_whitespace(ch: char) -> bool {
    matches!(
        ch,
        '\u{0009}' | '\u{000B}' | '\u{000C}' | '\u{0020}' | '\u{00A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}'
    )
}

fn is_ecmascript_line_terminator(ch: char) -> bool {
    matches!(ch, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// Extend a directive statement through comments attached to its line. OXC
/// supplies the boundary; this only retains trailing lexical trivia.
fn extend_directive_trailing_trivia(source: &str, statement_end: u32) -> u32 {
    let mut end = statement_end as usize;

    loop {
        while let Some(ch) = source[end..].chars().next() {
            if !is_ecmascript_horizontal_whitespace(ch) {
                break;
            }
            end += ch.len_utf8();
        }

        if source[end..].starts_with("//") {
            end += 2;
            while let Some(ch) = source[end..].chars().next() {
                if is_ecmascript_line_terminator(ch) {
                    break;
                }
                end += ch.len_utf8();
            }
            return end as u32;
        }

        if source[end..].starts_with("/*") {
            let comment_start = end;
            let Some(relative_close) = source[end + 2..].find("*/") else {
                return source.len() as u32;
            };
            end += relative_close + 4;
            if source[comment_start..end]
                .chars()
                .any(is_ecmascript_line_terminator)
            {
                return end as u32;
            }
            continue;
        }

        return end as u32;
    }
}

fn directive_prologue_protected_ranges(
    program: &Program<'_>,
    prologue_end: u32,
) -> Vec<(u32, u32)> {
    let mut ranges = program
        .directives
        .iter()
        .map(|directive| (directive.span.start, directive.span.end))
        .collect::<Vec<_>>();

    for comment in program
        .comments
        .iter()
        .filter(|comment| comment.span.start < prologue_end)
    {
        let start_delimiter_end = comment.span.start.saturating_add(2).min(comment.span.end);
        if comment.span.start < start_delimiter_end {
            ranges.push((comment.span.start, start_delimiter_end));
        }
        if matches!(
            comment.kind,
            CommentKind::SingleLineBlock | CommentKind::MultiLineBlock
        ) && comment.span.end.saturating_sub(comment.span.start) >= 4
        {
            ranges.push((comment.span.end - 2, comment.span.end));
        }
    }

    ranges
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileFacts {
    pub path: String,
    #[serde(skip)]
    pub directive_prologue: Option<DirectivePrologueFact>,
    pub chains: Vec<ChainFacts>,
    /// Same-file static const values (feeds identifier resolution).
    pub statics: BTreeMap<String, Value>,
    /// Raw JSX/createElement usage facts, component-agnostic; cross-file
    /// filtering happens later.
    pub usage: Vec<UsageFact>,
    /// Usage facts enriched with same-file and imported statics; `usage`
    /// above stays the raw syntax classification.
    #[serde(skip)]
    pub(crate) usage_enriched: Option<Vec<UsageFact>>,
    /// compose() families found in this file.
    pub compose: Vec<ComposeFamilyInfo>,
    /// Top-level `const X = Y;` bare-identifier aliases, assertion-peeled
    /// and `const` only.
    #[serde(skip)]
    pub aliases: BTreeMap<String, String>,
    /// Top-level `const` declarations → the identifier their initializer is
    /// built from (`const ds = bundle.seal()` → `bundle`), assertion-peeled.
    #[serde(skip)]
    pub declaration_roots: BTreeMap<String, String>,
    /// Top-level `const X = { key: Ident }` objects: static key → identifier,
    /// only for keys no later spread, computed key, other property, or
    /// top-level statement write in this file (`X.key =`, `X[k] =`,
    /// `Object.assign(X, …)`) can replace.
    #[serde(skip)]
    pub object_members: BTreeMap<String, BTreeMap<String, String>>,
    /// Extensions of an `Object.member` parent, which are never chains.
    #[serde(skip)]
    pub member_parent_extensions: Vec<chain_walk::MemberParentExtension>,
    /// Chains rooted in an `Object.member` path, which are never chains.
    #[serde(skip)]
    pub member_rooted_chains: Vec<chain_walk::MemberRootedChain>,
    /// Namespace imports (`import * as ns from 'x'`): local → specifier.
    #[serde(skip)]
    pub namespace_imports: BTreeMap<String, String>,
    /// A terminal chain bound by `export default`, which is never a chain.
    #[serde(skip)]
    pub default_export_chain: Option<DefaultExportChain>,
    /// Named-import specifiers (alias augmentation inputs).
    pub imports: Vec<ImportFact>,
    /// Named-export facts (re-export following for provenance/statics).
    pub exports: Vec<crate::usage_facts::ExportFact>,
    /// Bindings of extracted components whose every use is a JSX element of
    /// this module (see `confined_component_bindings`).
    #[serde(skip)]
    pub(crate) confined_components: BTreeSet<String>,
    /// Extracted createTransform() declarations: serialized with the facts
    /// for probes, and the source of their bail diagnostics. They are never
    /// registered with the evaluator.
    pub transforms: Vec<crate::transforms::ExtractedTransform>,
    /// `(file, binding)` of the `createTransform` declarations that
    /// supported `.props()` references here deliver in place, in this or an
    /// imported module; their isolated-evaluation bails do not apply.
    #[serde(skip)]
    pub(crate) captured_transform_bindings: BTreeSet<(String, String)>,
    pub parse_diagnostics: Vec<String>,
    /// The parser stopped at an unrecoverable error and yielded no chains,
    /// imports or exports: these facts describe nothing of the file.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub parse_panicked: bool,
}

#[derive(Debug, Clone)]
pub struct DefaultExportChain {
    /// The chain's root identifier, when it has one.
    pub root: Option<String>,
    /// 1-based source position of the chain expression.
    pub line: usize,
    pub column: usize,
}

impl FileFacts {
    pub(crate) fn usage_for_analysis(&self) -> &[UsageFact] {
        self.usage_enriched.as_deref().unwrap_or(&self.usage)
    }
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
        // Erased type wrappers (`as const`, `satisfies T`, `x!`): index the
        // operand so span lookups resolve to the inner object.
        Expression::TSAsExpression(x) => {
            index_objects(&x.expression, index);
        }
        Expression::TSSatisfiesExpression(x) => {
            index_objects(&x.expression, index);
        }
        Expression::TSNonNullExpression(x) => {
            index_objects(&x.expression, index);
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

/// Identifier spans → names, so `.styles(BASE)` can resolve BASE from
/// same-file statics.
fn index_identifiers<'a>(expr: &Expression<'a>, index: &mut BTreeMap<(u32, u32), String>) {
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
        // Erased type wrappers: `styles(s as const)` resolves the same
        // identifier as `styles(s)`.
        Expression::TSAsExpression(x) => {
            index_identifiers(&x.expression, index);
        }
        Expression::TSSatisfiesExpression(x) => {
            index_identifiers(&x.expression, index);
        }
        Expression::TSNonNullExpression(x) => {
            index_identifiers(&x.expression, index);
        }
        Expression::ParenthesizedExpression(x) => {
            index_identifiers(&x.expression, index);
        }
        _ => {}
    }
}

/// The identifier an expression is built from, through calls, static
/// members and assertions: `createSystem().build()` → `createSystem`.
fn expression_root(expr: &Expression<'_>) -> Option<String> {
    match crate::chain_walk::unwrap_type_assertions(expr) {
        Expression::Identifier(id) => Some(id.name.to_string()),
        Expression::CallExpression(call) => expression_root(&call.callee),
        Expression::StaticMemberExpression(member) => expression_root(&member.object),
        _ => None,
    }
}

#[derive(Default)]
struct ConstInitializerFacts {
    aliases: BTreeMap<String, String>,
    roots: BTreeMap<String, String>,
    objects: BTreeMap<String, BTreeMap<String, String>>,
}

/// Top-level `const` initializer facts: bare-identifier aliases, each
/// declaration's root identifier, and object literals' identifier members.
/// `let`/`var` are excluded: a mutable binding carries no static guarantee.
fn collect_const_initializers(program: &Program<'_>) -> ConstInitializerFacts {
    use oxc::ast::ast::{
        Declaration, ObjectPropertyKind, PropertyKind, Statement, VariableDeclarationKind,
    };
    let mut facts = ConstInitializerFacts::default();
    let mut record = |decl: &oxc::ast::ast::VariableDeclaration<'_>| {
        if decl.kind != VariableDeclarationKind::Const {
            return;
        }
        for d in &decl.declarations {
            let (Some(name), Some(init)) = (d.id.get_identifier_name(), &d.init) else {
                continue;
            };
            if let Expression::Identifier(target) =
                crate::chain_walk::unwrap_type_assertions(init)
            {
                facts.aliases.insert(name.to_string(), target.name.to_string());
            }
            if let Some(root) = expression_root(init) {
                facts.roots.insert(name.to_string(), root);
            }
            let Expression::ObjectExpression(object) =
                crate::chain_walk::unwrap_type_assertions(init)
            else {
                continue;
            };
            // Source order: a later spread, computed key or non-identifier
            // write may replace an earlier member, which then proves nothing.
            let mut members: BTreeMap<String, String> = BTreeMap::new();
            for property in &object.properties {
                let ObjectPropertyKind::ObjectProperty(p) = property else {
                    members.clear();
                    continue;
                };
                let Some(key) = p.key.static_name().filter(|_| !p.computed) else {
                    members.clear();
                    continue;
                };
                match crate::chain_walk::unwrap_type_assertions(&p.value) {
                    Expression::Identifier(value)
                        if p.kind == PropertyKind::Init && !p.method =>
                    {
                        members.insert(key.to_string(), value.name.to_string());
                    }
                    _ => {
                        members.remove(key.as_ref());
                    }
                }
            }
            facts.objects.insert(name.to_string(), members);
        }
    };
    for stmt in &program.body {
        match stmt {
            Statement::VariableDeclaration(decl) => record(decl),
            Statement::ExportNamedDeclaration(export) => {
                if let Some(Declaration::VariableDeclaration(decl)) = &export.declaration {
                    record(decl);
                }
            }
            _ => {}
        }
    }
    invalidate_top_level_writes(program, &mut facts.objects);
    facts
}

fn is_object_assign(callee: &Expression<'_>) -> bool {
    matches!(
        callee,
        Expression::StaticMemberExpression(member)
            if member.property.name == "assign"
                && matches!(&member.object, Expression::Identifier(id) if id.name == "Object")
    )
}

/// The recorded members of the object an expression names, if any.
fn written_object<'m>(
    objects: &'m mut BTreeMap<String, BTreeMap<String, String>>,
    expr: &Expression<'_>,
) -> Option<&'m mut BTreeMap<String, String>> {
    match crate::chain_walk::unwrap_type_assertions(expr) {
        Expression::Identifier(id) => objects.get_mut(id.name.as_str()),
        _ => None,
    }
}

/// Top-level statement writes to recorded objects: `X.key = …` removes that
/// key; `X[expr] = …` and `Object.assign(X, …)` clear X. Writes in nested
/// scopes, through aliases or from other modules are not seen.
fn invalidate_top_level_writes(
    program: &Program<'_>,
    objects: &mut BTreeMap<String, BTreeMap<String, String>>,
) {
    use oxc::ast::ast::{AssignmentTarget, Statement};
    for stmt in &program.body {
        let Statement::ExpressionStatement(statement) = stmt else {
            continue;
        };
        match crate::chain_walk::unwrap_type_assertions(&statement.expression) {
            Expression::AssignmentExpression(assignment) => match &assignment.left {
                AssignmentTarget::StaticMemberExpression(member) => {
                    if let Some(members) = written_object(objects, &member.object) {
                        members.remove(member.property.name.as_str());
                    }
                }
                AssignmentTarget::ComputedMemberExpression(member) => {
                    if let Some(members) = written_object(objects, &member.object) {
                        members.clear();
                    }
                }
                _ => {}
            },
            Expression::CallExpression(call) if is_object_assign(&call.callee) => {
                let target = call.arguments.first().and_then(|arg| arg.as_expression());
                if let Some(members) = target.and_then(|t| written_object(objects, t)) {
                    members.clear();
                }
            }
            _ => {}
        }
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
) -> EvaluatedStageObject {
    match eval::eval_object_expr_with_statics(obj, Some(statics)) {
        Ok((value, skipped, captured)) => (
            Some(value),
            skipped,
            captured
                .into_iter()
                .map(|c| CapturedTransformFact {
                    key: c.key,
                    source: source[c.span.start as usize..c.span.end as usize].to_string(),
                    callback: None,
                })
                .collect(),
            None,
        ),
        Err(bail) => (None, Vec::new(), Vec::new(), Some(bail.reason)),
    }
}

fn default_export_chain(program: &Program<'_>, source: &str, start: u32) -> DefaultExportChain {
    use oxc::ast::ast::Statement;
    let root = program.body.iter().find_map(|stmt| match stmt {
        Statement::ExportDefaultDeclaration(export) => {
            export.declaration.as_expression().and_then(expression_root)
        }
        _ => None,
    });
    let before = &source[..(start as usize).min(source.len())];
    let line = before.matches('\n').count() + 1;
    let column = before.rsplit('\n').next().map_or(0, |l| l.chars().count()) + 1;
    DefaultExportChain { root, line, column }
}

pub fn extract_file_facts(ast: &OwnedAst) -> FileFacts {
    extract_file_facts_with_prefix(ast, "animus")
}

pub fn extract_file_facts_with_prefix(ast: &OwnedAst, prefix: &str) -> FileFacts {
    extract_file_facts_enriched(ast, prefix, &rustc_hash::FxHashMap::default())
}

/// Chain-fact extraction with supplemental statics (imported consts and
/// keyframes bindings); the supplement overwrites same-file values.
pub fn extract_file_facts_enriched(
    ast: &OwnedAst,
    prefix: &str,
    extra_statics: &rustc_hash::FxHashMap<String, Value>,
) -> FileFacts {
    extract_file_facts_enriched_with_usage_statics(
        ast,
        prefix,
        extra_statics,
        &rustc_hash::FxHashMap::default(),
    )
}

pub fn extract_file_facts_enriched_with_usage_statics(
    ast: &OwnedAst,
    prefix: &str,
    extra_statics: &rustc_hash::FxHashMap<String, Value>,
    extra_usage_statics: &rustc_hash::FxHashMap<String, Value>,
) -> FileFacts {
    let program = ast.program();
    let local_statics = eval::collect_static_values(program);
    let local_usage_statics = eval::collect_complete_static_values(program);
    let imports = collect_import_facts(program);
    let exports = crate::usage_facts::collect_export_facts(program);
    let inputs = crate::analyze_css::CssInputs::default();
    // Alone, a module resolves only its own bindings.
    let mut references = TransformReferences::new(&inputs);
    references.add(&ast.path, program, &imports, &exports);
    extract_file_facts_from_static_maps(
        ast,
        prefix,
        &local_statics,
        &local_usage_statics,
        extra_statics,
        extra_usage_statics,
        &references,
    )
}

pub(crate) fn extract_file_facts_from_static_maps(
    ast: &OwnedAst,
    prefix: &str,
    local_statics: &rustc_hash::FxHashMap<String, Value>,
    local_usage_statics: &rustc_hash::FxHashMap<String, Value>,
    extra_statics: &rustc_hash::FxHashMap<String, Value>,
    extra_usage_statics: &rustc_hash::FxHashMap<String, Value>,
    references: &TransformReferences<'_>,
) -> FileFacts {
    let program = ast.program();
    let source = ast.source();
    let directive_prologue = program.directives.last().map(|last| {
        let end = extend_directive_trailing_trivia(source, last.span.end);
        DirectivePrologueFact {
            end,
            has_use_client: program
                .directives
                .iter()
                .any(|directive| directive.directive == "use client"),
            protected_ranges: directive_prologue_protected_ranges(program, end),
        }
    });

    let mut statics_fx = local_statics.clone();
    for (k, v) in extra_statics {
        statics_fx.insert(k.clone(), v.clone());
    }
    let mut usage_statics_fx = local_usage_statics.clone();
    for (k, v) in extra_usage_statics {
        usage_statics_fx.insert(k.clone(), v.clone());
    }
    let object_index = build_object_index(program);
    let undefined_bound = eval::module_binds(program, "undefined");

    let identifier_index = build_identifier_index(program);

    let walked = chain_walk::walk_program_facts(program);
    let member_parent_extensions = walked.member_parents;
    let walked_chains = walked.chains;
    let const_initializers = collect_const_initializers(program);
    let imports = collect_import_facts(program);
    let create_transform_locals: rustc_hash::FxHashSet<String> = imports
        .iter()
        .filter(|imp| imp.imported == "createTransform")
        .map(|imp| imp.local.clone())
        .collect();
    let mut captured_transform_bindings = BTreeSet::new();
    let chains: Vec<ChainFacts> = walked_chains
        .into_iter()
        .map(|descriptor| {
            let declarer = format!("{}::{}", ast.path, descriptor.binding);
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
                    config_identifier: None,
                    dropped_transforms: Vec::new(),
                    dropped_configs: Vec::new(),
                };
                let key = &stage.arg_span;
                if stage.method == "variant" {
                    match object_index.get(key) {
                        Some(obj) => match eval::parse_variant_arg(obj, Some(&statics_fx)) {
                            Ok((cfg, skips)) => {
                                let mut value = serde_json::json!({
                                    "prop": cfg.prop,
                                    "defaultVariant": cfg.default_variant,
                                    "base": cfg.base,
                                    "variants": Value::Object(cfg.variants),
                                });
                                eval::strip_lost_values(&mut value);
                                facts.value = Some(value);
                                facts.skipped =
                                    skips.into_iter().map(|s| (s.key, s.reason)).collect();
                            }
                            Err(bail) => {
                                facts.eval_error =
                                    Some(format!("variant eval failed: {}", bail.reason));
                            }
                        },
                        None => {
                            facts.config_identifier = identifier_index.get(key).cloned();
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
                            let props = stage.method == "props";
                            facts.captured = captured;
                            if props {
                                // An inline callback is its own definition.
                                let module_host_bindings = references.host_bindings(&ast.path);
                                for capture in &mut facts.captured {
                                    let prop = capture.key.split('.').next().unwrap_or_default();
                                    capture.callback = Some(CallbackBinding {
                                        declarer: declarer.clone(),
                                        definition: CallbackDefinition {
                                            key: format!("{}#{}.{prop}", ast.path, descriptor.binding),
                                            name: "inline".to_string(),
                                            source: capture.source.clone(),
                                            module_host_bindings: module_host_bindings.clone(),
                                        },
                                    });
                                }
                            }
                            for mut skip in skipped {
                                if props {
                                    match skip.parent.as_deref() {
                                        None => facts
                                            .dropped_configs
                                            .push((skip.key.clone(), skip.reason.clone())),
                                        Some(prop) if skip.key == "transform" && !prop.contains('.') => {
                                            let transform = object_index
                                                .get(key)
                                                .and_then(|obj| eval::transform_value_at(obj, Some(prop)));
                                            // An explicitly absent transform is no skip and no loss.
                                            if transform.is_some_and(|expr| eval::is_absent_value(expr, undefined_bound)) {
                                                continue;
                                            }
                                            if let Some(Expression::Identifier(reference)) =
                                                transform.map(Expression::get_inner_expression)
                                            {
                                                match references.resolve(&ast.path, &reference.name) {
                                                    Ok(resolved) => {
                                                        captured_transform_bindings.extend(resolved.created);
                                                        facts.captured.push(CapturedTransformFact {
                                                            key: format!("{prop}.transform"),
                                                            source: reference.name.to_string(),
                                                            callback: resolved.definition.map(|definition| {
                                                                CallbackBinding { declarer: declarer.clone(), definition }
                                                            }),
                                                        });
                                                        continue;
                                                    }
                                                    Err(reason) => skip.reason = reason,
                                                }
                                            }
                                            facts
                                                .dropped_transforms
                                                .push((prop.to_string(), skip.reason.clone()));
                                        }
                                        _ => {}
                                    }
                                }
                                facts.skipped.push((skip.key, skip.reason));
                            }
                            facts.value = value;
                            if let Some(value) = facts.value.as_mut() {
                                if props {
                                    let lost = eval::take_lost_custom_props(value);
                                    facts.dropped_transforms.extend(lost.transforms);
                                    facts.dropped_configs.extend(lost.configs);
                                } else {
                                    eval::strip_lost_values(value);
                                }
                            }
                        }
                        Err(e) => {
                            let label = if stage.method == "compound" {
                                "compound condition eval failed"
                            } else {
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
                    if stage.method == "compound" {
                        if let Some(sspan) = stage.second_arg_span {
                            match object_index.get(&sspan) {
                                Some(obj) => match eval::eval_object_expr_with_statics(
                                    obj,
                                    Some(&statics_fx),
                                ) {
                                    Ok((mut v, skips, _captures)) => {
                                        eval::strip_lost_values(&mut v);
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

    let transforms =
        crate::transforms::extract_transforms(program, source, &ast.path, &create_transform_locals);
    let exports = crate::usage_facts::collect_export_facts(program);
    let descriptors: Vec<&ChainDescriptor> = chains.iter().map(|chain| &chain.descriptor).collect();
    let usage = crate::usage_facts::collect_usage_facts(program);
    let (usage_enriched, confined_components) = crate::usage_facts::collect_enriched_usage(
        program,
        &usage_statics_fx,
        &descriptors,
        &exports,
    );

    FileFacts {
        path: ast.path.clone(),
        directive_prologue,
        chains,
        // Serialized facts carry no lost-value markers.
        statics: statics_fx
            .into_iter()
            .map(|(name, mut value)| {
                eval::strip_lost_values(&mut value);
                (name, value)
            })
            .collect(),
        usage,
        usage_enriched: Some(usage_enriched),
        compose: scan_compose_calls(program),
        aliases: const_initializers.aliases,
        declaration_roots: const_initializers.roots,
        object_members: const_initializers.objects,
        member_parent_extensions,
        member_rooted_chains: walked.member_rooted,
        namespace_imports: crate::usage_facts::collect_namespace_imports(program),
        default_export_chain: walked
            .default_export
            .map(|start| default_export_chain(program, source, start)),
        imports,
        exports,
        transforms,
        captured_transform_bindings,
        confined_components,
        parse_diagnostics: ast.diagnostics.clone(),
        parse_panicked: ast.panicked,
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
        assert_eq!(counter.load(std::sync::atomic::Ordering::SeqCst), 1);
        facts
    }

    #[test]
    fn directive_remap_rejects_out_of_bounds_removal_metadata() {
        let source = "'use client';\nconst x = 1;\n";
        let mut prologue = facts_for(source).directive_prologue.unwrap();
        assert!(!prologue.remap_after_strip(source.len(), &[(source.len(), source.len() + 1)],));
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
        assert_eq!(&facts.statics["GAP"], &Value::from(16));
    }

    #[test]
    fn local_const_ident_aliases_are_captured() {
        let facts = facts_for(
            r#"
            export const CardRoot = ds.styles({ display: 'flex' }).asElement('div');
            const Alias = CardRoot;
            export const Exported = Alias;
            const Peeled = (CardRoot as any);
            let Mutable = CardRoot;
            const NotAlias = pick(CardRoot);
            const Num = 3;
            "#,
        );
        assert_eq!(
            facts.aliases.get("Alias").map(String::as_str),
            Some("CardRoot")
        );
        assert_eq!(
            facts.aliases.get("Exported").map(String::as_str),
            Some("Alias")
        );
        assert_eq!(
            facts.aliases.get("Peeled").map(String::as_str),
            Some("CardRoot")
        );
        assert!(!facts.aliases.contains_key("Mutable"));
        assert!(!facts.aliases.contains_key("NotAlias"));
        assert!(!facts.aliases.contains_key("Num"));
    }

    #[test]
    fn raw_usage_keeps_identifiers_dynamic_and_conditionals_unenumerated() {
        let facts = facts_for(
            r#"
            const GAP = 24;
            export const App = ({ open }) => (
              <Box p={GAP} display={open ? 'block' : 'none'} />
            );
            "#,
        );
        let UsageFact::Element { attrs, .. } = &facts.usage[0] else {
            panic!("expected JSX element usage fact");
        };
        let identifier = attrs.iter().find(|attr| attr.name == "p").unwrap();
        assert!(identifier.static_value.is_none());
        assert!(identifier.enumerable_values.is_empty());
        assert!(identifier.dynamic);
        assert_eq!(
            identifier.dynamic_kind,
            Some(crate::jsx_scan::DynamicExpressionKind::Identifier)
        );

        let conditional = attrs.iter().find(|attr| attr.name == "display").unwrap();
        assert!(conditional.static_value.is_none());
        assert!(conditional.enumerable_values.is_empty());
        assert!(conditional.dynamic);
        assert_eq!(
            conditional.dynamic_kind,
            Some(crate::jsx_scan::DynamicExpressionKind::Conditional)
        );
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
        // Evaluation stopped at the failing stage.
        assert_eq!(facts.chains[0].stages.len(), 2);
    }

    #[test]
    fn variant_stage_uses_variant_parser_without_capture() {
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

    /// An inline callback reading a `btoa` its module declares is never
    /// isolated; the same callback reading the host function is.
    #[test]
    fn inline_callback_reading_a_module_bound_host_function_is_not_isolated() {
        for (preamble, isolated) in [("function btoa(s) { return s; }", false), ("", true)] {
            let facts = facts_for(&format!(
                "{preamble}\nexport const Box = ds.props({{ w: {{ property: 'width', transform: (v) => btoa(String(v)) }} }}).asElement('div');"
            ));
            let callback = facts.chains[0].stages[0].captured[0].callback.as_ref().unwrap();
            assert_eq!(callback.definition.isolated_source().is_some(), isolated, "{preamble:?}");
        }
    }

    fn captured_pairs(stage: &StageFacts) -> Vec<(&str, &str)> {
        stage
            .captured
            .iter()
            .map(|c| (c.key.as_str(), c.source.as_str()))
            .collect()
    }

    #[test]
    fn local_transform_references_keep_their_authored_reference() {
        let facts = facts_for(
            r#"
            import { createTransform as ct } from '@animus-ui/system';
            const double = (v) => v * 2;
            function half(v) { return v / 2; }
            const twice = double;
            const again = twice;
            const named = ct('double', (v) => `${v}px`);
            const viaExpression = (function (v) { return v; }) satisfies object;
            export const Box = ds
              .props({
                a: { property: 'width', transform: double },
                b: { property: 'height', transform: again as never },
                c: { property: 'minWidth', transform: half },
                d: { property: 'maxWidth', transform: named },
                e: { property: 'top', transform: viaExpression },
                f: { property: 'left', transform: (v) => v },
              })
              .asElement('div');
            export const Other = ds.props({ g: { property: 'width', transform: double } }).asElement('p');
            "#,
        );
        let stage = &facts.chains[0].stages[0];
        let mut captured = captured_pairs(stage);
        captured.sort();
        assert_eq!(
            captured,
            [
                ("a.transform", "double"),
                ("b.transform", "again"),
                ("c.transform", "half"),
                ("d.transform", "named"),
                ("e.transform", "viaExpression"),
                ("f.transform", "(v) => v"),
            ]
        );
        assert!(stage.skipped.is_empty(), "{:?}", stage.skipped);
        assert!(stage.dropped_transforms.is_empty(), "{:?}", stage.dropped_transforms);
        assert_eq!(
            captured_pairs(&facts.chains[1].stages[0]),
            [("g.transform", "double")]
        );
    }

    #[test]
    fn unsupported_transform_references_replace_their_generic_skip() {
        let facts = facts_for(
            r#"
            let shift = (v) => v;
            export const Box = ds
              .props({
                mut: { property: 'height', transform: shift },
                und: { property: 'inset', transform: nowhere },
              })
              .asElement('div');
            "#,
        );
        let stage = &facts.chains[0].stages[0];
        assert!(stage.captured.is_empty(), "{:?}", stage.captured);
        assert_eq!(
            stage.dropped_transforms,
            [
                ("mut".to_string(), "transform reference 'shift' is a mutable `let` binding".to_string()),
                ("und".to_string(), "transform reference 'nowhere' is not declared in this module".to_string()),
            ]
        );
        // The classified diagnostic replaces exactly the generic skip line.
        for (_, reason) in &stage.dropped_transforms {
            assert!(stage.skipped.contains(&("transform".to_string(), reason.clone())));
        }
    }

    #[test]
    fn css_transform_identifiers_outside_props_stay_skipped() {
        let facts = facts_for(
            r#"
            const rotate = (v) => v;
            export const Box = ds
              .styles({ transform: rotate })
              .props({ w: { property: 'width', transform: rotate, scale: rotate } })
              .asElement('div');
            "#,
        );
        let styles = &facts.chains[0].stages[0];
        assert!(styles.captured.is_empty());
        assert_eq!(styles.skipped.len(), 1);
        assert_eq!(styles.skipped[0].0, "transform");
        let props = &facts.chains[0].stages[1];
        assert_eq!(captured_pairs(props), [("w.transform", "rotate")]);
        assert_eq!(props.skipped.len(), 1, "{:?}", props.skipped);
        assert_eq!(props.skipped[0].0, "scale");
    }

    #[test]
    fn serialized_facts_tell_an_aborted_parse_from_a_recovered_one() {
        let chain = "export const Box = ds.styles({ display: 'block' }).asElement('div');\n";

        let aborted = facts_for(&chain.replace("= ds.", "= ds(."));
        assert!(aborted.chains.is_empty());
        assert!(!aborted.parse_diagnostics.is_empty());
        let wire = serde_json::to_value(&aborted).unwrap();
        assert_eq!(wire["parsePanicked"], true);

        let recovered = facts_for(&format!("{chain}return 1;\n"));
        assert_eq!(recovered.chains.len(), 1);
        assert!(!recovered.parse_diagnostics.is_empty());
        let wire = serde_json::to_value(&recovered).unwrap();
        assert!(wire.get("parsePanicked").is_none(), "{wire}");
    }
}
