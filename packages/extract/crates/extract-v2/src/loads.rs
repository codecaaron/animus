//! Every module a file loads at run time, read once: its `import`
//! declarations and re-exports, `import()`, and the load calls
//! (`require(…)`, `require.context(…)`, `import.meta.glob(…)`,
//! `import.meta.webpackContext(…)`), each with what it names and how its
//! specifier is written.

use oxc::ast::ast::{
    Argument, CallExpression, ExportNamedDeclaration, Expression, ImportDeclarationSpecifier, ImportExpression,
    ImportOrExportKind, Program, Statement,
};
use oxc::ast_visit::Visit;
use oxc::span::Span;

/// What a load is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoadKind {
    /// An `import` declaration; `runtime` unless type stripping erases it.
    Import { runtime: bool },
    /// `export … from` or `export * from`; `runtime` likewise.
    Reexport { runtime: bool },
    /// `import(…)`.
    DynamicImport,
    /// A load call; `require` for `require(…)` itself.
    Call { require: bool },
    /// `require` reached through parentheses or a type assertion
    /// (`(require)('./x')`, `require!('./x')`) with a literal specifier;
    /// the load calls match the bare name.
    WrappedRequire,
}

/// How a load's specifier is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Spelling {
    /// A string literal, as written.
    String,
    /// A template literal with no expressions, as written.
    Template,
    Other,
}

/// One module load.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Load {
    pub kind: LoadKind,
    pub target: LoadTarget,
    pub spelling: Spelling,
    pub span: Span,
}

impl Load {
    /// The module the load names by one specifier, if it does.
    pub fn specifier(&self) -> Option<&str> {
        match &self.target {
            LoadTarget::Specifier(specifier) => Some(specifier),
            _ => None,
        }
    }

    /// The load as `FileFacts::module_loads` records it, for a load that
    /// is no declaration.
    pub fn module_load(&self, source: &str) -> Option<ModuleLoad> {
        let dynamic_import = match self.kind {
            LoadKind::DynamicImport => true,
            LoadKind::Call { .. } | LoadKind::WrappedRequire => false,
            LoadKind::Import { .. } | LoadKind::Reexport { .. } => return None,
        };
        let (start, end) = (self.span.start as usize, self.span.end as usize);
        Some(ModuleLoad {
            target: self.target.clone(),
            dynamic_import,
            line: source[..start].matches('\n').count() + 1,
            call: source[start..end].split_whitespace().collect::<Vec<_>>().join(" "),
        })
    }
}

/// Every load of `program`: its declarations in source order, then its
/// `import()` and load calls in source order.
pub fn collect(program: &Program<'_>) -> Vec<Load> {
    let mut loads = Vec::new();
    for stmt in &program.body {
        let (kind, source, span) = match stmt {
            Statement::ImportDeclaration(import) => {
                let runtime = import.import_kind != ImportOrExportKind::Type
                    && match &import.specifiers {
                        // A side-effect import, or `import {} from`, still loads.
                        None => true,
                        Some(specifiers) if specifiers.is_empty() => true,
                        Some(specifiers) => specifiers.iter().any(|spec| match spec {
                            ImportDeclarationSpecifier::ImportSpecifier(named) => {
                                named.import_kind != ImportOrExportKind::Type
                            }
                            _ => true,
                        }),
                    };
                (LoadKind::Import { runtime }, &import.source, import.span)
            }
            Statement::ExportNamedDeclaration(export) => {
                let Some(source) = &export.source else { continue };
                (LoadKind::Reexport { runtime: reexport_needs_runtime(export) }, source, export.span)
            }
            Statement::ExportAllDeclaration(export) => {
                let runtime = export.export_kind != ImportOrExportKind::Type;
                (LoadKind::Reexport { runtime }, &export.source, export.span)
            }
            _ => continue,
        };
        loads.push(Load {
            kind,
            target: LoadTarget::Specifier(source.value.to_string()),
            spelling: Spelling::String,
            span,
        });
    }
    let mut calls = Calls(loads);
    calls.visit_program(program);
    calls.0
}

/// A type-only re-export, or one whose every named specifier is a type, is
/// erased before anything loads.
fn reexport_needs_runtime(export: &ExportNamedDeclaration<'_>) -> bool {
    export.export_kind != ImportOrExportKind::Type
        && (export.specifiers.is_empty()
            || export.specifiers.iter().any(|spec| spec.export_kind != ImportOrExportKind::Type))
}

fn spelling(expression: Option<&Expression<'_>>) -> Spelling {
    match expression {
        Some(Expression::StringLiteral(_)) => Spelling::String,
        Some(Expression::TemplateLiteral(template)) if template.expressions.is_empty() => Spelling::Template,
        _ => Spelling::Other,
    }
}

struct Calls(Vec<Load>);

impl<'a> Visit<'a> for Calls {
    fn visit_import_expression(&mut self, import: &ImportExpression<'a>) {
        self.0.push(Load {
            kind: LoadKind::DynamicImport,
            target: load_of(&import.source),
            spelling: spelling(Some(&import.source)),
            span: import.span,
        });
        oxc::ast_visit::walk::walk_import_expression(self, import);
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        let require = call.callee.is_specific_id("require");
        // The specifier as written: a string, or a template with no
        // substitution.
        let first = call.arguments.first().and_then(Argument::as_expression);
        let written = spelling(first);
        let literal = match (written, first.map(load_of)) {
            (Spelling::String | Spelling::Template, Some(LoadTarget::Specifier(specifier))) => Some(specifier),
            _ => None,
        };
        let targets = call_loads(call);
        match (targets.is_empty(), require, literal) {
            (true, true, Some(specifier)) => self.0.push(Load {
                kind: LoadKind::WrappedRequire,
                target: LoadTarget::Specifier(specifier),
                spelling: written,
                span: call.span,
            }),
            (_, _, literal) => {
                for target in targets {
                    let spelling = if require && literal.is_some() { written } else { Spelling::Other };
                    self.0.push(Load { kind: LoadKind::Call { require }, target, spelling, span: call.span });
                }
            }
        }
        oxc::ast_visit::walk::walk_call_expression(self, call);
    }
}

/// A module a file loads at runtime, outside its `import` declarations:
/// `import()`, `require()`, `require.context()`, `import.meta.glob()`.
/// Whatever the loaded module exports renders where usage cannot follow. A
/// glob array gives one load per pattern, all from one call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModuleLoad {
    pub target: LoadTarget,
    /// An `import()`: some hosts leave an unreadable one unbundled.
    pub dynamic_import: bool,
    /// The call's line and spelling, for the warning when it opens many
    /// components.
    pub line: usize,
    pub call: String,
}

/// What a module load names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoadTarget {
    /// One specifier: `import('./r')`, `require('./r')`.
    Specifier(String),
    /// Every module whose specifier starts with this: a template literal
    /// (`import(`./pages/${name}`)`) or a concatenation.
    Prefix(String),
    /// `require.context(dir, recursive, filter)` and
    /// `import.meta.webpackContext(dir, { recursive, regExp })`: modules
    /// under `dir`, at any depth when `recursive`, whose `./`-relative path
    /// `filter` (a regular expression) matches; `None` matches any.
    Context {
        dir: String,
        recursive: bool,
        filter: Option<String>,
    },
    /// One `import.meta.glob` pattern.
    Glob(String),
    /// A specifier usage cannot read.
    Unknown,
}

/// The modules a specifier expression can name.
fn load_of(specifier: &Expression<'_>) -> LoadTarget {
    match specifier.get_inner_expression() {
        Expression::StringLiteral(literal) => LoadTarget::Specifier(literal.value.to_string()),
        Expression::TemplateLiteral(template) => {
            let head = template.quasis.first().and_then(|quasi| quasi.value.cooked.as_ref());
            match (template.expressions.is_empty(), head) {
                (true, Some(head)) => LoadTarget::Specifier(head.to_string()),
                (false, Some(head)) => LoadTarget::Prefix(head.to_string()),
                _ => LoadTarget::Unknown,
            }
        }
        Expression::BinaryExpression(binary)
            if binary.operator == oxc::syntax::operator::BinaryOperator::Addition =>
        {
            match load_of(&binary.left) {
                LoadTarget::Specifier(head) | LoadTarget::Prefix(head) => LoadTarget::Prefix(head),
                _ => LoadTarget::Unknown,
            }
        }
        _ => LoadTarget::Unknown,
    }
}

/// A regular expression literal as a pattern for the `regex` crate, its
/// flags folded in; `None` for anything else.
fn regex_of(expression: Option<&Expression<'_>>) -> Option<String> {
    let Expression::RegExpLiteral(literal) = expression?.get_inner_expression() else {
        return None;
    };
    let flags = literal.regex.flags.to_string();
    let inline: String = flags.chars().filter(|flag| matches!(flag, 'i' | 'm' | 's')).collect();
    let pattern = literal.regex.pattern.text.to_string();
    Some(if inline.is_empty() { pattern } else { format!("(?{inline}){pattern}") })
}

/// A context's modules: `dir`, how deep, and which paths. An argument
/// usage cannot read keeps the widest reading: any depth, any path.
fn context_of(
    dir: Option<&Expression<'_>>,
    recursive: Option<&Expression<'_>>,
    filter: Option<&Expression<'_>>,
) -> LoadTarget {
    let dir = match dir.map(load_of) {
        Some(LoadTarget::Specifier(dir)) => dir,
        Some(LoadTarget::Prefix(prefix)) => {
            return LoadTarget::Prefix(prefix);
        }
        _ => return LoadTarget::Unknown,
    };
    let recursive = !matches!(
        recursive.map(Expression::get_inner_expression),
        Some(Expression::BooleanLiteral(literal)) if !literal.value
    );
    LoadTarget::Context {
        dir,
        recursive,
        filter: regex_of(filter),
    }
}

/// `import.meta.webpackContext(dir, { recursive, regExp })`.
fn webpack_context_of(call: &CallExpression<'_>) -> LoadTarget {
    let options = call.arguments.get(1).and_then(Argument::as_expression);
    let option = |name: &str| match options.map(Expression::get_inner_expression) {
        Some(Expression::ObjectExpression(object)) => object.properties.iter().find_map(|property| {
            match property {
                oxc::ast::ast::ObjectPropertyKind::ObjectProperty(property)
                    if property.key.static_name().as_deref() == Some(name) =>
                {
                    Some(&property.value)
                }
                _ => None,
            }
        }),
        _ => None,
    };
    let first = call.arguments.first().and_then(Argument::as_expression);
    context_of(first, option("recursive"), option("regExp"))
}

/// The patterns one glob argument names: a pattern, or an array of them; a
/// negated pattern only narrows, so it is skipped.
fn glob_loads(argument: Option<&Argument<'_>>) -> Vec<LoadTarget> {
    let pattern = |expression: &Expression<'_>| match expression.get_inner_expression() {
        Expression::StringLiteral(literal) if literal.value.starts_with('!') => None,
        Expression::StringLiteral(literal) => Some(LoadTarget::Glob(literal.value.to_string())),
        _ => Some(LoadTarget::Unknown),
    };
    match argument.and_then(Argument::as_expression).map(Expression::get_inner_expression) {
        Some(Expression::ArrayExpression(array)) => array
            .elements
            .iter()
            .filter_map(|element| match element.as_expression() {
                Some(expression) => pattern(expression),
                None => Some(LoadTarget::Unknown),
            })
            .collect(),
        Some(expression) => pattern(expression).into_iter().collect(),
        None => vec![LoadTarget::Unknown],
    }
}

/// What a call loads: `require(…)`, `require.context(…)`,
/// `import.meta.webpackContext(…)` and `import.meta.glob(…)` (also the
/// older `globEager`). `require.resolve` loads nothing.
fn call_loads(call: &CallExpression<'_>) -> Vec<LoadTarget> {
    let argument = |index: usize| call.arguments.get(index).and_then(Argument::as_expression);
    match &call.callee {
        Expression::Identifier(id) if id.name == "require" => {
            vec![argument(0).map_or(LoadTarget::Unknown, load_of)]
        }
        Expression::StaticMemberExpression(member) => {
            match (&member.object, member.property.name.as_str()) {
                (Expression::Identifier(object), "context") if object.name == "require" => {
                    vec![context_of(argument(0), argument(1), argument(2))]
                }
                (Expression::MetaProperty(meta), property)
                    if meta.meta.name == "import" && meta.property.name == "meta" =>
                {
                    match property {
                        "webpackContext" => vec![webpack_context_of(call)],
                        "glob" | "globEager" => glob_loads(call.arguments.first()),
                        _ => Vec::new(),
                    }
                }
                _ => Vec::new(),
            }
        }
        _ => Vec::new(),
    }
}
