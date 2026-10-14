//! The one QuickJS execution both workloads run on: the loader's system
//! construction and the extraction engine's transform evaluation. It gives a
//! fresh realm, under a poll budget where the caller sets one, and the global
//! vocabulary a pristine realm supplies. Each caller keeps its own policy, its
//! isolation and its reading of results; no realm is shared.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, OnceLock};

use rquickjs::{Context, Ctx, Runtime};

use super::js_quoted;

/// One runtime holding one full context. A host error thrown in a second
/// context of one runtime, such as btoa's `InvalidCharacterError`, has a null
/// prototype, so every realm gets a runtime of its own.
pub struct Realm {
    // Fields drop in declaration order: the context before its runtime.
    context: Context,
    _runtime: Runtime,
    budget: Option<Arc<AtomicU32>>,
}

impl Realm {
    /// A realm nothing has run in yet. With `poll_budget`, it is interrupted
    /// once it has passed that many interrupt polls (QuickJS polls about
    /// every ten thousand operations); without, it runs to completion.
    pub fn fresh(poll_budget: Option<u32>) -> Result<Realm, String> {
        let runtime = Runtime::new().map_err(|e| format!("rquickjs Runtime::new failed: {}", e))?;
        let context =
            Context::full(&runtime).map_err(|e| format!("rquickjs Context::full failed: {}", e))?;
        let budget = poll_budget.map(|polls| {
            let budget = Arc::new(AtomicU32::new(polls));
            let left = Arc::clone(&budget);
            runtime.set_interrupt_handler(Some(Box::new(move || match left.load(Ordering::Relaxed) {
                0 => true,
                polls => {
                    left.store(polls - 1, Ordering::Relaxed);
                    false
                }
            })));
            budget
        });
        Ok(Realm { context, _runtime: runtime, budget })
    }

    /// Runs `f` in the realm.
    pub fn with<R>(&self, f: impl FnOnce(Ctx<'_>) -> R) -> R {
        self.context.with(f)
    }

    /// Whether the realm spent its whole poll budget.
    pub fn exhausted(&self) -> bool {
        self.budget.as_ref().is_some_and(|budget| budget.load(Ordering::Relaxed) == 0)
    }
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

/// Host functions outside ECMA-262 that this realm, browsers and Node all
/// define natively, each depending only on its argument.
const SHARED_HOST_NAMES: &[&str] = &["atob", "btoa"];

/// The `names` a pristine realm defines as its own properties.
fn own_globals(names: &'static [&'static str]) -> Vec<&'static str> {
    let realm = Realm::fresh(None).expect("a pristine realm");
    realm.with(|ctx| {
        names
            .iter()
            .copied()
            .filter(|name| {
                let probe = format!(
                    "Object.prototype.hasOwnProperty.call(globalThis, '{}')",
                    js_quoted(name)
                );
                // A failed probe must not narrow admission silently.
                ctx.eval::<bool, _>(probe.as_bytes())
                    .unwrap_or_else(|e| panic!("probing global {name} failed: {e}"))
            })
            .collect()
    })
}

/// The `STANDARD_GLOBALS` a pristine realm supplies.
pub fn standard_globals() -> &'static [&'static str] {
    static SUPPLIED: OnceLock<Vec<&'static str>> = OnceLock::new();
    SUPPLIED.get_or_init(|| own_globals(STANDARD_GLOBALS))
}

/// The `SHARED_HOST_NAMES` a pristine realm supplies.
pub fn shared_host_globals() -> &'static [&'static str] {
    static SUPPLIED: OnceLock<Vec<&'static str>> = OnceLock::new();
    SUPPLIED.get_or_init(|| own_globals(SHARED_HOST_NAMES))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// This rquickjs pin supplies every specified global; a name it drops
    /// must be recorded here with its evidence, never silently narrowed.
    #[test]
    fn pristine_realm_supplies_every_specified_global() {
        let missing: Vec<&str> =
            STANDARD_GLOBALS.iter().copied().filter(|name| !standard_globals().contains(name)).collect();
        assert_eq!(missing, Vec::<&str>::new());
    }
}
