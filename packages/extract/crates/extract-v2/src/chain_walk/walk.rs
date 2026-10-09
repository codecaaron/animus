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
    TerminalKind, UnwalkedChain,
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
    /// Chain-shaped calls outside every chain above.
    pub unwalked: Vec<UnwalkedChain>,
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
    let mut default_export_span = None;
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
                        default_export_span = Some((call.span.start, call.span.end));
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
    let mut unwalked = UnwalkedChains {
        taken: chains
            .iter()
            .map(|chain| chain.span)
            .chain(default_export_span)
            .chain(continued_builder_spans(&chains, &staged_builders, &builders))
            .collect(),
        enclosing: None,
        found: Vec::new(),
    };
    for stmt in &program.body {
        unwalked.enclosing = statement_binding(stmt);
        unwalked.visit_statement(stmt);
    }
    WalkedProgram {
        chains,
        member_parents,
        member_rooted,
        default_export: default_export_span.map(|(start, _)| start),
        unwalked: unwalked.found,
        staged_builders,
    }
}

/// The initializers of the builders a walked chain continued, directly or
/// through another builder: their styles reach that chain's stylesheet.
fn continued_builder_spans(
    chains: &[ChainDescriptor],
    staged: &[StagedBuilder],
    builders: &StagedBuilders<'_, '_>,
) -> Vec<(u32, u32)> {
    use oxc::span::GetSpan;
    let mut pending: Vec<&str> = chains.iter().filter_map(|chain| chain.followed_builder.as_deref()).collect();
    let mut continued: FxHashSet<&str> = FxHashSet::default();
    while let Some(name) = pending.pop() {
        if !continued.insert(name) {
            continue;
        }
        if let Some(next) = staged.iter().find(|b| b.name == name).and_then(|b| b.followed_builder.as_deref()) {
            pending.push(next);
        }
    }
    continued
        .into_iter()
        .filter_map(|name| builders.get(name))
        .map(|(init, _, _)| (init.span().start, init.span().end))
        .collect()
}

/// Collects the outermost chain-shaped calls outside `taken`: the
/// extractor never sees them, so they run the builder at runtime.
struct UnwalkedChains {
    taken: Vec<(u32, u32)>,
    enclosing: Option<String>,
    found: Vec<UnwalkedChain>,
}

impl<'a> Visit<'a> for UnwalkedChains {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        let span = call.span;
        if self.taken.iter().any(|&(start, end)| start <= span.start && span.end <= end) {
            return;
        }
        let Some((root, methods)) = chain_shape(call) else {
            oxc::ast_visit::walk::walk_call_expression(self, call);
            return;
        };
        self.found.push(UnwalkedChain {
            root,
            methods,
            enclosing: self.enclosing.clone(),
            start: span.start,
        });
        // The spine is this chain; only its arguments can hold another.
        let mut current = Some(call);
        while let Some(link) = current {
            for argument in &link.arguments {
                self.visit_argument(argument);
            }
            current = match_static_member(&link.callee).and_then(|(object, _)| {
                match unwrap_type_assertions(object) {
                    Expression::CallExpression(inner) => Some(inner.as_ref()),
                    _ => None,
                }
            });
        }
    }
}

/// The root identifier and method names of a call built only from chain
/// methods, `extend()` and terminals on an identifier. `extend` with
/// arguments is the system and theme builders' merge, not a component's.
fn chain_shape(call: &CallExpression<'_>) -> Option<(String, Vec<String>)> {
    let mut methods = Vec::new();
    let mut current = call;
    loop {
        let (object, method) = match_static_member(&current.callee)?;
        let known = CHAIN_METHODS.contains(&method)
            || matches!(method, "asElement" | "asComponent" | "asClass")
            || (method == "extend" && current.arguments.is_empty());
        if !known {
            return None;
        }
        methods.push(method.to_string());
        match unwrap_type_assertions(object) {
            Expression::Identifier(id) => {
                methods.reverse();
                return Some((id.name.to_string(), methods));
            }
            Expression::CallExpression(inner) => current = inner,
            _ => return None,
        }
    }
}

/// The name a top-level statement declares, when it declares one.
fn statement_binding(stmt: &Statement<'_>) -> Option<String> {
    let declaration = match stmt {
        Statement::ExportNamedDeclaration(export) => export.declaration.as_ref()?,
        Statement::ExportDefaultDeclaration(_) => return Some("default".to_string()),
        other => other.as_declaration()?,
    };
    match declaration {
        Declaration::VariableDeclaration(decl) => match &decl.declarations.first()?.id {
            BindingPattern::BindingIdentifier(id) => Some(id.name.to_string()),
            _ => None,
        },
        Declaration::FunctionDeclaration(function) => Some(function.id.as_ref()?.name.to_string()),
        Declaration::ClassDeclaration(class) => Some(class.id.as_ref()?.name.to_string()),
        _ => None,
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

/// The terminal a builder method name ends a chain with.
pub fn terminal_kind(method_name: &str) -> Option<TerminalKind> {
    match method_name {
        "asElement" => Some(TerminalKind::AsElement),
        "asComponent" => Some(TerminalKind::AsComponent),
        "asClass" => Some(TerminalKind::AsClass),
        _ => None,
    }
}

fn try_walk_chain(
    call: &CallExpression<'_>,
    binding: String,
    builders: &StagedBuilders<'_, '_>,
) -> Option<WalkedChain> {
    let (object, method_name) = match_static_member(&call.callee)?;

    let terminal = terminal_kind(method_name)?;

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
