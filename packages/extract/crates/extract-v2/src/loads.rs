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
    /// An `import` declaration; `runtime` unless type stripping erases it,
    /// and `bindingless` for `import './x'` or `import {} from './x'`.
    Import { runtime: bool, bindingless: bool },
    /// `export … from` or `export * from`; `runtime` likewise.
    Reexport { runtime: bool },
    /// `import(…)`.
    DynamicImport,
    /// A load call; `require` for `require(…)` itself, through parentheses,
    /// a type assertion or an optional call too (`(require)(x)`,
    /// `require!(x)`, `require?.(x)`).
    Call { require: bool },
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

    /// The declaration as `FileFacts::runtime_imports` records it: an
    /// `import` or `export … from` the compiler keeps, bindings or not.
    pub fn runtime_import(&self, source: &str) -> Option<ModuleLoad> {
        matches!(self.kind, LoadKind::Import { runtime: true, .. } | LoadKind::Reexport { runtime: true })
            .then(|| self.recorded(source, false))
    }

    fn recorded(&self, source: &str, dynamic_import: bool) -> ModuleLoad {
        let (start, end) = (self.span.start as usize, self.span.end as usize);
        ModuleLoad {
            target: self.target.clone(),
            dynamic_import,
            line: source[..start].matches('\n').count() + 1,
            call: source[start..end].split_whitespace().collect::<Vec<_>>().join(" "),
            start: self.span.start,
        }
    }

    /// The load as `FileFacts::module_loads` records it, for a load that
    /// is no declaration.
    pub fn module_load(&self, source: &str) -> Option<ModuleLoad> {
        let dynamic_import = match self.kind {
            LoadKind::DynamicImport => true,
            LoadKind::Call { .. } => false,
            LoadKind::Import { .. } | LoadKind::Reexport { .. } => return None,
        };
        Some(self.recorded(source, dynamic_import))
    }
}

/// Every load of `program`: its declarations in source order, then its
/// `import()` and load calls in source order.
pub fn collect(program: &Program<'_>) -> Vec<Load> {
    collect_listed(program).0
}

/// Every load of `program`, and the computed ones a host expands: each
/// load call or `import()` that names no single specifier, read in the
/// same pass, so the two always agree on which calls are loads.
pub fn collect_listed(program: &Program<'_>) -> (Vec<Load>, Vec<HostLoad>) {
    let mut loads = Vec::new();
    for stmt in &program.body {
        let (kind, source, span) = match stmt {
            Statement::ImportDeclaration(import) => {
                let bindingless = import.specifiers.as_ref().is_none_or(|specifiers| specifiers.is_empty());
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
                (LoadKind::Import { runtime, bindingless }, &import.source, import.span)
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
    let mut calls = Calls { loads, listed: Vec::new(), program };
    calls.visit_program(program);
    (calls.loads, calls.listed)
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

struct Calls<'p, 'a> {
    loads: Vec<Load>,
    listed: Vec<HostLoad>,
    program: &'p Program<'a>,
}

impl Calls<'_, '_> {
    /// The comments written inside `span`, delimiters included: webpack's
    /// magic comments and Vite's `@vite-ignore` steer a host's expansion.
    fn comments_in(&self, span: Span) -> Vec<String> {
        self.program
            .comments
            .iter()
            .filter(|comment| comment.span.start >= span.start && comment.span.end <= span.end)
            .map(|comment| comment.span.source_text(self.program.source_text).to_string())
            .collect()
    }

    /// Lists the call at `span` once, when any load it makes is computed.
    fn list(&mut self, span: Span, kind: HostLoadKind, args: impl FnOnce(&Self) -> Option<HostArgs>) {
        let computed = self
            .loads
            .iter()
            .rev()
            .take_while(|load| load.span == span)
            .any(|load| !matches!(load.target, LoadTarget::Specifier(_)));
        if computed {
            let args = args(self);
            self.listed.push(HostLoad { start: span.start, kind, args });
        }
    }
}

impl<'a> Visit<'a> for Calls<'_, 'a> {
    fn visit_import_expression(&mut self, import: &ImportExpression<'a>) {
        self.loads.push(Load {
            kind: LoadKind::DynamicImport,
            target: load_of(&import.source),
            spelling: spelling(Some(&import.source)),
            span: import.span,
        });
        self.list(import.span, HostLoadKind::Import, |calls| {
            Some(HostArgs::Specifier { quasis: quasis_of(&import.source)?, comments: calls.comments_in(import.span) })
        });
        oxc::ast_visit::walk::walk_import_expression(self, import);
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        let require = matches!(loader(&call.callee), Loader::Require);
        // The specifier as written: a string, or a template with no
        // substitution.
        let first = call.arguments.first().and_then(Argument::as_expression);
        let written = spelling(first);
        let literal = match (written, first.map(load_of)) {
            (Spelling::String | Spelling::Template, Some(LoadTarget::Specifier(specifier))) => Some(specifier),
            _ => None,
        };
        for target in call_loads(call) {
            let spelling = if require && literal.is_some() { written } else { Spelling::Other };
            self.loads.push(Load { kind: LoadKind::Call { require }, target, spelling, span: call.span });
        }
        if let Some(kind) = host_load_kind(&call.callee) {
            self.list(call.span, kind, |calls| host_args(kind, call, calls.comments_in(call.span)));
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
    /// The call's byte offset in its file, which a host expansion record
    /// names it by.
    pub start: u32,
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
    match loader(&call.callee) {
        Loader::Require => vec![argument(0).map_or(LoadTarget::Unknown, load_of)],
        Loader::RequireMember(member) if member == "context" => vec![context_of(argument(0), argument(1), argument(2))],
        Loader::ImportMetaMember(member) => match member.as_str() {
            "webpackContext" => vec![webpack_context_of(call)],
            "glob" | "globEager" => glob_loads(call.arguments.first()),
            _ => Vec::new(),
        },
        _ => Vec::new(),
    }
}

/// What a call's callee names, read through parentheses and type
/// assertions (`(require)`, `require!`), with a constant computed member
/// (`require['context']`) as the member it names.
enum Loader {
    Require,
    RequireMember(String),
    ImportMetaMember(String),
    Other,
}

fn loader(callee: &Expression<'_>) -> Loader {
    let member = |object: &Expression<'_>, name: String| match object.get_inner_expression() {
        Expression::Identifier(id) if id.name == "require" => Loader::RequireMember(name),
        Expression::MetaProperty(meta) if meta.meta.name == "import" && meta.property.name == "meta" => {
            Loader::ImportMetaMember(name)
        }
        _ => Loader::Other,
    };
    match callee.get_inner_expression() {
        Expression::Identifier(id) if id.name == "require" => Loader::Require,
        Expression::StaticMemberExpression(static_member) => {
            member(&static_member.object, static_member.property.name.to_string())
        }
        Expression::ComputedMemberExpression(computed) => match computed.expression.get_inner_expression() {
            Expression::StringLiteral(name) => member(&computed.object, name.value.to_string()),
            Expression::TemplateLiteral(template) if template.expressions.is_empty() => {
                match template.quasis.first().and_then(|quasi| quasi.value.cooked.as_ref()) {
                    Some(name) => member(&computed.object, name.to_string()),
                    None => Loader::Other,
                }
            }
            _ => Loader::Other,
        },
        _ => Loader::Other,
    }
}

/// A computed load as its host reads it, for the host to expand it as its
/// bundler does (spec §6.3). `args` is `None` where an argument is not
/// written statically: the host then lists no expansion.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostLoad {
    /// The call's byte offset, as `ModuleLoad::start` keys it.
    pub start: u32,
    pub kind: HostLoadKind,
    pub args: Option<HostArgs>,
}

/// Which loader a computed load calls.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HostLoadKind {
    /// `import(…)`.
    Import,
    /// `require(…)`.
    Require,
    /// `require.context(…)`.
    Context,
    /// `import.meta.webpackContext(…)`.
    WebpackContext,
    /// `import.meta.glob(…)`.
    Glob,
    /// The older `import.meta.globEager(…)`.
    GlobEager,
}

/// A computed load's arguments as written.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(untagged)]
pub enum HostArgs {
    /// `import(…)` or `require(…)`: the specifier's static text between
    /// its substitutions (a template's quasis, or a concatenation's strings;
    /// one more than the substitutions), and the comments inside the call.
    Specifier { quasis: Vec<String>, comments: Vec<String> },
    /// `require.context(dir, recursive, regExp, mode)`, or
    /// `import.meta.webpackContext(dir, { recursive, regExp, include,
    /// exclude, mode })`; an argument left out is `None`, for the host's
    /// default.
    #[serde(rename_all = "camelCase")]
    Context {
        dir: String,
        recursive: Option<bool>,
        reg_exp: Option<RegexLiteral>,
        include: Option<RegexLiteral>,
        exclude: Option<RegexLiteral>,
        mode: Option<String>,
    },
    /// `import.meta.glob(patterns, options)`: every pattern, negated ones
    /// included, and the options object as written.
    Glob { patterns: Vec<String>, options: Option<serde_json::Value> },
}

/// A regular expression literal as written.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct RegexLiteral {
    pub source: String,
    pub flags: String,
}

fn host_load_kind(callee: &Expression<'_>) -> Option<HostLoadKind> {
    match loader(callee) {
        Loader::Require => Some(HostLoadKind::Require),
        Loader::RequireMember(member) if member == "context" => Some(HostLoadKind::Context),
        Loader::ImportMetaMember(member) => match member.as_str() {
            "webpackContext" => Some(HostLoadKind::WebpackContext),
            "glob" => Some(HostLoadKind::Glob),
            "globEager" => Some(HostLoadKind::GlobEager),
            _ => None,
        },
        _ => None,
    }
}

fn host_args(kind: HostLoadKind, call: &CallExpression<'_>, comments: Vec<String>) -> Option<HostArgs> {
    let argument = |index: usize| call.arguments.get(index).map(Argument::as_expression);
    match kind {
        HostLoadKind::Import | HostLoadKind::Require => {
            Some(HostArgs::Specifier { quasis: quasis_of(argument(0)??)?, comments })
        }
        HostLoadKind::Context => Some(HostArgs::Context {
            dir: literal_text(argument(0)??)?,
            recursive: optional(argument(1), bool_literal)?,
            reg_exp: optional(argument(2), regex_literal)?,
            include: None,
            exclude: None,
            mode: optional(argument(3), literal_text)?,
        }),
        HostLoadKind::WebpackContext => webpack_context_args(literal_text(argument(0)??)?, argument(1)),
        HostLoadKind::Glob | HostLoadKind::GlobEager => {
            let patterns = match argument(0)??.get_inner_expression() {
                Expression::ArrayExpression(array) => array
                    .elements
                    .iter()
                    .map(|element| element.as_expression().and_then(literal_text))
                    .collect::<Option<Vec<_>>>()?,
                expression => vec![literal_text(expression)?],
            };
            let options = optional(argument(1), static_json)?;
            Some(HostArgs::Glob { patterns, options })
        }
    }
}

/// `import.meta.webpackContext(dir, options)`'s options; a key webpack
/// does not expand by (a chunk name) is skipped.
fn webpack_context_args(dir: String, options: Option<Option<&Expression<'_>>>) -> Option<HostArgs> {
    let (mut recursive, mut reg_exp, mut include, mut exclude, mut mode) = (None, None, None, None, None);
    if let Some(options) = options {
        let Expression::ObjectExpression(object) = options?.get_inner_expression() else {
            return None;
        };
        for property in &object.properties {
            let oxc::ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
                return None;
            };
            if property.computed {
                return None;
            }
            match property.key.static_name()?.as_ref() {
                "recursive" => recursive = Some(bool_literal(&property.value)?),
                "regExp" => reg_exp = Some(regex_literal(&property.value)?),
                "include" => include = Some(regex_literal(&property.value)?),
                "exclude" => exclude = Some(regex_literal(&property.value)?),
                "mode" => mode = Some(literal_text(&property.value)?),
                _ => {}
            }
        }
    }
    Some(HostArgs::Context { dir, recursive, reg_exp, include, exclude, mode })
}

/// An optional argument as `read` reads it: `Some(None)` when left out,
/// and `None` when it is a spread or not static, which leaves the call
/// unlisted.
fn optional<T>(
    argument: Option<Option<&Expression<'_>>>,
    read: impl Fn(&Expression<'_>) -> Option<T>,
) -> Option<Option<T>> {
    match argument {
        None => Some(None),
        Some(expression) => read(expression?).map(Some),
    }
}

fn regex_literal(expression: &Expression<'_>) -> Option<RegexLiteral> {
    let Expression::RegExpLiteral(literal) = expression.get_inner_expression() else {
        return None;
    };
    Some(RegexLiteral { source: literal.regex.pattern.text.to_string(), flags: literal.regex.flags.to_string() })
}

fn bool_literal(expression: &Expression<'_>) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(literal) => Some(literal.value),
        _ => None,
    }
}

/// A string literal, or a template with no substitution, as its value.
fn literal_text(expression: &Expression<'_>) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(literal) => Some(literal.value.to_string()),
        Expression::TemplateLiteral(template) if template.expressions.is_empty() => {
            template.quasis.first()?.value.cooked.as_ref().map(|cooked| cooked.to_string())
        }
        _ => None,
    }
}

/// A specifier's static text between its substitutions: a template's
/// quasis, a concatenation's strings, any other expression one
/// substitution. `None` where a template's text has no cooked value.
fn quasis_of(expression: &Expression<'_>) -> Option<Vec<String>> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(literal) => Some(vec![literal.value.to_string()]),
        Expression::TemplateLiteral(template) => template
            .quasis
            .iter()
            .map(|quasi| quasi.value.cooked.as_ref().map(|cooked| cooked.to_string()))
            .collect(),
        // `+` concatenates when either side is text; numbers it adds.
        Expression::BinaryExpression(binary)
            if binary.operator == oxc::syntax::operator::BinaryOperator::Addition
                && (is_text(&binary.left) || is_text(&binary.right)) =>
        {
            let mut quasis = quasis_of(&binary.left)?;
            let mut right = quasis_of(&binary.right)?.into_iter();
            let joined = quasis.pop().unwrap_or_default() + &right.next().unwrap_or_default();
            quasis.push(joined);
            quasis.extend(right);
            Some(quasis)
        }
        _ => Some(vec![String::new(), String::new()]),
    }
}

fn is_text(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::StringLiteral(_) | Expression::TemplateLiteral(_) => true,
        Expression::BinaryExpression(binary) if binary.operator == oxc::syntax::operator::BinaryOperator::Addition => {
            is_text(&binary.left) || is_text(&binary.right)
        }
        _ => false,
    }
}

/// An options object as JSON, where every value in it is written
/// statically.
fn static_json(expression: &Expression<'_>) -> Option<serde_json::Value> {
    use serde_json::Value;
    Some(match expression.get_inner_expression() {
        Expression::ObjectExpression(object) => {
            let mut map = serde_json::Map::new();
            for property in &object.properties {
                let oxc::ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
                    return None;
                };
                if property.computed {
                    return None;
                }
                map.insert(property.key.static_name()?.to_string(), static_json(&property.value)?);
            }
            Value::Object(map)
        }
        Expression::ArrayExpression(array) => Value::Array(
            array.elements.iter().map(|element| element.as_expression().and_then(static_json)).collect::<Option<_>>()?,
        ),
        Expression::BooleanLiteral(literal) => Value::Bool(literal.value),
        Expression::NullLiteral(_) => Value::Null,
        Expression::NumericLiteral(literal) => Value::Number(serde_json::Number::from_f64(literal.value)?),
        expression => Value::String(literal_text(expression)?),
    })
}
