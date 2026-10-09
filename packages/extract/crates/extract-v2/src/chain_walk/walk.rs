//! The backward chain walk: find an `.asElement()`/`.asComponent()`/
//! `.asClass()` terminal, then walk the member chain back to its root.

use oxc::ast::ast::{
    BindingPattern, CallExpression, Declaration, Expression, IdentifierReference,
    ModuleExportName, Program, Statement, VariableDeclarationKind, VariableDeclarator,
};
use oxc::ast_visit::Visit;
use rustc_hash::{FxHashMap, FxHashSet};

use super::expr::{match_static_member, unwrap_type_assertions};
use super::terminal::{extract_terminal_arg, first_arg_span, second_arg_span_fn, TerminalArg};
use super::{
    ChainDescriptor, ChainStage, MemberParentExtension, MemberRootedChain, StagedBuilder,
    TerminalKind,
};

const BAIL_METHODS: &[&str] = &[];
pub(crate) const CHAIN_METHODS: &[&str] = &["styles", "variant", "compound", "states", "system", "props"];

/// A walked declarator: an extractable-shaped chain, or a chain shape whose
/// `Object.member` root the extractor does not support.
enum WalkedChain {
    Chain(ChainDescriptor),
    MemberParent(MemberParentExtension),
    MemberRooted(MemberRootedChain),
}

/// Top-level chain facts, including the unsupported shapes chain
/// collection drops.
pub struct WalkedProgram {
    pub chains: Vec<ChainDescriptor>,
    pub member_parents: Vec<MemberParentExtension>,
    pub member_rooted: Vec<MemberRootedChain>,
    /// Start offset of a terminal chain bound by `export default`.
    pub default_export: Option<u32>,
    /// Builders chains may continue, in declaration order.
    pub staged_builders: Vec<StagedBuilder>,
}

enum ChainRoot {
    Identifier(String),
    Member { object: String, member: String },
}

/// Top-level `const` builders a later chain continues: name → (initializer,
/// declaration statement span, whether it declares only this builder). A
/// builder is builder stages on an identifier with no terminal, and no
/// export names it. Every stage returns a new builder, so each chain from
/// one builder starts from the same stages.
type StagedBuilders<'p, 'a> = FxHashMap<&'p str, (&'p Expression<'a>, (u32, u32), bool)>;

fn staged_builders<'p, 'a>(program: &'p Program<'a>) -> StagedBuilders<'p, 'a> {
    let mut builders = StagedBuilders::default();
    let mut exported: FxHashSet<&str> = FxHashSet::default();
    for stmt in &program.body {
        match stmt {
            Statement::VariableDeclaration(decl) if decl.kind == VariableDeclarationKind::Const => {
                for declarator in &decl.declarations {
                    let (BindingPattern::BindingIdentifier(id), Some(init)) =
                        (&declarator.id, &declarator.init)
                    else {
                        continue;
                    };
                    let init = unwrap_type_assertions(init);
                    if is_builder_chain(init) {
                        let sole = decl.declarations.len() == 1;
                        builders.insert(id.name.as_str(), (init, (decl.span.start, decl.span.end), sole));
                    }
                }
            }
            Statement::ExportNamedDeclaration(export) if export.source.is_none() => {
                for specifier in &export.specifiers {
                    if let ModuleExportName::IdentifierReference(local) = &specifier.local {
                        exported.insert(local.name.as_str());
                    }
                }
            }
            Statement::ExportDefaultDeclaration(export) => {
                if let Some(Expression::Identifier(id)) =
                    export.declaration.as_expression().map(unwrap_type_assertions)
                {
                    exported.insert(id.name.as_str());
                }
            }
            _ => {}
        }
    }
    builders.retain(|name, _| !exported.contains(name));
    builders
}

/// The builders in declaration order, with what deciding whether a
/// replaced module still needs each declaration takes.
fn staged_builder_facts(program: &Program<'_>, builders: &StagedBuilders<'_, '_>) -> Vec<StagedBuilder> {
    let mut references = References {
        counts: builders.keys().map(|name| (*name, 0)).collect(),
    };
    references.visit_program(program);
    let mut facts: Vec<(u32, StagedBuilder)> = builders
        .iter()
        .map(|(name, &(init, statement, sole))| {
            let mut stages = Vec::new();
            let (mut extractable, mut bail_reason, mut extend) = (true, None, false);
            let followed_builder = walk_chain_backwards(
                init,
                &mut stages,
                &mut extractable,
                &mut bail_reason,
                &mut extend,
                builders,
            )
            .and_then(|(_, _, followed)| followed);
            let fact = StagedBuilder {
                name: name.to_string(),
                statement: sole.then_some(statement),
                followed_builder,
                references: references.counts[name],
            };
            (statement.0, fact)
        })
        .collect();
    facts.sort_by_key(|(start, _)| *start);
    facts.into_iter().map(|(_, fact)| fact).collect()
}

struct References<'n> {
    counts: FxHashMap<&'n str, usize>,
}

impl<'a> Visit<'a> for References<'_> {
    fn visit_identifier_reference(&mut self, id: &IdentifierReference<'a>) {
        if let Some(count) = self.counts.get_mut(id.name.as_str()) {
            *count += 1;
        }
    }
}

/// Builder stages (`extend()` included) on an identifier, with no terminal.
fn is_builder_chain(expr: &Expression<'_>) -> bool {
    let mut current = expr;
    loop {
        let Expression::CallExpression(call) = current else {
            return false;
        };
        let Some((object, method)) = match_static_member(&call.callee) else {
            return false;
        };
        let stage = CHAIN_METHODS.contains(&method) || (method == "extend" && call.arguments.is_empty());
        if !stage {
            return false;
        }
        match object {
            Expression::Identifier(_) => return true,
            next => current = next,
        }
    }
}

pub fn walk_program(program: &Program<'_>) -> Vec<ChainDescriptor> {
    walk_program_facts(program).chains
}

pub fn walk_program_facts(program: &Program<'_>) -> WalkedProgram {
    let builders = staged_builders(program);
    let mut chains = Vec::new();
    let mut member_parents = Vec::new();
    let mut member_rooted = Vec::new();
    let mut default_export = None;
    let mut record = |declarator: &VariableDeclarator<'_>| match try_extract_chain(declarator, &builders) {
        Some(WalkedChain::Chain(chain)) => chains.push(chain),
        Some(WalkedChain::MemberParent(extension)) => member_parents.push(extension),
        Some(WalkedChain::MemberRooted(chain)) => member_rooted.push(chain),
        None => {}
    };
    for stmt in &program.body {
        match stmt {
            Statement::VariableDeclaration(decl) => {
                decl.declarations.iter().for_each(&mut record);
            }
            // Chains bound by export default are not extracted; only their
            // presence is recorded.
            Statement::ExportDefaultDeclaration(export) => {
                if let Some(Expression::CallExpression(call)) = export
                    .declaration
                    .as_expression()
                    .map(unwrap_type_assertions)
                {
                    // Builders are not followed here: a default export is
                    // only reported, never extracted.
                    if let Some(WalkedChain::Chain(_)) =
                        try_walk_chain(call, "default".to_string(), &StagedBuilders::default())
                    {
                        default_export = Some(call.span.start);
                    }
                }
            }
            Statement::ExportNamedDeclaration(export) => {
                if let Some(Declaration::VariableDeclaration(decl)) = &export.declaration {
                    decl.declarations.iter().for_each(&mut record);
                }
            }
            _ => {}
        }
    }
    let staged_builders = staged_builder_facts(program, &builders);
    WalkedProgram {
        chains,
        member_parents,
        member_rooted,
        default_export,
        staged_builders,
    }
}

fn try_extract_chain(
    declarator: &VariableDeclarator<'_>,
    builders: &StagedBuilders<'_, '_>,
) -> Option<WalkedChain> {
    let init = declarator.init.as_ref()?;
    let binding = match &declarator.id {
        BindingPattern::BindingIdentifier(id) => id.name.to_string(),
        _ => return None, // destructuring bindings are not extracted
    };
    let call = match unwrap_type_assertions(init) {
        Expression::CallExpression(call) => call.as_ref(),
        _ => return None,
    };
    try_walk_chain(call, binding, builders)
}

fn try_walk_chain(
    call: &CallExpression<'_>,
    binding: String,
    builders: &StagedBuilders<'_, '_>,
) -> Option<WalkedChain> {
    let (object, method_name) = match_static_member(&call.callee)?;

    let terminal = match method_name {
        "asElement" => TerminalKind::AsElement,
        "asComponent" => TerminalKind::AsComponent,
        "asClass" => TerminalKind::AsClass,
        _ => return None,
    };

    let mut stages = Vec::new();
    let mut extractable = true;
    let mut bail_reason: Option<String> = None;

    let tag = match extract_terminal_arg(call, &terminal) {
        TerminalArg::Resolved(tag) => tag,
        TerminalArg::Unresolvable(reason) => {
            extractable = false;
            bail_reason = Some(format!("{}: {}", method_name, reason));
            String::new()
        }
    };
    let mut has_extend_marker = false;
    let chain_end = call.span;

    let (chain_start, root, followed_builder) = walk_chain_backwards(
        object,
        &mut stages,
        &mut extractable,
        &mut bail_reason,
        &mut has_extend_marker,
        builders,
    )?;

    let root_identifier = match root {
        ChainRoot::Identifier(name) => name,
        ChainRoot::Member { object, member } if has_extend_marker => {
            return Some(WalkedChain::MemberParent(MemberParentExtension {
                binding,
                object,
                member,
            }));
        }
        ChainRoot::Member { object, member } if !stages.is_empty() => {
            return Some(WalkedChain::MemberRooted(MemberRootedChain {
                binding,
                object,
                member,
            }));
        }
        ChainRoot::Member { .. } => return None,
    };

    stages.reverse();

    let extends_from = if has_extend_marker {
        Some(root_identifier)
    } else if !stages.is_empty() {
        // Primary chain: the method pattern suffices, so any root name
        // works (`animus.styles(...)`, custom instances).
        None
    } else {
        return None;
    };

    Some(WalkedChain::Chain(ChainDescriptor {
        binding,
        terminal,
        tag,
        stages,
        extractable,
        bail_reason,
        span: (chain_start, chain_end.end),
        extends_from,
        followed_builder,
    }))
}

fn walk_chain_backwards(
    expr: &Expression<'_>,
    stages: &mut Vec<ChainStage>,
    extractable: &mut bool,
    bail_reason: &mut Option<String>,
    has_extend_marker: &mut bool,
    builders: &StagedBuilders<'_, '_>,
) -> Option<(u32, ChainRoot, Option<String>)> {
    match expr {
        // A builder declared earlier continues into its own stages; the
        // chain keeps its own span. Declarations only ever point back, so
        // the walk ends. After `.extend()` the name is a parent component.
        Expression::Identifier(id) => match builders.get(id.name.as_str()) {
            Some(&(init, (_, declared_end), _))
                if declared_end <= id.span.start && !*has_extend_marker =>
            {
                let (_, root, _) = walk_chain_backwards(
                    init,
                    stages,
                    extractable,
                    bail_reason,
                    has_extend_marker,
                    builders,
                )?;
                Some((id.span.start, root, Some(id.name.to_string())))
            }
            _ => Some((id.span.start, ChainRoot::Identifier(id.name.to_string()), None)),
        },
        Expression::StaticMemberExpression(member) => match &member.object {
            Expression::Identifier(object) => Some((
                member.span.start,
                ChainRoot::Member {
                    object: object.name.to_string(),
                    member: member.property.name.to_string(),
                },
                None,
            )),
            _ => None,
        },
        Expression::CallExpression(call) => {
            let (object, method_name) = match_static_member(&call.callee)?;

            if method_name == "extend" {
                if call.arguments.is_empty() {
                    *has_extend_marker = true;
                } else {
                    *extractable = false;
                    if bail_reason.is_none() {
                        *bail_reason = Some("extend with arguments is not supported".to_string());
                    }
                }
            } else {
                if BAIL_METHODS.contains(&method_name) {
                    *extractable = false;
                    if bail_reason.is_none() {
                        *bail_reason = Some(format!("{} stage not supported", method_name));
                    }
                }
                if CHAIN_METHODS.contains(&method_name) || BAIL_METHODS.contains(&method_name) {
                    // Zero-arg known methods record nothing and do not bail.
                    if let Some(arg_span) = first_arg_span(call) {
                        let second_arg_span = if method_name == "compound" {
                            second_arg_span_fn(call)
                        } else {
                            None
                        };
                        stages.push(ChainStage {
                            method: method_name.to_string(),
                            arg_span: (arg_span.start, arg_span.end),
                            second_arg_span: second_arg_span.map(|s| (s.start, s.end)),
                        });
                    }
                } else {
                    *extractable = false;
                    if bail_reason.is_none() {
                        *bail_reason = Some(format!("unknown chain method: {}", method_name));
                    }
                }
            }

            walk_chain_backwards(object, stages, extractable, bail_reason, has_extend_marker, builders)
        }
        _ => None,
    }
}
