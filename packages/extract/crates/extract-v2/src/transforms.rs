//! createTransform() extraction: finds `createTransform('name', fn)`
//! declarations, validates self-containment, and strips TS annotations.

use rustc_hash::{FxHashMap, FxHashSet};
use std::path::Path;

use oxc::allocator::Allocator;
use oxc::ast::ast::{
    Argument, CallExpression, Declaration, Expression, Program, Statement, VariableDeclarator,
};
use oxc::codegen::Codegen;
use oxc::parser::{Parser, ParserReturn};
use oxc::semantic::{Scoping, SemanticBuilder};
use oxc::span::SourceType;
use oxc::transformer::{TransformOptions, Transformer};

mod reference;
mod self_contained;

pub(crate) use reference::TransformReferences;
use self_contained::{configured_reference_rejections, validate_self_contained};

/// The function a component callback binds, as its declaring module wrote
/// it: what extraction may evaluate for known values, apart from the code
/// that delivers the callback at runtime.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallbackDefinition {
    /// The definition's identity: its declaring module and binding, or for
    /// an inline callback the component and prop that declare it.
    pub key: String,
    /// The readable name diagnostics report.
    pub name: String,
    /// The function's authored source text.
    pub source: String,
    /// The shared host functions its declaring module binds at top level; in
    /// that module the callback reads those bindings, not the host's.
    pub module_host_bindings: Vec<&'static str>,
}

/// The callback a custom prop binds, with the component whose `.props()`
/// declares that prop; an extension inherits both unchanged.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallbackBinding {
    /// The declaring component's id, `file::binding`.
    pub declarer: String,
    pub definition: CallbackDefinition,
}

impl CallbackDefinition {
    /// The definition's JavaScript when it passes configured-source
    /// admission, so it can be evaluated in isolation; `None` keeps the
    /// callback on its runtime path only.
    pub(crate) fn isolated_source(&self) -> Option<String> {
        let source = strip_typescript(&self.source).ok()?;
        // Printed alone, a `function` expression gains a pair of parentheses.
        let source = match source.strip_prefix('(').and_then(|inner| inner.strip_suffix(')')) {
            Some(inner) if inner.starts_with("function") || inner.starts_with("async function") => {
                inner.to_string()
            }
            _ => source,
        };
        admit_configured_source(&self.name, &source).ok()?;
        // Admission reads names alone, so a host name its module rebinds
        // would evaluate the host function instead.
        if !self.module_host_bindings.is_empty()
            && self.free_names()?.iter().any(|name| self.module_host_bindings.contains(&name.as_str()))
        {
            return None;
        }
        Some(source)
    }

    /// The names the callback reads without binding them itself: in its
    /// declaring module these resolve to that module's bindings before any
    /// global. `None` when the source does not parse.
    pub(crate) fn free_names(&self) -> Option<Vec<String>> {
        let source = strip_typescript(&self.source).ok()?;
        let wrapper = format!("const __callback = ({source});");
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, &wrapper, SourceType::mjs()).parse();
        if parsed.panicked || !parsed.diagnostics.is_empty() {
            return None;
        }
        let scoping = SemanticBuilder::new().build(&parsed.program).semantic.into_scoping();
        Some(scoping.root_unresolved_references().keys().map(|name| name.to_string()).collect())
    }
}

/// An extracted `createTransform('name', fn)` call.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedTransform {
    /// The transform name (first argument string literal).
    pub name: String,
    /// The callback source text; TypeScript-stripped unless validation failed.
    pub source: String,
    /// File path where the transform was found.
    pub file: String,
    /// The top-level binding declared by the call: the declaration's
    /// identity within its file, unlike the readable name.
    #[serde(skip)]
    pub(crate) binding: Option<String>,
    pub diagnostics: Vec<String>,
    /// Whether the transform passed validation (no external refs).
    pub valid: bool,
}

/// Scan a parsed program for `createTransform('name', fn)` calls.
pub fn extract_transforms(
    program: &Program<'_>,
    source: &str,
    file_path: &str,
    known_create_transform_bindings: &FxHashSet<String>,
) -> Vec<ExtractedTransform> {
    let mut candidates = Vec::new();

    for stmt in &program.body {
        match stmt {
            Statement::VariableDeclaration(decl) => {
                for declarator in &decl.declarations {
                    if is_create_transform_declarator(declarator, known_create_transform_bindings) {
                        candidates.push(declarator);
                    }
                }
            }
            Statement::ExportNamedDeclaration(export) => {
                if let Some(Declaration::VariableDeclaration(decl)) = &export.declaration {
                    for declarator in &decl.declarations {
                        if is_create_transform_declarator(
                            declarator,
                            known_create_transform_bindings,
                        ) {
                            candidates.push(declarator);
                        }
                    }
                }
            }
            _ => {}
        }
    }

    if candidates.is_empty() {
        return Vec::new();
    }

    let scoping = SemanticBuilder::new()
        .build(program)
        .semantic
        .into_scoping();
    candidates
        .into_iter()
        .filter_map(|declarator| {
            try_extract_transform(
                declarator,
                source,
                file_path,
                known_create_transform_bindings,
                &scoping,
            )
        })
        .collect()
}

fn is_create_transform_declarator(
    declarator: &VariableDeclarator<'_>,
    known_bindings: &FxHashSet<String>,
) -> bool {
    let Some(Expression::CallExpression(call)) = declarator.init.as_ref() else {
        return false;
    };
    is_create_transform_call(call, known_bindings)
}

fn try_extract_transform(
    declarator: &VariableDeclarator<'_>,
    source: &str,
    file_path: &str,
    known_bindings: &FxHashSet<String>,
    scoping: &Scoping,
) -> Option<ExtractedTransform> {
    let init = declarator.init.as_ref()?;
    let binding = declarator.id.get_identifier_name().map(|name| name.to_string());

    let call = match init {
        Expression::CallExpression(call) => call,
        _ => return None,
    };

    if !is_create_transform_call(call, known_bindings) {
        return None;
    }

    let name = match call.arguments.first() {
        Some(Argument::StringLiteral(lit)) => lit.value.to_string(),
        _ => {
            return Some(ExtractedTransform {
                name: String::new(),
                source: String::new(),
                file: file_path.to_string(),
                binding: binding.clone(),
                diagnostics: vec![
                    "[bail] createTransform requires a static string name as first argument"
                        .to_string(),
                ],
                valid: false,
            });
        }
    };

    let callback_arg = match call.arguments.get(1) {
        Some(arg) => arg,
        None => {
            return Some(ExtractedTransform {
                name: name.clone(),
                source: String::new(),
                file: file_path.to_string(),
                binding: binding.clone(),
                diagnostics: vec![
                    "[bail] createTransform requires a callback function as second argument"
                        .to_string(),
                ],
                valid: false,
            });
        }
    };

    let callback_span = match callback_arg {
        Argument::ArrowFunctionExpression(arrow) => arrow.span,
        Argument::FunctionExpression(func) => func.span,
        _ => {
            return Some(ExtractedTransform {
                name: name.clone(),
                source: String::new(),
                file: file_path.to_string(),
                binding: binding.clone(),
                diagnostics: vec![format!(
                    "[bail] Transform '{}': second argument must be a function expression",
                    name
                )],
                valid: false,
            });
        }
    };

    let callback_source = &source[callback_span.start as usize..callback_span.end as usize];

    let mut diagnostics = Vec::new();
    let valid = callback_arg
        .as_expression()
        .is_none_or(|callback| validate_self_contained(callback, &name, &mut diagnostics, scoping));

    let js_source = if valid {
        match strip_typescript(callback_source) {
            Ok(js) => js,
            Err(err) => {
                diagnostics.push(format!(
                    "[warn] Transform '{}': TS stripping failed ({}), using raw source",
                    name, err
                ));
                callback_source.to_string()
            }
        }
    } else {
        callback_source.to_string()
    };

    Some(ExtractedTransform {
        name,
        source: js_source,
        file: file_path.to_string(),
        binding,
        diagnostics,
        valid,
    })
}

/// The loader's per-definition evidence of which shared host functions a
/// configured callable reads as the host's, or that it reads a binding
/// outside itself. Without it, a configured source reading a host function is
/// not admitted; any other source keeps its text admission, which proves
/// nothing about the bindings its callable closes over.
#[derive(Debug, Default)]
pub enum TransformProvenance {
    /// None was supplied: an older loader or host.
    #[default]
    Absent,
    /// The supplied JSON is not the expected shape.
    Malformed(String),
    Supplied(FxHashMap<String, ProvenanceEntry>),
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProvenanceEntry {
    #[serde(default)]
    host_globals: Vec<String>,
    rejection: Option<String>,
}

impl TransformProvenance {
    pub fn from_json(json: Option<&str>) -> Self {
        match json.map(str::trim) {
            None | Some("" | "null") => Self::Absent,
            Some(json) => serde_json::from_str(json)
                .map_or_else(|e: serde_json::Error| Self::Malformed(e.to_string()), Self::Supplied),
        }
    }

    /// Why definition `key`, whose admitted configured source reads no shared
    /// host function, may not be admitted: the loader showed its callable
    /// reading a binding outside itself.
    pub(crate) fn captured_rejection(&self, key: &str, name: &str) -> Option<String> {
        let Self::Supplied(entries) = self else { return None };
        let rejection = entries.get(key)?.rejection.as_deref()?;
        Some(format!("[bail] Transform '{name}': its callable {rejection}"))
    }

    /// Why definition `key`, whose admitted configured source reads the
    /// unbound shared host functions `hosts`, may not read them as the
    /// host's, if it may not.
    pub(crate) fn host_rejection(&self, key: &str, name: &str, hosts: &[&str]) -> Option<String> {
        let entry = match self {
            Self::Supplied(entries) => entries.get(key),
            _ => None,
        };
        let host = hosts.iter().find(|host| {
            entry.is_none_or(|entry| entry.rejection.is_some() || !entry.host_globals.iter().any(|g| g == *host))
        })?;
        let why = match (self, entry) {
            (Self::Absent, _) => "no host-binding provenance was supplied (an older loader or host)".to_string(),
            (Self::Malformed(error), _) => format!("its host-binding provenance is malformed ({error})"),
            (Self::Supplied(_), None) => "the loader supplied no host-binding provenance for it".to_string(),
            (_, Some(ProvenanceEntry { rejection: Some(rejection), .. })) => format!("its callable {rejection}"),
            (_, Some(_)) => format!("its callable is not shown to read the host '{host}'"),
        };
        Some(format!("[bail] Transform '{name}': configured source reads '{host}', but {why}"))
    }
}

/// Admit a transform source configured by the loaded system, the text the
/// system captured with `fn.toString()`. It must be exactly one function
/// expression that parses as strict-mode module code, and every reference
/// in it must resolve inside the function or to a shared intrinsic: the
/// runtime registry emits it verbatim, where a free identifier throws.
pub fn admit_configured_source(name: &str, source: &str) -> Result<(), Vec<String>> {
    admit_configured_host_reads(name, source).map(drop)
}

/// [`admit_configured_source`], returning the shared host functions the
/// admitted source reads unbound.
pub(crate) fn admit_configured_host_reads(name: &str, source: &str) -> Result<Vec<&'static str>, Vec<String>> {
    let rejected = |reason: &str| {
        Err(vec![format!(
            "[bail] Transform '{name}': configured source {reason}"
        )])
    };
    let wrapper = format!("const __configured = ({source});");
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, &wrapper, SourceType::mjs()).parse();
    if parsed.panicked || !parsed.diagnostics.is_empty() {
        return rejected("does not parse as strict-mode JavaScript");
    }
    let semantic = SemanticBuilder::new()
        .with_check_syntax_error(true)
        .with_build_nodes(true)
        .build(&parsed.program);
    if !semantic.diagnostics.is_empty() {
        return rejected("does not parse as strict-mode JavaScript");
    }
    // One declarator initialized by one parenthesized function expression
    // that ends where the wrapper's `(` closes: a trailing line comment in
    // the source would otherwise swallow that `)` and still parse.
    let paren = match parsed.program.body.as_slice() {
        [Statement::VariableDeclaration(decl)] => match decl.declarations.as_slice() {
            [declarator] => match &declarator.init {
                Some(Expression::ParenthesizedExpression(paren)) => Some(paren),
                _ => None,
            },
            _ => None,
        },
        _ => None,
    };
    let callback_scope = paren
        .filter(|paren| paren.span.end as usize == wrapper.len() - 1)
        .and_then(|paren| match &paren.expression {
            Expression::ArrowFunctionExpression(arrow) => arrow.scope_id.get(),
            Expression::FunctionExpression(func) => func.scope_id.get(),
            _ => None,
        });
    let Some(callback_scope) = callback_scope else {
        return rejected("is not a single function expression");
    };

    let reasons = configured_reference_rejections(&semantic.semantic, callback_scope, name);
    if !reasons.is_empty() {
        return Err(reasons.into_iter().collect());
    }
    let unresolved = semantic.semantic.scoping().root_unresolved_references();
    Ok(crate::evaluator::SHARED_HOST_GLOBALS
        .iter()
        .copied()
        .filter(|name| unresolved.contains_key(*name))
        .collect())
}

fn is_create_transform_call(
    call: &CallExpression<'_>,
    known_bindings: &FxHashSet<String>,
) -> bool {
    match &call.callee {
        Expression::Identifier(ident) => {
            let name = ident.name.as_str();
            name == "createTransform" || known_bindings.contains(name)
        }
        _ => false,
    }
}

/// Strip TypeScript annotations from a callback source string.
fn strip_typescript(callback_source: &str) -> Result<String, String> {
    let wrapper = format!("const __x = {};", callback_source);
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(Path::new("callback.ts"))
        .unwrap_or_else(|_| SourceType::ts());

    let ParserReturn {
        mut program,
        diagnostics: parse_errors,
        ..
    } = Parser::new(&allocator, &wrapper, source_type).parse();

    if !parse_errors.is_empty() {
        return Err(format!("parse error: {}", parse_errors[0]));
    }

    let semantic_ret = SemanticBuilder::new().build(&program);
    let scoping = semantic_ret.semantic.into_scoping();

    let options = TransformOptions::default();
    let transformer = Transformer::new(&allocator, Path::new("callback.ts"), &options);
    let _transform_ret = transformer.build_with_scoping(scoping, &mut program);

    // Extract the init expression from `const __x = <expr>;`
    let expr = program
        .body
        .first()
        .and_then(|stmt| match stmt {
            Statement::VariableDeclaration(decl) => decl.declarations.first(),
            _ => None,
        })
        .and_then(|declarator| declarator.init.as_ref())
        .ok_or_else(|| "could not find expression after transform".to_string())?;

    let mut codegen = Codegen::new();
    codegen.print_expression(expr);
    Ok(codegen.into_source_text())
}

#[cfg(test)]
mod tests {
    use super::*;

    const BUILT_IN_SIZE: &str = r#"(value) => {
	const toSize = (n) => {
		if (n === 0) return n;
		if (n <= 1 && n >= -1) return `${n * 100}%`;
		return `${n}px`;
	};
	if (typeof value === "number") return toSize(value);
	const strValue = value;
	const [match, number, unit] = /^\s*([+-]?\d*\.?\d+)(?:\.|(%|\w*))\s*$/.exec(strValue) || [];
	if (match === void 0) return strValue;
	const numericValue = parseFloat(number);
	return !unit ? toSize(numericValue) : `${numericValue}${unit}`;
}"#;

    fn rejection(name: &str, source: &str) -> Vec<String> {
        admit_configured_source(name, source).expect_err("source must be rejected")
    }

    #[test]
    fn configured_self_contained_sources_are_admitted() {
        assert_eq!(admit_configured_source("size", BUILT_IN_SIZE), Ok(()));
        assert_eq!(
            admit_configured_source("fraction", "(value) => `${Number(value) * 50}%`"),
            Ok(())
        );
        assert_eq!(
            admit_configured_source("named", "function named(v) { return named.length + v; }"),
            Ok(())
        );
    }

    #[test]
    fn configured_closure_over_a_module_const_is_rejected() {
        let diagnostics = rejection(
            "localRem",
            "(value) => typeof value === \"number\" ? `${value / BASE}rem` : value",
        );
        assert!(
            diagnostics
                .iter()
                .any(|d| d.contains("Transform 'localRem'") && d.contains("external symbol 'BASE'")),
            "{diagnostics:?}"
        );
    }

    #[test]
    fn configured_named_function_closing_over_a_const_is_rejected() {
        let diagnostics = rejection(
            "identRem",
            "function identRemFn(value) {\n\treturn typeof value === \"number\" ? `${value / BASE}rem` : value;\n}",
        );
        assert!(
            diagnostics
                .iter()
                .any(|d| d.contains("external symbol 'BASE'")),
            "{diagnostics:?}"
        );
    }

    #[test]
    fn configured_source_valid_only_in_sloppy_mode_is_rejected() {
        let diagnostics = rejection(
            "sloppy",
            "function anonymous(value\n) {\nvar interface = 1; return value + 010;\n}",
        );
        assert!(
            diagnostics.iter().any(|d| d.contains("Transform 'sloppy'")),
            "{diagnostics:?}"
        );
    }

    fn rejection_text(name: &str, source: &str) -> String {
        rejection(name, source).join("\n")
    }

    #[test]
    fn configured_closures_anywhere_in_the_callback_are_rejected() {
        for (source, symbol) in [
            (
                "(value) => { const toRem = (n) => `${n / BASE}rem`; return toRem(value); }",
                "BASE",
            ),
            ("(value) => SCALE?.[value] ?? value", "SCALE"),
            (
                "(value) => { switch (value) { case 'wide': return WIDE; default: return value; } }",
                "WIDE",
            ),
            ("(value) => [...new Set(ITEMS)].join(value)", "ITEMS"),
            ("(value) => { try { return value; } catch { return FALLBACK; } }", "FALLBACK"),
            ("(value) => { for (const k of KEYS) { return k; } return value; }", "KEYS"),
            ("(value) => ({ [KEY]: value }).x ?? value", "KEY"),
            ("(value) => `${value}${tag`x`}`", "tag"),
        ] {
            let text = rejection_text("closed", source);
            assert!(
                text.contains(&format!("external symbol '{symbol}'")),
                "{source}: {text}"
            );
        }
    }

    #[test]
    fn configured_reference_to_the_wrapper_binding_is_rejected() {
        let text = rejection_text("wrapper", "(value) => __configured ?? value");
        assert!(text.contains("external symbol '__configured'"), "{text}");
    }

    #[test]
    fn configured_arrow_capturing_outer_arguments_or_this_is_rejected() {
        assert!(rejection_text("args", "(value) => arguments[0]").contains("'arguments'"));
        assert!(rejection_text("lexicalThis", "(value) => this ?? value").contains("'this'"));
        assert!(
            rejection_text("callThis", "function (value) { return this ?? value; }").contains("'this'")
        );
    }

    #[test]
    fn configured_function_scoped_arguments_this_and_recursion_are_admitted() {
        for source in [
            "function (value) { return arguments.length + value; }",
            "function (value) { const first = () => arguments[0]; return first(); }",
            "function fact(n) { return n <= 1 ? 1 : n * fact(n - 1); }",
            "(value) => { function own() { return this; } return own() ?? value; }",
            "(value) => { const helper = (n) => { const inner = (m) => m * 2; return inner(n); }; return helper(value); }",
        ] {
            assert_eq!(admit_configured_source("ok", source), Ok(()), "{source}");
        }
    }

    /// One synchronous, non-blocking use per admitted standard global; each
    /// returns a string, so result-shape rules are untouched.
    const STANDARD_GLOBAL_PROOFS: &[(&str, &str)] = &[
        ("globalThis", r#"(v) => String(typeof globalThis) + v"#),
        ("Infinity", r#"(v) => String(Number(v) < Infinity)"#),
        ("NaN", r#"(v) => String(Number.isNaN(NaN)) + v"#),
        ("undefined", r#"(v) => String(v === undefined)"#),
        ("eval", r#"(v) => String(eval('1 + 1')) + v"#),
        ("isFinite", r#"(v) => String(isFinite(Number(v)))"#),
        ("isNaN", r#"(v) => String(isNaN(Number(v)))"#),
        ("parseFloat", r#"(v) => String(parseFloat(String(v)))"#),
        ("parseInt", r#"(v) => String(parseInt(String(v), 10))"#),
        ("decodeURI", r#"(v) => decodeURI(encodeURI(String(v)))"#),
        ("decodeURIComponent", r#"(v) => decodeURIComponent(encodeURIComponent(String(v)))"#),
        ("encodeURI", r#"(v) => encodeURI(String(v))"#),
        ("encodeURIComponent", r#"(v) => encodeURIComponent(String(v))"#),
        ("AggregateError", r#"(v) => new AggregateError([], String(v)).message"#),
        ("Array", r#"(v) => Array.of(v).join('')"#),
        ("ArrayBuffer", r#"(v) => String(new ArrayBuffer(Number(v)).byteLength)"#),
        ("AsyncDisposableStack", r#"(v) => String(new AsyncDisposableStack().disposed) + v"#),
        ("BigInt", r#"(v) => String(BigInt(Number(v)) + 1n)"#),
        ("BigInt64Array", r#"(v) => String(new BigInt64Array([BigInt(Number(v))])[0])"#),
        ("BigUint64Array", r#"(v) => String(new BigUint64Array([BigInt(Number(v))])[0])"#),
        ("Boolean", r#"(v) => String(Boolean(v))"#),
        ("DataView", r#"(v) => String(new DataView(new ArrayBuffer(2)).getUint8(0)) + v"#),
        ("Date", r#"(v) => String(new Date(0).getUTCFullYear() + Number(v))"#),
        ("DisposableStack", r#"(v) => { const stack = new DisposableStack(); stack.dispose(); return String(stack.disposed) + v; }"#),
        ("Error", r#"(v) => new Error(String(v)).message"#),
        ("EvalError", r#"(v) => new EvalError(String(v)).name + v"#),
        ("FinalizationRegistry", r#"(v) => { new FinalizationRegistry(() => {}); return String(v); }"#),
        ("Float16Array", r#"(v) => String(new Float16Array([Number(v)])[0])"#),
        ("Float32Array", r#"(v) => String(new Float32Array([Number(v)])[0])"#),
        ("Float64Array", r#"(v) => String(new Float64Array([Number(v)])[0])"#),
        ("Function", r#"(v) => String(Function('return 1')()) + v"#),
        ("Int8Array", r#"(v) => String(new Int8Array([Number(v)])[0])"#),
        ("Int16Array", r#"(v) => String(new Int16Array([Number(v)])[0])"#),
        ("Int32Array", r#"(v) => String(new Int32Array([Number(v)])[0])"#),
        ("Iterator", r#"(v) => String(typeof Iterator.from) + v"#),
        ("Map", r#"(v) => new Map([[1, String(v)]]).get(1)"#),
        ("Number", r#"(v) => String(Number(v))"#),
        ("Object", r#"(v) => Object.keys({ a: v }).join('')"#),
        ("Promise", r#"(v) => String(Promise.resolve(v) instanceof Promise) + v"#),
        ("Proxy", r#"(v) => new Proxy({}, { get: () => String(v) }).x"#),
        ("RangeError", r#"(v) => new RangeError(String(v)).name + v"#),
        ("ReferenceError", r#"(v) => new ReferenceError(String(v)).name + v"#),
        ("RegExp", r#"(v) => String(new RegExp('[0-9]').test(String(v)))"#),
        ("Set", r#"(v) => [...new Set([String(v), String(v)])].join(' ')"#),
        ("SharedArrayBuffer", r#"(v) => String(new SharedArrayBuffer(4).byteLength) + v"#),
        ("String", r#"(v) => String(v)"#),
        ("SuppressedError", r#"(v) => new SuppressedError(1, 2, String(v)).message"#),
        ("Symbol", r#"(v) => String(Symbol(String(v)).description)"#),
        ("SyntaxError", r#"(v) => new SyntaxError(String(v)).name + v"#),
        ("TypeError", r#"(v) => new TypeError(String(v)).name + v"#),
        ("Uint8Array", r#"(v) => String(new Uint8Array([Number(v)])[0])"#),
        ("Uint8ClampedArray", r#"(v) => String(new Uint8ClampedArray([Number(v)])[0])"#),
        ("Uint16Array", r#"(v) => String(new Uint16Array([Number(v)])[0])"#),
        ("Uint32Array", r#"(v) => String(new Uint32Array([Number(v)])[0])"#),
        ("URIError", r#"(v) => new URIError(String(v)).name + v"#),
        ("WeakMap", r#"(v) => { const m = new WeakMap(); const k = {}; m.set(k, String(v)); return m.get(k); }"#),
        ("WeakRef", r#"(v) => { const target = { v }; return String(new WeakRef(target).deref() === target) + v; }"#),
        ("WeakSet", r#"(v) => { const s = new WeakSet(); const k = {}; s.add(k); return s.has(k) ? String(v) : ''; }"#),
        ("Atomics", r#"(v) => String(Atomics.add(new Int32Array(1), 0, Number(v)))"#),
        ("JSON", r#"(v) => JSON.stringify(String(v))"#),
        ("Math", r#"(v) => String(Math.abs(Number(v)))"#),
        ("Reflect", r#"(v) => String(Reflect.has({ a: 1 }, 'a')) + v"#),
        ("escape", r#"(v) => escape(String(v) + ' ')"#),
        ("unescape", r#"(v) => unescape(escape(String(v)))"#),
    ];

    #[test]
    fn every_standard_global_the_evaluator_supplies_is_admitted_and_runs() {
        let mut proven: Vec<&str> = STANDARD_GLOBAL_PROOFS.iter().map(|(name, _)| *name).collect();
        proven.sort_unstable();
        let mut supplied = crate::evaluator::evaluator_standard_globals().to_vec();
        supplied.sort_unstable();
        let mut specified = crate::evaluator::STANDARD_GLOBALS.to_vec();
        specified.sort_unstable();
        assert_eq!(proven, specified, "every specified standard global needs a proof");
        assert_eq!(proven, supplied, "every admitted standard global needs a proof");

        // Each proof is registered under the name of the global it uses, and
        // every proof runs after all registrations: no key reaches a global.
        let eval = crate::evaluator::TransformEvaluator::new();
        for (name, source) in STANDARD_GLOBAL_PROOFS {
            assert_eq!(admit_configured_source(name, source), Ok(()), "{name}");
            eval.register(name, source).unwrap_or_else(|e| panic!("{name}: {e}"));
        }
        // A guarded global is admitted but declines static evaluation.
        for (name, _) in STANDARD_GLOBAL_PROOFS {
            let result = eval.evaluate(name, name, &serde_json::json!(7));
            if ["globalThis", "eval", "Function", "Date"].contains(name) {
                assert_eq!(result, Err(crate::evaluator::EvalError::Unevaluable), "{name}");
            } else {
                result.unwrap_or_else(|e| panic!("{name} must run in the evaluator: {e}"));
            }
        }
    }

    #[test]
    fn admission_ignores_names_registered_into_an_evaluator_realm() {
        let eval = crate::evaluator::TransformEvaluator::new();
        eval.register("registeredHelper", "(v) => v").unwrap();
        assert!(
            rejection_text("usesRegistered", "(v) => registeredHelper(v)")
                .contains("external symbol 'registeredHelper'")
        );
    }

    #[test]
    fn project_declarations_keep_the_project_global_list() {
        let transform = extract_one(
            "const t = createTransform('uri', (v) => encodeURIComponent(String(v)));",
        );
        assert!(!transform.valid, "{:?}", transform.diagnostics);
    }

    #[test]
    fn configured_host_only_globals_are_rejected() {
        for (source, symbol) in [
            ("(v) => Intl.NumberFormat().format(v)", "Intl"),
            ("(v) => window.innerWidth + v", "window"),
            ("(v) => document.title + v", "document"),
            ("(v) => structuredClone(v)", "structuredClone"),
            ("(v) => { queueMicrotask(() => {}); return v; }", "queueMicrotask"),
            ("(v) => String(performance.now() + v)", "performance"),
            ("(v) => new DOMException(String(v)).message", "DOMException"),
            ("(v) => String(new TextEncoder().encode(String(v)).length)", "TextEncoder"),
            ("(v) => String(typeof fetch) + v", "fetch"),
        ] {
            assert!(
                rejection_text("host", source).contains(&format!("external symbol '{symbol}'")),
                "{source}"
            );
        }
    }

    /// btoa and atob are admitted by name, in configured sources and project
    /// declarations, and run in the evaluator; both map Latin-1 one byte per
    /// code unit.
    #[test]
    fn shared_host_globals_are_admitted_and_run() {
        let eval = crate::evaluator::TransformEvaluator::new();
        for (key, source, value, expected) in [
            ("btoa", "(v) => btoa(String(v))", "caf\u{e9}", "Y2Fm6Q=="),
            ("atob", "(v) => atob(String(v))", "Y2Fm6Q==", "caf\u{e9}"),
        ] {
            assert_eq!(admit_configured_source(key, source), Ok(()), "{key}");
            assert!(extract_one(&format!("const t = createTransform('{key}', {source});")).valid, "{key}");
            let value = serde_json::json!(value);
            eval.register(key, source).unwrap();
            assert_eq!(eval.evaluate(key, key, &value).unwrap(), expected, "{key}");
        }
    }

    #[test]
    fn configured_source_that_is_not_one_function_expression_is_rejected() {
        for source in [
            "(v) => v), (x",
            "(v) => v // trailing",
            "(v) => v); globalThis.leak = (1",
            "method(v) { return v; }",
            "function () { [native code] }",
            "42",
        ] {
            rejection("shape", source);
        }
    }

    fn extract_one(source: &str) -> ExtractedTransform {
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source, SourceType::tsx()).parse();
        assert!(
            parsed.diagnostics.is_empty(),
            "fixture must parse: {:?}",
            parsed.diagnostics
        );
        extract_transforms(&parsed.program, source, "inline.tsx", &FxHashSet::default())
            .into_iter()
            .next()
            .expect("fixture must contain one transform")
    }

    #[test]
    fn standard_for_loop_block_locals_are_self_contained() {
        let transform = extract_one(
            r#"const gridItemRatio = createTransform('gridItemRatio', (value) => {
  const parts = String(value).split('/');
  let result = '';
  for (let i = 0; i < parts.length; i++) {
    const delimiter = i === 0 ? '' : ' / ';
    const curr = parts[i];
    if (curr) {
      result = `${result}${delimiter}${curr}`;
    }
  }
  return result;
});"#,
        );

        assert!(transform.valid, "{:?}", transform.diagnostics);
        assert!(transform.diagnostics.is_empty());
    }

    #[test]
    fn standard_for_loop_still_rejects_real_external_symbol() {
        let transform = extract_one(
            r#"const externalPrefix = 'item:';
const transform = createTransform('external', (values) => {
  for (let i = 0; i < values.length; i++) {
    const curr = values[i];
    if (curr) return externalPrefix + curr;
  }
  return '';
});"#,
        );

        assert!(!transform.valid);
        assert!(
            transform
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.contains("external symbol 'externalPrefix'")),
            "{:?}",
            transform.diagnostics
        );
    }

    #[test]
    fn block_local_reference_after_block_is_rejected() {
        let transform = extract_one(
            r#"const transform = createTransform('blockScope', (value) => {
  {
    const curr = String(value);
    if (curr) return curr;
  }
  return curr;
});"#,
        );

        assert!(!transform.valid);
        assert!(
            transform
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.contains("external symbol 'curr'")),
            "{:?}",
            transform.diagnostics
        );
    }

    #[test]
    fn strip_ts_simple_arrow() {
        let input = "(v: number) => `${v}px`";
        let result = strip_typescript(input).unwrap();
        assert_eq!(result, "(v) => `${v}px`");
    }

    #[test]
    fn strip_ts_as_cast() {
        let input = "(value) => { const s = value as string; return s; }";
        let result = strip_typescript(input).unwrap();
        assert!(
            !result.contains("as string"),
            "should not contain 'as string', got: {}",
            result
        );
    }

    #[test]
    fn strip_ts_size_transform() {
        let input = r#"(value) => {
  const toSize = (n: number) => {
    if (n === 0) return n;
    if (n <= 1 && n >= -1) return `${n * 100}%`;
    return `${n}px`;
  };
  if (typeof value === 'number') { return toSize(value); }
  const strValue = value as string;
  if (strValue.includes('calc')) { return strValue; }
  const [match, number, unit] = /(-?\d*\.?\d+)(%|\w*)/.exec(strValue) || [];
  if (match === undefined) { return strValue; }
  const numericValue = parseFloat(number);
  return !unit ? toSize(numericValue) : `${numericValue}${unit}`;
}"#;
        let result = strip_typescript(input);
        match &result {
            Ok(js) => {
                assert!(!js.contains(": number"), "should not contain type annotations: {}", js);
                assert!(!js.contains("as string"), "should not contain 'as string': {}", js);
                let eval = crate::evaluator::TransformEvaluator::new();
                eval.register("size", js).unwrap();
                assert_eq!(eval.evaluate("size", "size", &serde_json::Value::Number(28.into())).unwrap(), "28px");
            }
            Err(e) => panic!("strip_typescript failed: {}", e),
        }
    }
}
