//! Transform evaluator — v1 `transform_evaluator.rs` ported VERBATIM
//! (row 07 Task 07.2; the G-SEAM battery baseline is the behavioral
//! contract). rquickjs wrapper: shared context, globalThis registration
//! (last-registration-wins across files by call order), `String(fn(arg))`
//! ToString semantics, and value_to_js_literal's exact escaping (only
//! \\ \" \n — a raw \r is an eval error upstream, baselined as the
//! silent-passthrough contract).

use std::cell::RefCell;

use rquickjs::{Context, Runtime};
use serde_json::Value;

/// In-process JavaScript transform evaluator powered by rquickjs (QuickJS).
/// Wraps a rquickjs Runtime + Context with interior mutability (RefCell) so it
/// can be called through shared references in the resolve pipeline.
pub struct TransformEvaluator {
    #[allow(dead_code)] // Runtime must outlive Context — kept alive by struct ownership
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

    /// Register a transform function by name. `source` must be a pure JS
    /// function expression (arrow or function), e.g. `(v) => v + "px"`.
    pub fn register(&self, name: &str, source: &str) -> Result<(), String> {
        let script = format!("globalThis.{} = {};", name, source);
        let ctx = self.context.borrow();
        ctx.with(|ctx| {
            ctx.eval::<(), _>(script.as_bytes())
                .map_err(|e| format!("failed to register transform '{}': {}", name, e))
        })
    }

    /// Evaluate a transform: calls `name(value)` and returns the CSS string result.
    /// Preserves the value's type: numbers are passed as JS numbers, strings as JS strings.
    pub fn evaluate(&self, name: &str, value: &Value) -> Result<String, String> {
        let js_arg = value_to_js_literal(value)?;
        let script = format!("String({}({}))", name, js_arg);
        let ctx = self.context.borrow();
        ctx.with(|ctx| {
            ctx.eval::<String, _>(script.as_bytes())
                .map_err(|e| format!("transform '{}' eval failed: {}", name, e))
        })
    }
}

/// Convert a serde_json Value to a JavaScript literal string.
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
}
