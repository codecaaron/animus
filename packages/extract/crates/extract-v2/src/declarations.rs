//! Declaration scales: finite keys whose values are complete flat records of
//! CSS declarations, bound by `kind: "declarations"` system or component props. A bound
//! prop's records are validated against the effective scale and lowered to
//! CSS once, so its binding classes and its runtime writes read one table.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::{Arc, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::theme::{camel_to_kebab, FlatTheme, PropConfig, PropConfigMap};

pub const DECLARATIONS_KIND: &str = "declarations";

/// A prop's declaration fields. `binding` is set once its scale validates.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct DeclarationFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub members: Vec<String>,
    #[serde(skip)]
    pub binding: Option<Arc<DeclarationBinding>>,
}

#[derive(Debug)]
pub struct DeclarationMember {
    /// The authored camelCase name, the runtime's record key.
    pub name: String,
    pub css_property: String,
}

/// Scale key → member name → CSS value, units applied.
pub type DeclarationRecords = BTreeMap<String, BTreeMap<String, String>>;

/// A scale's members with its lowered records.
pub type LoweredScale = (Vec<DeclarationMember>, Arc<DeclarationRecords>);

/// The theme's declaration scales by name, validated and lowered.
pub type DeclarationScales = BTreeMap<String, LoweredScale>;

/// A declaration prop bound to its effective scale.
#[derive(Debug)]
pub struct DeclarationBinding {
    pub members: Vec<DeclarationMember>,
    pub records: Arc<DeclarationRecords>,
    /// The declaring component's identity hash for a component prop; `None`
    /// for a system prop, whose member variables every consumer shares.
    pub identity: Option<String>,
}

impl DeclarationBinding {
    /// The record a scalar entry selects; a key is a string or a number's text.
    pub fn record(&self, entry: &Value) -> Option<&BTreeMap<String, String>> {
        self.records.get(&record_key(entry)?)
    }
}

/// The scale key an entry names: a string, or a number's text as the
/// runtime's `String(value)` spells it.
pub fn record_key(entry: &Value) -> Option<String> {
    match entry {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

#[derive(Deserialize)]
struct WireScale {
    kind: String,
    members: Vec<String>,
    values: BTreeMap<String, Value>,
}

/// Longhands each shorthand resets; a nested shorthand expands in turn.
const SHORTHANDS: &[(&str, &[&str])] = &[
    ("animation", &["animation-name", "animation-duration", "animation-timing-function", "animation-delay", "animation-iteration-count", "animation-direction", "animation-fill-mode", "animation-play-state"]),
    ("background", &["background-color", "background-image", "background-position", "background-size", "background-repeat", "background-origin", "background-clip", "background-attachment"]),
    ("background-position", &["background-position-x", "background-position-y"]),
    ("border", &["border-top", "border-right", "border-bottom", "border-left", "border-width", "border-style", "border-color", "border-image"]),
    ("border-block", &["border-block-start", "border-block-end"]),
    ("border-block-end", &["border-block-end-width", "border-block-end-style", "border-block-end-color"]),
    ("border-block-start", &["border-block-start-width", "border-block-start-style", "border-block-start-color"]),
    ("border-bottom", &["border-bottom-width", "border-bottom-style", "border-bottom-color"]),
    ("border-color", &["border-top-color", "border-right-color", "border-bottom-color", "border-left-color"]),
    ("border-image", &["border-image-source", "border-image-slice", "border-image-width", "border-image-outset", "border-image-repeat"]),
    ("border-inline", &["border-inline-start", "border-inline-end"]),
    ("border-inline-end", &["border-inline-end-width", "border-inline-end-style", "border-inline-end-color"]),
    ("border-inline-start", &["border-inline-start-width", "border-inline-start-style", "border-inline-start-color"]),
    ("border-left", &["border-left-width", "border-left-style", "border-left-color"]),
    ("border-radius", &["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"]),
    ("border-right", &["border-right-width", "border-right-style", "border-right-color"]),
    ("border-style", &["border-top-style", "border-right-style", "border-bottom-style", "border-left-style"]),
    ("border-top", &["border-top-width", "border-top-style", "border-top-color"]),
    ("border-width", &["border-top-width", "border-right-width", "border-bottom-width", "border-left-width"]),
    ("column-rule", &["column-rule-width", "column-rule-style", "column-rule-color"]),
    ("columns", &["column-width", "column-count"]),
    ("container", &["container-name", "container-type"]),
    ("flex", &["flex-grow", "flex-shrink", "flex-basis"]),
    ("flex-flow", &["flex-direction", "flex-wrap"]),
    ("font", &["font-family", "font-size", "font-style", "font-variant", "font-weight", "font-stretch", "line-height"]),
    ("font-variant", &["font-variant-caps", "font-variant-numeric", "font-variant-ligatures", "font-variant-east-asian", "font-variant-alternates", "font-variant-position"]),
    ("gap", &["row-gap", "column-gap"]),
    ("grid", &["grid-template", "grid-auto-rows", "grid-auto-columns", "grid-auto-flow"]),
    ("grid-area", &["grid-row", "grid-column"]),
    ("grid-column", &["grid-column-start", "grid-column-end"]),
    ("grid-row", &["grid-row-start", "grid-row-end"]),
    ("grid-template", &["grid-template-rows", "grid-template-columns", "grid-template-areas"]),
    ("inset", &["top", "right", "bottom", "left"]),
    ("inset-block", &["inset-block-start", "inset-block-end"]),
    ("inset-inline", &["inset-inline-start", "inset-inline-end"]),
    ("list-style", &["list-style-type", "list-style-position", "list-style-image"]),
    ("margin", &["margin-top", "margin-right", "margin-bottom", "margin-left"]),
    ("margin-block", &["margin-block-start", "margin-block-end"]),
    ("margin-inline", &["margin-inline-start", "margin-inline-end"]),
    ("mask", &["mask-image", "mask-mode", "mask-repeat", "mask-position", "mask-clip", "mask-origin", "mask-size", "mask-composite"]),
    ("outline", &["outline-color", "outline-style", "outline-width"]),
    ("overflow", &["overflow-x", "overflow-y"]),
    ("overscroll-behavior", &["overscroll-behavior-x", "overscroll-behavior-y"]),
    ("padding", &["padding-top", "padding-right", "padding-bottom", "padding-left"]),
    ("padding-block", &["padding-block-start", "padding-block-end"]),
    ("padding-inline", &["padding-inline-start", "padding-inline-end"]),
    ("place-content", &["align-content", "justify-content"]),
    ("place-items", &["align-items", "justify-items"]),
    ("place-self", &["align-self", "justify-self"]),
    ("scroll-margin", &["scroll-margin-top", "scroll-margin-right", "scroll-margin-bottom", "scroll-margin-left"]),
    ("scroll-padding", &["scroll-padding-top", "scroll-padding-right", "scroll-padding-bottom", "scroll-padding-left"]),
    ("text-decoration", &["text-decoration-line", "text-decoration-style", "text-decoration-color", "text-decoration-thickness"]),
    ("text-emphasis", &["text-emphasis-style", "text-emphasis-color"]),
    ("transition", &["transition-property", "transition-duration", "transition-timing-function", "transition-delay", "transition-behavior"]),
];

/// The property and every longhand it resets, transitively.
fn expansion(css_property: &str) -> BTreeSet<&str> {
    let mut seen = BTreeSet::new();
    let mut pending = vec![css_property];
    while let Some(property) = pending.pop() {
        if !seen.insert(property) {
            continue;
        }
        if let Some((_, longhands)) = SHORTHANDS.iter().find(|(name, _)| *name == property) {
            pending.extend(longhands.iter().copied());
        }
    }
    seen
}

/// Whether a CSS property is a shorthand: it resets longhands.
pub(crate) fn is_shorthand(css_property: &str) -> bool {
    SHORTHANDS.iter().any(|(name, _)| *name == css_property)
}

/// The properties a set of CSS properties resets: each one, and every
/// longhand a shorthand among them resets. A strict superset is a broader
/// set, which the cascade orders first so the narrower one wins.
pub(crate) fn reset_set<'a>(properties: impl IntoIterator<Item = &'a str>) -> BTreeSet<&'a str> {
    properties.into_iter().flat_map(expansion).collect()
}

/// The utility cascade's rank of a shorthand: after every shorthand that
/// contains it, with siblings in the order their parent lists them, so the
/// border sides precede the border aspects. A longhand has none.
pub(crate) fn shorthand_rank(css_property: &str) -> Option<usize> {
    static ORDER: OnceLock<Vec<&'static str>> = OnceLock::new();
    let order = ORDER.get_or_init(|| {
        let parents = |name: &str| SHORTHANDS.iter().filter(|(_, longhands)| longhands.contains(&name)).count();
        let mut waiting: BTreeMap<&str, usize> = SHORTHANDS.iter().map(|(name, _)| (*name, parents(name))).collect();
        let mut queue: VecDeque<&str> =
            SHORTHANDS.iter().map(|(name, _)| *name).filter(|name| waiting[name] == 0).collect();
        let mut order = Vec::with_capacity(SHORTHANDS.len());
        while let Some(name) = queue.pop_front() {
            order.push(name);
            let longhands = SHORTHANDS.iter().find(|(shorthand, _)| *shorthand == name).map_or(&[][..], |(_, l)| *l);
            for longhand in longhands {
                if let Some(count) = waiting.get_mut(longhand) {
                    *count -= 1;
                    if *count == 0 {
                        queue.push_back(longhand);
                    }
                }
            }
        }
        order
    });
    order.iter().position(|name| *name == css_property)
}

/// A longhand both properties set, if one is or contains the other.
fn shared_longhand(a: &str, b: &str) -> Option<String> {
    let a_longhands = expansion(a);
    expansion(b)
        .into_iter()
        .find(|property| a_longhands.contains(property))
        .map(str::to_string)
}

fn overlap_in(members: &[DeclarationMember]) -> Option<(&str, &str)> {
    members.iter().enumerate().find_map(|(index, member)| {
        members[index + 1..]
            .iter()
            .find(|other| shared_longhand(&member.css_property, &other.css_property).is_some())
            .map(|other| (member.name.as_str(), other.name.as_str()))
    })
}

fn css_members(names: &[String], label: &str) -> Result<Vec<DeclarationMember>, String> {
    let mut members: Vec<DeclarationMember> = Vec::with_capacity(names.len());
    for name in names {
        // As the system package rules: custom properties are not members.
        if name.starts_with("--") {
            return Err(format!("{label}: member \"{name}\" is not a CSS property name."));
        }
        let css_property = camel_to_kebab(name);
        if members.iter().any(|member| member.css_property == css_property) {
            return Err(format!("{label}: member '{name}' is listed more than once"));
        }
        members.push(DeclarationMember { name: name.clone(), css_property });
    }
    if let Some((a, b)) = overlap_in(&members) {
        return Err(format!(
            "{label}: members '{a}' and '{b}' overlap as shorthand and longhand — their order would decide the result"
        ));
    }
    Ok(members)
}

/// A member value as CSS: a number takes `px` unless its property is unitless.
fn lower_value(value: &Value, css_property: &str) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => {
            let finite = number.as_f64().is_some_and(f64::is_finite);
            if !finite {
                None
            } else if crate::css::is_unitless_css_property(css_property) || number.as_f64() == Some(0.0) {
                Some(number.to_string())
            } else {
                Some(format!("{number}px"))
            }
        }
        _ => None,
    }
}

fn describe(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "a boolean",
        Value::Array(_) => "an array",
        Value::Object(_) => "a nested record",
        Value::Number(_) => "a non-finite number",
        Value::String(_) => "a string",
    }
}

/// One scale's records, validated against its member list and lowered.
fn lower_scale(
    name: &str,
    scale: &WireScale,
) -> Result<LoweredScale, String> {
    let label = format!("declaration scale '{name}'");
    if scale.kind != DECLARATIONS_KIND {
        return Err(format!("{label}: unknown kind '{}'", scale.kind));
    }
    if scale.members.is_empty() || scale.values.is_empty() {
        return Err(format!("{label}: a declaration scale needs members and at least one key"));
    }
    let members = css_members(&scale.members, &label)?;
    let mut records = BTreeMap::new();
    for (key, record) in &scale.values {
        let where_ = format!("{label} key '{key}'");
        let Some(record) = record.as_object() else {
            return Err(format!("{where_}: expected a record, got {}", describe(record)));
        };
        records.insert(key.clone(), lower_record(&where_, &members, record)?);
    }
    Ok((members, Arc::new(records)))
}

fn lower_record(
    where_: &str,
    members: &[DeclarationMember],
    record: &Map<String, Value>,
) -> Result<BTreeMap<String, String>, String> {
    if let Some(extra) = record.keys().find(|key| !members.iter().any(|member| &member.name == *key)) {
        return Err(format!("{where_}: sets extra member '{extra}'"));
    }
    let mut lowered = BTreeMap::new();
    for member in members {
        let Some(value) = record.get(&member.name) else {
            return Err(format!("{where_}: is missing member '{}'", member.name));
        };
        let Some(css) = lower_value(value, &member.css_property) else {
            return Err(format!(
                "{where_}: member '{}' must be a string or finite number, got {}",
                member.name,
                describe(value)
            ));
        };
        lowered.insert(member.name.clone(), css);
    }
    Ok(lowered)
}

fn declares_scalar_scale(theme: &FlatTheme, name: &str) -> bool {
    let prefix = format!("{name}.");
    theme.keys().any(|key| key.starts_with(&prefix))
}

fn bind_prop(
    prop_name: &str,
    config: &PropConfig,
    scales: &DeclarationScales,
    theme: &FlatTheme,
    identity: Option<String>,
) -> Result<DeclarationBinding, String> {
    let label = format!("declaration prop '{prop_name}'");
    let value_fields = [
        ("property", !config.property.is_empty()),
        ("properties", !config.properties.is_empty()),
        ("transform", config.transform.is_some() || config.transform_id.is_some() || config.transform_fn_source.is_some()),
        ("negative", config.negative),
        ("currentVar", config.current_var.is_some()),
        ("strict", config.strict == Some(false)),
    ];
    if let Some((field, _)) = value_fields.iter().find(|(_, present)| *present) {
        return Err(format!("{label}: '{field}' does not apply to a declaration prop"));
    }
    let Some(Value::String(scale_name)) = &config.scale else {
        return Err(format!("{label}: 'scale' must name a declaration scale"));
    };
    let Some((scale_members, records)) = scales.get(scale_name) else {
        return Err(if declares_scalar_scale(theme, scale_name) {
            format!("{label}: scale '{scale_name}' is a scalar scale, not a declaration scale")
        } else {
            format!("{label}: scale '{scale_name}' is not a declared declaration scale")
        });
    };
    let members = css_members(&config.declaration.members, &label)?;
    if members.is_empty() {
        return Err(format!("{label}: 'members' must list at least one property"));
    }
    // Members match by CSS property, so `borderColor` and `border-color` name
    // one member; the binding keeps the scale's spelling, its records' keys.
    let in_scale = |member: &DeclarationMember| scale_members.iter().find(|scale| scale.css_property == member.css_property);
    if let Some(missing) = scale_members
        .iter()
        .find(|scale| !members.iter().any(|member| member.css_property == scale.css_property))
    {
        return Err(format!(
            "{label}: scale '{scale_name}' sets member '{}' that the prop does not list",
            missing.name
        ));
    }
    let mut bound = Vec::with_capacity(members.len());
    for member in &members {
        let Some(scale_member) = in_scale(member) else {
            return Err(format!("{label}: member '{}' is not set by scale '{scale_name}'", member.name));
        };
        bound.push(DeclarationMember { name: scale_member.name.clone(), css_property: scale_member.css_property.clone() });
    }
    Ok(DeclarationBinding { members: bound, records: Arc::clone(records), identity })
}

/// A scalar prop must not name a declaration scale, and a prop without a
/// kind keeps its primary property.
fn check_value_prop(prop_name: &str, prop: &PropConfig, scales: &DeclarationScales) -> Result<(), String> {
    if prop.property.is_empty() {
        return Err(format!("missing field `property` in prop '{prop_name}'"));
    }
    if let Some(Value::String(scale)) = &prop.scale {
        if scales.contains_key(scale) {
            return Err(format!(
                "prop '{prop_name}': scale '{scale}' is a declaration scale — bind it with kind: 'declarations'"
            ));
        }
    }
    Ok(())
}

/// Declaration props of one registration surface must not set a common
/// longhand: their relative order would decide the result.
pub fn check_surface_overlap(config: &PropConfigMap) -> Result<(), String> {
    let mut bound: Vec<(&String, &DeclarationBinding)> = config
        .iter()
        .filter_map(|(name, prop)| Some((name, prop.declaration_binding()?)))
        .collect();
    bound.sort_by(|a, b| a.0.cmp(b.0));
    for (index, (name, binding)) in bound.iter().enumerate() {
        for (other_name, other) in &bound[index + 1..] {
            for member in &binding.members {
                for other_member in &other.members {
                    if let Some(longhand) = shared_longhand(&member.css_property, &other_member.css_property) {
                        return Err(format!(
                            "declaration props '{name}' and '{other_name}' both set '{longhand}' (members '{}' and '{}') — declarations of one registration surface must not overlap",
                            member.name, other_member.name
                        ));
                    }
                }
            }
        }
    }
    Ok(())
}

/// Binds a component's own `.props()` declaration props to the theme's
/// declaration scales under the declaring component's identity. Props already
/// bound, such as inherited ones, keep the identity they carry.
pub fn bind_component_declarations(
    config: &mut PropConfigMap,
    scales: &DeclarationScales,
    theme: &FlatTheme,
    declaring_component: &str,
) -> Result<(), String> {
    let mut prop_names: Vec<String> = config.keys().cloned().collect();
    prop_names.sort();
    for prop_name in &prop_names {
        let prop = config.get_mut(prop_name).expect("listed prop");
        match prop.declaration.kind.as_deref() {
            None => check_value_prop(prop_name, prop, scales)?,
            Some(DECLARATIONS_KIND) if prop.declaration.binding.is_none() => {
                let identity = Some(crate::css::content_hash(declaring_component));
                prop.declaration.binding = Some(Arc::new(bind_prop(prop_name, prop, scales, theme, identity)?));
            }
            Some(DECLARATIONS_KIND) => {}
            Some(other) => return Err(format!("prop '{prop_name}': unknown kind '{other}'")),
        }
    }
    check_surface_overlap(config)
}

/// Binds every declaration prop of the system configuration to its effective
/// scale. A registration that cannot bind fails with a diagnostic naming the
/// scale, key, member or prop: kind mismatches, missing or extra members,
/// non-flat or non-finite values, and shorthand/longhand overlap within one
/// record or between two declaration props of the system.
pub fn bind_declaration_props(
    config: &mut PropConfigMap,
    declaration_scales_json: Option<&str>,
    theme: &FlatTheme,
) -> Result<DeclarationScales, String> {
    let wire: BTreeMap<String, WireScale> = match declaration_scales_json {
        None => BTreeMap::new(),
        Some(json) if json.trim().is_empty() || json.trim() == "null" => BTreeMap::new(),
        Some(json) => serde_json::from_str(json)
            .map_err(|e| format!("EngineOptions.declarationScalesJson: invalid JSON — {e}"))?,
    };
    let mut scales = BTreeMap::new();
    for (name, scale) in &wire {
        if declares_scalar_scale(theme, name) {
            return Err(format!(
                "declaration scale '{name}': '{name}' is also a scalar scale — a scale is either scalar or declaration-valued"
            ));
        }
        scales.insert(name.clone(), lower_scale(name, scale)?);
    }

    let mut prop_names: Vec<String> = config.keys().cloned().collect();
    prop_names.sort();
    for prop_name in &prop_names {
        let prop = config.get_mut(prop_name).expect("listed prop");
        match prop.declaration.kind.as_deref() {
            None => check_value_prop(prop_name, prop, &scales).map_err(|e| format!("EngineOptions.configJson: {e}"))?,
            Some(DECLARATIONS_KIND) => {
                prop.declaration.binding = Some(Arc::new(bind_prop(prop_name, prop, &scales, theme, None)?));
            }
            Some(other) => return Err(format!("prop '{prop_name}': unknown kind '{other}'")),
        }
    }
    check_surface_overlap(config)?;
    Ok(scales)
}

/// A class name segment for a scale key: the key when it is a plain word
/// sequence, otherwise a hash, so `--` stays free to separate a breakpoint.
fn key_segment(key: &str) -> String {
    let plain = !key.is_empty()
        && key.split('-').all(|word| {
            !word.is_empty() && word.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
        })
        && key.chars().next().is_some_and(|ch| ch.is_ascii_alphanumeric());
    if plain {
        key.to_string()
    } else {
        format!("_{}", crate::css::content_hash(key))
    }
}

/// Names shared by the binding classes, the consuming rules and the runtime.
/// A component prop's names carry its declaring identity, so unrelated
/// components never read each other's member variables.
pub struct DeclarationNames<'a> {
    pub prefix: &'a str,
    pub prop: &'a str,
    pub identity: Option<&'a str>,
}

impl<'a> DeclarationNames<'a> {
    pub fn of(prefix: &'a str, prop: &'a str, binding: &'a DeclarationBinding) -> Self {
        Self { prefix, prop, identity: binding.identity.as_deref() }
    }

    fn scope(&self) -> String {
        format!("{}{}", crate::css::slot_segment(self.prop), self.identity.unwrap_or(""))
    }

    fn base(&self) -> String {
        format!("{}-dcl-{}", self.prefix, self.scope())
    }

    /// The key-independent class whose rules read the member variables.
    pub fn consuming_class(&self) -> String {
        self.base()
    }

    pub fn member_var(&self, member: &DeclarationMember) -> String {
        format!("--{}-{}-{}", self.prefix, self.scope(), crate::css::slot_segment(&member.name))
    }

    /// The class declaring one key's member variables, for the base or a
    /// breakpoint; it needs no media wrapper.
    pub fn binding_class(&self, key: &str, breakpoint: Option<&str>) -> String {
        match breakpoint {
            None => format!("{}--{}", self.base(), key_segment(key)),
            Some(bp) => format!("{}--{}--{}", self.base(), key_segment(key), bp),
        }
    }
}

/// The breakpoint suffix a responsive entry writes; `_` is the base.
pub fn breakpoint_of(entry_key: &str) -> Option<&str> {
    (entry_key != "_").then_some(entry_key)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn bind(scale_members: &[&str], prop_members: &[&str]) -> Result<DeclarationScales, String> {
        let mut config: PropConfigMap = serde_json::from_value(json!({
            "look": { "kind": "declarations", "scale": "looks", "members": prop_members },
        }))
        .unwrap();
        let record: Map<String, Value> = scale_members.iter().map(|member| (member.to_string(), json!("red"))).collect();
        let scales = json!({
            "looks": { "kind": "declarations", "members": scale_members, "values": { "loud": record } },
        })
        .to_string();
        bind_declaration_props(&mut config, Some(&scales), &FlatTheme::default())
    }

    /// The system package refuses custom-property members; the engine
    /// refuses the same input when it arrives as hand-written options.
    #[test]
    fn a_custom_property_member_is_not_a_css_property_name() {
        let error = bind(&["--bg", "color"], &["color"]).unwrap_err();
        assert!(error.contains("member \"--bg\" is not a CSS property name"), "{error}");
        let error = bind(&["color"], &["--bg", "color"]).unwrap_err();
        assert!(error.contains("member \"--bg\" is not a CSS property name"), "{error}");
        assert!(bind(&["backgroundColor", "color"], &["backgroundColor", "color"]).is_ok());
    }
}
