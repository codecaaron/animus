//! In-process JS transform evaluation over rquickjs: registration into a
//! private registry, plus result-shape validation inside the engine.

use std::cell::RefCell;
use std::fmt;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, OnceLock};

use rquickjs::{Context, Function, Runtime};
use rustc_hash::FxHashMap;
use serde_json::Value;

/// Message prefix the in-engine harness throws for invalid result shapes;
/// the Rust side classifies rquickjs errors by this prefix.
const INVALID_RESULT_PREFIX: &str = "animus-invalid-transform-result:";

/// The closed descriptor set the harness can emit. Descriptors reach build
/// errors verbatim, so a tail outside this set must classify as `Throw`.
const INVALID_RESULT_SHAPES: &[&str] = &[
    "object",
    "array",
    "null",
    "boolean",
    "undefined",
    "function",
    "symbol",
    "bigint",
    "non-finite-number",
];

/// Typed transform-evaluation failure. Variant names and descriptor
/// strings are part of the public contract.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EvalError {
    /// Transform returned an invalid shape. `shape` is always drawn from
    /// the closed `INVALID_RESULT_SHAPES` set.
    InvalidResultShape { shape: String },
    /// Transform threw, or the engine failed to evaluate the script.
    Throw { message: String },
    /// The evaluation exhausted its budget or reached the host environment,
    /// so its result for this value is not known before runtime.
    Unevaluable,
}

impl std::error::Error for EvalError {}

impl fmt::Display for EvalError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EvalError::InvalidResultShape { shape } => {
                write!(f, "invalid transform result shape: {}", shape)
            }
            EvalError::Throw { message } => write!(f, "{}", message),
            EvalError::Unevaluable => write!(f, "transform cannot be evaluated during extraction"),
        }
    }
}

/// In-process JavaScript transform evaluator powered by rquickjs.
///
/// Registered definitions live in a Rust-side registry keyed by definition
/// identity, so no registration writes a property of a realm's global
/// object: a transform named `Map` cannot replace another callback's `Map`.
#[derive(Default)]
pub struct TransformEvaluator {
    registry: RefCell<FxHashMap<String, Definition>>,
}

/// Compiled afresh for each evaluation, in its own strict realm under a
/// budget, so nothing it does reaches another evaluation; its result depends
/// only on the argument, so each argument is evaluated once.
struct Definition {
    source: String,
    results: RefCell<FxHashMap<String, Result<Scalar, EvalError>>>,
}

/// QuickJS polls the interrupt handler about every ten thousand operations,
/// so an evaluation stops near a million operations on every machine.
const BUDGET: u32 = 100;

/// A valid scalar result: its CSS text and whether it was a number.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Scalar {
    pub css: String,
    pub numeric: bool,
}

/// The standard global-object properties of ECMA-262 (2027 draft):
/// §19.1 value, §19.2 function, §19.3 constructor and §19.4 other
/// properties, plus Annex B.2.1's legacy `escape` and `unescape`.
/// `Intl` (ECMA-402) and host globals are not part of it.
pub const STANDARD_GLOBALS: &[&str] = &[
    // §19.1
    "globalThis",
    "Infinity",
    "NaN",
    "undefined",
    // §19.2
    "eval",
    "isFinite",
    "isNaN",
    "parseFloat",
    "parseInt",
    "decodeURI",
    "decodeURIComponent",
    "encodeURI",
    "encodeURIComponent",
    // §19.3
    "AggregateError",
    "Array",
    "ArrayBuffer",
    "AsyncDisposableStack",
    "BigInt",
    "BigInt64Array",
    "BigUint64Array",
    "Boolean",
    "DataView",
    "Date",
    "DisposableStack",
    "Error",
    "EvalError",
    "FinalizationRegistry",
    "Float16Array",
    "Float32Array",
    "Float64Array",
    "Function",
    "Int8Array",
    "Int16Array",
    "Int32Array",
    "Iterator",
    "Map",
    "Number",
    "Object",
    "Promise",
    "Proxy",
    "RangeError",
    "ReferenceError",
    "RegExp",
    "Set",
    "SharedArrayBuffer",
    "String",
    "SuppressedError",
    "Symbol",
    "SyntaxError",
    "TypeError",
    "Uint8Array",
    "Uint8ClampedArray",
    "Uint16Array",
    "Uint32Array",
    "URIError",
    "WeakMap",
    "WeakRef",
    "WeakSet",
    // §19.4
    "Atomics",
    "JSON",
    "Math",
    "Reflect",
    // Annex B.2.1
    "escape",
    "unescape",
];

/// Host functions outside ECMA-262 that the evaluator realm, browsers and
/// Node all define, each depending only on its argument.
pub(crate) const SHARED_HOST_GLOBALS: &[&str] = &animus_system_loader::SHARED_HOST_NAMES;

/// Every evaluator realm is this one; the probes below must match it.
fn new_realm() -> (Runtime, Context) {
    let runtime = Runtime::new().expect("failed to create rquickjs Runtime");
    let context = Context::full(&runtime).expect("failed to create rquickjs Context");
    (runtime, context)
}

/// The `names` a pristine evaluator realm defines as its own properties,
/// probed in a fresh realm nothing has registered into.
fn own_globals(names: &'static [&'static str]) -> Vec<&'static str> {
    let (_runtime, context) = new_realm();
    context.with(|ctx| {
        names
            .iter()
            .copied()
            .filter(|name| {
                let probe = format!(
                    "Object.prototype.hasOwnProperty.call(globalThis, {})",
                    js_string_literal(name)
                );
                // A failed probe must not narrow admission silently.
                ctx.eval::<bool, _>(probe.as_bytes())
                    .unwrap_or_else(|e| panic!("probing global {name} failed: {e}"))
            })
            .collect()
    })
}

/// The `STANDARD_GLOBALS` a pristine evaluator realm supplies.
pub fn evaluator_standard_globals() -> &'static [&'static str] {
    static SUPPLIED: OnceLock<Vec<&'static str>> = OnceLock::new();
    SUPPLIED.get_or_init(|| own_globals(STANDARD_GLOBALS))
}

/// The `SHARED_HOST_GLOBALS` a pristine evaluator realm supplies.
pub fn evaluator_shared_host_globals() -> &'static [&'static str] {
    static SUPPLIED: OnceLock<Vec<&'static str>> = OnceLock::new();
    SUPPLIED.get_or_init(|| own_globals(SHARED_HOST_GLOBALS))
}

/// Calls a registered callable and validates its result. Built in each
/// realm before the callable compiles, so it closes over pristine
/// intrinsics. A finite number comes back wrapped as `['' + r]`, so its type
/// survives.
fn harness_source() -> String {
    format!(
        "(() => {{\n\
           const isArray = Array.isArray;\n\
           return (fn, value) => {{\n\
             const r = fn(value);\n\
             if (typeof r === 'string') return r;\n\
             // Finite check without a global: NaN fails self-equality and\n\
             // `1/0` yields Infinity.\n\
             if (typeof r === 'number' && r === r && r !== 1/0 && r !== -1/0) return ['' + r];\n\
             const d = r === null ? 'null'\n\
               : typeof r === 'number' ? 'non-finite-number'\n\
               : (typeof r === 'object' && isArray(r)) ? 'array'\n\
               : typeof r;\n\
             // Thrown as a bare string; classify_eval_error recovers\n\
             // non-Error throws by coercion.\n\
             throw '{INVALID_RESULT_PREFIX}' + d;\n\
           }};\n\
         }})()"
    )
}

impl TransformEvaluator {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a JS function expression as the definition `key`: each
    /// evaluation compiles it in a fresh strict-mode realm under a budget, so
    /// its effects on intrinsics or the global object reach no other
    /// evaluation. The key is only a registry entry.
    pub fn register(&self, key: &str, source: &str) -> Result<(), String> {
        let (_runtime, context) = new_realm();
        context.with(|ctx| {
            let callable = ctx
                .eval::<rquickjs::Value, _>(isolated_script(source).as_bytes())
                .map_err(|e| format!("failed to register transform '{}': {}", key, e))?;
            if !callable.is_function() {
                return Err(format!("failed to register transform '{}': source is not a function", key));
            }
            Ok(())
        })?;
        self.registry
            .borrow_mut()
            .insert(key.to_string(), Definition { source: source.to_string(), results: RefCell::default() });
        Ok(())
    }

    /// Whether a definition is registered as `key`.
    pub fn is_registered(&self, key: &str) -> bool {
        self.registry.borrow().contains_key(key)
    }

    /// Evaluate the definition `key` for `value`, preserving the value's JS
    /// type; `name` is the readable transform name reported on failure, and
    /// an unregistered key reports the transform as unbound.
    /// Accepts a string or finite number; any other shape is an
    /// `InvalidResultShape`.
    pub fn evaluate(&self, key: &str, name: &str, value: &Value) -> Result<String, EvalError> {
        self.evaluate_callback(key, name, value).map(|scalar| scalar.css)
    }

    /// Evaluate the definition `key` for `value`, keeping whether
    /// the result was a number.
    pub fn evaluate_callback(&self, key: &str, name: &str, value: &Value) -> Result<Scalar, EvalError> {
        let js_arg = argument(name, value)?;
        let registry = self.registry.borrow();
        let Some(Definition { source, results }) = registry.get(key) else {
            return Err(unbound(name));
        };
        if let Some(result) = results.borrow().get(&js_arg) {
            return result.clone();
        }
        let result = evaluate_in_fresh_realm(source, name, &js_arg);
        results.borrow_mut().insert(js_arg, result.clone());
        result
    }
}

/// Evaluate `source` for `js_arg` in a realm of its own.
fn evaluate_in_fresh_realm(source: &str, name: &str, js_arg: &str) -> Result<Scalar, EvalError> {
    // A runtime of its own: a second context of one runtime gives host
    // errors such as btoa's `InvalidCharacterError` a null prototype.
    let (runtime, context) = new_realm();
    let budget = Arc::new(AtomicU32::new(BUDGET));
    let polls = Arc::clone(&budget);
    runtime.set_interrupt_handler(Some(Box::new(move || match polls.load(Ordering::Relaxed) {
        0 => true,
        left => {
            polls.store(left - 1, Ordering::Relaxed);
            false
        }
    })));
    let mut touched_host = false;
    let outcome = context.with(|ctx| {
        let fail = |e: rquickjs::Error| classify_eval_error(&ctx, name, &e);
        let harness: Function = ctx.eval(harness_source().as_bytes()).map_err(fail)?;
        let touched: Function = ctx.eval(HOST_GUARD.as_bytes()).map_err(fail)?;
        let callable: Function = ctx.eval(isolated_script(source).as_bytes()).map_err(fail)?;
        let argument: rquickjs::Value = ctx.eval(format!("({js_arg})").as_bytes()).map_err(fail)?;
        let result = harness.call::<_, rquickjs::Value>((callable, argument)).map_err(fail);
        // Read after the callback's own exception is taken.
        touched_host = touched.call(()).unwrap_or(true);
        let result = result?;
        let scalar = match result.as_array() {
            Some(number) => number.get(0).map(|css| Scalar { css, numeric: true }),
            None => result.get().map(|css| Scalar { css, numeric: false }),
        };
        scalar.map_err(fail)
    });
    let exhausted = budget.load(Ordering::Relaxed) == 0;
    match outcome {
        _ if touched_host => Err(EvalError::Unevaluable),
        Err(_) if exhausted => Err(EvalError::Unevaluable),
        outcome => outcome,
    }
}

/// Run in an isolated realm before the callback compiles: every way to the
/// global object, dynamic code, the clock, randomness or the locale becomes
/// a getter that records the access and throws, so a callback whose result
/// may depend on its host is never baked, even when it catches the throw.
/// Returns whether anything was touched.
const HOST_GUARD: &str = r#"(() => {
  const global = globalThis;
  let touched = false;
  const guard = (target, key) => Object.defineProperty(target, key, {
    configurable: false,
    get() { touched = true; throw new TypeError(`${String(key)} is host-dependent`); },
    set() { touched = true; throw new TypeError(`${String(key)} is host-dependent`); },
  });
  for (const fn of [function () {}, function* () {}, async function () {}, async function* () {}]) {
    guard(Object.getPrototypeOf(fn), 'constructor');
  }
  for (const key of ['globalThis', 'eval', 'Function', 'Date', 'console']) guard(global, key);
  guard(Math, 'random');
  for (const proto of [Object.prototype, Number.prototype, Array.prototype, BigInt.prototype]) {
    guard(proto, 'toLocaleString');
  }
  for (const key of ['localeCompare', 'toLocaleUpperCase', 'toLocaleLowerCase']) guard(String.prototype, key);
  return () => touched;
})()"#;

fn argument(name: &str, value: &Value) -> Result<String, EvalError> {
    value_to_js_literal(value).map_err(|message| EvalError::Throw {
        message: format!("transform '{}': {}", name, message),
    })
}

fn unbound(name: &str) -> EvalError {
    EvalError::Throw {
        message: format!("transform '{}' is not bound to one admitted definition", name),
    }
}

/// An isolated definition's script: strict, as the module the runtime
/// delivers it in.
fn isolated_script(source: &str) -> String {
    format!("'use strict';\n({})", source)
}

/// Classify an rquickjs failure: a message carrying `INVALID_RESULT_PREFIX`
/// becomes `InvalidResultShape`, everything else `Throw`.
fn classify_eval_error(ctx: &rquickjs::Ctx<'_>, name: &str, error: &rquickjs::Error) -> EvalError {
    let caught = ctx.catch();
    let message = match caught.as_exception() {
        Some(exc) => exc.message().unwrap_or_default(),
        // Non-Error throw: recover its string coercion so the throw stays
        // diagnosable; an absent toString falls back to the engine text.
        None => caught
            .get::<rquickjs::Coerced<String>>()
            .map(|coerced| coerced.0)
            .unwrap_or_default(),
    };
    if let Some(tail) = message
        .find(INVALID_RESULT_PREFIX)
        .map(|idx| message[idx + INVALID_RESULT_PREFIX.len()..].trim())
    {
        if INVALID_RESULT_SHAPES.contains(&tail) {
            return EvalError::InvalidResultShape { shape: tail.to_string() };
        }
    }
    let message = if message.is_empty() {
        format!("transform '{}' eval failed: {}", name, error)
    } else {
        format!("transform '{}' eval failed: {}", name, message)
    };
    EvalError::Throw { message }
}

/// Quote `value` as a JavaScript string literal so no input can terminate it
/// and inject syntax. JSON string syntax is a subset of JavaScript's.
pub(crate) fn js_string_literal(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

fn value_to_js_literal(value: &Value) -> Result<String, String> {
    match value {
        Value::Number(n) => Ok(n.to_string()),
        Value::String(s) => Ok(js_string_literal(s)),
        Value::Bool(b) => Ok(b.to_string()),
        _ => Err("unsupported value type for transform".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// This rquickjs pin supplies every specified global; a name it drops
    /// must be recorded here with its evidence, never silently narrowed.
    #[test]
    fn pristine_realm_supplies_every_specified_global() {
        let missing: Vec<&str> = STANDARD_GLOBALS
            .iter()
            .copied()
            .filter(|name| !evaluator_standard_globals().contains(name))
            .collect();
        assert_eq!(missing, Vec::<&str>::new());
    }

    #[test]
    fn register_and_eval_simple() {
        let eval = TransformEvaluator::new();
        eval.register("double", "(v) => String(v * 2)").unwrap();
        let result = eval.evaluate("double", "double", &Value::Number(5.into())).unwrap();
        assert_eq!(result, "10");
    }

    /// String arguments reach the callback with every character intact, a
    /// carriage return included.
    #[test]
    fn string_arguments_keep_line_terminators_quotes_and_backslashes() {
        let eval = TransformEvaluator::new();
        eval.register("b64", "(v) => btoa(v)").unwrap();
        for (value, expected) in [("a\rb", "YQ1i"), ("a\r\nb", "YQ0KYg=="), ("q\"\\\n\u{e9}", "cSJcCuk=")] {
            assert_eq!(eval.evaluate("b64", "b64", &Value::String(value.into())).unwrap(), expected, "{value:?}");
        }
    }

    /// A host function's exception keeps its name and message: each
    /// evaluation has a runtime of its own.
    #[test]
    fn host_function_exceptions_keep_their_message() {
        let eval = TransformEvaluator::new();
        eval.register("b64", "(v) => btoa(v)").unwrap();
        eval.register("caught", "(v) => { try { return btoa(v); } catch (e) { return e.name; } }").unwrap();
        let euro = Value::String("\u{20ac}".into());
        assert_eq!(
            eval.evaluate("b64", "b64", &euro),
            Err(EvalError::Throw { message: "transform 'b64' eval failed: InvalidCharacterError: String contains an invalid character".into() })
        );
        assert_eq!(eval.evaluate("caught", "caught", &euro).unwrap(), "InvalidCharacterError");
    }

    #[test]
    fn register_fails_on_invalid_js() {
        let eval = TransformEvaluator::new();
        let result = eval.register("bad", "not valid javascript {{{}}}");
        assert!(result.is_err());
    }

    #[test]
    fn eval_with_string_value() {
        let eval = TransformEvaluator::new();
        eval.register("wrap", r#"(v) => v + "px""#).unwrap();
        let result = eval.evaluate("wrap", "wrap", &Value::String("10".into())).unwrap();
        assert_eq!(result, "10px");
    }

    #[test]
    fn eval_size_transform() {
        let eval = TransformEvaluator::new();
        let source = r#"(value) => {
            const toSize = (n) => {
                if (n === 0) return n;
                if (n <= 1 && n >= -1) return `${n * 100}%`;
                return `${n}px`;
            };
            if (typeof value === 'number') { return toSize(value); }
            const strValue = value;
            if (strValue.includes('calc')) { return strValue; }
            const [match, number, unit] = /(-?\d*\.?\d+)(%|\w*)/.exec(strValue) || [];
            if (match === undefined) { return strValue; }
            const numericValue = parseFloat(number);
            return !unit ? toSize(numericValue) : `${numericValue}${unit}`;
        }"#;
        eval.register("size", source).unwrap();
        assert_eq!(eval.evaluate("size", "size", &Value::Number(28.into())).unwrap(), "28px");
        assert_eq!(eval.evaluate("size", "size", &Value::Number(0.into())).unwrap(), "0");
        assert_eq!(eval.evaluate("size", "size", &Value::String("max-content".into())).unwrap(), "max-content");
    }

    fn assert_invalid_shape(source: &str, expected: &str) {
        let eval = TransformEvaluator::new();
        eval.register("t", source).unwrap();
        let err = eval.evaluate("t", "t", &Value::Number(1.into())).unwrap_err();
        assert_eq!(err, EvalError::InvalidResultShape { shape: expected.to_string() });
    }

    #[test]
    fn invalid_shape_object() {
        assert_invalid_shape("(v) => ({ a: 1 })", "object");
    }

    #[test]
    fn invalid_shape_array() {
        assert_invalid_shape("(v) => [1, 2]", "array");
    }

    #[test]
    fn invalid_shape_null() {
        assert_invalid_shape("(v) => null", "null");
    }

    #[test]
    fn invalid_shape_boolean() {
        assert_invalid_shape("(v) => true", "boolean");
    }

    #[test]
    fn invalid_shape_undefined() {
        assert_invalid_shape("(v) => undefined", "undefined");
    }

    #[test]
    fn invalid_shape_function() {
        assert_invalid_shape("(v) => (() => 1)", "function");
    }

    #[test]
    fn invalid_shape_nan() {
        assert_invalid_shape("(v) => NaN", "non-finite-number");
    }

    #[test]
    fn invalid_shape_positive_infinity() {
        assert_invalid_shape("(v) => Infinity", "non-finite-number");
    }

    #[test]
    fn invalid_shape_negative_infinity() {
        assert_invalid_shape("(v) => -Infinity", "non-finite-number");
    }

    #[test]
    fn throwing_transform_reports_throw() {
        let eval = TransformEvaluator::new();
        eval.register("boom", "(v) => { throw new Error('boom-message') }").unwrap();
        let err = eval.evaluate("boom", "boom", &Value::Number(1.into())).unwrap_err();
        match err {
            EvalError::Throw { message } => assert!(message.contains("boom-message")),
            other => panic!("expected Throw, got {:?}", other),
        }
    }

    #[test]
    fn invalid_shape_symbol() {
        assert_invalid_shape("(v) => Symbol('x')", "symbol");
    }

    #[test]
    fn invalid_shape_bigint() {
        assert_invalid_shape("(v) => 10n", "bigint");
    }

    #[test]
    fn forged_prefix_with_junk_tail_classifies_as_throw() {
        let eval = TransformEvaluator::new();
        eval.register(
            "forge",
            "(v) => { throw new Error('animus-invalid-transform-result:object   trailing junk') }",
        )
        .unwrap();
        let err = eval.evaluate("forge", "forge", &Value::Number(1.into())).unwrap_err();
        assert!(matches!(err, EvalError::Throw { .. }), "got {:?}", err);
    }

    #[test]
    fn non_error_throw_recovers_coerced_message() {
        let eval = TransformEvaluator::new();
        eval.register("strthrow", "(v) => { throw 'plain-string-throw' }").unwrap();
        let err = eval.evaluate("strthrow", "strthrow", &Value::Number(1.into())).unwrap_err();
        match err {
            EvalError::Throw { message } => assert!(
                message.contains("plain-string-throw"),
                "message lost the thrown value: {}",
                message
            ),
            other => panic!("expected Throw, got {:?}", other),
        }

        eval.register("numthrow", "(v) => { throw 42 }").unwrap();
        let err = eval.evaluate("numthrow", "numthrow", &Value::Number(1.into())).unwrap_err();
        match err {
            EvalError::Throw { message } => assert!(message.contains("42")),
            other => panic!("expected Throw, got {:?}", other),
        }
    }

    #[test]
    fn unsupported_argument_names_the_transform() {
        let eval = TransformEvaluator::new();
        eval.register("t", "(v) => v").unwrap();
        let err = eval.evaluate("t", "t", &Value::Null).unwrap_err();
        match err {
            EvalError::Throw { message } => assert!(message.contains("transform 't'")),
            other => panic!("expected Throw, got {:?}", other),
        }
    }

    #[test]
    fn harness_locals_do_not_shadow_same_named_transforms() {
        for name in ["r", "d"] {
            let eval = TransformEvaluator::new();
            eval.register(name, r#"(v) => v + "px""#).unwrap();
            let result = eval
                .evaluate(name, name, &Value::Number(4.into()))
                .unwrap_or_else(|e| panic!("transform '{}' failed: {:?}", name, e));
            assert_eq!(result, "4px", "transform named '{}' was shadowed", name);
        }
    }

    #[test]
    fn intrinsic_named_keys_do_not_break_the_accept_path() {
        let eval = TransformEvaluator::new();
        eval.register("Number", "(v) => v * 2").unwrap();
        eval.register("String", "(v) => v").unwrap();
        eval.register("Array", "(v) => v").unwrap();
        eval.register("keep", "(v) => v * 3").unwrap();

        assert_eq!(
            eval.evaluate("keep", "keep", &Value::Number(5.into())).unwrap(),
            "15"
        );
        assert_eq!(
            eval.evaluate("Number", "Number", &Value::Number(6.into())).unwrap(),
            "12"
        );
    }

    /// Registration keys are registry entries, never global properties: a
    /// definition keyed like a standard global leaves that global intact for
    /// every other callback.
    #[test]
    fn registration_writes_no_global_property() {
        let eval = TransformEvaluator::new();
        eval.register("Map", "(v) => v + 1").unwrap();
        eval.register("size", r#"(v) => v + "px""#).unwrap();
        eval.register("keyed", "(v) => new Map([[1, String(v * 3)]]).get(1)").unwrap();
        eval.register("globals", "(v) => typeof size + typeof keyed").unwrap();

        assert_eq!(eval.evaluate("keyed", "keyed", &Value::Number(2.into())).unwrap(), "6");
        assert_eq!(eval.evaluate("Map", "Map", &Value::Number(4.into())).unwrap(), "5");
        assert_eq!(
            eval.evaluate("globals", "globals", &Value::Number(0.into())).unwrap(),
            "undefinedundefined"
        );
    }

    #[test]
    fn definitions_sharing_a_readable_name_stay_separate() {
        let eval = TransformEvaluator::new();
        eval.register("unit@system.inset", r#"(v) => v + "px""#).unwrap();
        eval.register("unit@system.lift", r#"(v) => v + "rem""#).unwrap();
        let value = Value::Number(3.into());
        assert_eq!(eval.evaluate("unit@system.inset", "unit", &value).unwrap(), "3px");
        assert_eq!(eval.evaluate("unit@system.lift", "unit", &value).unwrap(), "3rem");
    }

    #[test]
    fn an_unregistered_key_reports_the_readable_name() {
        let eval = TransformEvaluator::new();
        eval.register("unit@system.inset", r#"(v) => v + "px""#).unwrap();
        let err = eval.evaluate("unit", "unit", &Value::Number(3.into())).unwrap_err();
        match err {
            EvalError::Throw { message } => assert!(
                message.contains("transform 'unit' is not bound to one admitted definition"),
                "{message}"
            ),
            other => panic!("expected Throw, got {:?}", other),
        }
    }

    #[test]
    fn register_rejects_a_source_that_is_not_a_function() {
        let eval = TransformEvaluator::new();
        assert!(eval.register("n", "42").is_err());
    }

    /// Transform names come from user source and are never validated as
    /// identifiers, so neither registration nor evaluation may interpolate one.
    #[test]
    fn non_identifier_transform_names_are_safe() {
        let eval = TransformEvaluator::new();
        for name in ["kebab-name", "with space", "with\"quote"] {
            eval.register(name, r#"(v) => v + "!""#)
                .unwrap_or_else(|e| panic!("register '{}' failed: {}", name, e));
            assert_eq!(
                eval.evaluate(name, name, &Value::String("x".into())).unwrap(),
                "x!",
                "name {:?} did not round-trip",
                name
            );
        }
    }

    /// The harness closes over intrinsics captured before any callback ran,
    /// so a callback that clobbers them cannot change shape classification.
    #[test]
    fn invalid_shape_still_classified_with_clobbered_intrinsics() {
        let eval = TransformEvaluator::new();
        eval.register("Array", "(v) => v").unwrap();
        eval.register("bad", "(v) => ({ width: v })").unwrap();
        let err = eval.evaluate("bad", "bad", &Value::Number(4.into())).unwrap_err();
        assert!(
            matches!(err, EvalError::InvalidResultShape { .. }),
            "expected InvalidResultShape, got {:?}",
            err
        );

        eval.register("clobber", "(v) => { Array.isArray = () => false; return [v]; }")
            .unwrap();
        let err = eval.evaluate("clobber", "clobber", &Value::Number(4.into())).unwrap_err();
        assert_eq!(err, EvalError::InvalidResultShape { shape: "array".to_string() });
    }
}
