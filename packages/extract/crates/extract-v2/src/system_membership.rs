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
//! Membership is transitive: each member is followed through local and
//! package re-exports to the module that declares it, and that module's own
//! roots are read in turn, so a kit another kit extends is a member too. A
//! member reached through a package is spelled as the first package import
//! on the way, by the module that spells it (`importer`).
//!
//! A root chain not yet built is a builder. One that leaves the positions
//! membership follows (a binding, an assignment, an object property) is a
//! finding: kits extended past that point are not read.
//!
//! Following an identity can need a module the caller has not supplied:
//! the result then lists those requests (`needs`), which the caller resolves
//! (its host's package resolution, its extension order) and reads, and asks
//! again with them (spec §2.3, `NeedsInputs`).

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use oxc::ast::ast::{
    Argument, ArrayExpressionElement, AssignmentTarget, BindingPattern, CallExpression, Expression,
    ObjectPropertyKind, Program, PropertyKey, VariableDeclarator,
};
use oxc::ast::AstKind;
use oxc::semantic::{AstNodes, NodeId, Semantic, SymbolId};
use oxc::span::{GetSpan, Span};

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
    /// A builder leaves the positions membership follows (`how`): kits it
    /// extends from there are not read.
    Escapes { line: usize, column: usize, how: String },
}

/// A finding in one of the modules membership reads.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub file: String,
    #[serde(flatten)]
    pub finding: RootFinding,
}

/// A member specifier, as the module `importer` spells it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub specifier: String,
    pub importer: String,
}

#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Membership {
    /// The members, the system file's first, then each read module's, in
    /// discovery order without repeats.
    pub members: Vec<Member>,
    pub findings: Vec<Finding>,
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
/// `export class`, `export const`/`let`/`var`, or `export default`.
fn declared_exports(program: &Program<'_>) -> BTreeSet<String> {
    use oxc::ast::ast::{Declaration, Statement};
    let mut names = BTreeSet::new();
    for statement in &program.body {
        // `export default <expression>` declares the module's default.
        if let Statement::ExportDefaultDeclaration(_) = statement {
            names.insert("default".to_string());
            continue;
        }
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

/// Where a member's binding is declared, and the first package import on
/// the way to it.
struct Origin {
    package: Option<(String, String)>,
    declared: Declared,
}

enum Declared {
    File(String),
    Pending,
    Unknown,
}

fn is_bare(specifier: &str) -> bool {
    !specifier.starts_with('.') && !std::path::Path::new(specifier).is_absolute()
}

impl Follower<'_> {
    /// Follows `name`, exported by the module `specifier` names from
    /// `importer`, through local and package re-exports to the module that
    /// declares it.
    fn origin(&mut self, importer: &str, specifier: &str, name: &str, seen: &mut BTreeSet<String>) -> Origin {
        let package = is_bare(specifier).then(|| (importer.to_string(), specifier.to_string()));
        let at = |package: Option<(String, String)>, declared| Origin { package, declared };
        if is_animus_system_specifier(specifier) {
            return at(package, Declared::Unknown);
        }
        let key = format!("{importer}\0{specifier}");
        let Some(resolution) = self.inputs.resolved.get(&key) else {
            self.needs.insert((importer.to_string(), specifier.to_string()));
            return at(package, Declared::Pending);
        };
        let Some(file) = resolution.file.clone() else { return at(package, Declared::Unknown) };
        if !seen.insert(format!("{file}#{name}")) {
            return at(package, Declared::Unknown);
        }
        let Some((facts, declared)) = self.facts(&file) else { return at(package, Declared::Unknown) };
        let exported = facts.exports.iter().find(|entry| entry.exported == name).cloned();
        let declares = declared.contains(name);
        let imports = facts.imports.clone();
        let stars = facts.star_exports.clone();
        let next = if let Some(source) = exported.as_ref().and_then(|entry| entry.source.clone()) {
            let original = exported.as_ref().and_then(|entry| entry.original.clone()).unwrap_or_else(|| name.to_string());
            self.origin(&file, &source, &original, seen)
        } else if let Some(imported) = exported.as_ref().and_then(|entry| {
            let local = entry.local.clone().unwrap_or_else(|| name.to_string());
            imports.iter().find(|import| import.local == local).cloned()
        }) {
            self.origin(&file, &imported.source, &imported.imported, seen)
        } else if exported.is_some() || declares {
            return at(package, Declared::File(file));
        } else {
            // `export * from` provides `name` when exactly one source
            // provides it: declares it, or re-exports it from a package.
            let found: Vec<Origin> = stars.iter().map(|star| self.origin(&file, star, name, seen)).collect();
            if found.iter().any(|origin| matches!(origin.declared, Declared::Pending)) {
                Origin { package: None, declared: Declared::Pending }
            } else {
                let mut providing = found
                    .into_iter()
                    .filter(|origin| origin.package.is_some() || matches!(origin.declared, Declared::File(_)));
                match (providing.next(), providing.next()) {
                    (Some(origin), None) => origin,
                    _ => Origin { package: None, declared: Declared::Unknown },
                }
            }
        };
        // The first package on the way is the member; one further in only
        // says where it is declared.
        Origin { package: package.or(next.package), declared: next.declared }
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
                AstKind::AssignmentExpression(assignment) => match &assignment.left {
                    AssignmentTarget::AssignmentTargetIdentifier(target) => {
                        scan.assignments.push((target.name.to_string(), &assignment.right));
                    }
                    // `holder.base = …` binds `base`, as the spelling reads it.
                    AssignmentTarget::StaticMemberExpression(target) => {
                        scan.assignments.push((target.property.name.to_string(), &assignment.right));
                    }
                    _ => {}
                },
                // `{ base: createSystem() }` binds `base`, as `holder.base`.
                AstKind::ObjectProperty(property) if !property.computed => {
                    if let PropertyKey::StaticIdentifier(key) = &property.key {
                        scan.assignments.push((key.name.to_string(), &property.value));
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

/// Whether `expr` is a name or a dotted path of names: `a` or `a.b.c`.
fn is_member_path(expr: &Expression<'_>) -> bool {
    match expr {
        Expression::Identifier(_) => true,
        Expression::StaticMemberExpression(member) => is_member_path(&member.object),
        _ => false,
    }
}

/// The name a chain start is used and bound by: an identifier's name, or a
/// dotted path's last segment, as the file's spelling reads it.
fn start_name(expr: &Expression<'_>) -> Option<String> {
    match expr {
        Expression::Identifier(ident) => Some(ident.name.to_string()),
        Expression::StaticMemberExpression(member) if is_member_path(&member.object) => {
            Some(member.property.name.to_string())
        }
        _ => None,
    }
}

/// The expression a chain starts from: through each link's callee to the
/// expression it is called on, past parentheses and type assertions. A
/// dotted path (`holder.base`), and a call through one that is no link
/// (`ns.createSystem()`), is a start of its own.
fn leftmost<'b, 'a>(expr: &'b Expression<'a>) -> &'b Expression<'a> {
    match expr {
        Expression::CallExpression(call) => match &call.callee {
            Expression::StaticMemberExpression(member)
                if is_member_path(&call.callee)
                    && member.property.name != "extend"
                    && member.property.name != "from" =>
            {
                expr
            }
            Expression::StaticMemberExpression(member) => leftmost(&member.object),
            _ => expr,
        },
        Expression::StaticMemberExpression(_) if is_member_path(expr) => expr,
        Expression::StaticMemberExpression(member) => leftmost(&member.object),
        Expression::ParenthesizedExpression(paren) => leftmost(&paren.expression),
        Expression::TSAsExpression(cast) => leftmost(&cast.expression),
        Expression::TSSatisfiesExpression(cast) => leftmost(&cast.expression),
        Expression::TSNonNullExpression(cast) => leftmost(&cast.expression),
        _ => expr,
    }
}

/// The base identifier of a link's single argument, with the member read
/// directly off it: `x` for `x`, `x.member` for `x.member…`.
fn link_base(call: &CallExpression<'_>) -> Option<String> {
    if call.arguments.len() != 1 {
        return None;
    }
    let mut expr = call.arguments[0].as_expression()?;
    let mut member_name = None;
    loop {
        match expr {
            Expression::Identifier(ident) => {
                return Some(match member_name {
                    Some(member) => format!("{}.{member}", ident.name),
                    None => ident.name.to_string(),
                });
            }
            Expression::StaticMemberExpression(member) => {
                member_name = Some(member.property.name.to_string());
                expr = &member.object;
            }
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

/// Reads the membership of the system file in `inputs`, and of each module
/// declaring a member, transitively.
pub fn system_membership(inputs: &MembershipInputs) -> Membership {
    let mut follower = Follower { inputs, facts: BTreeMap::new(), needs: BTreeSet::new() };
    let mut members: Vec<Member> = Vec::new();
    let mut findings: Vec<Finding> = Vec::new();
    let mut pending = false;
    let mut queue = VecDeque::from([inputs.system.clone()]);
    let mut queued = BTreeSet::from([inputs.system.clone()]);
    while let Some(file) = queue.pop_front() {
        let Some(read) = read_system(&file, &mut follower) else {
            if file == inputs.system {
                return Membership::default();
            }
            continue;
        };
        if read.pending {
            pending = true;
            continue;
        }
        findings.extend(read.findings.into_iter().map(|finding| Finding { file: file.clone(), finding }));
        for (source, imported) in read.linked {
            let origin = follower.origin(&file, &source, &imported, &mut BTreeSet::new());
            let (importer, specifier) = origin.package.unwrap_or_else(|| (file.clone(), source.clone()));
            // A package is one member by its spelling; a module, by where it
            // is spelled.
            let repeat = members.iter().any(|member| {
                member.specifier == specifier && (is_bare(&specifier) || member.importer == importer)
            });
            if !repeat {
                members.push(Member { specifier, importer });
            }
            match origin.declared {
                Declared::File(declaring) => {
                    if queued.insert(declaring.clone()) {
                        queue.push_back(declaring);
                    }
                }
                Declared::Pending => pending = true,
                Declared::Unknown => {}
            }
        }
    }
    if pending {
        return Membership { members: Vec::new(), findings: Vec::new(), needs: follower.needs.into_iter().collect(), parsed: true };
    }
    Membership { members, findings, needs: Vec::new(), parsed: true }
}

/// One module's roots: the bindings its roots link, by import, and its
/// findings; `pending` while an identity waits on a module.
struct SystemRead {
    linked: Vec<(String, String)>,
    findings: Vec<RootFinding>,
    pending: bool,
}

/// Reads one module's roots, or None where it is not supplied or does not
/// parse.
fn read_system(file: &str, follower: &mut Follower<'_>) -> Option<SystemRead> {
    let inputs = follower.inputs;
    let source = inputs.files.get(file)?;
    let counter = ParseCounter::new(0);
    let ast = OwnedAst::parse(file.to_string(), source.clone(), &counter);
    let facts = crate::facts::extract_file_facts(&ast);
    if facts.parse_panicked {
        return None;
    }
    let program: &Program<'_> = ast.program();
    let semantic = oxc::semantic::SemanticBuilder::new().with_build_nodes(true).build(program).semantic;
    let scan = Scan::of(&semantic);
    let system = file;

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
        return Some(SystemRead { linked: Vec::new(), findings: Vec::new(), pending: true });
    }

    let mut findings = state.findings;
    findings.extend(escapes(&semantic, source, &state.roots));
    Some(SystemRead { linked: members(source, &scan, &facts, &state.roots), findings, pending: false })
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

/// Each `includes: [ … ]` property in `object`, at any depth through
/// nested objects and arrays, by its key's offset.
fn includes_properties<'b, 'a>(
    object: &'b oxc::ast::ast::ObjectExpression<'a>,
    found: &mut Vec<(u32, &'b oxc::ast::ast::ArrayExpression<'a>)>,
) {
    fn within<'b, 'a>(expr: &'b Expression<'a>, found: &mut Vec<(u32, &'b oxc::ast::ast::ArrayExpression<'a>)>) {
        match expr {
            Expression::ObjectExpression(object) => includes_properties(object, found),
            Expression::ArrayExpression(array) => {
                for element in &array.elements {
                    if let Some(expr) = element.as_expression() {
                        within(expr, found);
                    }
                }
            }
            _ => {}
        }
    }
    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else { continue };
        if let (PropertyKey::StaticIdentifier(key), false, Expression::ArrayExpression(array)) =
            (&property.key, property.computed, &property.value)
        {
            if key.name == "includes" {
                found.push((key.span.start, array));
            }
        }
        within(&property.value, found);
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

/// The imports the members bind, as (specifier, imported name), in the
/// lexer's discovery order: every root call's `includes`, the legacy
/// `.includes([…])` calls, each root call's consecutive links, then each
/// bound chain's.
fn members(source: &str, scan: &Scan<'_>, facts: &FileFacts, roots: &BTreeSet<String>) -> Vec<(String, String)> {
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

    // `createSystem({ includes: [a, b] })`: the first `includes` property,
    // at any depth of the first argument, whose key comes before the
    // argument's first closing brace, as the spelling read it.
    for call in calls.iter().filter(|call| is_root(call)) {
        let Some(Expression::ObjectExpression(object)) = call.arguments.first().and_then(Argument::as_expression) else {
            continue;
        };
        let start = object.span.start as usize;
        let close = source[start..].find('}').map_or(usize::MAX, |at| start + at);
        let mut found: Vec<(u32, &oxc::ast::ast::ArrayExpression<'_>)> = Vec::new();
        includes_properties(object, &mut found);
        if let Some((_, array)) =
            found.into_iter().filter(|(key, _)| (*key as usize) < close).min_by_key(|(key, _)| *key)
        {
            for element in &array.elements {
                if let ArrayExpressionElement::Identifier(ident) = element {
                    add(&mut identifiers, ident.name.to_string());
                }
            }
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
        let start = leftmost(&member.object);
        if let Some(name) = start_name(start) {
            uses.entry(name).or_default().push(start.span().start);
        }
    }
    // A binding or assignment of one: `const b = base` binds `b` in turn.
    let values = scan
        .declarators
        .iter()
        .filter_map(|declarator| declarator.init.as_ref())
        .chain(scan.assignments.iter().map(|(_, value)| *value));
    for value in values {
        let start = leftmost(value);
        if let Some(name) = start_name(start) {
            uses.entry(name).or_default().push(start.span().start);
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
            for base in links.get(&start).into_iter().flatten() {
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
    let imports: BTreeMap<&str, (&str, &str)> = facts
        .imports
        .iter()
        .map(|binding| (binding.local.as_str(), (binding.source.as_str(), binding.imported.as_str())))
        .collect();
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
    let mut members: Vec<(String, String)> = Vec::new();
    for identifier in identifiers {
        let (base, read) = match identifier.split_once('.') {
            Some((base, read)) => (base.to_string(), Some(read)),
            None => (identifier.clone(), None),
        };
        let mut current = base;
        let mut seen = BTreeSet::new();
        while !imports.contains_key(current.as_str()) && seen.insert(current.clone()) {
            match aliases.get(&current) {
                Some(target) => current = target.clone(),
                None => break,
            }
        }
        // A named import binds the member; a namespace import's member
        // (`kit.system`) is that module's export of the name.
        let member = match (imports.get(current.as_str()), facts.namespace_imports.get(&current), read) {
            (Some((specifier, imported)), _, _) => (specifier.to_string(), imported.to_string()),
            (None, Some(specifier), Some(read)) => (specifier.clone(), read.to_string()),
            _ => continue,
        };
        if !members.contains(&member) {
            members.push(member);
        }
    }
    members
}


/// The chain `start` begins, outward through its calls, parentheses and
/// type assertions: its outermost node, and whether it is settled — built,
/// or read for a property rather than called on.
fn chain_end(nodes: &AstNodes<'_>, start: NodeId) -> (NodeId, bool) {
    let mut current = start;
    let mut built = false;
    loop {
        let span = nodes.kind(current).span();
        let parent = nodes.parent_node(current);
        if parent.id() == current {
            return (current, built);
        }
        match parent.kind() {
            AstKind::StaticMemberExpression(member) if member.object.span() == span => {
                match nodes.parent_kind(parent.id()) {
                    AstKind::CallExpression(call) if call.callee.span() == member.span => {
                        built |= member.property.name == "build";
                        current = nodes.parent_id(parent.id());
                    }
                    _ => return (current, true),
                }
            }
            AstKind::ParenthesizedExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSNonNullExpression(_)
            | AstKind::ChainExpression(_) => current = parent.id(),
            _ => return (current, built),
        }
    }
}

/// Whether the expression statement `statement` is a concise arrow's body
/// (`() => value`), which returns its value rather than discarding it.
fn returns(nodes: &AstNodes<'_>, statement: NodeId) -> bool {
    let body = nodes.parent_id(statement);
    matches!(nodes.parent_kind(body), AstKind::ArrowFunctionExpression(arrow) if arrow.expression)
}

/// Where a position that takes a builder sends it, for a finding.
fn escape_how(kind: &AstKind<'_>) -> &'static str {
    match kind {
        AstKind::CallExpression(_) | AstKind::NewExpression(_) => "it is passed to a function",
        // A statement that takes a builder is a concise arrow's body.
        AstKind::ReturnStatement(_) | AstKind::ArrowFunctionExpression(_) | AstKind::ExpressionStatement(_) => {
            "it is returned from a function"
        }
        AstKind::ArrayExpression(_) => "it is placed in an array",
        AstKind::ConditionalExpression(_) | AstKind::LogicalExpression(_) => "it is chosen conditionally",
        AstKind::SpreadElement(_) => "it is spread",
        AstKind::VariableDeclarator(_) => "it is destructured",
        AstKind::AssignmentExpression(_) => "it is assigned to a target membership does not follow",
        AstKind::ObjectProperty(_) => "it is stored under a computed key",
        AstKind::ComputedMemberExpression(_) => "it is read through a computed key",
        _ => "it is used where membership does not follow it",
    }
}

/// Each builder — a root chain not yet built — that leaves the positions
/// membership follows: a declaration, an assignment to a name or a property,
/// an object property, or a statement of its own. A builder bound by one is
/// followed through the binding's uses: a name by its references, a property
/// by the dotted paths that end in it, as membership reads them. The object
/// holding a property-bound builder is followed too: read through a dotted
/// path or bound to another name, it is followed; used any other way, its
/// builder leaves what membership follows.
fn escapes(semantic: &Semantic<'_>, source: &str, roots: &BTreeSet<String>) -> Vec<RootFinding> {
    let nodes = semantic.nodes();
    let scoping = semantic.scoping();
    let mut starts: Vec<NodeId> = nodes
        .iter()
        .filter(|node| {
            matches!(node.kind(), AstKind::CallExpression(call)
                if callee_path(&call.callee).is_some_and(|path| roots.contains(&path)))
        })
        .map(|node| node.id())
        .collect();
    let mut symbols: BTreeSet<SymbolId> = BTreeSet::new();
    let mut properties: BTreeSet<String> = BTreeSet::new();
    let mut holders: Vec<SymbolId> = Vec::new();
    let mut findings = Vec::new();
    let mut follow_symbol = |symbol: Option<SymbolId>, starts: &mut Vec<NodeId>| {
        if let Some(symbol) = symbol {
            if symbols.insert(symbol) {
                starts.extend(semantic.symbol_references(symbol).filter(|reference| !reference.is_write()).map(|reference| reference.node_id()));
            }
        }
    };
    let mut index = 0;
    while index < starts.len() {
        let (end, settled) = chain_end(nodes, starts[index]);
        index += 1;
        if settled {
            continue;
        }
        let span: Span = nodes.kind(end).span();
        let parent = nodes.parent_node(end);
        let mut property = None;
        match parent.kind() {
            AstKind::VariableDeclarator(declarator) if declarator.init.as_ref().is_some_and(|init| init.span() == span) => {
                if let BindingPattern::BindingIdentifier(ident) = &declarator.id {
                    follow_symbol(ident.symbol_id.get(), &mut starts);
                    continue;
                }
            }
            AstKind::AssignmentExpression(assignment) if assignment.right.span() == span => match &assignment.left {
                AssignmentTarget::AssignmentTargetIdentifier(target) => {
                    let symbol = target.reference_id.get().and_then(|id| scoping.get_reference(id).symbol_id());
                    follow_symbol(symbol, &mut starts);
                    continue;
                }
                AssignmentTarget::StaticMemberExpression(target) => {
                    property = Some(target.property.name.to_string());
                    // `holder.base = …`: the path's first name holds it.
                    let mut object = &target.object;
                    while let Expression::StaticMemberExpression(member) = object {
                        object = &member.object;
                    }
                    if let Expression::Identifier(ident) = object {
                        let symbol = ident.reference_id.get().and_then(|id| scoping.get_reference(id).symbol_id());
                        holders.extend(symbol);
                    }
                }
                _ => {}
            },
            AstKind::ObjectProperty(object_property) if !object_property.computed && object_property.value.span() == span => {
                if let PropertyKey::StaticIdentifier(key) = &object_property.key {
                    property = Some(key.name.to_string());
                    if let Some(found) = holding_object(nodes, scoping, parent.id()) {
                        match found {
                            Ok(symbol) => holders.extend(symbol),
                            Err((at, how)) => {
                                let (line, column) = crate::facts::line_column(source, at);
                                findings.push(RootFinding::Escapes { line, column, how: how.to_string() });
                            }
                        }
                    }
                }
            }
            AstKind::ExpressionStatement(_) if !returns(nodes, parent.id()) => continue,
            AstKind::ExportDefaultDeclaration(_)
            | AstKind::ExportSpecifier(_)
            | AstKind::TSTypeQuery(_)
            | AstKind::UnaryExpression(_) => continue,
            _ => {}
        }
        if let Some(name) = property {
            if properties.insert(name.clone()) {
                // Each dotted path ending in it that is read, not written.
                for node in nodes.iter() {
                    let AstKind::StaticMemberExpression(member) = node.kind() else { continue };
                    if member.property.name != name.as_str() || !is_member_path(&member.object) {
                        continue;
                    }
                    let written = matches!(nodes.parent_kind(node.id()),
                        AstKind::AssignmentExpression(assignment) if assignment.left.span() == member.span);
                    if !written {
                        starts.push(node.id());
                    }
                }
            }
            continue;
        }
        let (line, column) = crate::facts::line_column(source, span.start);
        findings.push(RootFinding::Escapes { line, column, how: escape_how(&parent.kind()).to_string() });
    }

    // Each holder's uses, and the names it is bound to in turn.
    let mut held: BTreeSet<SymbolId> = BTreeSet::new();
    let mut index = 0;
    while index < holders.len() {
        let symbol = holders[index];
        index += 1;
        if !held.insert(symbol) {
            continue;
        }
        for reference in semantic.symbol_references(symbol).filter(|reference| !reference.is_write()) {
            let node = reference.node_id();
            let span = nodes.kind(node).span();
            let parent = nodes.parent_node(node);
            match parent.kind() {
                AstKind::StaticMemberExpression(member) if member.object.span() == span => continue,
                // A computed write stores another value; a computed read
                // takes the builder out of sight.
                AstKind::ComputedMemberExpression(member)
                    if member.object.span() == span
                        && matches!(nodes.parent_kind(parent.id()),
                            AstKind::AssignmentExpression(assignment) if assignment.left.span() == member.span) =>
                {
                    continue
                }
                AstKind::VariableDeclarator(declarator) if declarator.init.as_ref().is_some_and(|init| init.span() == span) => {
                    if let BindingPattern::BindingIdentifier(ident) = &declarator.id {
                        holders.extend(ident.symbol_id.get());
                        continue;
                    }
                }
                AstKind::AssignmentExpression(assignment) if assignment.right.span() == span => {
                    if let AssignmentTarget::AssignmentTargetIdentifier(target) = &assignment.left {
                        holders.extend(target.reference_id.get().and_then(|id| scoping.get_reference(id).symbol_id()));
                        continue;
                    }
                }
                AstKind::ExpressionStatement(_) if !returns(nodes, parent.id()) => continue,
                AstKind::ExportDefaultDeclaration(_)
                | AstKind::ExportSpecifier(_)
                | AstKind::TSTypeQuery(_)
                | AstKind::UnaryExpression(_) => continue,
                _ => {}
            }
            let (line, column) = crate::facts::line_column(source, span.start);
            findings.push(RootFinding::Escapes { line, column, how: escape_how(&parent.kind()).to_string() });
        }
    }
    findings
}

/// Where an object literal holding a builder goes: the name it is bound to,
/// or the offset and manner of a use membership does not follow.
type Holding = Result<Option<SymbolId>, (u32, &'static str)>;

/// Where the object literal holding a builder under `property` goes,
/// through enclosing literals; None where it is a statement of its own or a
/// module's default export, or assigned to a property, whose paths are read
/// by spelling.
fn holding_object(nodes: &AstNodes<'_>, scoping: &oxc::semantic::Scoping, property: NodeId) -> Option<Holding> {
    let mut object = nodes.parent_id(property);
    // `{ a: { base: createSystem() } }`: the outermost literal holds it.
    while let AstKind::ObjectProperty(outer) = nodes.parent_kind(object) {
        if outer.computed || outer.value.span() != nodes.kind(object).span() {
            break;
        }
        object = nodes.parent_id(nodes.parent_id(object));
    }
    let span = nodes.kind(object).span();
    let parent = nodes.parent_node(object);
    match parent.kind() {
        AstKind::VariableDeclarator(declarator) if declarator.init.as_ref().is_some_and(|init| init.span() == span) => {
            match &declarator.id {
                BindingPattern::BindingIdentifier(ident) => Some(Ok(ident.symbol_id.get())),
                _ => Some(Err((span.start, "it is destructured"))),
            }
        }
        AstKind::AssignmentExpression(assignment) if assignment.right.span() == span => match &assignment.left {
            AssignmentTarget::AssignmentTargetIdentifier(target) => {
                Some(Ok(target.reference_id.get().and_then(|id| scoping.get_reference(id).symbol_id())))
            }
            _ => None,
        },
        AstKind::ExpressionStatement(_) if !returns(nodes, parent.id()) => None,
        AstKind::ExportDefaultDeclaration(_) => None,
        other => Some(Err((span.start, escape_how(&other)))),
    }
}
