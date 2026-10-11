//! Whether a package entry is self-contained: every module it reaches, by
//! the literal specifiers it imports, is installed under `node_modules`, so
//! loading it cannot reach a module the analysis holds and re-export one of
//! its objects.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use oxc::ast::AstKind;
use oxc::ast_visit::Visit;
use oxc::span::{GetSpan, Span};

use crate::analyze_css::{expand_alias, AliasEntry};
use crate::loads::{LoadKind, LoadTarget, Spelling};

/// What one file's code loads, as the proof reads it.
#[derive(Clone)]
enum Fact {
    /// A module named by a literal specifier.
    Loads(String),
    /// Something that may load a module the proof cannot name, said as a
    /// clause.
    Unnamed(String),
}

/// The extensions of files whose code runs; any other file a specifier
/// names (JSON, a stylesheet, an asset) imports nothing.
const SCRIPT_EXTENSIONS: [&str; 8] = ["js", "mjs", "cjs", "jsx", "ts", "tsx", "mts", "cts"];

/// Each file's facts, kept while its size and modification time stay the
/// same, so a later proof re-reads only what changed.
struct Read {
    len: u64,
    modified: Option<SystemTime>,
    facts: Vec<Fact>,
}

static READS: Mutex<Option<HashMap<PathBuf, Read>>> = Mutex::new(None);

fn facts_of(path: &Path) -> Result<Vec<Fact>, String> {
    let meta = std::fs::metadata(path).map_err(|error| format!("cannot be read: {error}"))?;
    let (len, modified) = (meta.len(), meta.modified().ok());
    let mut reads = READS.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let reads = reads.get_or_insert_with(HashMap::new);
    if let Some(read) = reads.get(path).filter(|read| read.len == len && read.modified == modified) {
        return Ok(read.facts.clone());
    }
    let source = std::fs::read_to_string(path).map_err(|error| format!("cannot be read: {error}"))?;
    let facts = read_facts(path, source);
    reads.insert(path.to_path_buf(), Read { len, modified, facts: facts.clone() });
    Ok(facts)
}

fn read_facts(path: &Path, source: String) -> Vec<Fact> {
    let counter = crate::owned_ast::ParseCounter::new(0);
    let ast = crate::owned_ast::OwnedAst::parse(path.to_string_lossy().to_string(), source, &counter);
    if ast.panicked {
        return vec![Fact::Unnamed("does not parse".to_string())];
    }
    let program = ast.program();
    let text = program.source_text;
    let line = |span: Span| text[..(span.start as usize).min(text.len())].matches('\n').count() + 1;
    let mut facts = Vec::new();
    let scoping = oxc::semantic::SemanticBuilder::new().build(program).semantic.into_scoping();
    for load in crate::loads::collect(program) {
        match (load.kind, &load.target) {
            (LoadKind::Import { runtime: false } | LoadKind::Reexport { runtime: false }, _) => {}
            (_, LoadTarget::Specifier(specifier)) if specifier == "module" || specifier == "node:module" => {
                facts.push(Fact::Unnamed(format!("line {}: imports {specifier}, which can create a require", line(load.span))));
            }
            (_, LoadTarget::Specifier(specifier)) if load.spelling != Spelling::Other => {
                facts.push(Fact::Loads(specifier.clone()));
            }
            _ => facts.push(Fact::Unnamed(format!("line {}: loads a module no literal names", line(load.span)))),
        }
    }
    let mut loaders = Loaders { scoping: &scoping, ancestors: Vec::new(), found: None };
    loaders.visit_program(program);
    if let Some((span, how)) = loaders.found {
        facts.push(Fact::Unnamed(format!("line {}: {how}", line(span))));
    }
    facts
}

/// The first read of an unbound loader or code runner that may load a module
/// no literal names:
/// - `require` other than a call of it, a `typeof` of it or
///   `require.resolve`, and `module.require`: a loader handed on;
/// - `eval` other than as a `typeof` operand;
/// - `Function` other than as a `typeof` operand, the right side of
///   `instanceof`, or `Function.prototype.toString`, `.call`, `.apply` or
///   `.bind`;
/// - `eval` or `Function` read from the global object (`globalThis.eval`).
///
/// A computed member (`globalThis['ev' + 'al']`) and a function's own
/// `constructor` are not followed, as for the style statics.
struct Loaders<'s, 'a> {
    scoping: &'s oxc::semantic::Scoping,
    ancestors: Vec<AstKind<'a>>,
    found: Option<(Span, &'static str)>,
}

impl<'a> Visit<'a> for Loaders<'_, 'a> {
    fn enter_node(&mut self, kind: AstKind<'a>) {
        self.ancestors.push(kind);
    }

    fn leave_node(&mut self, _kind: AstKind<'a>) {
        self.ancestors.pop();
    }

    fn visit_identifier_reference(&mut self, ident: &oxc::ast::ast::IdentifierReference<'a>) {
        const NAMES: [&str; 8] = ["require", "module", "eval", "Function", "globalThis", "window", "self", "global"];
        if self.found.is_some() || !NAMES.contains(&ident.name.as_str()) {
            return;
        }
        let unbound = ident
            .reference_id
            .get()
            .is_none_or(|id| self.scoping.get_reference(id).symbol_id().is_none());
        if !unbound {
            return;
        }
        // Erased wrappers around the name (`(require)`, `require!`) are the
        // name.
        let mut parents = self.ancestors.iter().rev();
        let (span, parent) = peel(&mut parents, ident.span);
        let member_of = |kind: Option<&AstKind<'a>>, span: Span| match kind {
            Some(AstKind::StaticMemberExpression(member)) if member.object.span() == span => {
                Some(member.property.name.as_str())
            }
            _ => None,
        };
        let how = match (ident.name.as_str(), parent) {
            (_, Some(AstKind::UnaryExpression(unary)))
                if unary.operator == oxc::syntax::operator::UnaryOperator::Typeof =>
            {
                None
            }
            ("require", Some(AstKind::CallExpression(call))) if call.callee.span() == span => None,
            ("require", parent) if member_of(parent, span) == Some("resolve") => None,
            ("require", _) => Some("reads require as a value, so it may load any module"),
            ("module", parent) if member_of(parent, span) == Some("require") => {
                Some("reads module.require, which may load any module")
            }
            ("eval", _) => Some("reads eval, which can run code that loads any module"),
            ("Function", Some(AstKind::BinaryExpression(binary)))
                if binary.operator == oxc::syntax::operator::BinaryOperator::Instanceof
                    && binary.right.span() == span =>
            {
                None
            }
            ("Function", parent) if member_of(parent, span) == Some("prototype") => {
                let (prototype, method) = peel(&mut parents, parent.map_or(span, GetSpan::span));
                match member_of(method, prototype) {
                    Some("toString" | "call" | "apply" | "bind") => None,
                    _ => Some("reads Function, which can run code that loads any module"),
                }
            }
            ("Function", _) => Some("reads Function, which can run code that loads any module"),
            (_, parent) if matches!(member_of(parent, span), Some("eval" | "Function")) => {
                Some("reads eval or Function from the global object, which can run code that loads any module")
            }
            _ => None,
        };
        if let Some(how) = how {
            self.found = Some((ident.span, how));
        }
    }
}

/// The span the erased wrappers around `span` end at (`(require)`,
/// `require!`, `require as T`), and the first ancestor past them.
fn peel<'b, 'a: 'b>(parents: &mut impl Iterator<Item = &'b AstKind<'a>>, span: Span) -> (Span, Option<&'b AstKind<'a>>) {
    let mut span = span;
    loop {
        match parents.next() {
            Some(kind @ (AstKind::ParenthesizedExpression(_) | AstKind::TSNonNullExpression(_) | AstKind::TSAsExpression(_))) => {
                span = kind.span();
            }
            other => return (span, other),
        }
    }
}

/// Why an entry is not proven self-contained, said as a clause.
pub(crate) type Unproven = String;

/// A file's or directory's size and modification time.
type Stamp = (u64, Option<SystemTime>);

fn stamp(path: &Path) -> Option<Stamp> {
    std::fs::metadata(path).ok().map(|meta| (meta.len(), meta.modified().ok()))
}

/// A proof, with what it read: each file it visited and each directory on
/// their resolution paths, as stamped then. An install adds or removes a
/// directory entry, which restamps the `node_modules` directory holding it.
struct Kept {
    stamps: Vec<(PathBuf, Option<Stamp>)>,
    result: Result<(), Unproven>,
}

static PROOFS: Mutex<Option<HashMap<String, Kept>>> = Mutex::new(None);

/// Proves `specifier`, resolved from `from_dir`, self-contained: every
/// file it reaches is a data file or code whose every load names, by a
/// literal specifier no host alias maps, a module built into Node or a file
/// under `node_modules`. Anything else is the reason it is not. A proof is
/// kept while every file it read and every directory on their resolution
/// paths keeps its size and modification time.
pub(crate) fn prove(
    specifier: &str,
    from_dir: &str,
    context: &animus_system_loader::ResolutionContext,
    aliases: &[AliasEntry],
) -> Result<(), Unproven> {
    let key = format!("{specifier}\0{from_dir}\0{:?}\0{:?}\0{:?}\0{aliases:?}", context.conditions, context.workspaces, context.extensions);
    {
        let proofs = PROOFS.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(kept) = proofs.as_ref().and_then(|proofs| proofs.get(&key)) {
            if kept.stamps.iter().all(|(path, was)| stamp(path) == *was) {
                return kept.result.clone();
            }
        }
    }
    let mut visited = vec![PathBuf::from(from_dir)];
    let result = walk(specifier, from_dir, context, aliases, &mut visited);
    let mut paths: Vec<PathBuf> = Vec::new();
    for path in &visited {
        paths.push(path.clone());
        paths.extend(path.ancestors().skip(1).map(Path::to_path_buf));
    }
    paths.sort();
    paths.dedup();
    let stamps = paths.into_iter().map(|path| {
        let at = stamp(&path);
        (path, at)
    });
    let kept = Kept { stamps: stamps.collect(), result: result.clone() };
    PROOFS.lock().unwrap_or_else(std::sync::PoisonError::into_inner).get_or_insert_with(HashMap::new).insert(key, kept);
    result
}

fn walk(
    specifier: &str,
    from_dir: &str,
    context: &animus_system_loader::ResolutionContext,
    aliases: &[AliasEntry],
    visited: &mut Vec<PathBuf>,
) -> Result<(), Unproven> {
    let shown = |path: &Path| {
        let text = path.to_string_lossy();
        match text.rfind("node_modules/") {
            Some(at) => text[at..].to_string(),
            None => text.to_string(),
        }
    };
    let installed = |path: &Path| path.components().any(|component| component.as_os_str() == "node_modules");
    let entry = animus_system_loader::resolve_specifier(specifier, from_dir, context)
        .map_err(|why| format!("{specifier} does not resolve: {why}"))?
        .0;
    if !installed(&entry) {
        return Err(format!("{specifier} resolves to {}, outside node_modules", entry.display()));
    }
    let mut seen = HashSet::new();
    let mut pending = vec![entry];
    while let Some(file) = pending.pop() {
        if !seen.insert(file.clone()) {
            continue;
        }
        visited.push(file.clone());
        let script = file
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| SCRIPT_EXTENSIONS.contains(&extension));
        if !script {
            continue;
        }
        let at = shown(&file);
        let dir = file.parent().map(|dir| dir.to_string_lossy().to_string()).unwrap_or_default();
        for fact in facts_of(&file).map_err(|why| format!("{at} {why}"))? {
            let loaded = match fact {
                Fact::Unnamed(why) => return Err(format!("{at} {why}")),
                Fact::Loads(loaded) => loaded,
            };
            if crate::link::is_node_builtin(&loaded) {
                continue;
            }
            let path_like = loaded.starts_with('.') || loaded.starts_with('/');
            if !path_like && expand_alias(&loaded, aliases).is_some() {
                return Err(format!("{at} loads {loaded}, which a host alias maps"));
            }
            let resolved = animus_system_loader::resolve_specifier(&loaded, &dir, context)
                .map_err(|why| format!("{at} loads {loaded}, which does not resolve: {why}"))?
                .0;
            if !installed(&resolved) {
                return Err(format!("{at} loads {loaded}, which resolves to {}, outside node_modules", resolved.display()));
            }
            pending.push(resolved);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh directory for one fixture tree.
    fn fixture(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("animus-self-contained-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    fn write(path: &Path, contents: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, contents).unwrap();
    }

    /// A package installed under `app/node_modules`, its `index.js` as given.
    fn package(app: &Path, name: &str, index: &str) {
        let dir = app.join("node_modules").join(name);
        write(&dir.join("package.json"), &format!(r#"{{ "name": "{name}", "main": "index.js" }}"#));
        write(&dir.join("index.js"), index);
    }

    fn proof(app: &Path, specifier: &str, aliases: &[AliasEntry]) -> Result<(), Unproven> {
        prove(specifier, &app.join("src").to_string_lossy(), &animus_system_loader::ResolutionContext::default(), aliases)
    }

    /// An entry is self-contained only when every module it reaches loads,
    /// by a literal specifier no host alias maps, a module built into Node
    /// or a file under `node_modules`: a computed load, a loader read as a
    /// value, `node:module`, code from a string, an alias, a path out of
    /// `node_modules` and an unresolvable specifier each defeat it, named
    /// with the file and line.
    #[test]
    fn a_package_entry_is_self_contained_only_when_everything_it_reaches_stays_installed() {
        let app = fixture("rows");
        write(&app.join("src/pad.ts"), "export const pad = { padding: 4 };\n");
        package(&app, "dep", "export const two = 2;\n");
        package(
            &app,
            "plain",
            "import { two } from 'dep';\nimport data from './data.json';\nimport 'node:path';\n\
             export const toText = Function.prototype.toString;\nexport default [two, data, typeof require];\n",
        );
        write(&app.join("node_modules/plain/data.json"), "{}\n");
        package(&app, "computed", "export const load = (name) => import(name);\n");
        package(&app, "template", "export const load = (name) => import(`./locale/${name}.js`);\n");
        package(&app, "loader", "const load = require;\nmodule.exports = load('dep');\n");
        package(&app, "creates", "import { createRequire } from 'node:module';\nexport const r = createRequire(import.meta.url);\n");
        package(&app, "evals", "export const run = (code) => eval(code);\n");
        package(&app, "aliased", "export { pad } from '@app/pad';\n");
        package(&app, "escapes", "export { pad } from '../../src/pad.ts';\n");
        package(&app, "missing", "export { x } from 'absent';\n");
        package(&app, "reaches-computed", "export * from 'computed';\n");
        let aliases = [AliasEntry {
            pattern: "@app/".to_string(),
            replacement: "./src/".to_string(),
            alias_type: crate::analyze_css::AliasType::Prefix,
        }];
        assert_eq!(proof(&app, "plain", &aliases), Ok(()));
        for (specifier, because) in [
            ("computed", "node_modules/computed/index.js line 1: loads a module no literal names"),
            ("template", "node_modules/template/index.js line 1: loads a module no literal names"),
            ("loader", "node_modules/loader/index.js line 1: reads require as a value"),
            ("creates", "node_modules/creates/index.js line 1: imports node:module"),
            ("evals", "node_modules/evals/index.js line 1: reads eval"),
            ("aliased", "node_modules/aliased/index.js loads @app/pad, which a host alias maps"),
            ("escapes", "node_modules/escapes/index.js loads ../../src/pad.ts, which resolves to"),
            ("missing", "node_modules/missing/index.js loads absent, which does not resolve"),
            ("reaches-computed", "node_modules/computed/index.js line 1: loads a module no literal names"),
        ] {
            let why = proof(&app, specifier, &aliases).expect_err(specifier);
            assert!(why.starts_with(because), "{specifier}: {why}");
        }
        let _ = std::fs::remove_dir_all(&app);
    }

    /// A proof re-reads what changed since the last: an optional bridge an
    /// install puts in place later is followed, and so is an edit to it.
    #[test]
    fn a_later_install_or_edit_changes_the_proof() {
        let app = fixture("memo");
        write(&app.join("src/pad.ts"), "export const pad = { padding: 4 };\n");
        package(&app, "host", "let bridge = null;\ntry { bridge = require('bridge'); } catch {}\nmodule.exports = bridge;\n");
        let first = proof(&app, "host", &[]).expect_err("an absent bridge does not resolve");
        assert!(first.contains("loads bridge, which does not resolve"), "{first}");
        package(&app, "bridge", "module.exports = {};\n");
        assert_eq!(proof(&app, "host", &[]), Ok(()));
        write(&app.join("node_modules/bridge/index.js"), "module.exports = require('../../src/pad.ts');\n");
        let edited = proof(&app, "host", &[]).expect_err("the edited bridge leaves node_modules");
        assert!(edited.contains("outside node_modules"), "{edited}");
        let _ = std::fs::remove_dir_all(&app);
    }
}
