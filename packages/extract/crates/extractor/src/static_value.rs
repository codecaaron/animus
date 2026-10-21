//! A static value as evaluation reads it (spec §6.2): JSON-shaped data in
//! authored order, and the nodes no JSON value stands for, each a typed
//! node rather than a key inside the value.

use std::cmp::Ordering;

/// A number as the source wrote it: `1` and `1.0` stay apart, as the CSS
/// they print does. Ordered by value (`f64::total_cmp`, so `-0.0` sorts
/// before `0.0`), then by spelling; two numbers are equal only where that
/// order says so.
#[derive(Debug, Clone)]
pub struct StaticNumber(pub serde_json::Number);

impl PartialEq for StaticNumber {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}

impl Eq for StaticNumber {}

impl Ord for StaticNumber {
    fn cmp(&self, other: &Self) -> Ordering {
        let value = |number: &serde_json::Number| number.as_f64().unwrap_or(f64::NAN);
        value(&self.0).total_cmp(&value(&other.0)).then_with(|| self.0.to_string().cmp(&other.0.to_string()))
    }
}

impl PartialOrd for StaticNumber {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// What evaluation could not read in a const: the kind, and the clause a
/// diagnostic says it with (`a computed key in const 'preset'`).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Unevaluated {
    pub kind: UnevaluatedKind,
    pub clause: String,
}

/// Why a node is unevaluated (spec §6.2, `Unevaluated(kind)`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum UnevaluatedKind {
    /// A computed or non-static property key.
    ComputedKey,
    /// A call: a function, or `asset()` of what it cannot resolve.
    Call,
    /// A spread of what is no static object.
    Spread,
    /// A reference, by name or member path, to no static value.
    Reference,
    /// A function or arrow function as a value.
    Function,
    /// A template literal or tagged template with expressions.
    Template,
    /// An operator applied to what is no literal.
    Operator,
    /// A getter or setter.
    Accessor,
    /// A selector key with no substitutable subject.
    Selector,
    /// An expression evaluation does not model.
    Unsupported,
    /// An inline `transform` callback, which a stage captures as its own
    /// definition but a `.props()` config read through a const loses.
    CapturedTransform,
}

/// A static value. An object is its entries in authored order, which
/// decides CSS declaration order (rule 15).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum StaticValue {
    Null,
    Bool(bool),
    Number(StaticNumber),
    String(String),
    Array(Vec<StaticValue>),
    Object(Vec<(String, StaticValue)>),
    /// A local bound to a function `@animus-ui/system` exports that
    /// evaluation calls; no read takes it as a value.
    SystemFunction(SystemFunction),
    Unevaluated(Unevaluated),
}

/// The `@animus-ui/system` functions evaluation calls.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum SystemFunction {
    /// `asset`. `in_project` says whether a relative specifier may
    /// evaluate: in a package file it would resolve from the wrong origin.
    Asset { in_project: bool },
    /// `firstThatWorks`.
    FirstThatWorks,
}

impl StaticValue {
    /// An object's entries.
    pub fn entries(&self) -> Option<&Vec<(String, StaticValue)>> {
        match self {
            StaticValue::Object(entries) => Some(entries),
            _ => None,
        }
    }

    /// An object's entries, to change.
    pub fn entries_mut(&mut self) -> Option<&mut Vec<(String, StaticValue)>> {
        match self {
            StaticValue::Object(entries) => Some(entries),
            _ => None,
        }
    }

    /// The member `key` of an object.
    pub fn get(&self, key: &str) -> Option<&StaticValue> {
        self.entries()?.iter().find(|(name, _)| name == key).map(|(_, value)| value)
    }

    /// The member `key` of an object, to change.
    pub fn get_mut(&mut self, key: &str) -> Option<&mut StaticValue> {
        self.entries_mut()?.iter_mut().find(|(name, _)| name == key).map(|(_, value)| value)
    }

    /// Sets the member `key` of an object: in place where it has one, as a
    /// JavaScript object keeps a key's first position, else last.
    pub fn insert(&mut self, key: &str, value: StaticValue) {
        if let Some(entries) = self.entries_mut() {
            match entries.iter_mut().find(|(name, _)| name == key) {
                Some((_, slot)) => *slot = value,
                None => entries.push((key.to_string(), value)),
            }
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            StaticValue::String(text) => Some(text),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Contract: `StaticValue`'s equality agrees with its order, numbers
    /// included, so a `Known` set of values never holds two that are equal
    /// or loses one that is not.
    #[test]
    fn equality_agrees_with_order() {
        let numbers: Vec<serde_json::Number> = [
            serde_json::json!(0),
            serde_json::json!(-0.0),
            serde_json::json!(0.0),
            serde_json::json!(1),
            serde_json::json!(1.0),
            serde_json::json!(-1),
            serde_json::json!(0.1),
            serde_json::json!(2.5),
            serde_json::json!(1e300),
            serde_json::json!(u64::MAX),
            serde_json::json!(u64::MAX - 1),
            serde_json::json!(i64::MIN),
        ]
        .into_iter()
        .filter_map(|value| value.as_number().cloned())
        .collect();
        let values: Vec<StaticValue> = numbers
            .iter()
            .map(|number| StaticValue::Number(StaticNumber(number.clone())))
            .chain(numbers.iter().map(|number| {
                StaticValue::Array(vec![StaticValue::Number(StaticNumber(number.clone()))])
            }))
            .collect();
        for a in &values {
            for b in &values {
                assert_eq!(a == b, a.cmp(b) == Ordering::Equal, "{a:?} against {b:?}");
                assert_eq!(a.cmp(b), b.cmp(a).reverse(), "{a:?} against {b:?}");
            }
        }
    }
}
