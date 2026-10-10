//! `transform` references in `.props()` configs. A reference is kept as
//! authored and delivered in its own module, so only its binding is
//! resolved — through module-local aliases and analyzed imports and named
//! re-exports — and nothing is evaluated here; resolution also names the
//! function it reaches, which extraction may evaluate once admitted.

use std::cell::OnceCell;
use std::collections::BTreeMap;

use rustc_hash::FxHashSet;

use oxc::ast::ast::{
    Argument, BindingPattern, Declaration, ExportDefaultDeclarationKind, Expression, Function,
    Program, Statement, VariableDeclarationKind,
};
use oxc::span::GetSpan;
use oxc::semantic::{Scoping, SemanticBuilder};
use oxc::syntax::symbol::SymbolFlags;

use crate::analyze_css::{resolve_import_source, CssInputs};
use crate::evaluator::SHARED_HOST_GLOBALS;
use crate::transforms::CallbackDefinition;
use crate::usage_facts::{is_animus_system_specifier, ExportFact, ImportFact};

/// The analyzed modules a reference may resolve through. Specifiers resolve
/// as every other cross-file fact does: relative paths, path aliases and the
/// package map, landing only on modules in this set.
pub(crate) struct TransformReferences<'s> {
    modules: BTreeMap<String, Module<'s>>,
    inputs: &'s CssInputs,
}

struct Module<'s> {
    program: &'s Program<'s>,
    imports: &'s [ImportFact],
    exports: &'s [ExportFact],
    scoping: OnceCell<Scoping>,
}

impl<'s> TransformReferences<'s> {
    pub(crate) fn new(inputs: &'s CssInputs) -> Self {
        Self {
            modules: BTreeMap::new(),
            inputs,
        }
    }

    pub(crate) fn add(
        &mut self,
        path: &str,
        program: &'s Program<'s>,
        imports: &'s [ImportFact],
        exports: &'s [ExportFact],
    ) {
        self.modules.insert(
            path.to_string(),
            Module {
                program,
                imports,
                exports,
                scoping: OnceCell::new(),
            },
        );
    }

    /// `Ok` when `name`, read in `file`, reaches a supported callable: an
    /// unreassigned function declaration, or a `const` (or `export default`
    /// expression) that is a function expression, a `createTransform` call
    /// or an alias of either, through imports and named re-exports of
    /// analyzed modules. `Err` carries the attributable reason it is not
    /// supported.
    pub(crate) fn resolve(&self, file: &str, name: &str) -> Result<Resolved, String> {
        let mut seen = Visited::default();
        self.origin(file, name, &mut seen)
            .and_then(|origin| self.callable(origin, &mut seen))
            .map_err(|stop| stop.describe(file, name))
    }

    fn callable(&self, origin: Origin<'s>, seen: &mut Visited) -> Result<Resolved, Unsupported> {
        match origin {
            Origin::System { stop, .. } => Err(stop),
            Origin::Default { file, kind } => match kind {
                Anonymous::Function(function) => {
                    Ok(Resolved::function(self.definition(&file, "default", "default", function)))
                }
                Anonymous::Expression(expression) => self.initializer(&file, None, expression, seen),
                Anonymous::Other => Err(Unsupported::at(&file, "default", UNRESOLVED_VALUE)),
            },
            Origin::Declared { file, name } => {
                // `initializer` reports a cycle before following an alias.
                seen.declarations.insert((file.clone(), name.clone()));
                match self.modules[&file].binding(&name) {
                    Ok(Binding::Function(function)) => {
                        Ok(Resolved::function(self.definition(&file, &name, &name, function)))
                    }
                    Ok(Binding::Const(init)) => self.initializer(&file, Some(&name), init, seen),
                    Err(detail) => Err(Unsupported::at(&file, &name, detail)),
                }
            }
        }
    }

    /// The definition `binding` of `file` declares with `function`, a
    /// function node of that module.
    fn definition(
        &self,
        file: &str,
        binding: &str,
        name: &str,
        function: &impl GetSpan,
    ) -> CallbackDefinition {
        let span = function.span();
        let module = &self.modules[file];
        CallbackDefinition {
            key: format!("{file}#{binding}"),
            name: name.to_string(),
            source: module.program.source_text[span.start as usize..span.end as usize].to_string(),
            module_host_bindings: module.host_bindings(),
        }
    }

    /// A `const` initializer, or the anonymous `export default` expression
    /// when `owner` is `None`.
    fn initializer(
        &self,
        file: &str,
        owner: Option<&str>,
        init: &'s Expression<'s>,
        seen: &mut Visited,
    ) -> Result<Resolved, Unsupported> {
        let at = owner.unwrap_or("default");
        match crate::chain_walk::unwrap_type_assertions(init) {
            function if is_function_expression(function) => {
                Ok(Resolved::function(self.definition(file, at, at, function)))
            }
            Expression::Identifier(alias) => {
                let origin = self.origin(file, &alias.name, seen)?;
                if let Origin::Declared { file: target, name } = &origin {
                    if seen.declarations.contains(&(target.clone(), name.clone())) {
                        return Err(Unsupported::at(file, at, "is a circular alias"));
                    }
                }
                self.callable(origin, seen)
            }
            Expression::CallExpression(call)
                if matches!(&call.callee, Expression::Identifier(callee)
                    if self.is_create_transform(file, &callee.name)) =>
            {
                // A static name labels diagnostics; the binding stays the identity.
                let name = match call.arguments.first() {
                    Some(Argument::StringLiteral(literal)) => literal.value.as_str(),
                    _ => at,
                };
                let definition = call
                    .arguments
                    .get(1)
                    .and_then(Argument::as_expression)
                    .map(crate::chain_walk::unwrap_type_assertions)
                    .filter(|callback| is_function_expression(callback))
                    .map(|callback| self.definition(file, at, name, callback));
                Ok(Resolved {
                    created: owner.map(|name| (file.to_string(), name.to_string())),
                    definition,
                })
            }
            _ => Err(Unsupported::at(file, at, UNRESOLVED_VALUE)),
        }
    }

    /// Whether `callee` in `file` is `createTransform` from the Animus
    /// system package, directly or through analyzed re-exports.
    fn is_create_transform(&self, file: &str, callee: &str) -> bool {
        matches!(
            self.origin(file, callee, &mut Visited::default()),
            Ok(Origin::System { imported, .. }) if imported == "createTransform"
        )
    }

    /// The shared host functions `file` binds at top level.
    pub(crate) fn host_bindings(&self, file: &str) -> Vec<&'static str> {
        self.modules[file].host_bindings()
    }

    /// Where `name`, read in `file`, is declared.
    fn origin(&self, file: &str, name: &str, seen: &mut Visited) -> Result<Origin<'s>, Unsupported> {
        let Some(module) = self.modules.get(file) else {
            return Err(Unsupported::at(file, name, "is not in an analyzed module"));
        };
        match module.imports.iter().find(|i| i.local == name) {
            None => Ok(Origin::Declared {
                file: file.to_string(),
                name: name.to_string(),
            }),
            Some(import) => {
                self.follow(file, name, &import.source, &import.imported, "is imported from", seen)
            }
        }
    }

    /// The origin of `imported` from `specifier`, read in `file` as `name`.
    fn follow(
        &self,
        file: &str,
        name: &str,
        specifier: &str,
        imported: &str,
        relation: &'static str,
        seen: &mut Visited,
    ) -> Result<Origin<'s>, Unsupported> {
        if is_animus_system_specifier(specifier) {
            return Ok(Origin::System {
                imported: imported.to_string(),
                stop: Unsupported::at(file, name, outside(specifier, relation)),
            });
        }
        let Some(target) = self.landing(file, specifier) else {
            return Err(Unsupported::at(file, name, outside(specifier, relation)));
        };
        self.exported(target, imported.to_string(), seen)
    }

    /// The analyzed module `specifier` names from `file`.
    fn landing(&self, file: &str, specifier: &str) -> Option<String> {
        resolve_import_source(file, specifier, &self.modules, self.inputs)
            .filter(|target| self.modules.contains_key(target))
    }

    /// The origin of the export `exported` of `file`.
    fn exported(
        &self,
        file: String,
        exported: String,
        seen: &mut Visited,
    ) -> Result<Origin<'s>, Unsupported> {
        if !seen.exports.insert((file.clone(), exported.clone())) {
            return Err(Unsupported::at(&file, &exported, "is a circular re-export"));
        }
        let module = &self.modules[&file];
        if let Some(export) = module.exports.iter().find(|e| e.exported == exported) {
            if let (Some(source), Some(original)) = (&export.source, &export.original) {
                return self.follow(&file, &exported, source, original, "is re-exported from", seen);
            }
            if let Some(local) = &export.local {
                return self.origin(&file, local, seen);
            }
        }
        match module.exported_declaration(&file, &exported) {
            Some(origin) => Ok(origin),
            None if module.namespace_reexport(&exported) => {
                Err(Unsupported::at(&file, &exported, "is a namespace re-export"))
            }
            None if module.has_star_export() => Err(Unsupported::at(
                &file,
                &exported,
                "is not exported by that module; `export *` re-exports are not followed",
            )),
            None => Err(Unsupported::at(&file, &exported, "is not exported by that module")),
        }
    }
}

impl<'s> Module<'s> {
    fn scoping(&self) -> &Scoping {
        self.scoping
            .get_or_init(|| SemanticBuilder::new().build(self.program).semantic.into_scoping())
    }

    /// The shared host functions this module declares or imports at top level.
    fn host_bindings(&self) -> Vec<&'static str> {
        SHARED_HOST_GLOBALS
            .iter()
            .copied()
            .filter(|name| {
                // An identifier may spell the name with `\u` escapes.
                let text = self.program.source_text;
                (text.contains(name) || text.contains("\\u"))
                    && self.scoping().get_root_binding((*name).into()).is_some()
            })
            .collect()
    }

    /// One top-level binding, or the unsupported detail.
    fn binding(&self, name: &str) -> Result<Binding<'s>, &'static str> {
        let scoping = self.scoping();
        let Some(symbol) = scoping.get_root_binding(name.into()) else {
            return Err("is not declared in this module");
        };
        let flags = scoping.symbol_flags(symbol);
        if flags.is_import() {
            return Err("is a namespace import");
        }
        if flags.is_function() {
            if scoping.symbol_is_mutated(symbol) {
                return Err("is reassigned");
            }
            return self.function_declaration(name).map(Binding::Function).ok_or(UNRESOLVED_VALUE);
        }
        if !flags.is_const_variable() {
            return Err(if flags.contains(SymbolFlags::FunctionScopedVariable) {
                "is a mutable `var` binding"
            } else if flags.contains(SymbolFlags::BlockScopedVariable) {
                "is a mutable `let` binding"
            } else {
                UNRESOLVED_VALUE
            });
        }
        self.const_initializer(name).map(Binding::Const).ok_or(UNRESOLVED_VALUE)
    }

    /// The top-level function declaration of `name`, exported or not.
    fn function_declaration(&self, name: &str) -> Option<&'s Function<'s>> {
        self.program.body.iter().find_map(|stmt| {
            let function = match stmt {
                Statement::FunctionDeclaration(function) => function,
                Statement::ExportNamedDeclaration(export) => match &export.declaration {
                    Some(Declaration::FunctionDeclaration(function)) => function,
                    _ => return None,
                },
                Statement::ExportDefaultDeclaration(export) => match &export.declaration {
                    ExportDefaultDeclarationKind::FunctionDeclaration(function) => function,
                    _ => return None,
                },
                _ => return None,
            };
            function.id.as_ref().is_some_and(|id| id.name == name).then_some(&**function)
        })
    }

    /// The initializer of a top-level `const name = …`; `None` for a
    /// destructured binding.
    fn const_initializer(&self, name: &str) -> Option<&'s Expression<'s>> {
        self.program.body.iter().find_map(|stmt| {
            let decl = match stmt {
                Statement::VariableDeclaration(decl) => decl,
                Statement::ExportNamedDeclaration(export) => match &export.declaration {
                    Some(Declaration::VariableDeclaration(decl)) => decl,
                    _ => return None,
                },
                _ => return None,
            };
            if decl.kind != VariableDeclarationKind::Const {
                return None;
            }
            decl.declarations.iter().find_map(|d| match &d.id {
                BindingPattern::BindingIdentifier(id) if id.name == name => d.init.as_ref(),
                _ => None,
            })
        })
    }

    /// Exported declarations that export facts do not record: destructured
    /// `export const`, `export function`, `class` and `enum`, and `export
    /// default`.
    fn exported_declaration(&self, file: &str, exported: &str) -> Option<Origin<'s>> {
        let declared = |name: &str| Origin::Declared {
            file: file.to_string(),
            name: name.to_string(),
        };
        let anonymous = |kind| Origin::Default {
            file: file.to_string(),
            kind,
        };
        self.program.body.iter().find_map(|stmt| match stmt {
            Statement::ExportNamedDeclaration(export) => {
                let declares = match &export.declaration {
                    Some(Declaration::VariableDeclaration(decl)) => decl.declarations.iter().any(|d| {
                        d.id.get_binding_identifiers().iter().any(|id| id.name == exported)
                    }),
                    Some(decl) => decl.id().is_some_and(|id| id.name == exported),
                    None => false,
                };
                declares.then(|| declared(exported))
            }
            Statement::ExportDefaultDeclaration(export) if exported == "default" => {
                Some(match &export.declaration {
                    ExportDefaultDeclarationKind::FunctionDeclaration(f) => match &f.id {
                        Some(id) => declared(&id.name),
                        None => anonymous(Anonymous::Function(f)),
                    },
                    ExportDefaultDeclarationKind::ClassDeclaration(c) => match &c.id {
                        Some(id) => declared(&id.name),
                        None => anonymous(Anonymous::Other),
                    },
                    kind => anonymous(
                        kind.as_expression().map_or(Anonymous::Other, Anonymous::Expression),
                    ),
                })
            }
            _ => None,
        })
    }

    /// An unnamed `export * from`, whose names are not followed.
    fn has_star_export(&self) -> bool {
        self.program.body.iter().any(
            |stmt| matches!(stmt, Statement::ExportAllDeclaration(all) if all.exported.is_none()),
        )
    }

    /// `export * as exported from …`.
    fn namespace_reexport(&self, exported: &str) -> bool {
        self.program.body.iter().any(|stmt| {
            matches!(stmt, Statement::ExportAllDeclaration(all)
                if all.exported.as_ref().is_some_and(|name| name.name() == exported))
        })
    }
}

/// The `createTransform` declaration a reference reaches, as `(file, binding)`.
type Created = Option<(String, String)>;

/// What a supported reference reaches.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Resolved {
    pub(crate) created: Created,
    /// The function the reference binds; `None` for a `createTransform`
    /// whose callback is not a function expression.
    pub(crate) definition: Option<CallbackDefinition>,
}

impl Resolved {
    fn function(definition: CallbackDefinition) -> Self {
        Self {
            created: None,
            definition: Some(definition),
        }
    }
}

enum Origin<'s> {
    /// A top-level binding of `file` that is not an import.
    Declared { file: String, name: String },
    /// The system package's export `imported`; `stop` is why it is not a
    /// referenceable callback.
    System { imported: String, stop: Unsupported },
    /// An `export default` without a binding of its own.
    Default { file: String, kind: Anonymous<'s> },
}

enum Anonymous<'s> {
    /// `export default function () {}`.
    Function(&'s Function<'s>),
    Expression(&'s Expression<'s>),
    Other,
}

enum Binding<'s> {
    Function(&'s Function<'s>),
    Const(&'s Expression<'s>),
}

#[derive(Default)]
struct Visited {
    declarations: FxHashSet<(String, String)>,
    exports: FxHashSet<(String, String)>,
}

/// Where resolution stopped: the module, the name read there and why.
struct Unsupported {
    file: String,
    name: String,
    detail: String,
}

impl Unsupported {
    fn at(file: &str, name: &str, detail: impl Into<String>) -> Self {
        Self {
            file: file.to_string(),
            name: name.to_string(),
            detail: detail.into(),
        }
    }

    fn describe(self, file: &str, reference: &str) -> String {
        let Self { file: at, name, detail } = self;
        if at != file {
            format!("transform reference '{reference}' resolves to '{name}' in {at}, which {detail}")
        } else if name != reference {
            format!("transform reference '{reference}' aliases '{name}', which {detail}")
        } else {
            format!("transform reference '{reference}' {detail}")
        }
    }
}

fn is_function_expression(expression: &Expression<'_>) -> bool {
    matches!(
        expression,
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    )
}

fn outside(specifier: &str, relation: &str) -> String {
    format!("{relation} '{specifier}', which is not an analyzed source module")
}

const UNRESOLVED_VALUE: &str =
    "is not a function, an alias of one or a createTransform call declared with `const`";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::owned_ast::{OwnedAst, ParseCounter};
    use crate::usage_facts::{collect_export_facts, collect_import_facts};

    fn project(
        files: &[(&str, &str)],
        test: impl FnOnce(&TransformReferences<'_>),
    ) {
        let counter = ParseCounter::new(0);
        let asts: Vec<OwnedAst> = files
            .iter()
            .map(|(path, source)| OwnedAst::parse(path.to_string(), source.to_string(), &counter))
            .collect();
        let facts: Vec<(Vec<ImportFact>, Vec<ExportFact>)> = asts
            .iter()
            .map(|ast| (collect_import_facts(ast.module_record()), collect_export_facts(ast.program())))
            .collect();
        let inputs = CssInputs::default();
        let mut references = TransformReferences::new(&inputs);
        for (ast, (imports, exports)) in asts.iter().zip(&facts) {
            references.add(&ast.path, ast.program(), imports, exports);
        }
        test(&references);
    }

    /// A callback reading `btoa` or `atob` that its declaring module binds,
    /// by declaration or import, is never isolated, wherever it is consumed;
    /// a callback-local binding or the host function itself is.
    #[test]
    fn callbacks_reading_a_module_bound_host_function_are_not_isolated() {
        let declared = r#"
            import atob from './b64';
            function btoa(s) { return s; }
            export const enc = (v) => btoa(String(v));
            export const dec = (v) => atob(String(v)).toUpperCase();
            export const own = (v) => { const btoa = (s) => s; return btoa(String(v)); };
            export const plain = (v) => String(v);
        "#;
        let imported = r#"
            import { encode as btoa } from './b64';
            import * as atob from './b64';
            export const enc = (v) => btoa(String(v));
            export const dec = (v) => atob.decode(String(v));
        "#;
        let host = r#"
            import { enc } from './declared';
            export const viaDeclared = enc;
            export const native = (v) => btoa(String(v)) + atob('QQ==');
        "#;
        let b64 = "export default (s) => s;\nexport const encode = (s) => s;\nexport const decode = (s) => s;";
        let files = [("declared.ts", declared), ("imported.ts", imported), ("host.ts", host), ("b64.ts", b64)];
        project(&files, |refs| {
            for (file, name, isolated) in [
                ("declared.ts", "enc", false),
                ("declared.ts", "dec", false),
                ("imported.ts", "enc", false),
                ("imported.ts", "dec", false),
                ("host.ts", "viaDeclared", false),
                ("declared.ts", "own", true),
                ("declared.ts", "plain", true),
                ("host.ts", "native", true),
            ] {
                let definition = refs.resolve(file, name).unwrap().definition.unwrap();
                assert_eq!(definition.isolated_source().is_some(), isolated, "{file} {name}");
            }
        });
    }

    #[test]
    fn resolves_supported_bindings_and_names_each_unsupported_reason() {
        let source = r#"
            import { size } from '@animus-ui/system';
            import { createTransform as ct } from '@animus-ui/system';
            import { make } from './factory';
            import * as ns from './factory';
            const double = (v) => v * 2;
            const twice = double as never;
            function half(v) { return v / 2; }
            export default function quarter(v) { return v / 4; }
            const named = ct('double', (v) => v);
            const viaNamed = named;
            const viaExpression = (function (v) { return v; }) satisfies object;
            let shift = (v) => v;
            var legacy = (v) => v;
            function moved(v) { return v; }
            moved = (v) => v * 3;
            const made = make(2);
            const { picked } = make(3);
            const viaLet = shift;
            const loopA = loopB;
            const loopB = loopA;
            function createTransform(name, fn) { return fn; }
            const fake = createTransform('fake', (v) => v);
            class Shape {}
        "#;
        project(&[("test.tsx", source)], |local| {
            for (name, created, definition) in [
                ("double", None, ("double", "double", "(v) => v * 2")),
                ("twice", None, ("double", "double", "(v) => v * 2")),
                ("half", None, ("half", "half", "function half(v) { return v / 2; }")),
                ("quarter", None, ("quarter", "quarter", "function quarter(v) { return v / 4; }")),
                ("viaExpression", None, ("viaExpression", "viaExpression", "function (v) { return v; }")),
                ("named", Some("named"), ("named", "double", "(v) => v")),
                ("viaNamed", Some("named"), ("named", "double", "(v) => v")),
            ] {
                let (binding, readable, source) = definition;
                let expected = Resolved {
                    created: created.map(|binding| ("test.tsx".to_string(), binding.to_string())),
                    definition: Some(CallbackDefinition {
                        key: format!("test.tsx#{binding}"),
                        name: readable.to_string(),
                        source: source.to_string(),
                        module_host_bindings: Vec::new(),
                    }),
                };
                assert_eq!(local.resolve("test.tsx", name), Ok(expected), "{name}");
            }
            for (name, reason) in [
                ("size", "'size' is imported from '@animus-ui/system', which is not an analyzed"),
                ("make", "'make' is imported from './factory', which is not an analyzed"),
                ("ns", "'ns' is a namespace import"),
                ("shift", "'shift' is a mutable `let` binding"),
                ("legacy", "'legacy' is a mutable `var` binding"),
                ("moved", "'moved' is reassigned"),
                ("made", "'made' is not a function"),
                ("picked", "'picked' is not a function"),
                ("viaLet", "'viaLet' aliases 'shift', which is a mutable `let` binding"),
                ("loopA", "'loopA' aliases 'loopB', which is a circular alias"),
                ("nowhere", "'nowhere' is not declared in this module"),
                ("fake", "'fake' is not a function"),
                ("Shape", "'Shape' is not a function"),
            ] {
                let error = local.resolve("test.tsx", name).expect_err(name);
                assert!(error.contains(reason), "{name}: {error}");
            }
        });
    }
}
