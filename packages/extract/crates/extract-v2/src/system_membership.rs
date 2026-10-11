//! Which kits a system file's roots extend or include (spec §2.3 step 5),
//! read from the engine's own parse rather than the file's spelling.
//!
//! A root is a call of Animus's `createSystem`. A binding counts once its
//! identity is followed to `createSystem` of `@animus-ui/system`: a named
//! import, through local and package re-exports; a namespace import's
//! member; or a property destructured from a namespace import, `require` or
//! `import()` of a module. A binding named `createSystem` shown to be
//! something else is no root; one whose identity cannot be followed keeps
//! the admission its name gives it. Both are findings. A call of the bare
//! name, which no import or declaration binds, is no root and is a finding.
//!
//! Members are the identifiers a root's first argument lists under
//! `includes`, the legacy `.includes([…])` call, and each consecutive
//! `.extend(x)` or `.from(x)` link from a root call or from a binding a root
//! chain initialises, transitively. Each maps through local aliases to the
//! import that binds it.
//!
//! Following an identity can need a module the caller has not supplied:
//! the result then lists those requests (`needs`), which the caller resolves
//! (its host's package resolution, its extension order) and reads, and asks
//! again with them (spec §2.3, `NeedsInputs`).

use std::collections::{BTreeMap, BTreeSet};

use oxc::ast::ast::{
    Argument, ArrayExpressionElement, AssignmentTarget, BindingPattern, CallExpression, Expression,
    ObjectPropertyKind, Program, PropertyKey, VariableDeclarator,
};
use oxc::ast::AstKind;
use oxc::span::GetSpan;

use crate::facts::FileFacts;
use crate::owned_ast::{OwnedAst, ParseCounter};
use crate::usage_facts::is_animus_system_specifier;

/// How the caller resolved one module request: the file it names, or why
/// it names none.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolution {
    #[serde(default)]
    pub file: Option<String>,
    #[serde(default)]
    pub why: Option<String>,
    /// The module on the way differs from its specifier only in case: a
    /// case-insensitive host follows it and discovery cannot.
    #[serde(default)]
    pub case_mismatch: bool,
}

/// The modules a membership read may follow, by path, and how each
/// request resolved, by `importer\0specifier`.
#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MembershipInputs {
    pub system: String,
    pub files: BTreeMap<String, String>,
    #[serde(default)]
    pub resolved: BTreeMap<String, Resolution>,
}

/// A binding named or called as a root that is not proven to be Animus's
/// `createSystem`, or a call no binding binds.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum RootFinding {
    /// `local` was shown to be something else (`what`), or could not be
    /// followed (`why`); `admitted` says whether its name still made it a
    /// root.
    Unproven {
        local: String,
        line: usize,
        column: usize,
        what: Option<String>,
        why: Option<String>,
        admitted: bool,
    },
    /// A `createSystem` call no import, declaration or parameter binds.
    Unimported { line: usize, column: usize },
}

#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Membership {
    /// The member specifiers, as their imports spell them, in discovery
    /// order without repeats.
    pub members: Vec<String>,
    pub findings: Vec<RootFinding>,
    /// Requests to resolve and read before the answer is final.
    pub needs: Vec<(String, String)>,
    /// False where the system file could not be parsed: no membership.
    pub parsed: bool,
}

/// What a binding was shown to be bound to.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Identity {
    Animus,
    Other(String),
    Unknown { why: String, case_mismatch: bool },
    /// A module on the way is not supplied yet.
    Pending,
}

struct Follower<'i> {
    inputs: &'i MembershipInputs,
    /// Each module's facts and the names it exports by declaration.
    facts: BTreeMap<String, Option<(FileFacts, BTreeSet<String>)>>,
    needs: BTreeSet<(String, String)>,
}

/// The names a module exports by declaring them: `export function`,
/// `export class`, or `export const`/`let`/`var`.
fn declared_exports(program: &Program<'_>) -> BTreeSet<String> {
    use oxc::ast::ast::{Declaration, Statement};
    let mut names = BTreeSet::new();
    for statement in &program.body {
        let Statement::ExportNamedDeclaration(export) = statement else { continue };
        match &export.declaration {
            Some(Declaration::FunctionDeclaration(function)) => {
                if let Some(id) = &function.id {
                    names.insert(id.name.to_string());
                }
            }
            Some(Declaration::ClassDeclaration(class)) => {
                if let Some(id) = &class.id {
                    names.insert(id.name.to_string());
                }
            }
            Some(Declaration::VariableDeclaration(declaration)) => {
                for declarator in &declaration.declarations {
                    if let BindingPattern::BindingIdentifier(id) = &declarator.id {
                        names.insert(id.name.to_string());
                    }
                }
            }
            _ => {}
        }
    }
    names
}

impl Follower<'_> {
    fn facts(&mut self, file: &str) -> Option<&(FileFacts, BTreeSet<String>)> {
        if !self.facts.contains_key(file) {
            let parsed = self.inputs.files.get(file).and_then(|source| {
                let counter = ParseCounter::new(0);
                let ast = OwnedAst::parse(file.to_string(), source.clone(), &counter);
                let facts = crate::facts::extract_file_facts(&ast);
                (!facts.parse_panicked).then(|| (facts, declared_exports(ast.program())))
            });
            self.facts.insert(file.to_string(), parsed);
        }
        self.facts.get(file).and_then(Option::as_ref)
    }

    /// Follows `name`, exported by the module `specifier` names from
    /// `importer`, through re-exports to its declaration.
    fn identity(&mut self, importer: &str, specifier: &str, name: &str, seen: &mut BTreeSet<String>) -> Identity {
        if is_animus_system_specifier(specifier) {
            return if name == "createSystem" {
                Identity::Animus
            } else {
                Identity::Other(format!("'{name}' of {specifier}"))
            };
        }
        let key = format!("{importer}\0{specifier}");
        let Some(resolution) = self.inputs.resolved.get(&key) else {
            self.needs.insert((importer.to_string(), specifier.to_string()));
            return Identity::Pending;
        };
        let Some(file) = resolution.file.clone() else {
            return Identity::Unknown {
                why: resolution.why.clone().unwrap_or_else(|| format!("'{specifier}' could not be resolved")),
                case_mismatch: resolution.case_mismatch,
            };
        };
        if !seen.insert(format!("{file}#{name}")) {
            return unknown(format!("'{specifier}' re-exports it in a cycle"));
        }
        if !self.inputs.files.contains_key(&file) {
            return unknown(format!("'{specifier}' could not be read"));
        }
        let Some((facts, declared)) = self.facts(&file) else {
            return unknown(format!("'{specifier}' could not be parsed"));
        };
        let exported = facts.exports.iter().find(|entry| entry.exported == name).cloned();
        let declares = declared.contains(name);
        let imports = facts.imports.clone();
        let stars = facts.star_exports.clone();
        if let Some(entry) = &exported {
            if let Some(source) = &entry.source {
                let original = entry.original.clone().unwrap_or_else(|| name.to_string());
                return self.identity(&file, source, &original, seen);
            }
        }
        let local = exported.as_ref().and_then(|entry| entry.local.clone()).unwrap_or_else(|| name.to_string());
        let imported = imports.iter().find(|entry| entry.local == local);
        if let (Some(_), Some(imported)) = (&exported, imported) {
            return self.identity(&file, &imported.source, &imported.imported, seen);
        }
        if exported.is_some() || declares {
            return Identity::Other(format!("the '{name}' that '{specifier}' declares"));
        }
        // `export * from` re-exports `name` when exactly one of its sources
        // does.
        let mut identities = Vec::new();
        for star in &stars {
            identities.push(self.identity(&file, star, name, seen));
        }
        if identities.contains(&Identity::Pending) {
            return Identity::Pending;
        }
        let definite: Vec<&Identity> =
            identities.iter().filter(|identity| !matches!(identity, Identity::Unknown { .. })).collect();
        match definite.len() {
            1 => definite[0].clone(),
            0 => identities
                .into_iter()
                .find(|identity| matches!(identity, Identity::Unknown { .. }))
                .unwrap_or_else(|| unknown(format!("'{specifier}' has no export '{name}' discovery can read"))),
            _ => unknown(format!("more than one `export *` of '{specifier}' provides '{name}'")),
        }
    }
}

fn unknown(why: String) -> Identity {
    Identity::Unknown { why, case_mismatch: false }
}

/// The calls, chains and bindings of a system file that membership reads.
#[derive(Default)]
struct Scan<'a> {
    calls: Vec<&'a CallExpression<'a>>,
    declarators: Vec<&'a VariableDeclarator<'a>>,
    /// Identifier-target assignments and defaults: name, value.
    assignments: Vec<(String, &'a Expression<'a>)>,
}

impl<'a> Scan<'a> {
    /// Every call, declarator and identifier-target assignment or default
    /// of `semantic`'s program, in source order.
    fn of(semantic: &oxc::semantic::Semantic<'a>) -> Self {
        let mut scan = Scan::default();
        for node in semantic.nodes().iter() {
            match node.kind() {
                AstKind::CallExpression(call) => scan.calls.push(call),
                AstKind::VariableDeclarator(declarator) => scan.declarators.push(declarator),
                AstKind::AssignmentExpression(assignment) => {
                    if let AssignmentTarget::AssignmentTargetIdentifier(target) = &assignment.left {
                        scan.assignments.push((target.name.to_string(), &assignment.right));
                    }
                }
                AstKind::AssignmentPattern(pattern) => {
                    if let BindingPattern::BindingIdentifier(target) = &pattern.left {
                        scan.assignments.push((target.name.to_string(), &pattern.right));
                    }
                }
                _ => {}
            }
        }
        scan
    }
}

/// `callee` as a dotted path: `name` or `ns.member`.
fn callee_path(expr: &Expression<'_>) -> Option<String> {
    match expr {
        Expression::Identifier(ident) => Some(ident.name.to_string()),
        Expression::StaticMemberExpression(member) => match &member.object {
            Expression::Identifier(object) => Some(format!("{}.{}", object.name, member.property.name)),
            _ => None,
        },
        _ => None,
    }
}

/// The expression a chain starts from: through calls' callees and member
/// objects, past parentheses and type assertions.
fn leftmost<'b, 'a>(expr: &'b Expression<'a>) -> &'b Expression<'a> {
    match expr {
        Expression::CallExpression(call) => match &call.callee {
            Expression::StaticMemberExpression(member) => leftmost(&member.object),
            _ => expr,
        },
        Expression::StaticMemberExpression(member) => leftmost(&member.object),
        Expression::ParenthesizedExpression(paren) => leftmost(&paren.expression),
        Expression::TSAsExpression(cast) => leftmost(&cast.expression),
        Expression::TSSatisfiesExpression(cast) => leftmost(&cast.expression),
        Expression::TSNonNullExpression(cast) => leftmost(&cast.expression),
        _ => expr,
    }
}

/// The base identifier of a link's single argument: `x` or `x.member…`.
fn link_base(call: &CallExpression<'_>) -> Option<String> {
    if call.arguments.len() != 1 {
        return None;
    }
    let mut expr = call.arguments[0].as_expression()?;
    loop {
        match expr {
            Expression::Identifier(ident) => return Some(ident.name.to_string()),
            Expression::StaticMemberExpression(member) => expr = &member.object,
            _ => return None,
        }
    }
}

/// The identifiers an array argument lists, in order.
fn listed_identifiers(element: Option<&Argument<'_>>) -> Vec<String> {
    let Some(Expression::ArrayExpression(array)) = element.and_then(Argument::as_expression) else {
        return Vec::new();
    };
    array
        .elements
        .iter()
        .filter_map(|element| match element {
            ArrayExpressionElement::Identifier(ident) => Some(ident.name.to_string()),
            _ => None,
        })
        .collect()
}

/// Reads the membership of the system file in `inputs`.
pub fn system_membership(inputs: &MembershipInputs) -> Membership {
    let Some(source) = inputs.files.get(&inputs.system) else {
        return Membership::default();
    };
    let counter = ParseCounter::new(0);
    let ast = OwnedAst::parse(inputs.system.clone(), source.clone(), &counter);
    let facts = crate::facts::extract_file_facts(&ast);
    if facts.parse_panicked {
        return Membership::default();
    }
    let program: &Program<'_> = ast.program();
    let semantic = oxc::semantic::SemanticBuilder::new().with_build_nodes(true).build(program).semantic;
    let scan = Scan::of(&semantic);
    let mut follower = Follower { inputs, facts: BTreeMap::new(), needs: BTreeSet::new() };
    let system = inputs.system.as_str();

    let called = |path: &str| scan.calls.iter().find(|call| callee_path(&call.callee).as_deref() == Some(path)).map(|call| call.callee.span().start);
    let mut state = Roots::default();

    // Named imports: one named or imported as `createSystem` decides by its
    // identity; another, called and imported from a local module, may be a
    // renamed re-export of the factory.
    let import_spans = import_local_spans(program);
    for binding in &facts.imports {
        let named = binding.imported == "createSystem" || binding.local == "createSystem";
        if named {
            let offset = import_spans.get(&(binding.source.clone(), binding.local.clone())).copied().unwrap_or(0);
            let identity = follower.identity(system, &binding.source, &binding.imported, &mut BTreeSet::new());
            admit(&mut state, &binding.local, crate::facts::line_column(source, offset), identity, binding.imported == "createSystem");
            continue;
        }
        if binding.source.starts_with('.') {
            if let Some(offset) = called(&binding.local) {
                match follower.identity(system, &binding.source, &binding.imported, &mut BTreeSet::new()) {
                    identity @ Identity::Unknown { case_mismatch: true, .. } => {
                        admit(&mut state, &binding.local, crate::facts::line_column(source, offset), identity, false)
                    }
                    Identity::Animus => {
                        state.roots.insert(binding.local.clone());
                    }
                    Identity::Pending => state.pending = true,
                    _ => {}
                }
            }
        }
    }

    // Namespace imports' `createSystem` members.
    for (namespace, specifier) in &facts.namespace_imports {
        let member = format!("{namespace}.createSystem");
        if is_animus_system_specifier(specifier) {
            state.roots.insert(member);
        } else if specifier.starts_with('.') {
            if let Some(offset) = called(&member) {
                match follower.identity(system, specifier, "createSystem", &mut BTreeSet::new()) {
                    identity @ Identity::Unknown { case_mismatch: true, .. } => {
                        admit(&mut state, &member, crate::facts::line_column(source, offset), identity, false)
                    }
                    Identity::Animus => {
                        state.roots.insert(member);
                    }
                    Identity::Pending => state.pending = true,
                    _ => {}
                }
            }
        }
    }

    // `createSystem` properties a declaration destructures.
    for declarator in &scan.declarators {
        let (BindingPattern::ObjectPattern(pattern), Some(init)) = (&declarator.id, &declarator.init) else {
            continue;
        };
        for property in &pattern.properties {
            let PropertyKey::StaticIdentifier(key) = &property.key else { continue };
            if key.name != "createSystem" || property.computed {
                continue;
            }
            let local = match &property.value {
                BindingPattern::BindingIdentifier(ident) => ident.name.to_string(),
                BindingPattern::AssignmentPattern(assigned) => match &assigned.left {
                    BindingPattern::BindingIdentifier(ident) => ident.name.to_string(),
                    _ => continue,
                },
                _ => continue,
            };
            let identity = match loaded_module(init) {
                Some(specifier) => follower.identity(system, &specifier, "createSystem", &mut BTreeSet::new()),
                None => match leftmost(init) {
                    Expression::Identifier(ident) if facts.namespace_imports.contains_key(ident.name.as_str()) => {
                        let specifier = facts.namespace_imports[ident.name.as_str()].clone();
                        follower.identity(system, &specifier, "createSystem", &mut BTreeSet::new())
                    }
                    _ => {
                        let text = init.span().source_text(source).trim().to_string();
                        unknown(format!("it is destructured from '{text}', which is not a module namespace"))
                    }
                },
            };
            admit(&mut state, &local, crate::facts::line_column(source, key.span.start), identity, local == "createSystem");
        }
    }

    for call in crate::usage_facts::unbound_create_system_calls(program) {
        let (line, column) = crate::facts::line_column(source, call.start);
        state.findings.push(RootFinding::Unimported { line, column });
    }

    if state.pending {
        return Membership { members: Vec::new(), findings: Vec::new(), needs: follower.needs.into_iter().collect(), parsed: true };
    }

    Membership { members: members(source, &scan, &facts, &state.roots), findings: state.findings, needs: Vec::new(), parsed: true }
}

#[derive(Default)]
struct Roots {
    roots: BTreeSet<String>,
    findings: Vec<RootFinding>,
    pending: bool,
}

/// Admits a binding named as a root by its identity: an unknown one keeps
/// `spelling`, and every unproven one is a finding.
fn admit(state: &mut Roots, local: &str, at: (usize, usize), identity: Identity, spelling: bool) {
    let (line, column) = at;
    match identity {
        Identity::Animus => {
            state.roots.insert(local.to_string());
        }
        Identity::Pending => state.pending = true,
        Identity::Other(what) => state.findings.push(RootFinding::Unproven {
            local: local.to_string(),
            line,
            column,
            what: Some(what),
            why: None,
            admitted: false,
        }),
        Identity::Unknown { why, .. } => {
            if spelling {
                state.roots.insert(local.to_string());
            }
            state.findings.push(RootFinding::Unproven {
                local: local.to_string(),
                line,
                column,
                what: None,
                why: Some(why),
                admitted: spelling,
            });
        }
    }
}

/// The module `import('x')`, `await import('x')` or `require('x')` loads.
fn loaded_module(init: &Expression<'_>) -> Option<String> {
    match init {
        Expression::ParenthesizedExpression(paren) => loaded_module(&paren.expression),
        Expression::AwaitExpression(awaited) => loaded_module(&awaited.argument),
        Expression::ImportExpression(import) => match &import.source {
            Expression::StringLiteral(literal) => Some(literal.value.to_string()),
            _ => None,
        },
        Expression::CallExpression(call) => match (&call.callee, call.arguments.first().and_then(Argument::as_expression)) {
            (Expression::Identifier(callee), Some(Expression::StringLiteral(literal)))
                if callee.name == "require" && call.arguments.len() == 1 =>
            {
                Some(literal.value.to_string())
            }
            _ => None,
        },
        _ => None,
    }
}

/// Each named or default import's local binding span, by source and local.
fn import_local_spans(program: &Program<'_>) -> BTreeMap<(String, String), u32> {
    use oxc::ast::ast::{ImportDeclarationSpecifier, Statement};
    let mut spans = BTreeMap::new();
    for statement in &program.body {
        let Statement::ImportDeclaration(import) = statement else { continue };
        for specifier in import.specifiers.iter().flatten() {
            let local = match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(named) => &named.local,
                ImportDeclarationSpecifier::ImportDefaultSpecifier(default) => &default.local,
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(_) => continue,
            };
            spans.entry((import.source.value.to_string(), local.name.to_string())).or_insert(local.span.start);
        }
    }
    spans
}

/// The member specifiers, in the lexer's discovery order: every root call's
/// `includes`, the legacy `.includes([…])` calls, each root call's
/// consecutive links, then each bound chain's.
fn members(source: &str, scan: &Scan<'_>, facts: &FileFacts, roots: &BTreeSet<String>) -> Vec<String> {
    let is_root = |call: &CallExpression<'_>| callee_path(&call.callee).is_some_and(|path| roots.contains(&path));
    let mut calls: Vec<&CallExpression<'_>> = scan.calls.clone();
    // Inner calls first: a chain's links share its start, and each link is
    // read after the one it is called on.
    calls.sort_by_key(|call| (call.span.start, call.span.end));
    let mut identifiers: Vec<String> = Vec::new();
    let add = |identifiers: &mut Vec<String>, name: String| {
        if !identifiers.contains(&name) {
            identifiers.push(name);
        }
    };

    // `createSystem({ includes: [a, b] })`, where `includes` comes before any
    // closing brace in the argument, as the spelling read it.
    for call in calls.iter().filter(|call| is_root(call)) {
        let Some(Expression::ObjectExpression(object)) = call.arguments.first().and_then(Argument::as_expression) else {
            continue;
        };
        for property in &object.properties {
            let ObjectPropertyKind::ObjectProperty(property) = property else { continue };
            let PropertyKey::StaticIdentifier(key) = &property.key else { continue };
            if key.name != "includes" || property.computed {
                continue;
            }
            if source[object.span.start as usize..key.span.start as usize].contains('}') {
                break;
            }
            if let Expression::ArrayExpression(array) = &property.value {
                for element in &array.elements {
                    if let ArrayExpressionElement::Identifier(ident) = element {
                        add(&mut identifiers, ident.name.to_string());
                    }
                }
            }
            break;
        }
    }

    // The legacy chain method, `.includes([a])`, wherever it is called.
    for call in &calls {
        let Expression::StaticMemberExpression(member) = &call.callee else { continue };
        if member.property.name == "includes" && call.arguments.len() == 1 {
            for name in listed_identifiers(call.arguments.first()) {
                add(&mut identifiers, name);
            }
        }
    }

    // Each consecutive `.extend(x)` / `.from(x)` link outward from a chain's
    // start, keyed by the start's span.
    let mut links: BTreeMap<u32, Vec<String>> = BTreeMap::new();
    let mut outermost: BTreeMap<u32, u32> = BTreeMap::new();
    for call in &calls {
        let Expression::StaticMemberExpression(member) = &call.callee else { continue };
        if member.property.name != "extend" && member.property.name != "from" {
            continue;
        }
        let start = leftmost(&member.object).span().start;
        // Only a link directly on the start, or on the previous link, counts.
        let inner_end = member.object.span().end;
        let expected = outermost.get(&start).copied().unwrap_or_else(|| leftmost(&member.object).span().end);
        if inner_end != expected {
            continue;
        }
        let Some(base) = link_base(call) else { continue };
        links.entry(start).or_default().push(base);
        outermost.insert(start, call.span.end);
    }

    // What a chain's start binds: a declarator or assignment whose value
    // starts there.
    let mut binds: BTreeMap<u32, String> = BTreeMap::new();
    for declarator in &scan.declarators {
        if let (BindingPattern::BindingIdentifier(ident), Some(init)) = (&declarator.id, &declarator.init) {
            binds.entry(leftmost(init).span().start).or_insert_with(|| ident.name.to_string());
        }
    }
    for (name, value) in &scan.assignments {
        binds.entry(leftmost(value).span().start).or_insert_with(|| name.clone());
    }

    let mut bound: Vec<String> = Vec::new();
    for call in calls.iter().filter(|call| is_root(call)) {
        let start = call.span.start;
        for base in links.get(&start).into_iter().flatten() {
            add(&mut identifiers, base.clone());
        }
        if let Some(name) = binds.get(&start) {
            if !bound.contains(name) {
                bound.push(name.clone());
            }
        }
    }
    // A bound root's own uses: each followed by a link adds that link's
    // bases, and binds what its chain initialises.
    let mut uses: BTreeMap<String, Vec<u32>> = BTreeMap::new();
    for call in &calls {
        let Expression::StaticMemberExpression(member) = &call.callee else { continue };
        if let Expression::Identifier(ident) = leftmost(&member.object) {
            uses.entry(ident.name.to_string()).or_default().push(ident.span.start);
        }
    }
    let mut index = 0;
    while index < bound.len() {
        let root = bound[index].clone();
        index += 1;
        let mut starts = uses.get(&root).cloned().unwrap_or_default();
        starts.sort_unstable();
        starts.dedup();
        for start in starts {
            let Some(found) = links.get(&start) else { continue };
            for base in found {
                add(&mut identifiers, base.clone());
            }
            if let Some(name) = binds.get(&start) {
                if !bound.contains(name) {
                    bound.push(name.clone());
                }
            }
        }
    }

    // Each identifier through its local aliases to the import that binds it.
    let imports: BTreeMap<&str, &str> =
        facts.imports.iter().map(|binding| (binding.local.as_str(), binding.source.as_str())).collect();
    let mut aliases: BTreeMap<String, String> = BTreeMap::new();
    for declarator in &scan.declarators {
        if let (BindingPattern::BindingIdentifier(ident), Some(init)) = (&declarator.id, &declarator.init) {
            let target = match init {
                Expression::Identifier(target) => Some(target.name.to_string()),
                Expression::TSAsExpression(cast) => match &cast.expression {
                    Expression::Identifier(target) => Some(target.name.to_string()),
                    _ => None,
                },
                Expression::TSSatisfiesExpression(cast) => match &cast.expression {
                    Expression::Identifier(target) => Some(target.name.to_string()),
                    _ => None,
                },
                _ => None,
            };
            if let Some(target) = target {
                aliases.entry(ident.name.to_string()).or_insert(target);
            }
        }
    }
    let mut members: Vec<String> = Vec::new();
    for identifier in identifiers {
        let mut current = identifier;
        let mut seen = BTreeSet::new();
        while !imports.contains_key(current.as_str()) && seen.insert(current.clone()) {
            match aliases.get(&current) {
                Some(target) => current = target.clone(),
                None => break,
            }
        }
        if let Some(specifier) = imports.get(current.as_str()) {
            if !members.iter().any(|member| member == specifier) {
                members.push(specifier.to_string());
            }
        }
    }
    members
}

