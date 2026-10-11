//! A static value as evaluation reads it (spec §6.2): JSON-shaped data in
//! authored order, and the nodes no JSON value stands for, each a typed
//! node rather than a key inside the value.

use std::cmp::Ordering;

/// A number as the source wrote it: `1` and `1.0` stay apart, as the CSS
/// they print does. Ordered by value, then by spelling, so the order agrees
/// with equality.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StaticNumber(pub serde_json::Number);

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

/// Why a node is unevaluated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum UnevaluatedKind {
    /// An expression evaluation skipped: a computed key, a call, a spread,
    /// a reference to no static value.
    Expression,
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
    /// A local bound to `@animus-ui/system`'s `asset`: evaluation calls it,
    /// and no read takes it as a value. `in_project` says whether a relative
    /// specifier may evaluate: in a package file it would resolve from the
    /// wrong origin.
    AssetFunction { in_project: bool },
    Unevaluated(Unevaluated),
}

impl StaticValue {
    /// The member `key` of an object.
    pub fn get(&self, key: &str) -> Option<&StaticValue> {
        match self {
            StaticValue::Object(entries) => entries.iter().find(|(name, _)| name == key).map(|(_, value)| value),
            _ => None,
        }
    }

    /// The member `key` of an object, to change.
    pub fn get_mut(&mut self, key: &str) -> Option<&mut StaticValue> {
        match self {
            StaticValue::Object(entries) => {
                entries.iter_mut().find(|(name, _)| name == key).map(|(_, value)| value)
            }
            _ => None,
        }
    }

    /// Sets the member `key` of an object: in place where it has one, as a
    /// JavaScript object keeps a key's first position, else last.
    pub fn insert(&mut self, key: &str, value: StaticValue) {
        if let StaticValue::Object(entries) = self {
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
