//! In-process JS transform evaluation over rquickjs: registration on a
//! shared globalThis, plus result-shape validation inside the engine.

use std::cell::RefCell;
use std::fmt;

use rquickjs::{Context, Runtime};
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
}

impl std::error::Error for EvalError {}

impl fmt::Display for EvalError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EvalError::InvalidResultShape { shape } => {
                write!(f, "invalid transform result shape: {}", shape)
            }
            EvalError::Throw { message } => write!(f, "{}", message),
        }
    }
}

/// In-process JavaScript transform evaluator powered by rquickjs.
pub struct TransformEvaluator {
    #[allow(dead_code)] // Runtime must outlive Context.
    runtime: Runtime,
    context: RefCell<Context>,
}

impl Default for TransformEvaluator {
    fn default() -> Self {
        Self::new()
    }
}

impl TransformEvaluator {
    pub fn new() -> Self {
        let runtime = Runtime::new().expect("failed to create rquickjs Runtime");
        let context = Context::full(&runtime).expect("failed to create rquickjs Context");
        Self {
            runtime,
            context: RefCell::new(context),
        }
    }

    /// Register a JS function expression under `name`. The name is installed
    /// as a computed `globalThis[name]` key: it is never an identifier.
    pub fn register(&self, name: &str, source: &str) -> Result<(), String> {
        let script = format!("globalThis[{}] = ({});", js_string_literal(name), source);
        let ctx = self.context.borrow();
        ctx.with(|ctx| {
            ctx.eval::<(), _>(script.as_bytes())
                .map_err(|e| format!("failed to register transform '{}': {}", name, e))
        })
    }

    /// Evaluate `name(value)`, preserving the value's JS type. Accepts a
    /// string or finite number; any other shape is an `InvalidResultShape`.
    pub fn evaluate(&self, name: &str, value: &Value) -> Result<String, EvalError> {
        let js_arg = value_to_js_literal(value).map_err(|message| EvalError::Throw {
            message: format!("transform '{}': {}", name, message),
        })?;
        let name_lit = js_string_literal(name);
        let script = format!(
            "(() => {{\n\
               const r = globalThis[{name_lit}]({js_arg});\n\
               if (typeof r === 'string') return r;\n\
               // Finite check without `Number.isFinite`: NaN fails self-equality\n\
               // and `1/0` yields Infinity without touching a global.\n\
               if (typeof r === 'number' && r === r && r !== 1/0 && r !== -1/0) return '' + r;\n\
               const A = globalThis.Array;\n\
               const d = r === null ? 'null'\n\
                 : typeof r === 'number' ? 'non-finite-number'\n\
                 : (typeof r === 'object' && A && A.isArray && A.isArray(r)) ? 'array'\n\
                 : typeof r;\n\
               // Thrown as a bare string: `Error` is shadowable too, and\n\
               // classify_eval_error recovers non-Error throws by coercion.\n\
               throw '{INVALID_RESULT_PREFIX}' + d;\n\
             }})()"
        );
        let ctx = self.context.borrow();
        ctx.with(|ctx| {
            ctx.eval::<String, _>(script.as_bytes())
                .map_err(|e| classify_eval_error(&ctx, name, &e))
        })
    }
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
fn js_string_literal(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

#[allow(dead_code)]
fn value_to_js_literal(value: &Value) -> Result<String, String> {
    match value {
        Value::Number(n) => Ok(n.to_string()),
        Value::String(s) => {
            let escaped = s.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n");
            Ok(format!("\"{}\"", escaped))
        }
        Value::Bool(b) => Ok(b.to_string()),
        _ => Err("unsupported value type for transform".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn register_and_eval_simple() {
        let eval = TransformEvaluator::new();
        eval.register("double", "(v) => String(v * 2)").unwrap();
        let result = eval.evaluate("double", &Value::Number(5.into())).unwrap();
        assert_eq!(result, "10");
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
        let result = eval.evaluate("wrap", &Value::String("10".into())).unwrap();
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
        assert_eq!(eval.evaluate("size", &Value::Number(28.into())).unwrap(), "28px");
        assert_eq!(eval.evaluate("size", &Value::Number(0.into())).unwrap(), "0");
        assert_eq!(eval.evaluate("size", &Value::String("max-content".into())).unwrap(), "max-content");
    }

    fn assert_invalid_shape(source: &str, expected: &str) {
        let eval = TransformEvaluator::new();
        eval.register("t", source).unwrap();
        let err = eval.evaluate("t", &Value::Number(1.into())).unwrap_err();
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
        let err = eval.evaluate("boom", &Value::Number(1.into())).unwrap_err();
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
        let err = eval.evaluate("forge", &Value::Number(1.into())).unwrap_err();
        assert!(matches!(err, EvalError::Throw { .. }), "got {:?}", err);
    }

    #[test]
    fn non_error_throw_recovers_coerced_message() {
        let eval = TransformEvaluator::new();
        eval.register("strthrow", "(v) => { throw 'plain-string-throw' }").unwrap();
        let err = eval.evaluate("strthrow", &Value::Number(1.into())).unwrap_err();
        match err {
            EvalError::Throw { message } => assert!(
                message.contains("plain-string-throw"),
                "message lost the thrown value: {}",
                message
            ),
            other => panic!("expected Throw, got {:?}", other),
        }

        eval.register("numthrow", "(v) => { throw 42 }").unwrap();
        let err = eval.evaluate("numthrow", &Value::Number(1.into())).unwrap_err();
        match err {
            EvalError::Throw { message } => assert!(message.contains("42")),
            other => panic!("expected Throw, got {:?}", other),
        }
    }

    #[test]
    fn unsupported_argument_names_the_transform() {
        let eval = TransformEvaluator::new();
        eval.register("t", "(v) => v").unwrap();
        let err = eval.evaluate("t", &Value::Null).unwrap_err();
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
                .evaluate(name, &Value::Number(4.into()))
                .unwrap_or_else(|e| panic!("transform '{}' failed: {:?}", name, e));
            assert_eq!(result, "4px", "transform named '{}' was shadowed", name);
        }
    }

    #[test]
    fn shadowed_intrinsics_do_not_break_the_accept_path() {
        let eval = TransformEvaluator::new();
        eval.register("Number", "(v) => v * 2").unwrap();
        eval.register("String", "(v) => v").unwrap();
        eval.register("Array", "(v) => v").unwrap();
        eval.register("keep", "(v) => v * 3").unwrap();

        assert_eq!(
            eval.evaluate("keep", &Value::Number(5.into())).unwrap(),
            "15"
        );
        assert_eq!(
            eval.evaluate("Number", &Value::Number(6.into())).unwrap(),
            "12"
        );
    }

    /// Package sources register before project sources, so last registration
    /// wins is what lets a project transform override a built-in.
    #[test]
    fn last_registration_wins() {
        let eval = TransformEvaluator::new();
        eval.register("size", r#"(v) => v + "-package""#).unwrap();
        eval.register("size", r#"(v) => v + "-project""#).unwrap();
        assert_eq!(
            eval.evaluate("size", &Value::String("4".into())).unwrap(),
            "4-project"
        );
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
                eval.evaluate(name, &Value::String("x".into())).unwrap(),
                "x!",
                "name {:?} did not round-trip",
                name
            );
        }
    }

    /// Shape classification must survive a clobbered `Array` — degrading the
    /// descriptor is acceptable, misclassifying a rejection as a throw is not.
    #[test]
    fn invalid_shape_still_classified_with_shadowed_intrinsics() {
        let eval = TransformEvaluator::new();
        eval.register("Array", "(v) => v").unwrap();
        eval.register("bad", "(v) => ({ width: v })").unwrap();
        let err = eval.evaluate("bad", &Value::Number(4.into())).unwrap_err();
        assert!(
            matches!(err, EvalError::InvalidResultShape { .. }),
            "expected InvalidResultShape, got {:?}",
            err
        );
    }
}
