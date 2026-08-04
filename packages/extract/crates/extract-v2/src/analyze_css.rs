//! Project-level CSS orchestration (row 07 Task 07.6): v1
//! `project_analyzer::analyze` Phases 3–6 reimplemented over retained
//! FACTS — no AST access, no re-parse (v1 re-parses every file for JSX
//! scanning; v2 filters the usage facts collected at parse time).
//!
//! Bug-compat mirrors (v1 project_analyzer line refs):
//!  - eval-failed chains still DROP from the manifest and the source file
//!    stays untransformed (967-969), but the drop now bails LOUD (quirk
//!    shed inc 02 — v1 emits no diagnostic; divergence licensed);
//!  - cycle in extension provenance ⇒ the ordering degrades to the
//!    lexically-sorted non-cyclic set (700-712) — not a re-topo;
//!  - usage configs only track variant props WITH a default (982-1001),
//!    but every evaluated binding is inserted (1006-1010);
//!  - inline-transform custom props are forced onto the dynamic path and
//!    filtered from BOTH static utility streams (1302-1316, 1335-1353);
//!  - .asClass() chains and ALL compose slots are unconditionally
//!    rendered; shared variant keys pre-populate child-slot usage
//!    (1514-1559);
//!  - dev_mode retains all components and reports prospective
//!    eliminations only (1584-1602).
//!
//! Input surface (completed at row 13): global style blocks + keyframes
//! feed `sheets.global`; extension parents resolve through relative
//! imports, path aliases, the package map, AND re-export chains
//! (follow_reexports) — mirroring v1's import_resolver.

use std::collections::{BTreeMap, HashMap};
use std::fmt::Write as _;

use rustc_hash::{FxHashMap, FxHashSet};
use serde_json::Value;

use crate::chain_merge::{topological_sort, ProvenanceNode, TopoResult};
use crate::chain_walk::TerminalKind;
use crate::css::{
    build_variable_slot_entries, camel_to_kebab, generate_composed_variant_css,
    generate_css_sheets_ordered, generate_custom_prop_css, generate_utility_css, layer_name,
    BreakpointMap, ComponentCss, ComposeFamilyRef, CssFragmentStore, CssSheets, UtilityInput,
    VariantCss,
};
use crate::dynamic_meta::DynamicPropMeta;
use crate::evaluator::TransformEvaluator;
use crate::facts::FileFacts;
use crate::jsx_scan::{
    ComponentUsageConfig, ComposeFamilyInfo, DynamicPropUsage, SystemPropUsage, UsageScanResult,
};
use crate::pipeline::process_chain_facts;
use crate::reconcile::{build_ledger, identify_prospective_eliminations, reconcile, VariantConfigMap};
use crate::theme::{
    ConditionAliasesMap, ContextualVarsMap, CssDeclaration, FlatTheme, PropConfigMap,
    ResolveContext, ResolvedStyles, SelectorAliasesMap, VariableMap,
};
use crate::usage_facts::UsageResidueRecord;

type ComponentPropSetMap = FxHashMap<String, FxHashSet<String>>;

/// v1 project_analyzer AliasType/AliasEntry VERBATIM serde shapes.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AliasType {
    Prefix,
    Exact,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AliasEntry {
    pub pattern: String,
    pub replacement: String,
    #[serde(rename = "type")]
    pub alias_type: AliasType,
}

/// v1 expand_alias VERBATIM (project_analyzer 132-150): first match in
/// GIVEN order (v1 does not sort at parse).
pub fn expand_alias(source: &str, aliases: &[AliasEntry]) -> Option<String> {
    for alias in aliases {
        match alias.alias_type {
            AliasType::Exact => {
                if source == alias.pattern {
                    return Some(alias.replacement.clone());
                }
            }
            AliasType::Prefix => {
                if source.starts_with(&alias.pattern) {
                    let rest = &source[alias.pattern.len()..];
                    return Some(format!("{}{}", alias.replacement, rest));
                }
            }
        }
    }
    None
}

/// Parsed configuration/theme inputs (EngineOptions JSON blobs → owned
/// maps; parsed ONCE at engine construction, fail-loud).
#[derive(Default)]
pub struct CssInputs {
    pub theme: FlatTheme,
    pub variable_map: VariableMap,
    pub contextual_vars: ContextualVarsMap,
    pub config: PropConfigMap,
    pub group_registry: FxHashMap<String, Vec<String>>,
    pub selector_aliases: SelectorAliasesMap,
    /// Condition alias registry (`conditionAliases` manifest field, inc 03):
    /// `_motionReduce` → { value, order, kind }. Empty = no registrations.
    pub condition_aliases: ConditionAliasesMap,
    /// v1 `global_style_blocks_json` (resolved into sheets.global).
    pub global_style_blocks: Option<Value>,
    /// v1 `keyframes_blocks_json` (keyframes registry + global CSS).
    pub keyframes_blocks: Option<Value>,
    /// v1 `package_resolution_json`: import source → resolved path.
    pub package_map: FxHashMap<String, String>,
    /// v1 `path_aliases_json` (`{aliases: [...]}` wrapper), given order.
    pub path_aliases: Vec<AliasEntry>,
    /// Forced-emission declarations (spec: static-emission-overrides).
    pub static_css: Option<crate::forced_usage::StaticCssConfig>,
    /// rootDir-relative directory prefixes of discovered external packages
    /// (`externalDirsJson`). Files under these dirs get the external-token
    /// candidate walk (cross-source correlation); empty = no candidates.
    pub external_dirs: Vec<String>,
    pub dev_mode: bool,
}

impl CssInputs {
    #[allow(clippy::too_many_arguments)]
    pub fn from_json(
        theme_json: Option<&str>,
        variable_map_json: Option<&str>,
        contextual_vars_json: Option<&str>,
        config_json: Option<&str>,
        group_registry_json: Option<&str>,
        selector_aliases_json: Option<&str>,
        condition_aliases_json: Option<&str>,
        global_style_blocks_json: Option<&str>,
        keyframes_json: Option<&str>,
        package_resolution_json: Option<&str>,
        path_aliases_json: Option<&str>,
        static_css_json: Option<&str>,
        external_dirs_json: Option<&str>,
        dev_mode: bool,
    ) -> Result<Self, String> {
        fn parse<T: serde::de::DeserializeOwned + Default>(
            name: &str,
            json: Option<&str>,
        ) -> Result<T, String> {
            match json {
                None => Ok(T::default()),
                Some(s) if s.trim().is_empty() || s.trim() == "null" => Ok(T::default()),
                Some(s) => serde_json::from_str(s)
                    .map_err(|e| format!("EngineOptions.{name}: invalid JSON — {e}")),
            }
        }
        fn parse_opt_value(name: &str, json: Option<&str>) -> Result<Option<Value>, String> {
            match json {
                None => Ok(None),
                Some(s) if s.trim().is_empty() || s.trim() == "null" => Ok(None),
                Some(s) => serde_json::from_str(s)
                    .map(Some)
                    .map_err(|e| format!("EngineOptions.{name}: invalid JSON — {e}")),
            }
        }
        // v1 lib.rs 877-888: `{aliases: [...]}` wrapper, silently-empty on
        // parse failure in v1 — v2 fails loud instead (G5).
        let path_aliases = match path_aliases_json {
            None => Vec::new(),
            Some(s) if s.trim().is_empty() || s.trim() == "null" => Vec::new(),
            Some(s) => {
                #[derive(serde::Deserialize)]
                struct AliasWrapper {
                    aliases: Vec<AliasEntry>,
                }
                serde_json::from_str::<AliasWrapper>(s)
                    .map(|w| w.aliases)
                    .map_err(|e| format!("EngineOptions.pathAliasesJson: invalid JSON — {e}"))?
            }
        };
        let static_css = match static_css_json {
            None => None,
            Some(s) if s.trim().is_empty() || s.trim() == "null" => None,
            Some(s) => {
                let parsed = crate::forced_usage::StaticCssConfig::parse(s)
                    .map_err(|e| format!("EngineOptions.staticCssJson: {e}"))?;
                if parsed.is_empty() {
                    None
                } else {
                    Some(parsed)
                }
            }
        };
        Ok(CssInputs {
            theme: parse("themeJson", theme_json)?,
            variable_map: parse("variableMapJson", variable_map_json)?,
            contextual_vars: parse("contextualVarsJson", contextual_vars_json)?,
            config: parse("configJson", config_json)?,
            group_registry: parse("groupRegistryJson", group_registry_json)?,
            selector_aliases: parse("selectorAliasesJson", selector_aliases_json)?,
            condition_aliases: parse("conditionAliasesJson", condition_aliases_json)?,
            global_style_blocks: parse_opt_value(
                "globalStyleBlocksJson",
                global_style_blocks_json,
            )?,
            keyframes_blocks: parse_opt_value("keyframesJson", keyframes_json)?,
            package_map: parse("packageResolutionJson", package_resolution_json)?,
            path_aliases,
            static_css,
            external_dirs: parse("externalDirsJson", external_dirs_json)?,
            dev_mode,
        })
    }
}

/// v1 manifest ComponentDescriptor (project_analyzer 1784-1793), the
/// plugin-consumed subset — field names match v1's serde output.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ComponentDescriptor {
    pub file: String,
    pub binding: String,
    pub class_name: String,
    pub extends_from: Option<String>,
    pub terminal: String,
    pub tag: String,
    pub replacement: String,
    pub system_prop_names: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CssDiagnostic {
    pub file: String,
    pub component: String,
    pub kind: String,
    pub message: String,
    /// Structured token path (`scale.key`) for diagnostics that reference a
    /// specific theme token — set only by the external-token candidate walk
    /// (cross-source correlation). Skipped from the manifest when absent, so
    /// every existing diagnostic serializes byte-identically.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

pub struct CssOutput {
    pub css: String,
    pub sheets: CssSheets,
    pub fragments: CssFragmentStore,
    pub diagnostics: Vec<CssDiagnostic>,
    pub reconciliation: Value,
    /// component_id → config-dependent replacement payloads (v1 Phase
    /// 5c/6 equivalents; consumed by engine.transform_file).
    pub replacement_configs: FxHashMap<String, crate::assemble::ReplacementPayload>,
    /// v1 manifest `system_prop_map` (utility class_map; key-sorted).
    pub system_prop_map: BTreeMap<String, BTreeMap<String, String>>,
    /// v1 manifest `dynamic_props` (global dynamic prop metadata; sorted).
    pub dynamic_props: BTreeMap<String, DynamicPropMeta>,
    /// v1 manifest `component_fragments` (per-component sheet fragments).
    pub component_fragments: BTreeMap<String, crate::css::PerComponentSheets>,
    /// v1 manifest `reverse_provenance` (parent → direct children, sorted).
    pub reverse_provenance: BTreeMap<String, Vec<String>>,
    /// v1 manifest `components` (id → descriptor; evaluated survivors).
    pub components: BTreeMap<String, ComponentDescriptor>,
    /// v1 manifest `files` (path → [component_ids]; evaluated survivors).
    pub files_map: BTreeMap<String, Vec<String>>,
    /// V2-native, additive per-site dynamic usage residue.
    pub usage_residue: Vec<UsageResidueRecord>,
}

/// v1 lib.rs:748 verbatim: breakpoints live under `breakpoints.` theme keys.
pub fn extract_breakpoints(theme: &FlatTheme) -> BreakpointMap {
    let mut bps = FxHashMap::default();
    for (key, value) in theme {
        if key.starts_with("breakpoints.") {
            let bp_name = key.strip_prefix("breakpoints.").unwrap();
            if let Ok(px) = value.parse::<u32>() {
                bps.insert(bp_name.to_string(), px);
            }
        }
    }
    BreakpointMap::new(bps)
}

/// v1 project_analyzer:2117 verbatim.
fn extract_layer_content(layer_block: &str) -> String {
    let trimmed = layer_block.trim();
    if let Some(start) = trimmed.find('{') {
        let after_brace = &trimmed[start + 1..];
        if let Some(end) = after_brace.rfind('}') {
            return after_brace[..end].to_string();
        }
    }
    String::new()
}

/// Resolve an import specifier against the analyzed file set — v1
/// resolve_path order: relative → alias+probe → package map. Re-export
/// hops are followed by the CALLER via follow_reexports.
pub fn resolve_import_source<T>(
    from_file: &str,
    spec: &str,
    files: &BTreeMap<String, T>,
    inputs: &CssInputs,
) -> Option<String> {
    // v1 resolve_path order (project_analyzer 528-536): relative →
    // expand_alias + probe → package-map lookup (path returned
    // UNCONDITIONALLY — a non-project path becomes a dangling external
    // root and the child stays standalone).
    if !spec.starts_with('.') {
        if let Some(expanded) = expand_alias(spec, &inputs.path_aliases) {
            return probe_files(&expanded, files);
        }
        return inputs.package_map.get(spec).cloned();
    }
    let dir: Vec<&str> = match from_file.rfind('/') {
        Some(pos) => from_file[..pos].split('/').collect(),
        None => Vec::new(),
    };
    let mut parts: Vec<&str> = dir;
    for seg in spec.split('/') {
        match seg {
            "." | "" => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    let base = parts.join("/");
    probe_files(&base, files)
}

/// v1 probe_known_files order EXACTLY (project_analyzer 2027-2047):
/// bare, .ts, .tsx, .js, .jsx, /index.ts, /index.tsx, /index.js,
/// /index.jsx — a sibling .ts/.tsx pair must resolve to the SAME parent
/// v1 picks (inc-07 review F3).
fn probe_files<T>(base: &str, files: &BTreeMap<String, T>) -> Option<String> {
    let candidates = [
        base.to_string(),
        format!("{base}.ts"),
        format!("{base}.tsx"),
        format!("{base}.js"),
        format!("{base}.jsx"),
        format!("{base}/index.ts"),
        format!("{base}/index.tsx"),
        format!("{base}/index.js"),
        format!("{base}/index.jsx"),
    ];
    candidates.into_iter().find(|c| files.contains_key(c))
}

/// Follow re-export chains (v1 import_resolver resolve_bindings): from
/// (file, exported name), hop through `export {{ X as Y }} from '...'`
/// links until a file that defines the name locally (or has no matching
/// re-export). Cycle-guarded; unresolvable hops stop at the last node
/// (dangling — v1 keeps the child standalone).
pub fn follow_reexports(
    mut file: String,
    mut name: String,
    files: &BTreeMap<String, FileFacts>,
    inputs: &CssInputs,
) -> (String, String) {
    let mut seen: FxHashSet<(String, String)> = FxHashSet::default();
    while seen.insert((file.clone(), name.clone())) {
        let Some(ff) = files.get(&file) else { break };
        let Some(exp) = ff
            .exports
            .iter()
            .find(|e| e.exported == name && e.source.is_some())
        else {
            break;
        };
        let (Some(spec), Some(original)) = (&exp.source, &exp.original) else {
            break;
        };
        let Some(next) = resolve_import_source(&file, spec, files, inputs) else {
            break;
        };
        name = original.clone();
        file = next;
    }
    (file, name)
}

/// Every complete `{...}` span remaining in a POST-resolution CSS value.
/// The resolver (theme.rs `resolve_single_alias`) passes unresolvable
/// `{scale.path}` aliases through verbatim, so any surviving brace-delimited
/// span IS an unresolved token alias — resolved aliases were replaced by
/// `var()` / theme literals, which never contain braces.
fn unresolved_alias_spans(value: &str) -> Vec<String> {
    if !value.contains('{') {
        return Vec::new();
    }
    let mut spans = Vec::new();
    let bytes = value.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        // '{' and '}' are ASCII; UTF-8 continuation bytes can't collide.
        if bytes[i] == b'{' {
            if let Some(rel) = value[i + 1..].find('}') {
                let end = i + 1 + rel;
                spans.push(value[i..=end].to_string());
                i = end + 1;
                continue;
            }
        }
        i += 1;
    }
    spans
}

/// extract-quirk-shed increment 01 (resolves DEF-4): an unresolvable token
/// alias SHALL NOT leak raw into emitted CSS (deterministic-extraction);
/// the carrying declaration is DROPPED and a warn diagnostic names the
/// component, CSS property, and unresolved alias (extraction-diagnostics).
/// v1 retains the raw passthrough until retirement — the resulting
/// v1-vs-v2 divergence is licensed in packages/_parity/register.json
/// (intentional-correctness entries for the css-validity witnesses).
fn shed_unresolved_alias_decls(
    decls: &mut Vec<CssDeclaration>,
    scale_family: &FxHashSet<String>,
    file: &str,
    component: &str,
    diagnostics: &mut Vec<CssDiagnostic>,
) {
    decls.retain(|d| {
        let spans = unresolved_alias_spans(&d.value);
        if spans.is_empty() {
            // Survives emission — but a token SHAPE on a scale-family property
            // still warns (emit-as-authored; see warn_token_shaped_value).
            warn_token_shaped_value(d, scale_family, file, component, diagnostics);
            return true;
        }
        diagnostics.push(CssDiagnostic {
            token: None,
            file: file.to_string(),
            component: component.to_string(),
            kind: "warn".to_string(),
            message: format!(
                "unresolvable token alias {} in '{}' — declaration dropped",
                spans.join(", "),
                d.property
            ),
        });
        false
    });
}

/// CSS properties whose values legitimately carry dotted bare identifiers, so a
/// dotted value there is NEVER evidence of an unresolved token: font stacks
/// (`Inter.var`), grid line/area names, `content` strings, counter and
/// animation/transition NAMES, and `will-change` property lists.
const TOKEN_SHAPE_EXEMPT_PROPERTIES: &[&str] = &[
    "font-family",
    "font",
    "grid-template-areas",
    "grid-area",
    "grid-row",
    "grid-column",
    "content",
    "counter-reset",
    "counter-increment",
    "animation-name",
    "animation",
    "transition-property",
    "will-change",
];

/// The kebab-case CSS properties that carry theme meaning: every property a
/// scale-bearing propConfig entry writes (`property` + fan-out `properties`),
/// plus the color-family pass-throughs that resolve against `colors` without a
/// propConfig entry. A token-shaped value is only suspicious on these.
fn scale_family_css_properties(config: &PropConfigMap) -> FxHashSet<String> {
    let mut props: FxHashSet<String> = FxHashSet::default();
    for pc in config.values() {
        if pc.scale.is_none() {
            continue;
        }
        props.insert(camel_to_kebab(&pc.property));
        for p in &pc.properties {
            props.insert(camel_to_kebab(p));
        }
    }
    for p in crate::theme::COLOR_FAMILY_PASS_THROUGH {
        props.insert(camel_to_kebab(p));
    }
    props
}

/// A BARE dotted token path — `^[A-Za-z][\w-]*(\.[\w-]+)+$`. Only `[A-Za-z0-9_-]`
/// and the separating dots are admitted, so anything carrying whitespace, a
/// comma, a paren (`url(...)`, `var(...)`), a quote, `#`, `%` or a non-ASCII
/// char is rejected outright — as is a leading `-` (custom properties) and a
/// trailing dot (`transforms.`). A value of this shape is never valid standalone
/// CSS for a color or a length, which is what makes the warn safe to raise
/// without full grammar validation.
fn is_token_shaped_value(value: &str) -> bool {
    let mut chars = value.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() => {}
        _ => return false,
    }
    // Chars in the current dot-separated segment (the first is consumed above).
    let mut segment_len = 1usize;
    let mut dots = 0usize;
    for c in chars {
        if c == '.' {
            if segment_len == 0 {
                return false; // empty segment: `a..b`
            }
            dots += 1;
            segment_len = 0;
        } else if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
            segment_len += 1;
        } else {
            return false;
        }
    }
    dots >= 1 && segment_len > 0
}

/// A token-SHAPED literal surviving on a scale-family property is a token that
/// failed to resolve — `bg: 'accent.solid'` reaching CSS as `accent.solid`.
/// The declaration is EMITTED AS AUTHORED (a browser discards the invalid
/// declaration on its own, and the value may be legal under another named
/// theme, forced through by staticCss, or arrive via a spread whose provenance
/// extraction cannot see); the diagnostic is the entire value of this check.
fn warn_token_shaped_value(
    decl: &CssDeclaration,
    scale_family: &FxHashSet<String>,
    file: &str,
    component: &str,
    diagnostics: &mut Vec<CssDiagnostic>,
) {
    if decl.property.starts_with("--")
        || TOKEN_SHAPE_EXEMPT_PROPERTIES.contains(&decl.property.as_str())
        || !scale_family.contains(&decl.property)
        || !is_token_shaped_value(&decl.value)
    {
        return;
    }
    diagnostics.push(CssDiagnostic {
            token: None,
        file: file.to_string(),
        component: component.to_string(),
        kind: "warn".to_string(),
        message: format!(
            "token-shaped value '{}' in '{}' did not resolve — likely an unresolved token: \
             check the key against the theme. The declaration is emitted as authored and \
             will be ignored by browsers.",
            decl.value, decl.property
        ),
    });
}

/// CSS property → theme scale NAME, for every propConfig entry whose scale is
/// a string reference (`property` + fan-out `properties`), plus the
/// color-family pass-throughs → `colors`. Inline object/array scales resolve
/// locally and never correspond to theme tokens, so they contribute nothing.
fn scale_name_by_css_property(config: &PropConfigMap) -> FxHashMap<String, String> {
    let mut map: FxHashMap<String, String> = FxHashMap::default();
    for pc in config.values() {
        let Some(Value::String(scale)) = &pc.scale else {
            continue;
        };
        map.insert(camel_to_kebab(&pc.property), scale.clone());
        for p in &pc.properties {
            map.insert(camel_to_kebab(p), scale.clone());
        }
    }
    for p in crate::theme::COLOR_FAMILY_PASS_THROUGH {
        map.entry(camel_to_kebab(p))
            .or_insert_with(|| "colors".to_string());
    }
    map
}

/// A value that could be an unresolved SCALE KEY: a single bare segment or a
/// dotted path over `[A-Za-z0-9_-]` (leading digits admitted — numeric scale
/// keys are common). Resolved outputs (`var(...)`, `#hex`, values with
/// whitespace/commas/quotes) are rejected by shape. Deliberately broad — the
/// TS-side join only reports a candidate whose token the SOURCE package's own
/// manifest defines, which is what keeps CSS literals silent.
fn is_scale_key_shaped_value(value: &str) -> bool {
    let mut segment_len = 0usize;
    for (i, c) in value.chars().enumerate() {
        if c == '.' {
            if segment_len == 0 {
                return false; // leading dot or empty segment
            }
            segment_len = 0;
        } else if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
            if i == 0 && c == '-' {
                return false; // custom-property / negative-value shapes
            }
            segment_len += 1;
        } else {
            return false;
        }
    }
    segment_len > 0
}

fn record_external_candidates_in_decls(
    decls: &[CssDeclaration],
    scale_names: &FxHashMap<String, String>,
    file: &str,
    component: &str,
    diagnostics: &mut Vec<CssDiagnostic>,
) {
    for d in decls {
        if d.property.starts_with("--") {
            continue;
        }
        // An unresolved brace alias already carries its full token path and
        // may sit on ANY property (`boxShadow: '0 0 8px {colors.glow}'`); a
        // bare or dotted survivor is only a candidate on a scale-qualified,
        // non-exempt property, qualified by that property's scale name.
        let spans = unresolved_alias_spans(&d.value);
        let tokens: Vec<String> = if spans.is_empty() {
            if TOKEN_SHAPE_EXEMPT_PROPERTIES.contains(&d.property.as_str()) {
                continue;
            }
            let Some(scale) = scale_names.get(&d.property) else {
                continue;
            };
            if !is_scale_key_shaped_value(&d.value) {
                continue;
            }
            vec![format!("{}.{}", scale, d.value)]
        } else {
            spans
                .iter()
                .map(|s| {
                    let content = s.trim_matches(|c| c == '{' || c == '}');
                    // `{colors.primary/40}` alpha syntax: the token is the
                    // path before the alpha suffix.
                    content.split('/').next().unwrap_or(content).to_string()
                })
                .collect()
        };
        for token in tokens {
            diagnostics.push(CssDiagnostic {
                token: Some(token.clone()),
                file: file.to_string(),
                component: component.to_string(),
                kind: "external-token-candidate".to_string(),
                message: format!(
                    "'{}' in '{}' did not resolve against the consumer theme",
                    token, d.property
                ),
            });
        }
    }
}

fn record_external_candidates_in_styles(
    styles: &ResolvedStyles,
    scale_names: &FxHashMap<String, String>,
    file: &str,
    component: &str,
    diagnostics: &mut Vec<CssDiagnostic>,
) {
    record_external_candidates_in_decls(
        &styles.declarations,
        scale_names,
        file,
        component,
        diagnostics,
    );
    for (_, decls) in &styles.pseudo_selectors {
        record_external_candidates_in_decls(decls, scale_names, file, component, diagnostics);
    }
    for group in &styles.conditioned {
        record_external_candidates_in_decls(
            &group.declarations,
            scale_names,
            file,
            component,
            diagnostics,
        );
    }
}

/// The external-token candidate walk (extraction-diagnostics: cross-source
/// correlation). Runs only for components whose file lives under a declared
/// external package dir, BEFORE the alias shed — so unresolved brace aliases
/// are still present and contribute their token paths. Candidates use their
/// own diagnostic kind, which the default plugin surfacing drops (unknown
/// kind): the TS-side correlation join owns their presentation after checking
/// each token against the source package's captured manifest.
fn record_external_token_candidates(
    css: &ComponentCss,
    scale_names: &FxHashMap<String, String>,
    file: &str,
    component: &str,
    diagnostics: &mut Vec<CssDiagnostic>,
) {
    if let Some(base) = css.base.as_ref() {
        record_external_candidates_in_styles(base, scale_names, file, component, diagnostics);
    }
    for vc in &css.variants {
        for (_, styles) in &vc.options {
            record_external_candidates_in_styles(styles, scale_names, file, component, diagnostics);
        }
    }
    for styles in &css.compounds {
        record_external_candidates_in_styles(styles, scale_names, file, component, diagnostics);
    }
    for (_, styles) in &css.states {
        record_external_candidates_in_styles(styles, scale_names, file, component, diagnostics);
    }
}

/// Is this rootDir-relative file under one of the declared external dirs?
fn is_external_file(file: &str, external_dirs: &[String]) -> bool {
    external_dirs.iter().any(|dir| {
        let dir = dir.trim_end_matches('/');
        !dir.is_empty() && file.strip_prefix(dir).is_some_and(|rest| rest.starts_with('/'))
    })
}

fn shed_unresolved_aliases_in_styles(
    styles: &mut ResolvedStyles,
    scale_family: &FxHashSet<String>,
    file: &str,
    component: &str,
    diagnostics: &mut Vec<CssDiagnostic>,
) {
    shed_unresolved_alias_decls(
        &mut styles.declarations,
        scale_family,
        file,
        component,
        diagnostics,
    );
    for (_, decls) in &mut styles.pseudo_selectors {
        shed_unresolved_alias_decls(decls, scale_family, file, component, diagnostics);
    }
    for group in &mut styles.conditioned {
        shed_unresolved_alias_decls(
            &mut group.declarations,
            scale_family,
            file,
            component,
            diagnostics,
        );
    }
}

/// extract-quirk-shed increment 02: a builder chain dropped because stage
/// evaluation failed emits a bail diagnostic naming the file, binding, and
/// failing stage (extraction-diagnostics) — silent disappearance from the
/// manifest no longer occurs. The chain still drops and its source file
/// stays untransformed for that chain (existing behavior; only the
/// diagnostic is new). v1 keeps the empty Err arm (project_analyzer
/// 967-969) until retirement — the resulting diagnostics divergence is
/// licensed in packages/_parity/register.json.
fn emit_eval_drop_bail(
    diagnostics: &mut Vec<CssDiagnostic>,
    file: &str,
    binding: &str,
    stage: &str,
    detail: &str,
) {
    diagnostics.push(CssDiagnostic {
            token: None,
        file: file.to_string(),
        component: binding.to_string(),
        kind: "bail".to_string(),
        message: format!(
            "chain dropped: stage '{}' evaluation failed — {}",
            stage, detail
        ),
    });
}

/// Resolve one compose slot's LOCAL binding to the class of the component it
/// names (ANI-004). Slot values are identifiers at the compose() callsite, so
/// the owning file decides what they mean: the file's own component first,
/// then whatever its import (following re-exports) brought the name in from.
/// An aliased import — `import { Root as CardRoot }` — resolves through the
/// same path, which bare-name matching could never do.
fn resolve_compose_slot_class<'a>(
    family_file: &str,
    binding: &str,
    files: &BTreeMap<String, FileFacts>,
    inputs: &CssInputs,
    id_to_class: &FxHashMap<&str, &'a str>,
) -> Option<&'a str> {
    let local_id = format!("{}::{}", family_file, binding);
    if let Some(class) = id_to_class.get(local_id.as_str()) {
        return Some(class);
    }
    let imported = files
        .get(family_file)?
        .imports
        .iter()
        .find(|import| import.local == binding)?;
    let source_file = resolve_import_source(family_file, &imported.source, files, inputs)?;
    let (defining_file, defining_name) =
        follow_reexports(source_file, imported.imported.clone(), files, inputs);
    let defining_id = format!("{}::{}", defining_file, defining_name);
    id_to_class.get(defining_id.as_str()).copied()
}

/// extract ANI-004: a compose slot whose binding names no extracted component
/// — neither in the composing file nor through its imports — no longer
/// disappears silently. The slot still drops from the composed variant CSS
/// (existing behavior); only the diagnostic is new. Under the retired
/// bare-name scheme this case could also resolve to the WRONG component when
/// two files shared a local recipe name.
fn emit_compose_slot_bail(
    diagnostics: &mut Vec<CssDiagnostic>,
    file: &str,
    family_name: &str,
    slot_name: &str,
    binding: &str,
) {
    diagnostics.push(CssDiagnostic {
            token: None,
        file: file.to_string(),
        component: family_name.to_string(),
        kind: "bail".to_string(),
        message: format!(
            "compose slot '{}' names binding '{}', which resolves to no extracted \
             component in this file or through its imports — composed variant CSS dropped",
            slot_name, binding
        ),
    });
}

/// Walk every ResolvedStyles surface of a freshly evaluated component
/// (base, variant options, compounds, states) — runs BEFORE the extension
/// merge, so parent contributions pulled from `evaluated` are already shed
/// (each leak is diagnosed once, on its defining component).
fn shed_unresolved_aliases(
    css: &mut ComponentCss,
    scale_family: &FxHashSet<String>,
    file: &str,
    component: &str,
    diagnostics: &mut Vec<CssDiagnostic>,
) {
    if let Some(base) = css.base.as_mut() {
        shed_unresolved_aliases_in_styles(base, scale_family, file, component, diagnostics);
    }
    for vc in &mut css.variants {
        for (_, styles) in &mut vc.options {
            shed_unresolved_aliases_in_styles(styles, scale_family, file, component, diagnostics);
        }
    }
    for styles in &mut css.compounds {
        shed_unresolved_aliases_in_styles(styles, scale_family, file, component, diagnostics);
    }
    for (_, styles) in &mut css.states {
        shed_unresolved_aliases_in_styles(styles, scale_family, file, component, diagnostics);
    }
}

pub fn run(
    files: &BTreeMap<String, FileFacts>,
    order: &[String],
    inputs: &CssInputs,
    class_prefix: &str,
) -> CssOutput {
    run_with_system_floor(files, order, inputs, class_prefix, true)
}

// ---------------------------------------------------------------------------
// Canonical usage identity
// ---------------------------------------------------------------------------
//
// Every usage-side map below is keyed by a COMPONENT ID
// (`{defining_file}::{binding}`), never by a bare binding name: two files
// exporting the same component name must not pool their JSX usage, or
// reconciliation — and, in a production build, ELIMINATION — is decided by
// the wrong callsites.
//
// `resolve_usage_identity` is the single producer of those keys. The lookup
// maps handed to the JSX filter carry two disjoint key spaces: component ids
// (which always contain `::`) and bare binding names (JS identifiers, which
// never do). The bare-name space is the fallback layer described on the
// resolver; it is what keeps unique-name corpora byte-identical.

/// bare binding → the component ids that define it, in `sorted_ids` order.
type IdsByBinding = FxHashMap<String, Vec<String>>;

/// The bare binding of a component id. Used ONLY for human-facing report
/// text and the residue record — never as a map key.
fn binding_of(component_id: &str) -> &str {
    component_id
        .rfind("::")
        .map(|pos| &component_id[pos + 2..])
        .unwrap_or(component_id)
}

/// Resolve the LOCAL name `local`, as written in `file`, to the canonical
/// component ids it can name.
///
/// Order:
///  1. a component DEFINED in this file wins (`{file}::{local}`);
///  2. an import is resolved through `resolve_import_source` to the file the
///     name is imported FROM (`{source}::{imported}`);
///  3. otherwise the bare-name fallback applies — against the IMPORTED name
///     when the name came from an import, against the local name otherwise.
///
/// The fallback is what reproduces v1's global-by-name usage maps for every
/// name that resolves to exactly one component; it also decides the
/// AMBIGUOUS case (a bare name defined by several files with no usable
/// import) by returning EVERY candidate. Attributing to all possible origins
/// is the only choice that cannot eliminate CSS that v1 kept: dropping the
/// attribution would silently prune the variants observed at that callsite,
/// and picking one arbitrarily would prune them for the losers.
///
/// Re-export chains are deliberately NOT followed here (unlike extension
/// provenance, which does follow them): v1's Phase-5b matches the imported
/// name against the usage maps BY NAME, and the `aliased-reexport` corpus
/// unit pins that a component reached only through a renaming barrel stays
/// UNATTRIBUTED — which makes the scan identity-uncertain and therefore
/// conservative. Following the chain here would start attributing it, and
/// reconciliation would begin pruning its variants.
///
/// An empty result means "not a known component": the caller keeps the
/// scanner's existing unknown-tag handling.
fn resolve_usage_identity(
    file: &str,
    local: &str,
    files: &BTreeMap<String, FileFacts>,
    inputs: &CssInputs,
    evaluated_ids: &FxHashSet<String>,
    ids_by_binding: &IdsByBinding,
) -> Vec<String> {
    let local_id = format!("{}::{}", file, local);
    if evaluated_ids.contains(&local_id) {
        return vec![local_id];
    }
    if let Some(imp) = files
        .get(file)
        .and_then(|ff| ff.imports.iter().find(|i| i.local == local))
    {
        if let Some(source_file) = resolve_import_source(file, &imp.source, files, inputs) {
            let imported_id = format!("{}::{}", source_file, imp.imported);
            if evaluated_ids.contains(&imported_id) {
                return vec![imported_id];
            }
        }
        return ids_by_binding
            .get(&imp.imported)
            .cloned()
            .unwrap_or_default();
    }
    ids_by_binding.get(local).cloned().unwrap_or_default()
}

/// The maps the per-file JSX filter consults, plus the attribution map that
/// turns whatever the filter recorded back into component ids. All four are
/// keyed by the same LOOKUP KEY space (component ids + bare bindings), so a
/// key present in one is present in the others' key space by construction.
#[derive(Default, Clone)]
struct UsageLookupMaps {
    props: ComponentPropSetMap,
    configs: FxHashMap<String, ComponentUsageConfig>,
    custom_props: ComponentPropSetMap,
    attribution: IdsByBinding,
}

/// Per-component authoritative maps, keyed by component id.
struct UsageSourceMaps {
    props: ComponentPropSetMap,
    configs: FxHashMap<String, ComponentUsageConfig>,
    custom_props: ComponentPropSetMap,
}

impl UsageLookupMaps {
    /// Publish one lookup key resolving to `ids`. Values are the UNION over
    /// the candidates: the filter only ever reads key SETS (which props are
    /// active, which attribute names are variants/states), so a union is the
    /// sound view for an ambiguous name and is exactly the single
    /// component's view for an unambiguous one.
    fn publish(&mut self, key: &str, ids: &[String], source: &UsageSourceMaps) {
        if ids.is_empty() {
            return;
        }
        self.attribution.insert(key.to_string(), ids.to_vec());

        let mut props: FxHashSet<String> = FxHashSet::default();
        let mut custom: FxHashSet<String> = FxHashSet::default();
        let mut config = ComponentUsageConfig::default();
        for id in ids {
            if let Some(p) = source.props.get(id) {
                props.extend(p.iter().cloned());
            }
            if let Some(c) = source.custom_props.get(id) {
                custom.extend(c.iter().cloned());
            }
            if let Some(c) = source.configs.get(id) {
                for (prop, (options, default_option)) in &c.variants {
                    let entry = config
                        .variants
                        .entry(prop.clone())
                        .or_insert_with(|| (FxHashSet::default(), None));
                    entry.0.extend(options.iter().cloned());
                    if entry.1.is_none() {
                        entry.1 = default_option.clone();
                    }
                }
                config.states.extend(c.states.iter().cloned());
            }
        }
        // v1 keeps NO entry for a component with no active props; an empty
        // set and a missing key behave identically downstream, but the
        // missing key is what the emptiness gates observe.
        if !props.is_empty() {
            self.props.insert(key.to_string(), props);
        }
        if !custom.is_empty() {
            self.custom_props.insert(key.to_string(), custom);
        }
        if ids.iter().any(|id| source.configs.contains_key(id)) {
            self.configs.insert(key.to_string(), config);
        }
    }
}

/// Reachability + attribution over component ids. Replaces v1's
/// bare-binding "canonical floor": the scan already records lookup keys, so
/// this only maps them through `attribution` and records what stayed
/// unattributable.
#[derive(Default)]
struct UsageIdentityPolicy {
    rendered_ids: FxHashSet<String>,
    uncertain: bool,
}

impl UsageIdentityPolicy {
    /// Component ids for a recorded lookup key.
    ///
    /// An unresolvable key is the same conservative signal v1 raised when
    /// its canonical floor failed: the whole run goes identity-uncertain.
    /// The record is KEPT under the unresolved key rather than dropped —
    /// system-prop records feed the utility stream by (prop, value) with the
    /// binding unread, and dropping them would delete utility CSS v1 emits.
    /// Under id keying an unresolved key simply matches no component.
    fn resolve_all(&mut self, key: &str, attribution: &IdsByBinding) -> Vec<String> {
        match attribution.get(key) {
            Some(ids) => ids.clone(),
            None => {
                self.uncertain = true;
                vec![key.to_string()]
            }
        }
    }

    /// One representative id, for records whose binding is not read
    /// downstream. `None` leaves the record's key untouched.
    fn resolve_one(&mut self, key: &str, attribution: &IdsByBinding) -> Option<String> {
        match attribution.get(key) {
            Some(ids) => ids.first().cloned(),
            None => {
                self.uncertain = true;
                None
            }
        }
    }

    fn attribute_system_usages(
        &mut self,
        usages: &mut [SystemPropUsage],
        attribution: &IdsByBinding,
    ) {
        // The binding is not read downstream (only prop/value are), so one
        // representative id keeps the record shape without fanning out.
        for usage in usages {
            if let Some(id) = self.resolve_one(&usage.binding, attribution) {
                usage.binding = id;
            }
        }
    }

    fn attribute_dynamic_usages(
        &mut self,
        usages: &mut Vec<DynamicPropUsage>,
        attribution: &IdsByBinding,
    ) {
        let taken = std::mem::take(usages);
        for usage in taken {
            for binding in self.resolve_all(&usage.binding, attribution) {
                usages.push(DynamicPropUsage {
                    prop_name: usage.prop_name.clone(),
                    binding,
                });
            }
        }
    }

    fn attribute_result(&mut self, result: &mut UsageScanResult, attribution: &IdsByBinding) {
        self.uncertain |= result.identity_uncertain;
        self.attribute_system_usages(&mut result.system_prop_usages, attribution);
        self.attribute_dynamic_usages(&mut result.dynamic_prop_usages, attribution);

        for site in &mut result.residue_sites {
            if let Some(id) = self.resolve_one(&site.binding, attribution) {
                site.binding = id;
            }
        }

        let variant_usages = std::mem::take(&mut result.variant_usages);
        for usage in variant_usages {
            for component_binding in self.resolve_all(&usage.component_binding, attribution) {
                result.variant_usages.push(crate::jsx_scan::VariantUsage {
                    component_binding,
                    variant_prop: usage.variant_prop.clone(),
                    value: usage.value.clone(),
                });
            }
        }

        let state_usages = std::mem::take(&mut result.state_usages);
        for usage in state_usages {
            for component_binding in self.resolve_all(&usage.component_binding, attribution) {
                result.state_usages.push(crate::jsx_scan::StateUsage {
                    component_binding,
                    state_name: usage.state_name.clone(),
                });
            }
        }

        let rendered = std::mem::take(&mut result.rendered_components);
        for key in rendered {
            for id in self.resolve_all(&key, attribution) {
                self.rendered_ids.insert(id.clone());
                result.rendered_components.insert(id);
            }
        }
    }

    fn include(&mut self, component_id: String) {
        self.rendered_ids.insert(component_id);
    }

    fn conservative_rendered_ids(&self, evaluated_ids: &FxHashSet<String>) -> FxHashSet<String> {
        if self.uncertain {
            evaluated_ids.clone()
        } else {
            self.rendered_ids.clone()
        }
    }
}

/// Re-key an id-keyed ledger by bare binding, unioning same-named entries.
/// staticCss is USER configuration that names components by binding, so the
/// forced-vs-observed comparison happens in that name space.
fn project_ledger_to_bindings(
    ledger: &crate::reconcile::UsageLedger,
) -> crate::reconcile::UsageLedger {
    let mut out = crate::reconcile::UsageLedger::default();
    for component_id in &ledger.rendered_components {
        out.rendered_components
            .insert(binding_of(component_id).to_string());
    }
    for (component_id, props) in &ledger.variant_usage {
        let entry = out
            .variant_usage
            .entry(binding_of(component_id).to_string())
            .or_default();
        for (prop, options) in props {
            entry
                .entry(prop.clone())
                .or_default()
                .extend(options.iter().cloned());
        }
    }
    for (component_id, states) in &ledger.state_usage {
        out.state_usage
            .entry(binding_of(component_id).to_string())
            .or_default()
            .extend(states.iter().cloned());
    }
    out
}

/// Expand staticCss's binding-named synthetic usage onto every component of
/// that name — a forced declaration is a statement about the NAME, so it
/// keeps every component that answers to it (v1 behavior, since v1's ledger
/// was name-keyed throughout).
fn expand_forced_scan(scan: UsageScanResult, ids_by_binding: &IdsByBinding) -> UsageScanResult {
    let ids_for = |binding: &str| ids_by_binding.get(binding).cloned().unwrap_or_default();
    let mut out = UsageScanResult {
        // System-prop values ride the utility stream by (prop, value); the
        // pseudo-binding is never attributed to a component.
        system_prop_usages: scan.system_prop_usages,
        identity_uncertain: scan.identity_uncertain,
        ..Default::default()
    };
    for binding in &scan.rendered_components {
        for id in ids_for(binding) {
            out.rendered_components.insert(id);
        }
    }
    for usage in &scan.variant_usages {
        for id in ids_for(&usage.component_binding) {
            out.variant_usages.push(crate::jsx_scan::VariantUsage {
                component_binding: id,
                variant_prop: usage.variant_prop.clone(),
                value: usage.value.clone(),
            });
        }
    }
    for usage in &scan.state_usages {
        for id in ids_for(&usage.component_binding) {
            out.state_usages.push(crate::jsx_scan::StateUsage {
                component_binding: id,
                state_name: usage.state_name.clone(),
            });
        }
    }
    out
}

fn collect_reachable_active_prop_names<'a>(
    components: impl IntoIterator<Item = (&'a str, Option<&'a FxHashSet<String>>)>,
    reachable_ids: &FxHashSet<String>,
    identity_uncertain: bool,
) -> FxHashSet<String> {
    components
        .into_iter()
        .filter(|(component_id, _)| identity_uncertain || reachable_ids.contains(*component_id))
        .filter_map(|(_, active_props)| active_props)
        .flat_map(|props| props.iter().cloned())
        .collect()
}

fn sorted_resolvable_component_ids(
    files: &BTreeMap<String, FileFacts>,
    parent_map: &FxHashMap<String, String>,
    unresolvable_extensions: &FxHashSet<String>,
) -> Vec<String> {
    let mut all_component_ids: Vec<String> = files
        .iter()
        .flat_map(|(file_path, file)| {
            file.chains.iter().filter_map(move |chain| {
                if !chain.descriptor.extractable {
                    return None;
                }

                let id = format!("{}::{}", file_path, chain.descriptor.binding);
                (!unresolvable_extensions.contains(&id)).then_some(id)
            })
        })
        .collect();
    all_component_ids.sort();

    let nodes: Vec<ProvenanceNode> = all_component_ids
        .iter()
        .map(|id| ProvenanceNode {
            component_id: id.clone(),
            parent_id: parent_map.get(id).cloned(),
        })
        .collect();

    match topological_sort(&nodes) {
        TopoResult::Sorted(order) => order,
        TopoResult::Cycle(cycle_ids) => {
            let cycle_set: FxHashSet<&String> = cycle_ids.iter().collect();
            all_component_ids
                .into_iter()
                .filter(|id| !cycle_set.contains(id))
                .collect()
        }
    }
}

fn run_with_system_floor(
    files: &BTreeMap<String, FileFacts>,
    order: &[String],
    inputs: &CssInputs,
    class_prefix: &str,
    total_system_floor: bool,
) -> CssOutput {
    let breakpoints = extract_breakpoints(&inputs.theme);
    let bp_keys: FxHashSet<String> = breakpoints.breakpoints.keys().cloned().collect();
    let evaluator = TransformEvaluator::new();
    let mut diagnostics: Vec<CssDiagnostic> = Vec::new();

    // Register extracted createTransform sources (v1 750-762) — INPUT
    // order, so cross-file name collisions keep last-registration-wins.
    for path in order {
        let Some(ff) = files.get(path) else { continue };
        for t in &ff.transforms {
            if t.valid {
                if let Err(err) = evaluator.register(&t.name, &t.source) {
                    diagnostics.push(CssDiagnostic {
            token: None,
                        file: t.file.clone(),
                        component: format!("createTransform('{}')", t.name),
                        kind: "warn".to_string(),
                        message: format!("Failed to register transform in evaluator: {}", err),
                    });
                }
            }
        }
    }

    // Invalid-transform bail diagnostics (v1 1928-1940; emitted at
    // manifest build in v1 — multiset position is what the harness
    // compares, so emission point here is equivalent).
    for path in order {
        let Some(ff) = files.get(path) else { continue };
        for t in &ff.transforms {
            if !t.valid {
                for diag in &t.diagnostics {
                    diagnostics.push(CssDiagnostic {
            token: None,
                        file: t.file.clone(),
                        component: format!("createTransform('{}')", t.name),
                        kind: "bail".to_string(),
                        message: diag.clone(),
                    });
                }
            }
        }
    }

    let resolve_ctx = ResolveContext {
        config: &inputs.config,
        theme: &inputs.theme,
        variable_map: &inputs.variable_map,
        contextual_vars: &inputs.contextual_vars,
        breakpoint_keys: &bp_keys,
        selector_aliases: &inputs.selector_aliases,
        condition_aliases: &inputs.condition_aliases,
        transform_evaluator: Some(&evaluator),
    };

    // -- Phase 3 mirror: extension provenance -------------------------------
    let mut parent_map: FxHashMap<String, String> = FxHashMap::default();
    let mut unresolvable_extensions: FxHashSet<String> = FxHashSet::default();
    let has_extractable = |file: &str, binding: &str| -> bool {
        files.get(file).is_some_and(|ff| {
            ff.chains
                .iter()
                .any(|c| c.descriptor.binding == binding && c.descriptor.extractable)
        })
    };
    for (file_path, ff) in files {
        for chain in &ff.chains {
            let d = &chain.descriptor;
            if !d.extractable {
                if let Some(reason) = &d.bail_reason {
                    diagnostics.push(CssDiagnostic {
            token: None,
                        file: file_path.clone(),
                        component: d.binding.clone(),
                        kind: "bail".to_string(),
                        message: reason.clone(),
                    });
                }
                continue;
            }
            let component_id = format!("{}::{}", file_path, d.binding);
            if let Some(extends_binding) = &d.extends_from {
                let imported = ff.imports.iter().find(|i| &i.local == extends_binding);
                let resolved = match imported {
                    // v1 binding_map records ANY resolvable export — no
                    // chain check; a parent id that never evaluates is an
                    // external root in the topo and the child is kept
                    // STANDALONE, not dropped (inc-07 review F3).
                    Some(imp) => {
                        resolve_import_source(file_path, &imp.source, files, inputs).map(|f| {
                            let (pf, pn) = follow_reexports(f, imp.imported.clone(), files, inputs);
                            format!("{}::{}", pf, pn)
                        })
                    }
                    None => {
                        if has_extractable(file_path, extends_binding) {
                            Some(format!("{}::{}", file_path, extends_binding))
                        } else {
                            None
                        }
                    }
                };
                match resolved {
                    Some(parent_id) => {
                        parent_map.insert(component_id, parent_id);
                    }
                    None => {
                        unresolvable_extensions.insert(component_id);
                    }
                }
            }
        }
    }

    // -- Phase 4 mirror: topological sort ------------------------------------
    let sorted_ids = sorted_resolvable_component_ids(files, &parent_map, &unresolvable_extensions);

    // chain lookup: id → (file, chain index)
    let mut chain_lookup: FxHashMap<&str, (&str, usize)> = FxHashMap::default();
    for (file_path, ff) in files {
        for (i, chain) in ff.chains.iter().enumerate() {
            if chain.descriptor.extractable {
                let id = format!("{}::{}", file_path, chain.descriptor.binding);
                if let Some(id_ref) = sorted_ids.iter().find(|s| **s == id) {
                    chain_lookup.insert(id_ref.as_str(), (file_path.as_str(), i));
                }
            }
        }
    }

    // -- Phase 5a mirror: evaluate chains (topo order) -----------------------
    type EvalEntry = (
        ComponentCss,
        String,       // binding
        TerminalKind, // terminal (asClass detection)
        Option<FxHashSet<String>>,
        Vec<String>, // active group names (sorted)
        Option<PropConfigMap>,
        Vec<(BTreeMap<String, Value>, String)>, // POST-MERGE compound configs
    );
    let mut evaluated: FxHashMap<String, EvalEntry> = FxHashMap::default();
    // Derived once per run — the properties on which a token SHAPE is suspicious.
    let scale_family_props = scale_family_css_properties(&inputs.config);
    // Derived once per run — CSS property → scale name, for qualifying
    // external-token candidates (empty external_dirs skips the walk entirely).
    let scale_names = if inputs.external_dirs.is_empty() {
        FxHashMap::default()
    } else {
        scale_name_by_css_property(&inputs.config)
    };
    let mut inherited_active_props: FxHashMap<String, FxHashSet<String>> = FxHashMap::default();

    for component_id in &sorted_ids {
        let Some((file_path, chain_idx)) = chain_lookup.get(component_id.as_str()) else {
            continue;
        };
        let chain = &files[*file_path].chains[*chain_idx];
        if let Some(fatal) = &chain.fatal_error {
            // Quirk shed 02 (v1 967-969 dropped these SILENTLY): the chain
            // still drops from the manifest, but the drop is diagnosed —
            // the failing stage is the one whose eval_error went fatal.
            let stage = chain
                .stages
                .iter()
                .find(|s| s.eval_error.is_some())
                .map_or("<unknown>", |s| s.method.as_str());
            emit_eval_drop_bail(
                &mut diagnostics,
                file_path,
                &chain.descriptor.binding,
                stage,
                fatal,
            );
            continue;
        }
        let result = process_chain_facts(chain, &resolve_ctx, &inputs.group_registry);
        match result {
            Ok(out) => {
                let mut component_css = out.component_css;
                let active_props = out.active_prop_names;
                let active_group_names = out.active_group_names;
                let custom_configs = out.custom_prop_configs;
                for warning in &out.skip_warnings {
                    diagnostics.push(CssDiagnostic {
            token: None,
                        file: file_path.to_string(),
                        component: chain.descriptor.binding.clone(),
                        kind: "skip".to_string(),
                        message: warning.clone(),
                    });
                }

                // Cross-source correlation: candidate walk BEFORE the shed so
                // unresolved brace aliases still carry their token paths.
                if is_external_file(file_path, &inputs.external_dirs) {
                    record_external_token_candidates(
                        &component_css,
                        &scale_names,
                        file_path,
                        &chain.descriptor.binding,
                        &mut diagnostics,
                    );
                }

                // Quirk shed 01: unresolvable-alias leak → drop declaration
                // + warn (v1 leaks the raw `{scale.path}` literal).
                shed_unresolved_aliases(
                    &mut component_css,
                    &scale_family_props,
                    file_path,
                    &chain.descriptor.binding,
                    &mut diagnostics,
                );

                // Own compound configs from facts (v1 process_chain:
                // sorted String|Array conditions + positional class).
                let mut compound_configs: Vec<(BTreeMap<String, Value>, String)> = Vec::new();
                {
                    let mut idx = 0usize;
                    for stage in &chain.stages {
                        // v1 lib.rs 536-554: config + index only for styled
                        // (two-arg) compounds.
                        if stage.method == "compound" && stage.second_value.is_some() {
                            if let Some(cond) = &stage.value {
                                let sorted: BTreeMap<String, Value> = cond
                                    .as_object()
                                    .map(|m| {
                                        m.iter()
                                            .filter(|(_, v)| v.is_string() || v.is_array())
                                            .map(|(k, v)| (k.clone(), v.clone()))
                                            .collect()
                                    })
                                    .unwrap_or_default();
                                compound_configs.push((
                                    sorted,
                                    format!("{}--compound-{}", component_css.class_name, idx),
                                ));
                                idx += 1;
                            }
                        }
                    }
                }

                // Extension merge (v1 840-931 verbatim over ComponentCss).
                if let Some(parent_id) = parent_map.get(component_id) {
                    if let Some((parent_css, _, _, _, _, _, parent_compound_configs)) =
                        evaluated.get(parent_id)
                    {
                        match (&parent_css.base, &component_css.base) {
                            (Some(parent_base), Some(child_base)) => {
                                let mut merged_decls = parent_base.declarations.clone();
                                let child_props: FxHashSet<&str> = child_base
                                    .declarations
                                    .iter()
                                    .map(|d| d.property.as_str())
                                    .collect();
                                merged_decls.retain(|d| !child_props.contains(d.property.as_str()));
                                merged_decls.extend(child_base.declarations.clone());

                                let mut merged_pseudos = parent_base.pseudo_selectors.clone();
                                for (sel, decls) in &child_base.pseudo_selectors {
                                    if let Some(entry) =
                                        merged_pseudos.iter_mut().find(|(s, _)| s == sel)
                                    {
                                        entry.1 = decls.clone();
                                    } else {
                                        merged_pseudos.push((sel.clone(), decls.clone()));
                                    }
                                }

                                // Extension merge: start from the parent's condition
                                // groups, then let the child's groups replace-by-key. The
                                // legacy two-bucket bug-compat only ever licensed dropping
                                // the child's SELECTOR-BEARING groups (nested selectors are
                                // inc 05); the child's selectorless breakpoint AND
                                // non-breakpoint (Media/Container/Supports) groups both
                                // carry through — breakpoints by name, conditions by
                                // (conditions, selector). Byte-safe: pre-inc-03 fixtures
                                // have no non-breakpoint groups, so this loop is a no-op
                                // for them (G1).
                                let mut merged = ResolvedStyles {
                                    declarations: merged_decls,
                                    pseudo_selectors: merged_pseudos,
                                    conditioned: parent_base.conditioned.clone(),
                                };
                                for (bp, decls) in child_base.breakpoint_groups() {
                                    let slot = merged.breakpoint_decls_mut(bp);
                                    *slot = decls.clone();
                                }
                                for child_group in &child_base.conditioned {
                                    // Selectorless single-breakpoint groups merged via
                                    // breakpoint_decls_mut above; every other shape —
                                    // incl. [Breakpoint]+selector (inc 05 review F2) —
                                    // replaces-by-(conditions, selector) or appends.
                                    let plain_breakpoint = matches!(
                                        child_group.emit_order,
                                        crate::theme::ConditionEmitOrder::Breakpoint
                                    ) && child_group.selector.is_none()
                                        && child_group.conditions.len() == 1;
                                    if plain_breakpoint {
                                        continue;
                                    }
                                    if let Some(existing) =
                                        merged.conditioned.iter_mut().find(|g| {
                                            g.conditions == child_group.conditions
                                                && g.selector == child_group.selector
                                        })
                                    {
                                        *existing = child_group.clone();
                                    } else {
                                        merged.conditioned.push(child_group.clone());
                                    }
                                }

                                component_css.base = Some(merged);
                            }
                            (Some(parent_base), None) => {
                                component_css.base = Some(parent_base.clone());
                            }
                            _ => {}
                        }

                        for pv in &parent_css.variants {
                            if !component_css.variants.iter().any(|v| v.prop == pv.prop) {
                                component_css.variants.push(VariantCss {
                                    prop: pv.prop.clone(),
                                    options: pv.options.clone(),
                                    default_option: pv.default_option.clone(),
                                });
                            }
                        }

                        for (name, styles) in &parent_css.states {
                            if !component_css.states.iter().any(|(n, _)| n == name) {
                                component_css.states.push((name.clone(), styles.clone()));
                            }
                        }

                        if !parent_css.compounds.is_empty() {
                            let mut merged_compounds = parent_css.compounds.clone();
                            merged_compounds.append(&mut component_css.compounds);
                            component_css.compounds = merged_compounds;
                        }

                        // v1 908-913: inherit compound configs, parent first.
                        //
                        // ANI-008: the inherited entries still carry the
                        // PARENT's class prefix and their original indices,
                        // while the emitter enumerates the merged
                        // `component_css.compounds` positionally under the
                        // CHILD's class (css.rs `generate_css_sheets_ordered`
                        // / `generate_layer_content`). Renumbering the whole
                        // flattened list here makes the runtime config agree
                        // with emission by construction — the two lists are
                        // built from the same two-arg compound stages, so
                        // index i names rule i. Field 7 is post-merge, so a
                        // grandchild renumbers an already-renumbered parent
                        // list and multi-level extension composes.
                        if !parent_compound_configs.is_empty() {
                            let mut merged_configs = parent_compound_configs.clone();
                            merged_configs.append(&mut compound_configs);
                            for (idx, (_, class)) in merged_configs.iter_mut().enumerate() {
                                *class =
                                    format!("{}--compound-{}", component_css.class_name, idx);
                            }
                            compound_configs = merged_configs;
                        }
                    }
                }

                // Active-prop inheritance (v1 933-960 verbatim).
                let mut merged_active_props: FxHashSet<String> = FxHashSet::default();
                if let Some(parent_id) = parent_map.get(component_id) {
                    if let Some(parent_inherited) = inherited_active_props.get(parent_id) {
                        merged_active_props.extend(parent_inherited.iter().cloned());
                    }
                    if let Some((_, _, _, Some(parent_active), _, _, _)) = evaluated.get(parent_id) {
                        merged_active_props.extend(parent_active.iter().cloned());
                    }
                }
                if let Some(ref own_props) = active_props {
                    merged_active_props.extend(own_props.iter().cloned());
                }
                if !merged_active_props.is_empty() {
                    inherited_active_props
                        .insert(component_id.clone(), merged_active_props.clone());
                }
                let final_active_props = if !merged_active_props.is_empty() {
                    Some(merged_active_props)
                } else {
                    active_props
                };

                evaluated.insert(
                    component_id.clone(),
                    (
                        component_css,
                        chain.descriptor.binding.clone(),
                        chain.descriptor.terminal.clone(),
                        final_active_props,
                        active_group_names,
                        custom_configs,
                        compound_configs,
                    ),
                );
            }
            Err((stage, detail)) => {
                // Quirk shed 02: same v1 967-969 mirror as the fatal_error
                // gate above — the post-facts eval path (e.g. a props()
                // config that evaluates statically but fails PropConfigMap
                // deserialization) bails loud instead of vanishing.
                emit_eval_drop_bail(
                    &mut diagnostics,
                    file_path,
                    &chain.descriptor.binding,
                    &stage,
                    &detail,
                );
            }
        }
    }

    // -- Phase 5b mirror: usage configs + scans ------------------------------
    // Authoritative per-component maps, keyed by component id.
    let evaluated_ids: FxHashSet<String> = evaluated.keys().cloned().collect();
    let mut ids_by_binding: IdsByBinding = FxHashMap::default();
    for component_id in &sorted_ids {
        if let Some((_, binding, _, _, _, _, _)) = evaluated.get(component_id) {
            ids_by_binding
                .entry(binding.clone())
                .or_default()
                .push(component_id.clone());
        }
    }

    let mut usage_sources = UsageSourceMaps {
        props: FxHashMap::default(),
        configs: FxHashMap::default(),
        custom_props: FxHashMap::default(),
    };
    for component_id in &sorted_ids {
        let Some((component_css, _, _, active_props, _, custom_configs, _)) =
            evaluated.get(component_id)
        else {
            continue;
        };

        let mut variants: FxHashMap<String, (FxHashSet<String>, Option<String>)> =
            FxHashMap::default();
        for vc in &component_css.variants {
            if vc.default_option.is_some() {
                let options: FxHashSet<String> =
                    vc.options.iter().map(|(name, _)| name.clone()).collect();
                variants.insert(vc.prop.clone(), (options, vc.default_option.clone()));
            }
        }
        let states: FxHashSet<String> = component_css
            .states
            .iter()
            .map(|(n, _)| n.clone())
            .collect();
        usage_sources.configs.insert(
            component_id.clone(),
            ComponentUsageConfig { variants, states },
        );

        let mut all_props: FxHashSet<String> = FxHashSet::default();
        if let Some(props) = active_props {
            all_props.extend(props.iter().cloned());
        }
        if let Some(cc) = custom_configs {
            all_props.extend(cc.keys().cloned());
        }
        if !all_props.is_empty() {
            usage_sources.props.insert(component_id.clone(), all_props);
        }

        if let Some(cc) = custom_configs {
            if !cc.is_empty() {
                usage_sources
                    .custom_props
                    .insert(component_id.clone(), cc.keys().cloned().collect());
            }
        }
    }

    // The global lookup layer: every component id under its own key, plus
    // the bare-name fallback layer (v1's global-by-name maps).
    let mut global_lookup = UsageLookupMaps::default();
    for component_id in &sorted_ids {
        if evaluated_ids.contains(component_id) {
            global_lookup.publish(
                component_id,
                std::slice::from_ref(component_id),
                &usage_sources,
            );
        }
    }
    for component_id in &sorted_ids {
        if let Some((_, binding, _, _, _, _, _)) = evaluated.get(component_id) {
            if !global_lookup.attribution.contains_key(binding) {
                let ids = ids_by_binding[binding].clone();
                global_lookup.publish(binding, &ids, &usage_sources);
            }
        }
    }

    // Families carry the path of the file whose compose() call declared them.
    // Slot names are the compose callsite's LOCAL identifiers, so the owning
    // file is what turns them into qualified component ids (ANI-004).
    let mut compose_families: Vec<(&String, &ComposeFamilyInfo)> = Vec::new();
    for path in order {
        if let Some(ff) = files.get(path) {
            compose_families.extend(ff.compose.iter().map(|family| (path, family)));
        }
    }
    // A member tag resolves to the SLOT's canonical origin, resolved in the
    // file that composed the family — not to the textual member tail and not
    // through the consuming file's own bindings. Unresolvable slots keep the
    // raw binding name so they land on the bare-name layer exactly as before.
    let resolve_slot_ids = |family_file: &str, binding_name: &str| -> Vec<String> {
        resolve_usage_identity(
            family_file,
            binding_name,
            files,
            inputs,
            &evaluated_ids,
            &ids_by_binding,
        )
    };
    let mut member_expr_bindings: FxHashMap<String, String> = FxHashMap::default();
    for (family_file, family) in &compose_families {
        if let Some(ref family_binding) = family.family_binding {
            for (slot_name, binding_name) in &family.slots {
                let ids = resolve_slot_ids(family_file, binding_name);
                let lookup_key = match ids.as_slice() {
                    [only] => only.clone(),
                    _ => binding_name.clone(),
                };
                member_expr_bindings
                    .insert(format!("{}.{}", family_binding, slot_name), lookup_key);
            }
        }
    }

    let mut all_utility_inputs: Vec<UtilityInput> = Vec::new();
    let mut all_custom_inputs: Vec<UtilityInput> = Vec::new();
    let mut all_custom_dynamic_usages: Vec<DynamicPropUsage> = Vec::new();
    let mut all_usage_results: Vec<UsageScanResult> = Vec::new();
    let mut usage_residue: Vec<UsageResidueRecord> = Vec::new();
    let mut identity_policy = UsageIdentityPolicy::default();

    for path in order {
        if global_lookup.props.is_empty()
            && global_lookup.custom_props.is_empty()
            && global_lookup.configs.is_empty()
        {
            break;
        }
        let Some(ff) = files.get(path) else { continue };

        // Per-file view (replaces v1's alias augmentation, 1147-1213): every
        // name this file BINDS is resolved through the canonical resolver,
        // and only the names whose resolution differs from the bare-name
        // layer are republished. For a codebase with unique component names
        // nothing differs and the global maps are used by reference — the
        // same fast path the alias check used to give.
        let mut file_lookup: Option<UsageLookupMaps> = None;
        let bound_names = ff
            .imports
            .iter()
            .map(|imp| (imp.local.as_str(), true))
            .chain(
                ff.chains
                    .iter()
                    .filter(|c| c.descriptor.extractable)
                    .map(|c| (c.descriptor.binding.as_str(), false)),
            );
        for (name, from_import) in bound_names {
            let ids =
                resolve_usage_identity(path, name, files, inputs, &evaluated_ids, &ids_by_binding);
            if ids.is_empty() {
                // An IMPORTED name that resolves to nothing extractable is
                // v1's canonical-floor failure: the tag still reads as a
                // component (the lookup entry stays) but nothing may be
                // attributed to it, and the run goes conservative. A name
                // bound only by a local chain that did not evaluate keeps
                // the bare-name layer, exactly as v1's floor did.
                if from_import && global_lookup.attribution.contains_key(name) {
                    file_lookup
                        .get_or_insert_with(|| global_lookup.clone())
                        .attribution
                        .remove(name);
                }
                continue;
            }
            if global_lookup.attribution.get(name) == Some(&ids) {
                continue;
            }
            file_lookup
                .get_or_insert_with(|| global_lookup.clone())
                .publish(name, &ids, &usage_sources);
        }
        let lookup = file_lookup.as_ref().unwrap_or(&global_lookup);

        let mut usage_result = crate::usage_facts::filter_usage_scan(
            ff.usage_for_analysis(),
            &lookup.props,
            &lookup.configs,
            &member_expr_bindings,
        );
        identity_policy.attribute_result(&mut usage_result, &lookup.attribution);

        usage_residue.extend(
            usage_result
                .residue_sites
                .iter()
                .map(|site| UsageResidueRecord {
                    // The record is a consumer surface: it names the
                    // component, not the internal key.
                    binding: binding_of(&site.binding).to_string(),
                    prop: site.prop_name.clone(),
                    file: path.clone(),
                    span: site.span,
                    kind: site.kind,
                }),
        );

        all_utility_inputs.extend(
            usage_result
                .system_prop_usages
                .iter()
                .map(|u| UtilityInput {
                    prop_name: u.prop_name.clone(),
                    value: u.value.clone(),
                }),
        );

        if !lookup.custom_props.is_empty() {
            let mut custom_scan = crate::usage_facts::filter_custom_prop_scan(
                ff.usage_for_analysis(),
                &lookup.custom_props,
                &member_expr_bindings,
            );
            identity_policy
                .attribute_system_usages(&mut custom_scan.static_usages, &lookup.attribution);
            identity_policy
                .attribute_dynamic_usages(&mut custom_scan.dynamic_usages, &lookup.attribution);
            all_custom_inputs.extend(custom_scan.static_usages.iter().map(|u| UtilityInput {
                prop_name: u.prop_name.clone(),
                value: u.value.clone(),
            }));
            all_custom_dynamic_usages.extend(custom_scan.dynamic_usages.iter().cloned());
        }

        all_usage_results.push(usage_result);
    }

    usage_residue.sort_by(|a, b| {
        (&a.file, a.span.start, a.span.end, &a.binding, &a.prop).cmp(&(
            &b.file,
            b.span.start,
            b.span.end,
            &b.binding,
            &b.prop,
        ))
    });

    // -- Forced-emission overrides (spec: static-emission-overrides) ---------
    // Synthetic usage rides the ordinary ledger/utility/dynamic streams;
    // forced counts are labeled against the observed-only ledger.
    let forced_report = if let Some(static_css) = inputs.static_css.as_ref() {
        let known_bindings: FxHashSet<String> = evaluated
            .values()
            .map(|(_, binding, _, _, _, _, _)| binding.clone())
            .collect();
        let mut custom_props_by_binding: FxHashMap<String, FxHashSet<String>> =
            FxHashMap::default();
        for (_, binding, _, _, _, custom_configs, _) in evaluated.values() {
            if let Some(cc) = custom_configs {
                custom_props_by_binding
                    .entry(binding.clone())
                    .or_default()
                    .extend(cc.keys().cloned());
            }
        }
        let observed_variant_configs: crate::reconcile::VariantConfigMap = usage_sources
            .configs
            .iter()
            .map(|(component_id, config)| (component_id.clone(), config.variants.clone()))
            .collect();
        // staticCss names components by BINDING (it is user configuration,
        // not an internal key), so the observed ledger is projected back to
        // bindings for the forced-vs-observed comparison, and the synthetic
        // usage it returns is expanded to every component of that name.
        let observed_ledger = project_ledger_to_bindings(&crate::reconcile::build_ledger(
            &all_usage_results,
            &observed_variant_configs,
        ));

        // Forced-emission metadata covers EVERY declared variant.
        // component_usage_configs deliberately drops variants without a
        // default_option (they never participate in usage reconciliation and
        // are always emitted in full), but staticCss must still recognize
        // them as declared — validation and forced counting run against this
        // full map, while forced_usage only synthesizes ledger usage for
        // default-bearing props.
        let declared_usage_configs: FxHashMap<String, ComponentUsageConfig> = sorted_ids
            .iter()
            .filter_map(|component_id| evaluated.get(component_id))
            .map(|(component_css, binding, _, _, _, _, _)| {
                let variants: FxHashMap<String, (FxHashSet<String>, Option<String>)> =
                    component_css
                        .variants
                        .iter()
                        .map(|vc| {
                            let options: FxHashSet<String> =
                                vc.options.iter().map(|(name, _)| name.clone()).collect();
                            (vc.prop.clone(), (options, vc.default_option.clone()))
                        })
                        .collect();
                let states: FxHashSet<String> = component_css
                    .states
                    .iter()
                    .map(|(n, _)| n.clone())
                    .collect();
                (binding.clone(), ComponentUsageConfig { variants, states })
            })
            .collect();

        let injection = crate::forced_usage::build_forced_injection(
            static_css,
            &known_bindings,
            &declared_usage_configs,
            &custom_props_by_binding,
            &|prop| inputs.config.contains_key(prop),
            &observed_ledger,
        );

        diagnostics.extend(injection.warnings.iter().cloned());
        for binding in &injection.forced_bindings {
            for component_id in ids_by_binding.get(binding).into_iter().flatten() {
                identity_policy.include(component_id.clone());
            }
        }
        all_utility_inputs.extend(injection.utility_values.iter().map(
            |(prop_name, value)| UtilityInput {
                prop_name: prop_name.clone(),
                value: value.clone(),
            },
        ));
        for usage in &injection.custom_dynamic {
            for component_id in ids_by_binding.get(&usage.binding).into_iter().flatten() {
                all_custom_dynamic_usages.push(DynamicPropUsage {
                    prop_name: usage.prop_name.clone(),
                    binding: component_id.clone(),
                });
            }
        }
        all_usage_results.push(expand_forced_scan(injection.scan, &ids_by_binding));
        Some(injection.report)
    } else {
        None
    };

    // Dynamic prop metadata (v1 1247-1289).
    let detected_dynamic_prop_names: FxHashSet<String> = all_usage_results
        .iter()
        .flat_map(|r| r.dynamic_prop_usages.iter())
        .map(|d| d.prop_name.clone())
        .collect();
    for component_id in &sorted_ids {
        if let Some((_, _, terminal, _, _, _, _)) = evaluated.get(component_id) {
            if *terminal == TerminalKind::AsClass {
                identity_policy.include(component_id.clone());
            }
        }
    }
    for (family_file, family) in &compose_families {
        for (_, binding) in &family.slots {
            for component_id in resolve_slot_ids(family_file, binding) {
                identity_policy.include(component_id);
            }
        }
    }
    for parent_id in parent_map.values() {
        if evaluated.contains_key(parent_id) {
            identity_policy.include(parent_id.clone());
        }
    }
    let reachable_ids = identity_policy.conservative_rendered_ids(&evaluated_ids);
    let active_system_prop_names = collect_reachable_active_prop_names(
        sorted_ids.iter().filter_map(|component_id| {
            evaluated
                .get(component_id)
                .map(|(_, _, _, active_props, _, _, _)| {
                    (component_id.as_str(), active_props.as_ref())
                })
        }),
        &reachable_ids,
        identity_policy.uncertain,
    );
    let dynamic_prop_names = if total_system_floor {
        active_system_prop_names
    } else {
        detected_dynamic_prop_names
    };

    let mut dynamic_props: HashMap<String, DynamicPropMeta> = HashMap::new();
    for prop_name in &dynamic_prop_names {
        if let Some(prop_config) = inputs.config.get(prop_name.as_str()) {
            let kebab = camel_to_kebab(prop_name);
            let mut scale_values: BTreeMap<String, String> = BTreeMap::new();
            if let Some(Value::String(scale_name)) = &prop_config.scale {
                let prefix = format!("{}.", scale_name);
                for (theme_key, css_value) in &inputs.theme {
                    if let Some(scale_key) = theme_key.strip_prefix(&prefix) {
                        scale_values.insert(scale_key.to_string(), css_value.clone());
                    }
                }
            }
            dynamic_props.insert(
                prop_name.clone(),
                DynamicPropMeta {
                    var_name: format!("--{}-{}", class_prefix, kebab),
                    slot_class: format!("{}-dyn-{}", class_prefix, kebab),
                    property: prop_config.property.clone(),
                    properties: prop_config.properties.clone(),
                    transform_name: prop_config.transform.clone(),
                    transform_fn_source: prop_config.transform_fn_source.clone(),
                    scale_values,
                },
            );
        }
    }
    let slot_entries = if !dynamic_props.is_empty() {
        Some(build_variable_slot_entries(&dynamic_props, &breakpoints))
    } else {
        None
    };

    // Global custom config union + inline-transform filtering (v1 1291-1316).
    let mut global_custom_config: PropConfigMap = PropConfigMap::default();
    for component_id in &sorted_ids {
        if let Some((_, _, _, _, _, Some(custom_configs), _)) = evaluated.get(component_id) {
            global_custom_config.extend(custom_configs.clone());
        }
    }
    let inline_transform_props: FxHashSet<String> = global_custom_config
        .iter()
        .filter(|(_, config)| config.transform_fn_source.is_some())
        .map(|(name, _)| name.clone())
        .collect();
    if !inline_transform_props.is_empty() {
        all_custom_inputs.retain(|input| !inline_transform_props.contains(&input.prop_name));
        all_utility_inputs.retain(|input| !inline_transform_props.contains(&input.prop_name));
    }

    let utility_output = if !all_utility_inputs.is_empty() || slot_entries.is_some() {
        Some(generate_utility_css(
            &all_utility_inputs,
            &resolve_ctx,
            &breakpoints,
            slot_entries,
            class_prefix,
        ))
    } else {
        None
    };

    // Per-component custom dynamic metadata (v1 1325-1447).
    let mut custom_dynamic_by_id: FxHashMap<String, FxHashSet<String>> = FxHashMap::default();
    for dyn_usage in &all_custom_dynamic_usages {
        custom_dynamic_by_id
            .entry(dyn_usage.binding.clone())
            .or_default()
            .insert(dyn_usage.prop_name.clone());
    }
    if !inline_transform_props.is_empty() {
        for component_id in &sorted_ids {
            if let Some((_, _, _, _, _, Some(custom_configs), _)) = evaluated.get(component_id) {
                for prop_name in custom_configs.keys() {
                    if inline_transform_props.contains(prop_name) {
                        custom_dynamic_by_id
                            .entry(component_id.clone())
                            .or_default()
                            .insert(prop_name.clone());
                    }
                }
            }
        }
    }

    let mut per_component_custom_dynamic: FxHashMap<String, HashMap<String, DynamicPropMeta>> =
        FxHashMap::default();
    let mut all_custom_slot_entries: Vec<(String, ResolvedStyles, String)> = Vec::new();
    for component_id in &sorted_ids {
        let Some((component_css, _, _, _, _, custom_configs, _)) = evaluated.get(component_id)
        else {
            continue;
        };
        let Some(cc) = custom_configs else { continue };
        let Some(dynamic_props_for_binding) = custom_dynamic_by_id.get(component_id) else {
            continue;
        };
        let mut component_dynamic: HashMap<String, DynamicPropMeta> = HashMap::new();
        let class_hash = component_css
            .class_name
            .rsplit('-')
            .next()
            .unwrap_or(&component_css.class_name);
        let hash8 = &class_hash[..class_hash.len().min(8)];
        for prop_name in dynamic_props_for_binding {
            if let Some(prop_config) = cc.get(prop_name) {
                let kebab = camel_to_kebab(prop_name);
                let mut scale_values: BTreeMap<String, String> = BTreeMap::new();
                match &prop_config.scale {
                    Some(Value::String(scale_name)) => {
                        let prefix = format!("{}.", scale_name);
                        for (theme_key, css_value) in &inputs.theme {
                            if let Some(scale_key) = theme_key.strip_prefix(&prefix) {
                                scale_values.insert(scale_key.to_string(), css_value.clone());
                            }
                        }
                    }
                    Some(Value::Object(inline_scale)) => {
                        let css_prop = camel_to_kebab(&prop_config.property);
                        for (key, val) in inline_scale {
                            let resolved = if let Some(s) = val.as_str() {
                                s.to_string()
                            } else if let Some(n) = val.as_f64() {
                                crate::css::apply_unit_fallback_for_property(n, &css_prop)
                            } else {
                                val.to_string()
                            };
                            scale_values.insert(key.clone(), resolved);
                        }
                    }
                    _ => {}
                }
                component_dynamic.insert(
                    prop_name.clone(),
                    DynamicPropMeta {
                        var_name: format!("--{}-{}", class_prefix, kebab),
                        slot_class: format!("{}-dyn-{}-{}", class_prefix, hash8, kebab),
                        property: prop_config.property.clone(),
                        properties: prop_config.properties.clone(),
                        transform_name: prop_config.transform.clone(),
                        transform_fn_source: prop_config.transform_fn_source.clone(),
                        scale_values,
                    },
                );
            }
        }
        if !component_dynamic.is_empty() {
            all_custom_slot_entries.extend(build_variable_slot_entries(
                &component_dynamic,
                &breakpoints,
            ));
            per_component_custom_dynamic.insert(component_id.clone(), component_dynamic);
        }
    }
    let custom_slot_entries = if !all_custom_slot_entries.is_empty() {
        Some(all_custom_slot_entries)
    } else {
        None
    };

    let custom_output = if !all_custom_inputs.is_empty() || custom_slot_entries.is_some() {
        Some(generate_custom_prop_css(
            &all_custom_inputs,
            &global_custom_config,
            &resolve_ctx,
            &breakpoints,
            custom_slot_entries,
            class_prefix,
        ))
    } else {
        None
    };

    // -- Phase 5c mirror: replacement payloads --------------------------------
    let mut replacement_configs: FxHashMap<String, crate::assemble::ReplacementPayload> =
        FxHashMap::default();
    for component_id in &sorted_ids {
        let Some((_, _, _, active_props, group_names, custom_configs, compound_configs)) =
            evaluated.get(component_id)
        else {
            continue;
        };
        let mut all_prop_names: Vec<String> = Vec::new();
        if let Some(props) = active_props {
            all_prop_names.extend(props.iter().cloned());
        }
        if let Some(cc) = custom_configs {
            all_prop_names.extend(cc.keys().cloned());
        }
        all_prop_names.sort();
        all_prop_names.dedup();

        let mut custom_prop_class_map: Option<HashMap<String, HashMap<String, String>>> = None;
        if let Some(cc) = custom_configs {
            if !cc.is_empty() {
                if let Some(ref custom_out) = custom_output {
                    let mut component_class_map: HashMap<String, HashMap<String, String>> =
                        HashMap::new();
                    for prop_name in cc.keys() {
                        if let Some(val_map) = custom_out.class_map.get(prop_name) {
                            component_class_map.insert(prop_name.clone(), val_map.clone());
                        }
                    }
                    if !component_class_map.is_empty() {
                        custom_prop_class_map = Some(component_class_map);
                    }
                }
            }
        }

        let has_system_dynamic_props = active_props
            .as_ref()
            .is_some_and(|props| props.iter().any(|name| dynamic_prop_names.contains(name)));
        let has_custom_dynamic_props = per_component_custom_dynamic
            .get(component_id)
            .is_some_and(|config| !config.is_empty());
        let has_dynamic_props = has_system_dynamic_props || has_custom_dynamic_props;

        // Extension children get the POST-MERGE config trio (v1 908-929).
        let merged_config = if parent_map.contains_key(component_id) {
            let (component_css, ..) = &evaluated[component_id];
            Some(crate::assemble::MergedChainConfig {
                variant_config: component_css
                    .variants
                    .iter()
                    .map(|vc| {
                        (
                            vc.prop.clone(),
                            vc.options.iter().map(|(name, _)| name.clone()).collect(),
                            vc.default_option.clone(),
                        )
                    })
                    .collect(),
                compound_configs: compound_configs.clone(),
                state_names: component_css
                    .states
                    .iter()
                    .map(|(n, _)| n.clone())
                    .collect(),
            })
        } else {
            None
        };

        replacement_configs.insert(
            component_id.clone(),
            crate::assemble::ReplacementPayload {
                system_prop_names: all_prop_names,
                system_group_names: group_names.clone(),
                has_dynamic_props,
                custom_prop_class_map,
                custom_dynamic_config: per_component_custom_dynamic.get(component_id).cloned(),
                merged_config,
            },
        );
    }

    // -- Phase 5d mirror: usage ledger ---------------------------------------
    let variant_configs_for_ledger: VariantConfigMap = usage_sources
        .configs
        .iter()
        .map(|(component_id, config)| (component_id.clone(), config.variants.clone()))
        .collect();

    let mut usage_ledger = build_ledger(&all_usage_results, &variant_configs_for_ledger);
    usage_ledger
        .rendered_components
        .extend(reachable_ids.iter().cloned());

    for component_id in &sorted_ids {
        if let Some((_, _, terminal, _, _, _, _)) = evaluated.get(component_id) {
            if *terminal == TerminalKind::AsClass {
                usage_ledger
                    .rendered_components
                    .insert(component_id.clone());
            }
        }
    }
    for (family_file, family) in &compose_families {
        for (_slot_name, binding_name) in &family.slots {
            for component_id in resolve_slot_ids(family_file, binding_name) {
                usage_ledger.rendered_components.insert(component_id);
            }
        }
    }
    for (family_file, family) in &compose_families {
        for (_slot_name, binding_name) in &family.slots {
            if *binding_name == family.root_binding {
                continue;
            }
            for component_id in resolve_slot_ids(family_file, binding_name) {
                for shared_key in &family.shared_keys {
                    if let Some(variant_config) = variant_configs_for_ledger
                        .get(&component_id)
                        .and_then(|vc| vc.get(shared_key))
                    {
                        let used_set = usage_ledger
                            .variant_usage
                            .entry(component_id.clone())
                            .or_default()
                            .entry(shared_key.clone())
                            .or_default();
                        for option in &variant_config.0 {
                            used_set.insert(option.clone());
                        }
                    }
                }
            }
        }
    }

    // -- Phase 5e mirror: reconcile ------------------------------------------
    let mut reconciled_components: Vec<(String, ComponentCss)> = sorted_ids
        .iter()
        .filter_map(|component_id| {
            evaluated
                .get(component_id)
                .map(|(component_css, _, _, _, _, _, _)| {
                    (component_id.clone(), component_css.clone())
                })
        })
        .collect();

    // Parents are kept regardless of usage; the id is the parent itself, not
    // every component that happens to share its name.
    let parent_ids: FxHashSet<String> = parent_map.values().cloned().collect();

    let reconciliation = if inputs.dev_mode {
        let prospective =
            identify_prospective_eliminations(&reconciled_components, &usage_ledger, &parent_ids);
        let mut report = crate::reconcile::ReconciliationReport {
            components_total: reconciled_components.len(),
            components_extracted: reconciled_components.len(),
            eliminated_details: prospective,
            ..Default::default()
        };
        if let Some(forced) = &forced_report {
            crate::forced_usage::merge_into_report(&mut report, forced);
        }
        serde_json::to_value(&report).unwrap_or(serde_json::json!({}))
    } else {
        let mut report = reconcile(&mut reconciled_components, &usage_ledger, &parent_ids);
        if let Some(forced) = &forced_report {
            crate::forced_usage::merge_into_report(&mut report, forced);
        }
        serde_json::to_value(&report).unwrap_or(serde_json::json!({}))
    };

    // -- Phase 6b mirror: CSS generation --------------------------------------
    let reconciled_order: Vec<String> = reconciled_components
        .iter()
        .map(|(id, _)| id.clone())
        .collect();
    let component_css_list: Vec<ComponentCss> = reconciled_components
        .into_iter()
        .map(|(_, css)| css)
        .collect();

    let (mut sheets, fragments) = generate_css_sheets_ordered(
        &component_css_list,
        &breakpoints,
        &reconciled_order,
        class_prefix,
    );

    // Phase 6c: composed variant CSS.
    let mut composed_variant_css = String::new();
    if !compose_families.is_empty() {
        // Keyed by component_id, not by bare binding: two files may define the
        // same local recipe name (ANI-004), and a bare-name map let whichever
        // one hashed last win for every family in the universe.
        let id_to_class: FxHashMap<&str, &str> = evaluated
            .iter()
            .map(|(id, (css, _, _, _, _, _, _))| (id.as_str(), css.class_name.as_str()))
            .collect();
        let mut family_refs: Vec<ComposeFamilyRef> = Vec::new();
        for (family_file, family) in &compose_families {
            let Some(root_class) = resolve_compose_slot_class(
                family_file,
                &family.root_binding,
                files,
                inputs,
                &id_to_class,
            ) else {
                emit_compose_slot_bail(
                    &mut diagnostics,
                    family_file,
                    &family.name,
                    "Root",
                    &family.root_binding,
                );
                continue;
            };
            let mut child_slots: Vec<(&str, &str)> = Vec::new();
            for (slot_name, binding) in &family.slots {
                if slot_name == "Root" {
                    continue;
                }
                match resolve_compose_slot_class(
                    family_file,
                    binding,
                    files,
                    inputs,
                    &id_to_class,
                ) {
                    Some(class) => child_slots.push((binding.as_str(), class)),
                    None => emit_compose_slot_bail(
                        &mut diagnostics,
                        family_file,
                        &family.name,
                        slot_name,
                        binding,
                    ),
                }
            }
            if child_slots.is_empty() {
                continue;
            }
            family_refs.push(ComposeFamilyRef {
                root_class,
                child_slots,
                shared_keys: &family.shared_keys,
            });
        }
        if !family_refs.is_empty() {
            composed_variant_css =
                generate_composed_variant_css(&family_refs, &component_css_list, &breakpoints);
        }
    }

    // Unconditional variants sublayering (v1 1675-1694 verbatim).
    {
        let standalone_content = extract_layer_content(&sheets.variants);
        let variants_layer = layer_name("variants");
        let mut sublayered = String::new();
        writeln!(sublayered, "@layer {} {{", variants_layer).unwrap();
        writeln!(sublayered, "  @layer standalone, composed;").unwrap();
        if !standalone_content.is_empty() {
            writeln!(sublayered, "  @layer standalone {{").unwrap();
            sublayered.push_str(&standalone_content);
            writeln!(sublayered, "  }}").unwrap();
        }
        writeln!(sublayered, "  @layer composed {{").unwrap();
        sublayered.push_str(&composed_variant_css);
        writeln!(sublayered, "  }}").unwrap();
        writeln!(sublayered, "}}").unwrap();
        sheets.variants = sublayered;
    }

    if let Some(util_out) = &utility_output {
        if !util_out.css.is_empty() {
            sheets.system = util_out.css.clone();
        }
    }
    if let Some(custom_out) = &custom_output {
        if !custom_out.css.is_empty() {
            sheets.custom = custom_out.css.clone();
        }
    }

    // Global style blocks + keyframes → sheets.global (v1 1708-1736).
    let global_css_raw = if let Some(blocks) = &inputs.global_style_blocks {
        crate::theme::resolve_all_global_blocks(blocks, &resolve_ctx)
    } else {
        String::new()
    };
    let keyframes_css_raw = if let Some(blocks) = &inputs.keyframes_blocks {
        crate::theme::resolve_all_keyframes_blocks(blocks, &resolve_ctx)
    } else {
        String::new()
    };
    let mut combined_global = String::new();
    if !global_css_raw.is_empty() {
        combined_global.push_str(&global_css_raw);
    }
    if !keyframes_css_raw.is_empty() {
        if !combined_global.is_empty() {
            combined_global.push('\n');
        }
        combined_global.push_str(&keyframes_css_raw);
    }
    if !combined_global.is_empty() {
        sheets.global = format!(
            "@layer {} {{\n{}\n}}\n",
            layer_name("global"),
            combined_global
        );
    }

    // Concatenated CSS (v1 1738-1748; global excluded — flows via sheets).
    let mut css = sheets.declaration.clone();
    css.push('\n');
    for sheet in [
        &sheets.base,
        &sheets.variants,
        &sheets.compounds,
        &sheets.states,
        &sheets.system,
        &sheets.custom,
    ] {
        if !sheet.is_empty() {
            css.push_str(sheet);
            css.push('\n');
        }
    }

    // Manifest observables (v1 1922-1994).
    let system_prop_map: BTreeMap<String, BTreeMap<String, String>> = utility_output
        .as_ref()
        .map(|u| {
            u.class_map
                .iter()
                .map(|(k, v)| {
                    (
                        k.clone(),
                        v.iter().map(|(a, b)| (a.clone(), b.clone())).collect(),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    let dynamic_props_sorted: BTreeMap<String, DynamicPropMeta> =
        dynamic_props.into_iter().collect();
    let component_fragments: BTreeMap<String, crate::css::PerComponentSheets> =
        fragments.to_per_component_map().into_iter().collect();
    // v1 Phase 7 components/files maps (evaluated survivors only).
    let mut components: BTreeMap<String, ComponentDescriptor> = BTreeMap::new();
    let mut files_map: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for component_id in &sorted_ids {
        let Some((file_path, chain_idx)) = chain_lookup.get(component_id.as_str()) else {
            continue;
        };
        let Some((component_css, binding, terminal, _, _, _, _)) = evaluated.get(component_id)
        else {
            continue;
        };
        let chain = &files[*file_path].chains[*chain_idx];
        let payload = replacement_configs.get(component_id);
        let replacement = crate::assemble::generate_replacement(
            file_path,
            chain,
            class_prefix,
            payload,
            &inputs.group_registry,
        )
        .unwrap_or_default();
        let terminal_str = match terminal {
            TerminalKind::AsElement => "asElement",
            TerminalKind::AsComponent => "asComponent",
            TerminalKind::AsClass => "asClass",
        };
        components.insert(
            component_id.clone(),
            ComponentDescriptor {
                file: file_path.to_string(),
                binding: binding.clone(),
                class_name: component_css.class_name.clone(),
                extends_from: parent_map.get(component_id).cloned(),
                terminal: terminal_str.to_string(),
                tag: chain.descriptor.tag.clone(),
                replacement,
                system_prop_names: payload
                    .map(|p| p.system_prop_names.clone())
                    .unwrap_or_default(),
            },
        );
        files_map
            .entry(file_path.to_string())
            .or_default()
            .push(component_id.clone());
    }

    let mut reverse_provenance: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for component_id in &sorted_ids {
        // v1 builds provenance only for EVALUATED survivors (Phase 7
        // components_map gate; inc-07 review F8).
        if !evaluated.contains_key(component_id) {
            continue;
        }
        if let Some(parent_id) = parent_map.get(component_id) {
            reverse_provenance
                .entry(parent_id.clone())
                .or_default()
                .push(component_id.clone());
        }
    }
    for children in reverse_provenance.values_mut() {
        children.sort();
    }

    CssOutput {
        css,
        sheets,
        fragments,
        diagnostics,
        reconciliation,
        replacement_configs,
        system_prop_map,
        dynamic_props: dynamic_props_sorted,
        component_fragments,
        reverse_provenance,
        components,
        files_map,
        usage_residue,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::facts::extract_file_facts_with_prefix;
    use crate::owned_ast::{OwnedAst, ParseCounter};

    fn analyze(entries: &[(&str, &str)], inputs: &CssInputs) -> CssOutput {
        analyze_with_total_system_floor(entries, inputs, true)
    }

    fn analyze_with_total_system_floor(
        entries: &[(&str, &str)],
        inputs: &CssInputs,
        total_system_floor: bool,
    ) -> CssOutput {
        let counter = ParseCounter::new(0);
        let mut files = BTreeMap::new();
        let mut order = Vec::new();
        for (path, source) in entries {
            let ast = OwnedAst::parse(path.to_string(), source.to_string(), &counter);
            files.insert(
                path.to_string(),
                extract_file_facts_with_prefix(&ast, "animus"),
            );
            order.push(path.to_string());
        }
        run_with_system_floor(&files, &order, inputs, "animus", total_system_floor)
    }

    fn test_inputs() -> CssInputs {
        let mut inputs = CssInputs::from_json(
            None,
            None,
            None,
            Some(r#"{"p": {"property": "padding", "scale": "space"}, "display": {"property": "display"}}"#),
            Some(r#"{"space": ["p", "m"]}"#),
            None,
            None, // condition_aliases_json
            None,
            None,
            None,
            None,
            None,
            None,
            false,
        )
        .unwrap();
        inputs.theme.insert("space.8".into(), "0.5rem".into());
        inputs.theme.insert("breakpoints.sm".into(), "480".into());
        inputs
    }

    fn assert_uncertain_identity_widens_and_retains(out: &CssOutput) {
        assert!(
            out.dynamic_props.contains_key("p"),
            "{:?}",
            out.dynamic_props.keys()
        );
        assert!(
            out.dynamic_props.contains_key("display"),
            "{:?}",
            out.dynamic_props.keys()
        );
        assert!(
            out.sheets.base.contains("display: flex"),
            "{}",
            out.sheets.base
        );
        assert!(
            out.sheets.base.contains("display: grid"),
            "{}",
            out.sheets.base
        );
        assert_eq!(out.reconciliation["components_eliminated"], 0);
    }

    fn analyze_uncertain_identity(render: &str) -> CssOutput {
        let source = format!(
            "export const Box = ds.system({{ space: true }}).styles({{ display: 'flex' }}).asElement('div');\n\
             export const Grid = ds.system({{ display: true }}).styles({{ display: 'grid' }}).asElement('div');\n\
             {render}\n"
        );
        analyze(&[("a.tsx", source.as_str())], &test_inputs())
    }

    #[test]
    fn component_order_excludes_unresolvable_extensions_and_sorts_parents_first() {
        let counter = ParseCounter::new(0);
        let mut files = BTreeMap::new();
        for (path, source) in [
            (
                "base.tsx",
                "export const Base = ds.styles({ display: 'block' }).asElement('div');",
            ),
            (
                "child.tsx",
                "export const Child = ds.styles({ display: 'flex' }).asElement('div');",
            ),
            (
                "skip.tsx",
                "export const Skip = ds.styles({ display: 'grid' }).asElement('div');",
            ),
        ] {
            let ast = OwnedAst::parse(path.to_string(), source.to_string(), &counter);
            files.insert(
                path.to_string(),
                extract_file_facts_with_prefix(&ast, "animus"),
            );
        }

        let parent_map =
            FxHashMap::from_iter([("child.tsx::Child".to_string(), "base.tsx::Base".to_string())]);
        let unresolvable_extensions = FxHashSet::from_iter(["skip.tsx::Skip".to_string()]);

        assert_eq!(
            sorted_resolvable_component_ids(&files, &parent_map, &unresolvable_extensions),
            vec!["base.tsx::Base", "child.tsx::Child"]
        );
    }

    #[test]
    fn component_order_omits_cycles_and_keeps_survivors_sorted() {
        let counter = ParseCounter::new(0);
        let mut files = BTreeMap::new();
        for (path, source) in [
            (
                "cycle-a.tsx",
                "export const CycleA = ds.styles({ display: 'block' }).asElement('div');",
            ),
            (
                "cycle-b.tsx",
                "export const CycleB = ds.styles({ display: 'flex' }).asElement('div');",
            ),
            (
                "survivors.tsx",
                "export const Z = ds.styles({ display: 'grid' }).asElement('div');\n\
                 export const A = ds.styles({ display: 'inline' }).asElement('div');",
            ),
        ] {
            let ast = OwnedAst::parse(path.to_string(), source.to_string(), &counter);
            files.insert(
                path.to_string(),
                extract_file_facts_with_prefix(&ast, "animus"),
            );
        }

        let parent_map = FxHashMap::from_iter([
            (
                "cycle-a.tsx::CycleA".to_string(),
                "cycle-b.tsx::CycleB".to_string(),
            ),
            (
                "cycle-b.tsx::CycleB".to_string(),
                "cycle-a.tsx::CycleA".to_string(),
            ),
        ]);

        assert_eq!(
            sorted_resolvable_component_ids(&files, &parent_map, &FxHashSet::default()),
            vec!["survivors.tsx::A", "survivors.tsx::Z"]
        );
    }

    #[test]
    fn import_source_resolution_follows_v1_order() {
        // relative → alias-expand+probe → package map (v1 528-536).
        let mut files: BTreeMap<String, ()> = BTreeMap::new();
        files.insert("src/ui/button.tsx".into(), ());
        files.insert("lib/theme.ts".into(), ());
        let mut inputs = CssInputs::default();
        inputs.path_aliases.push(AliasEntry {
            pattern: "@ui/".into(),
            replacement: "src/ui/".into(),
            alias_type: AliasType::Prefix,
        });
        inputs
            .package_map
            .insert("@corp/tokens".into(), "vendor/tokens.ts".into());

        assert_eq!(
            resolve_import_source("src/app.tsx", "./ui/button", &files, &inputs).as_deref(),
            Some("src/ui/button.tsx")
        );
        assert_eq!(
            resolve_import_source("x.tsx", "@ui/button", &files, &inputs).as_deref(),
            Some("src/ui/button.tsx")
        );
        // Package map returns the path UNCONDITIONALLY (dangling roots ok).
        assert_eq!(
            resolve_import_source("x.tsx", "@corp/tokens", &files, &inputs).as_deref(),
            Some("vendor/tokens.ts")
        );
        assert_eq!(
            resolve_import_source("x.tsx", "not-mapped", &files, &inputs),
            None
        );
    }

    #[test]
    fn base_css_flows_through_sheets_and_layers() {
        let out = analyze(
            &[(
                "a.tsx",
                "export const C = ds.styles({ p: 8, display: 'flex' }).asElement('div');\nexport const App = () => <C />;\n",
            )],
            &test_inputs(),
        );
        assert!(
            out.sheets.base.contains("padding: 0.5rem"),
            "{}",
            out.sheets.base
        );
        assert!(
            out.css.starts_with("@layer anm-global, anm-base"),
            "{}",
            out.css
        );
        assert!(out.sheets.variants.contains("@layer standalone, composed;"));
    }

    #[test]
    fn unused_component_is_reconciled_away_in_prod() {
        let out = analyze(
            &[(
                "a.tsx",
                "export const Used = ds.styles({ display: 'flex' }).asElement('div');\nexport const Unused = ds.styles({ display: 'grid' }).asElement('div');\nexport const App = () => <Used />;\n",
            )],
            &test_inputs(),
        );
        assert!(out.sheets.base.contains("flex"));
        assert!(!out.sheets.base.contains("grid"), "{}", out.sheets.base);
    }

    #[test]
    fn dev_mode_keeps_unused_components() {
        let mut inputs = test_inputs();
        inputs.dev_mode = true;
        let out = analyze(
            &[(
                "a.tsx",
                "export const Unused = ds.styles({ display: 'grid' }).asElement('div');\n",
            )],
            &inputs,
        );
        assert!(out.sheets.base.contains("grid"));
    }

    #[test]
    fn unresolvable_alias_declaration_dropped_with_warn_diagnostic() {
        // extract-quirk-shed inc 01: raw `{scale.path}` leaks are shed, not
        // emitted; each dropped declaration gets a warn naming component,
        // property, and alias.
        let out = analyze(
            &[(
                "a.tsx",
                "export const Broken = ds.styles({ display: 'flex', border: '1px solid {colors.missing}', '&:hover': { outline: '2px solid {colors.gone.999}' } }).asElement('div');\nexport const App = () => <Broken />;\n",
            )],
            &test_inputs(),
        );
        assert!(!out.css.contains("{colors.missing}"), "{}", out.css);
        assert!(!out.css.contains("{colors.gone.999}"), "{}", out.css);
        // Sibling static declaration survives the shed.
        assert!(
            out.sheets.base.contains("display: flex"),
            "{}",
            out.sheets.base
        );
        let warns: Vec<&CssDiagnostic> = out
            .diagnostics
            .iter()
            .filter(|d| d.kind == "warn")
            .collect();
        assert_eq!(warns.len(), 2, "{:?}", out.diagnostics);
        assert!(
            warns.iter().any(|d| d.file == "a.tsx"
                && d.component == "Broken"
                && d.message.contains("{colors.missing}")
                && d.message.contains("'border'")),
            "{:?}",
            out.diagnostics
        );
        assert!(
            warns.iter().any(|d| d.component == "Broken"
                && d.message.contains("{colors.gone.999}")
                && d.message.contains("'outline'")),
            "{:?}",
            out.diagnostics
        );
    }

    /// Inputs whose propConfig carries scale-BEARING entries for a color
    /// property and for two properties on the token-shape exemption list, so
    /// the exemptions are load-bearing rather than vacuous.
    fn token_shape_inputs() -> CssInputs {
        let mut inputs = CssInputs::from_json(
            None,
            None,
            None,
            Some(
                r#"{"bg": {"property": "backgroundColor", "scale": "colors"},
                    "fontFamily": {"property": "fontFamily", "scale": "fonts"},
                    "gridArea": {"property": "gridArea", "scale": "space"},
                    "display": {"property": "display"}}"#,
            ),
            Some(r#"{"color": ["bg"]}"#),
            None,
            None, // condition_aliases_json
            None,
            None,
            None,
            None,
            None,
            None,
            false,
        )
        .unwrap();
        inputs
            .theme
            .insert("colors.primary".into(), "#ff2800".into());
        inputs
    }

    fn warns_of(out: &CssOutput) -> Vec<&CssDiagnostic> {
        out.diagnostics
            .iter()
            .filter(|d| d.kind == "warn")
            .collect()
    }

    #[test]
    fn token_shaped_value_warns_but_is_emitted_as_authored() {
        // A dotted color typo on a scale-family property: the declaration is
        // NOT dropped (a browser discards it on its own, and the value may be
        // legal under another named theme or forced through by staticCss) —
        // the warn diagnostic is the entire value of the check.
        let out = analyze(
            &[(
                "a.tsx",
                "export const Typo = ds.styles({ display: 'flex', bg: 'accent.solid' }).asElement('div');\nexport const App = () => <Typo />;\n",
            )],
            &token_shape_inputs(),
        );
        // Emission is byte-identical to the pre-warn behavior.
        assert!(
            out.sheets.base.contains("background-color: accent.solid"),
            "{}",
            out.sheets.base
        );
        assert!(
            out.sheets.base.contains("display: flex"),
            "{}",
            out.sheets.base
        );
        let warns = warns_of(&out);
        assert_eq!(warns.len(), 1, "{:?}", out.diagnostics);
        let w = warns[0];
        assert_eq!(w.file, "a.tsx");
        assert_eq!(w.component, "Typo");
        assert!(w.message.contains("accent.solid"), "{}", w.message);
        assert!(w.message.contains("'background-color'"), "{}", w.message);
        assert!(
            w.message.contains("check the key against the theme"),
            "{}",
            w.message
        );
        assert!(w.message.contains("emitted as authored"), "{}", w.message);
    }

    /// token_shape_inputs with `kit/src` declared as an external package dir
    /// (extraction-diagnostics: cross-source correlation candidates).
    fn external_dir_inputs() -> CssInputs {
        let mut inputs = token_shape_inputs();
        inputs.external_dirs = vec!["kit/src".into()];
        inputs
    }

    fn candidates_of(out: &CssOutput) -> Vec<&CssDiagnostic> {
        out.diagnostics
            .iter()
            .filter(|d| d.kind == "external-token-candidate")
            .collect()
    }

    #[test]
    fn external_scale_key_miss_records_candidate_with_token() {
        // The flagship correlation case: a kit component references a kit
        // token via a BARE scale key the consumer theme does not define.
        // Emission keeps the shipped pass-through; the candidate (not a warn)
        // carries the scale-qualified token for the TS-side witness join.
        let out = analyze(
            &[(
                "kit/src/Card.tsx",
                "export const KitCard = ds.styles({ display: 'flex', bg: 'externalAccent' }).asElement('div');\nexport const App = () => <KitCard />;\n",
            )],
            &external_dir_inputs(),
        );
        assert!(
            out.sheets.base.contains("background-color: externalAccent"),
            "{}",
            out.sheets.base
        );
        let candidates = candidates_of(&out);
        assert_eq!(candidates.len(), 1, "{:?}", out.diagnostics);
        let c = candidates[0];
        assert_eq!(c.file, "kit/src/Card.tsx");
        assert_eq!(c.component, "KitCard");
        assert_eq!(c.token.as_deref(), Some("colors.externalAccent"));
        // Candidates are NOT the always-on warn channel.
        assert!(warns_of(&out).is_empty(), "{:?}", out.diagnostics);
    }

    #[test]
    fn external_brace_alias_records_candidate_before_shed() {
        // The candidate walk runs BEFORE the alias shed, so a dropped
        // declaration still contributes its token path (alpha suffix
        // stripped). The shed itself is unchanged: declaration dropped, warn
        // emitted.
        let out = analyze(
            &[(
                "kit/src/Card.tsx",
                "export const KitCard = ds.styles({ display: 'flex', bg: '{colors.kitAccent/40}' }).asElement('div');\nexport const App = () => <KitCard />;\n",
            )],
            &external_dir_inputs(),
        );
        assert!(!out.css.contains("{colors.kitAccent"), "{}", out.css);
        let candidates = candidates_of(&out);
        assert_eq!(candidates.len(), 1, "{:?}", out.diagnostics);
        assert_eq!(
            candidates[0].token.as_deref(),
            Some("colors.kitAccent"),
            "{:?}",
            out.diagnostics
        );
        assert_eq!(warns_of(&out).len(), 1, "{:?}", out.diagnostics);
    }

    #[test]
    fn consumer_local_miss_records_no_candidate() {
        // Consumer-local components keep the existing pass-through with no
        // candidate — the correlation covers discovered sources only.
        let out = analyze(
            &[(
                "src/App.tsx",
                "export const Local = ds.styles({ bg: 'externalAccent' }).asElement('div');\nexport const App = () => <Local />;\n",
            )],
            &external_dir_inputs(),
        );
        assert!(candidates_of(&out).is_empty(), "{:?}", out.diagnostics);
    }

    #[test]
    fn external_resolved_and_literal_values_record_no_scale_key_candidate_noise() {
        // A resolving key becomes a theme literal (`#ff2800` — rejected by
        // shape); `display: flex` has no scale. Only shape-plausible misses
        // on scale-qualified properties survive as candidates.
        let out = analyze(
            &[(
                "kit/src/Card.tsx",
                "export const KitCard = ds.styles({ display: 'flex', bg: 'primary' }).asElement('div');\nexport const App = () => <KitCard />;\n",
            )],
            &external_dir_inputs(),
        );
        assert!(candidates_of(&out).is_empty(), "{:?}", out.diagnostics);
    }

    #[test]
    fn scale_key_shape_predicate_bounds() {
        assert!(is_scale_key_shaped_value("externalAccent"));
        assert!(is_scale_key_shaped_value("16"));
        assert!(is_scale_key_shaped_value("accent.solid"));
        assert!(is_scale_key_shaped_value("red"));
        assert!(!is_scale_key_shaped_value("var(--x)"));
        assert!(!is_scale_key_shaped_value("#fff"));
        assert!(!is_scale_key_shaped_value("0 0 4px"));
        assert!(!is_scale_key_shaped_value("-4"));
        assert!(!is_scale_key_shaped_value("a..b"));
        assert!(!is_scale_key_shaped_value(""));
    }

    #[test]
    fn is_external_file_requires_directory_boundary() {
        let dirs = vec!["kit/src".to_string()];
        assert!(is_external_file("kit/src/Card.tsx", &dirs));
        assert!(!is_external_file("kit/srcx/Card.tsx", &dirs));
        assert!(!is_external_file("src/App.tsx", &dirs));
        assert!(!is_external_file("kit/src", &dirs));
    }

    #[test]
    fn resolving_scale_key_does_not_warn() {
        let out = analyze(
            &[(
                "a.tsx",
                "export const Good = ds.styles({ bg: 'primary' }).asElement('div');\nexport const App = () => <Good />;\n",
            )],
            &token_shape_inputs(),
        );
        assert!(
            out.sheets.base.contains("background-color: #ff2800"),
            "{}",
            out.sheets.base
        );
        assert!(warns_of(&out).is_empty(), "{:?}", out.diagnostics);
    }

    #[test]
    fn exempt_properties_do_not_warn_on_dotted_values() {
        // fontFamily/gridArea are scale-family in these inputs, so only the
        // exemption list keeps them quiet — `Inter.var` is a real font stack.
        let out = analyze(
            &[(
                "a.tsx",
                "export const Fonts = ds.styles({ fontFamily: 'Inter.var', gridArea: 'header.main' }).asElement('div');\nexport const App = () => <Fonts />;\n",
            )],
            &token_shape_inputs(),
        );
        assert!(
            out.sheets.base.contains("font-family: Inter.var"),
            "{}",
            out.sheets.base
        );
        assert!(
            out.sheets.base.contains("grid-area: header.main"),
            "{}",
            out.sheets.base
        );
        assert!(warns_of(&out).is_empty(), "{:?}", out.diagnostics);
    }

    #[test]
    fn dotted_value_on_non_scale_property_does_not_warn() {
        // `display` is registered WITHOUT a scale; `maskImage` is not
        // registered at all. Neither carries theme meaning, so a dotted value
        // there is the author's own CSS.
        let out = analyze(
            &[(
                "a.tsx",
                "export const Passthrough = ds.styles({ display: 'a.b', maskImage: 'foo.bar' }).asElement('div');\nexport const App = () => <Passthrough />;\n",
            )],
            &token_shape_inputs(),
        );
        assert!(warns_of(&out).is_empty(), "{:?}", out.diagnostics);
    }

    #[test]
    fn token_shape_admits_only_bare_dotted_identifiers() {
        assert!(is_token_shaped_value("accent.solid"));
        assert!(is_token_shaped_value("colors.accent.solid-2"));
        assert!(is_token_shaped_value("a.b"));
        // Not token-shaped: no dot at all (may be perfectly valid CSS).
        assert!(!is_token_shaped_value("red"));
        assert!(!is_token_shaped_value("not-allowed"));
        // Whitespace, commas, parens, quotes, url() and braces.
        assert!(!is_token_shaped_value("2px solid accent.solid"));
        assert!(!is_token_shaped_value("Inter, sans-serif"));
        assert!(!is_token_shaped_value("var(--current-bg)"));
        assert!(!is_token_shaped_value("url(a.png)"));
        assert!(!is_token_shaped_value("\"a.b\""));
        assert!(!is_token_shaped_value("{colors.missing}"));
        // Custom properties, leading digits, trailing/empty segments.
        assert!(!is_token_shaped_value("--color-primary"));
        assert!(!is_token_shaped_value("1.5rem"));
        assert!(!is_token_shaped_value("transforms."));
        assert!(!is_token_shaped_value("a..b"));
        assert!(!is_token_shaped_value(".leading"));
        assert!(!is_token_shaped_value(""));
        // Non-ASCII never qualifies.
        assert!(!is_token_shaped_value("こんにちは.solid"));
    }

    #[test]
    fn scale_family_covers_config_fan_out_and_color_pass_through() {
        let inputs = CssInputs::from_json(
            None,
            None,
            None,
            Some(
                r#"{"px": {"property": "padding", "properties": ["paddingLeft", "paddingRight"], "scale": "space"},
                    "display": {"property": "display"}}"#,
            ),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            false,
        )
        .unwrap();
        let props = scale_family_css_properties(&inputs.config);
        assert!(props.contains("padding"));
        assert!(props.contains("padding-left"));
        assert!(props.contains("padding-right"));
        // Scale-less config entries carry no theme meaning.
        assert!(!props.contains("display"));
        // Color-family pass-throughs join without a propConfig entry.
        assert!(props.contains("outline-color"));
        assert!(props.contains("border-inline-start-color"));
    }

    #[test]
    fn brace_leak_shed_still_wins_over_token_warn() {
        // A `{...}` leak is still DROPPED (inc 01 behavior is untouched) and
        // reports exactly one warn, not two.
        let out = analyze(
            &[(
                "a.tsx",
                "export const Broken = ds.styles({ bg: '{colors.missing}' }).asElement('div');\nexport const App = () => <Broken />;\n",
            )],
            &token_shape_inputs(),
        );
        assert!(!out.css.contains("{colors.missing}"), "{}", out.css);
        let warns = warns_of(&out);
        assert_eq!(warns.len(), 1, "{:?}", out.diagnostics);
        assert!(
            warns[0].message.contains("declaration dropped"),
            "{}",
            warns[0].message
        );
    }

    #[test]
    fn serde_rejected_props_chain_emits_bail_diagnostic() {
        // extract-quirk-shed inc 02: a props() config that evaluates
        // statically but fails PropConfigMap deserialization no longer
        // vanishes silently — a bail names file, binding, and stage.
        // Mirrors packages/_parity/corpus/props-serde-reject.tsx.
        let out = analyze(
            &[(
                "a.tsx",
                "export const Broken = ds.props({ w: { property: 123 } }).asElement('div');\nexport const App = () => <Broken />;\n",
            )],
            &test_inputs(),
        );
        // The chain still drops from the manifest (existing behavior).
        assert!(out.components.is_empty(), "{:?}", out.components.keys());
        let bails: Vec<&CssDiagnostic> = out
            .diagnostics
            .iter()
            .filter(|d| d.kind == "bail")
            .collect();
        assert_eq!(bails.len(), 1, "{:?}", out.diagnostics);
        assert_eq!(bails[0].file, "a.tsx");
        assert_eq!(bails[0].component, "Broken");
        assert!(
            bails[0].message.contains("stage 'props'"),
            "{}",
            bails[0].message
        );
        assert!(
            bails[0].message.contains("props config parse failed"),
            "{}",
            bails[0].message
        );
    }

    #[test]
    fn fatal_stage_eval_error_emits_bail_diagnostic() {
        // extract-quirk-shed inc 02, fatal_error leg: a stage whose
        // evaluation failed at fact extraction (chain-fatal in v1 via `?`)
        // also bails loud with the failing stage named.
        let out = analyze(
            &[(
                "a.tsx",
                "export const Broken = ds.styles(notStatic).asElement('div');\nexport const App = () => <Broken />;\n",
            )],
            &test_inputs(),
        );
        assert!(out.components.is_empty(), "{:?}", out.components.keys());
        let bails: Vec<&CssDiagnostic> = out
            .diagnostics
            .iter()
            .filter(|d| d.kind == "bail")
            .collect();
        assert_eq!(bails.len(), 1, "{:?}", out.diagnostics);
        assert_eq!(bails[0].file, "a.tsx");
        assert_eq!(bails[0].component, "Broken");
        assert!(
            bails[0].message.contains("stage 'styles'"),
            "{}",
            bails[0].message
        );
    }

    #[test]
    fn system_prop_usage_generates_utility_css() {
        let out = analyze(
            &[(
                "a.tsx",
                "export const Box = ds.system({ space: true }).asElement('div');\nexport const App = () => <Box p={8} />;\n",
            )],
            &test_inputs(),
        );
        assert!(
            out.sheets.system.contains("padding"),
            "{}",
            out.sheets.system
        );
        assert!(
            out.sheets.system.contains("animus-u-"),
            "{}",
            out.sheets.system
        );
    }

    #[test]
    fn total_floor_active_set() {
        let mut inputs = test_inputs();
        inputs.config.insert(
            "m".into(),
            serde_json::from_str(r#"{"property":"margin","scale":"space"}"#).unwrap(),
        );
        inputs.config.insert(
            "gridArea".into(),
            serde_json::from_str(r#"{"property":"gridArea"}"#).unwrap(),
        );
        let out = analyze(
            &[(
                "a.tsx",
                "export const Box = ds.system({ space: true }).asElement('div');\nexport const Grid = ds.system({ space: true, display: true }).asElement('div');\nexport const App = () => <><Box p={8} /><Grid display=\"flex\" /></>;\n",
            )],
            &inputs,
        );

        assert_eq!(
            out.dynamic_props
                .keys()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            vec!["display", "m", "p"]
        );
        assert!(!out.dynamic_props.contains_key("gridArea"));
        for prop in ["display", "m", "p"] {
            assert!(
                out.sheets
                    .system
                    .contains(&format!(".animus-dyn-{prop} {{")),
                "missing slot for {prop}: {}",
                out.sheets.system
            );
        }
        for component in out.components.values() {
            assert!(
                component.replacement.contains("dynamicPropConfig"),
                "{}",
                component.replacement
            );
        }
    }

    #[test]
    fn total_floor_reachability_excludes_unrendered_component_props() {
        let out = analyze(
            &[(
                "a.tsx",
                "export const Used = ds.system({ space: true }).asElement('div');\nexport const Unused = ds.system({ display: true }).asElement('div');\nexport const App = () => <Used />;\n",
            )],
            &test_inputs(),
        );

        assert!(out.dynamic_props.contains_key("p"));
        assert!(!out.dynamic_props.contains_key("display"));
    }

    #[test]
    fn total_floor_reachability_canonicalizes_named_import_aliases() {
        let out = analyze(
            &[
                (
                    "components.tsx",
                    "export const Box = ds.system({ space: true }).styles({ display: 'flex' }).variant({ prop: 'size', defaultVariant: 'lg', variants: { sm: { opacity: 1 }, lg: { opacity: 0.5 } } }).states({ active: { visibility: 'visible' } }).props({ tone: { property: 'color' } }).asElement('div');\nexport const Grid = ds.system({ display: true }).styles({ display: 'grid' }).asElement('div');\n",
                ),
                (
                    "app.tsx",
                    "import { Box as Renamed } from './components';\nexport const App = ({ value }) => <Renamed size=\"sm\" active tone={value} />;\n",
                ),
            ],
            &test_inputs(),
        );

        assert!(out.dynamic_props.contains_key("p"));
        assert!(!out.dynamic_props.contains_key("display"));
        assert!(
            out.sheets.base.contains("display: flex"),
            "{}",
            out.sheets.base
        );
        assert!(
            !out.sheets.base.contains("display: grid"),
            "{}",
            out.sheets.base
        );
        assert!(
            out.sheets.variants.contains("opacity: 1"),
            "{}",
            out.sheets.variants
        );
        assert!(
            !out.sheets.variants.contains("opacity: 0.5"),
            "{}",
            out.sheets.variants
        );
        assert!(
            out.sheets.states.contains("visibility: visible"),
            "{}",
            out.sheets.states
        );
        let box_output = out.components.values().next().unwrap();
        assert!(box_output.replacement.contains("customDynamicConfig"));
        assert!(out.sheets.custom.contains("color"), "{}", out.sheets.custom);
    }

    #[test]
    fn unresolved_jsx_member_widens_floor_and_retains_evaluated_components() {
        let out = analyze_uncertain_identity("export const App = () => <External.Box />;");
        assert_uncertain_identity_widens_and_retains(&out);
    }

    #[test]
    fn unresolved_create_element_member_widens_floor_and_retains_evaluated_components() {
        let out = analyze_uncertain_identity(
            "export const App = () => React.createElement(External.Box);",
        );
        assert_uncertain_identity_widens_and_retains(&out);
    }

    #[test]
    fn lowercase_create_element_identifier_widens_floor_and_retains_evaluated_components() {
        let out = analyze_uncertain_identity(
            "const component = getComponent();\nexport const App = () => createElement(component, null);",
        );
        assert_uncertain_identity_widens_and_retains(&out);
    }

    #[test]
    fn unresolved_local_component_alias_widens_floor_and_retains_evaluated_components() {
        let out = analyze_uncertain_identity("const C = Box;\nexport const App = () => <C />;");
        assert_uncertain_identity_widens_and_retains(&out);
    }

    #[test]
    fn renamed_unknown_component_binding_widens_floor_and_retains_evaluated_components() {
        let out = analyze_uncertain_identity(
            "import { Mystery as Renamed } from './external';\nexport const App = () => <Renamed />;",
        );
        assert_uncertain_identity_widens_and_retains(&out);
    }

    #[test]
    fn lowercase_intrinsic_does_not_widen_floor_or_retain_components() {
        let out = analyze_uncertain_identity("export const App = () => <div />;");
        assert!(
            out.dynamic_props.is_empty(),
            "{:?}",
            out.dynamic_props.keys()
        );
        assert!(
            !out.sheets.base.contains("display: flex"),
            "{}",
            out.sheets.base
        );
        assert!(
            !out.sheets.base.contains("display: grid"),
            "{}",
            out.sheets.base
        );
        assert_eq!(out.reconciliation["components_eliminated"], 2);
    }

    #[test]
    fn native_create_element_string_does_not_widen_floor_or_retain_components() {
        let out =
            analyze_uncertain_identity("export const App = () => createElement('div', null);");
        assert!(
            out.dynamic_props.is_empty(),
            "{:?}",
            out.dynamic_props.keys()
        );
        assert!(
            !out.sheets.base.contains("display: flex"),
            "{}",
            out.sheets.base
        );
        assert!(
            !out.sheets.base.contains("display: grid"),
            "{}",
            out.sheets.base
        );
        assert_eq!(out.reconciliation["components_eliminated"], 2);
    }

    #[test]
    fn total_floor_reachability_retains_parent_as_class_and_compose_slots() {
        let mut inputs = test_inputs();
        inputs.config.insert(
            "m".into(),
            serde_json::from_str(r#"{"property":"margin","scale":"space"}"#).unwrap(),
        );
        inputs.config.insert(
            "gridArea".into(),
            serde_json::from_str(r#"{"property":"gridArea"}"#).unwrap(),
        );
        let out = analyze(
            &[(
                "a.tsx",
                "const Parent = ds.system({ display: true }).asElement('div');\nexport const Child = Parent.extend().styles({}).asElement('div');\nconst Root = ds.system({ space: true }).asElement('section');\nexport const helper = ds.system({ gridArea: true }).asClass();\nexport const Family = compose({ Root }, { shared: {} });\n",
            )],
            &inputs,
        );

        assert!(out.dynamic_props.contains_key("p"));
        assert!(out.dynamic_props.contains_key("m"));
        assert!(out.dynamic_props.contains_key("display"));
        assert!(out.dynamic_props.contains_key("gridArea"));
    }

    #[test]
    fn total_floor_reachability_widens_when_binding_is_uncertain() {
        let out = analyze(
            &[
                (
                    "components.tsx",
                    "export const Box = ds.system({ space: true }).asElement('div');\nexport const Grid = ds.system({ display: true }).asElement('div');\n",
                ),
                (
                    "app.tsx",
                    "import Box from './external';\nexport const App = () => <Box />;\n",
                ),
            ],
            &test_inputs(),
        );

        assert!(out.dynamic_props.contains_key("p"));
        assert!(out.dynamic_props.contains_key("display"));
    }

    #[test]
    fn total_floor_empty_project_has_no_slots() {
        let out = analyze(&[], &test_inputs());
        assert!(out.dynamic_props.is_empty());
        assert!(
            !out.sheets.system.contains("-dyn-"),
            "{}",
            out.sheets.system
        );
    }

    #[test]
    fn total_floor_static_invariance() {
        let source = "export const Box = ds.system({ space: true }).asElement('div');\nexport const App = () => <Box p={8} />;\n";
        let legacy = analyze_with_total_system_floor(&[("a.tsx", source)], &test_inputs(), false);
        let floor = analyze_with_total_system_floor(&[("a.tsx", source)], &test_inputs(), true);

        assert_eq!(floor.system_prop_map, legacy.system_prop_map);
        assert_eq!(
            floor.system_prop_map["p"]["8"],
            legacy.system_prop_map["p"]["8"]
        );
        assert!(legacy.dynamic_props.is_empty());
        assert!(floor.dynamic_props.contains_key("p"));
    }

    #[test]
    fn enrichment_static_invariance() {
        let source = "export const Box = ds.system({ space: true }).asElement('div');\nexport const App = () => <Box p={8} />;\n";
        let counter = ParseCounter::new(0);
        let ast = OwnedAst::parse("a.tsx".to_string(), source.to_string(), &counter);
        let enriched = extract_file_facts_with_prefix(&ast, "animus");
        let mut legacy = enriched.clone();
        legacy.usage = crate::usage_facts::collect_usage_facts(ast.program());
        legacy.usage_enriched = None;

        let order = vec!["a.tsx".to_string()];
        let enriched_out = run(
            &BTreeMap::from([("a.tsx".to_string(), enriched)]),
            &order,
            &test_inputs(),
            "animus",
        );
        let legacy_out = run(
            &BTreeMap::from([("a.tsx".to_string(), legacy)]),
            &order,
            &test_inputs(),
            "animus",
        );

        assert_eq!(enriched_out.system_prop_map, legacy_out.system_prop_map);
        assert_eq!(enriched_out.css, legacy_out.css);
    }

    #[test]
    fn total_floor_keeps_custom_props_detection_gated_and_component_qualified() {
        let static_only = analyze(
            &[(
                "a.tsx",
                "export const Card = ds.props({ size: { property: 'flexBasis' } }).asElement('div');\nexport const App = () => <Card size=\"sm\" />;\n",
            )],
            &test_inputs(),
        );
        let static_card = static_only.components.values().next().unwrap();
        assert!(!static_card.replacement.contains("customDynamicConfig"));
        assert!(!static_only.sheets.custom.contains("-dyn-"));
        assert!(!static_only.dynamic_props.contains_key("size"));

        let dynamic = analyze(
            &[(
                "a.tsx",
                "export const Card = ds.props({ size: { property: 'flexBasis' } }).asElement('div');\nexport const App = ({ value }) => <Card size={value} />;\n",
            )],
            &test_inputs(),
        );
        let dynamic_card = dynamic.components.values().next().unwrap();
        assert!(dynamic_card.replacement.contains("customDynamicConfig"));
        assert!(dynamic_card.replacement.contains("animus-dyn-"));
        assert!(dynamic.sheets.custom.contains("@layer anm-custom"));
        assert!(!dynamic.dynamic_props.contains_key("size"));
    }

    #[test]
    fn extension_child_inherits_parent_base_across_files() {
        let out = analyze(
            &[
                (
                    "base.tsx",
                    "export const Parent = ds.styles({ display: 'flex', p: 8 }).asElement('div');\nexport const A = () => <Parent />;\n",
                ),
                (
                    "child.tsx",
                    "import { Parent } from './base';\nexport const Child = Parent.extend().styles({ display: 'grid' }).asElement('div');\nexport const B = () => <Child />;\n",
                ),
            ],
            &test_inputs(),
        );
        // Child overrides display but inherits padding from Parent.
        let child_start = out.sheets.base.find("animus-Child-").unwrap();
        let child_rule = &out.sheets.base[child_start..];
        let child_rule = &child_rule[..child_rule.find('}').unwrap()];
        assert!(child_rule.contains("display: grid"), "{}", out.sheets.base);
        assert!(
            child_rule.contains("padding: 0.5rem"),
            "{}",
            out.sheets.base
        );
    }

    #[test]
    fn extension_child_condition_block_carries_through_merge() {
        // Regression (inc 03): the extend-merge previously dropped the CHILD's
        // selectorless Media/Container/Supports groups (only the parent's
        // carried through). A child's own condition block must survive into the
        // child's emitted rule, wrapping the child's class inside its @layer.
        let out = analyze(
            &[
                (
                    "base.tsx",
                    "export const Parent = ds.styles({ display: 'flex' }).asElement('div');\nexport const A = () => <Parent />;\n",
                ),
                (
                    "child.tsx",
                    "import { Parent } from './base';\nexport const Child = Parent.extend().styles({ '@container (min-width: 400px)': { p: 8 } }).asElement('div');\nexport const B = () => <Child />;\n",
                ),
            ],
            &test_inputs(),
        );
        let ci = out
            .sheets
            .base
            .find("@container (min-width: 400px)")
            .unwrap_or_else(|| panic!("child container block dropped:\n{}", out.sheets.base));
        let after = &out.sheets.base[ci..];
        assert!(
            after.contains("animus-Child-"),
            "container must wrap the child class:\n{}",
            out.sheets.base
        );
        assert!(after.contains("padding: 0.5rem"), "{}", out.sheets.base);
        // Parent's inherited base declaration still present on the child rule.
        assert!(out.sheets.base.contains("display: flex"), "{}", out.sheets.base);
    }

    #[test]
    fn extension_child_responsive_selector_group_carries() {
        // F2 (inc-05 review): the child's [Breakpoint]+selector group
        // (responsive map inside a selector block) must survive the
        // extend-merge — same silent-drop family as the inc-03 fix above.
        let out = analyze(
            &[
                (
                    "base.tsx",
                    "export const Parent = ds.styles({ display: 'flex' }).asElement('div');\nexport const A = () => <Parent />;\n",
                ),
                (
                    "child.tsx",
                    "import { Parent } from './base';\nexport const Child = Parent.extend().styles({ '&:hover': { p: { _: 8, sm: 16 } } }).asElement('div');\nexport const B = () => <Child />;\n",
                ),
            ],
            &test_inputs(),
        );
        let hover_base = out.sheets.base.contains(":hover");
        assert!(hover_base, "hover pseudo present:\n{}", out.sheets.base);
        let mi = out
            .sheets
            .base
            .find("@media (min-width: 480px)")
            .unwrap_or_else(|| panic!("child bp+selector group dropped:\n{}", out.sheets.base));
        let after = &out.sheets.base[mi..];
        assert!(
            after.contains(":hover"),
            "selector must compose inside the media wrapper:\n{}",
            out.sheets.base
        );
        assert!(after.contains("padding: 16"), "{}", out.sheets.base);
    }

    #[test]
    fn named_transform_registers_and_applies() {
        let mut inputs = test_inputs();
        inputs.config.insert(
            "w".into(),
            serde_json::from_str(r#"{"property": "width", "transform": "battle"}"#).unwrap(),
        );
        let out = analyze(
            &[
                (
                    "t.tsx",
                    "import { createTransform } from '@animus-ui/system';\nexport const t1 = createTransform('battle', (v) => `${v}px`);\n",
                ),
                (
                    "a.tsx",
                    "export const C = ds.styles({ w: 3 }).asElement('div');\nexport const App = () => <C />;\n",
                ),
            ],
            &inputs,
        );
        assert!(
            out.sheets.base.contains("width: 3px"),
            "{}",
            out.sheets.base
        );
    }

    // --- ANI-004: compose slots resolve through qualified component ids -----

    fn class_of(out: &CssOutput, component_id: &str) -> String {
        out.components
            .get(component_id)
            .unwrap_or_else(|| panic!("missing component {component_id}: {:?}", out.components.keys()))
            .class_name
            .clone()
    }

    fn slot_family_source(family: &str, root: &str, body: &str) -> String {
        format!(
            "export const {root} = ds.styles({{ display: 'flex' }}).asElement('div');\n\
             export const {body} = ds\n\
               .variant({{ prop: 'size', variants: {{ sm: {{ p: 8 }} }} }})\n\
               .asElement('div');\n\
             export const {family} = compose({{ Root: {root}, Body: {body} }}, \
               {{ name: '{family}', shared: {{ size: true }} }});\n\
             export const App{family} = () => <{family}.Root><{family}.Body size=\"sm\" /></{family}.Root>;\n"
        )
    }

    #[test]
    fn compose_slots_resolve_per_file_not_by_bare_binding_name() {
        // Two files defining the SAME local recipe names: the bare-name map
        // let one file's components win every family in the universe.
        let one = slot_family_source("One", "Root", "Body");
        let two = slot_family_source("Two", "Root", "Body");
        let out = analyze(
            &[("one.tsx", one.as_str()), ("two.tsx", two.as_str())],
            &test_inputs(),
        );

        let one_root = class_of(&out, "one.tsx::Root");
        let one_body = class_of(&out, "one.tsx::Body");
        let two_root = class_of(&out, "two.tsx::Root");
        let two_body = class_of(&out, "two.tsx::Body");
        let css = &out.sheets.variants;

        assert!(
            css.contains(&format!(".{one_root}--size-sm .{one_body}")),
            "one.tsx family lost its own slot:\n{css}"
        );
        assert!(
            css.contains(&format!(".{two_root}--size-sm .{two_body}")),
            "two.tsx family lost its own slot:\n{css}"
        );
        assert!(
            !css.contains(&format!(".{one_root}--size-sm .{two_body}")),
            "cross-file slot wiring leaked:\n{css}"
        );
        assert!(
            !css.contains(&format!(".{two_root}--size-sm .{one_body}")),
            "cross-file slot wiring leaked:\n{css}"
        );
        assert!(
            !out.diagnostics.iter().any(|d| d.kind == "bail"),
            "{:?}",
            out.diagnostics
        );
    }

    #[test]
    fn compose_slots_resolve_through_aliased_imports() {
        // `import { Root as CardRoot }` had no bare-name entry, so the slot
        // was silently dropped from the composed CSS.
        let out = analyze(
            &[
                (
                    "slots.tsx",
                    "export const Root = ds.styles({ display: 'flex' }).asElement('div');\n\
                     export const Body = ds\n\
                       .variant({ prop: 'size', variants: { sm: { p: 8 } } })\n\
                       .asElement('div');\n",
                ),
                (
                    "card.tsx",
                    "import { Root as CardRoot, Body as CardBody } from './slots';\n\
                     export const Card = compose({ Root: CardRoot, Body: CardBody }, \
                       { name: 'Card', shared: { size: true } });\n\
                     export const App = () => <Card.Root><Card.Body size=\"sm\" /></Card.Root>;\n",
                ),
            ],
            &test_inputs(),
        );

        let root = class_of(&out, "slots.tsx::Root");
        let body = class_of(&out, "slots.tsx::Body");
        assert!(
            out.sheets
                .variants
                .contains(&format!(".{root}--size-sm .{body}")),
            "aliased slot import dropped:\n{}",
            out.sheets.variants
        );
        assert!(
            !out.diagnostics.iter().any(|d| d.kind == "bail"),
            "{:?}",
            out.diagnostics
        );
    }

    #[test]
    fn compose_slot_unresolvable_by_qualified_id_bails_loud() {
        // The composing file neither defines nor imports the slot bindings;
        // under bare-name matching these silently bound to whichever same-named
        // component hashed first. Now the drop is diagnosed.
        let out = analyze(
            &[
                (
                    "one.tsx",
                    "export const Root = ds.styles({ display: 'flex' }).asElement('div');\n\
                     export const Body = ds.styles({ display: 'block' }).asElement('div');\n",
                ),
                (
                    "two.tsx",
                    "export const Root = ds.styles({ display: 'grid' }).asElement('div');\n\
                     export const Body = ds.styles({ display: 'inline' }).asElement('div');\n",
                ),
                (
                    "fam.tsx",
                    "export const Fam = compose({ Root, Body }, { name: 'Fam', shared: {} });\n\
                     export const App = () => <Fam.Root><Fam.Body /></Fam.Root>;\n",
                ),
            ],
            &test_inputs(),
        );

        let bails: Vec<&CssDiagnostic> = out
            .diagnostics
            .iter()
            .filter(|d| d.kind == "bail" && d.component == "Fam")
            .collect();
        assert_eq!(bails.len(), 1, "{:?}", out.diagnostics);
        assert_eq!(bails[0].file, "fam.tsx");
        assert!(
            bails[0].message.contains("compose slot 'Root'")
                && bails[0].message.contains("binding 'Root'"),
            "{}",
            bails[0].message
        );
    }

    // --- ANI-008: compound class names agree with emitter enumeration -------

    fn merged_compound_configs(
        out: &CssOutput,
        component_id: &str,
    ) -> Vec<(BTreeMap<String, Value>, String)> {
        out.replacement_configs[component_id]
            .merged_config
            .as_ref()
            .unwrap_or_else(|| panic!("{component_id} has no merged config"))
            .compound_configs
            .clone()
    }

    const COMPOUND_PARENT: &str = "export const Parent = ds\n\
          .variant({ prop: 'size', variants: { sm: { p: 8 }, lg: { p: 8 } } })\n\
          .variant({ prop: 'tone', variants: { quiet: { p: 8 }, loud: { p: 8 } } })\n\
          .compound({ size: 'sm' }, { display: 'flex' })\n\
          .compound({ size: 'lg' }, { display: 'grid' })\n\
          .asElement('div');\n\
          export const AppParent = () => <Parent size=\"sm\" tone=\"loud\" />;\n";

    #[test]
    fn extension_renumbers_compound_configs_under_the_child_class() {
        let out = analyze(
            &[
                ("parent.tsx", COMPOUND_PARENT),
                (
                    "child.tsx",
                    "import { Parent } from './parent';\n\
                     export const Child = Parent.extend()\n\
                       .compound({ tone: 'loud' }, { display: 'inline' })\n\
                       .asElement('div');\n\
                     export const AppChild = () => <Child size=\"sm\" tone=\"loud\" />;\n",
                ),
            ],
            &test_inputs(),
        );

        let child_class = class_of(&out, "child.tsx::Child");
        let configs = merged_compound_configs(&out, "child.tsx::Child");
        assert_eq!(configs.len(), 3, "{configs:?}");
        for (idx, (_, class)) in configs.iter().enumerate() {
            assert_eq!(*class, format!("{child_class}--compound-{idx}"));
        }
        // Condition-to-index pairing follows the flattened parent-first order,
        // which is exactly what the emitter enumerates.
        assert_eq!(configs[0].0["size"], Value::from("sm"));
        assert_eq!(configs[1].0["size"], Value::from("lg"));
        assert_eq!(configs[2].0["tone"], Value::from("loud"));
        for idx in 0..3 {
            assert!(
                out.sheets
                    .compounds
                    .contains(&format!(".{child_class}--compound-{idx} {{")),
                "emitter rule {idx} missing:\n{}",
                out.sheets.compounds
            );
        }
    }

    #[test]
    fn two_level_extension_renumbers_compound_configs_end_to_end() {
        let out = analyze(
            &[
                ("parent.tsx", COMPOUND_PARENT),
                (
                    "child.tsx",
                    "import { Parent } from './parent';\n\
                     export const Child = Parent.extend()\n\
                       .compound({ tone: 'loud' }, { display: 'inline' })\n\
                       .asElement('div');\n\
                     export const AppChild = () => <Child size=\"sm\" tone=\"loud\" />;\n",
                ),
                (
                    "grand.tsx",
                    "import { Child } from './child';\n\
                     export const Grand = Child.extend()\n\
                       .compound({ tone: 'quiet' }, { display: 'block' })\n\
                       .asElement('div');\n\
                     export const AppGrand = () => <Grand size=\"lg\" tone=\"quiet\" />;\n",
                ),
            ],
            &test_inputs(),
        );

        let grand_class = class_of(&out, "grand.tsx::Grand");
        let configs = merged_compound_configs(&out, "grand.tsx::Grand");
        assert_eq!(configs.len(), 4, "{configs:?}");
        for (idx, (_, class)) in configs.iter().enumerate() {
            assert_eq!(*class, format!("{grand_class}--compound-{idx}"));
        }
        assert_eq!(configs[2].0["tone"], Value::from("loud"));
        assert_eq!(configs[3].0["tone"], Value::from("quiet"));
        for idx in 0..4 {
            assert!(
                out.sheets
                    .compounds
                    .contains(&format!(".{grand_class}--compound-{idx} {{")),
                "emitter rule {idx} missing:\n{}",
                out.sheets.compounds
            );
        }
    }

    #[test]
    fn extension_with_compound_free_parent_keeps_child_numbering() {
        let out = analyze(
            &[
                (
                    "parent.tsx",
                    "export const Parent = ds\n\
                       .variant({ prop: 'tone', variants: { quiet: { p: 8 }, loud: { p: 8 } } })\n\
                       .asElement('div');\n\
                     export const AppParent = () => <Parent tone=\"loud\" />;\n",
                ),
                (
                    "child.tsx",
                    "import { Parent } from './parent';\n\
                     export const Child = Parent.extend()\n\
                       .compound({ tone: 'loud' }, { display: 'inline' })\n\
                       .asElement('div');\n\
                     export const AppChild = () => <Child tone=\"loud\" />;\n",
                ),
            ],
            &test_inputs(),
        );

        let child_class = class_of(&out, "child.tsx::Child");
        let configs = merged_compound_configs(&out, "child.tsx::Child");
        assert_eq!(configs.len(), 1, "{configs:?}");
        assert_eq!(configs[0].1, format!("{child_class}--compound-0"));
        assert!(
            out.sheets
                .compounds
                .contains(&format!(".{child_class}--compound-0 {{")),
            "{}",
            out.sheets.compounds
        );
    }

    // ------------------------------------------------------------------
    // Usage identity is keyed by component id, not by bare binding name
    // ------------------------------------------------------------------

    fn variant_inputs() -> CssInputs {
        CssInputs::from_json(
            None,
            None,
            None,
            Some(r#"{"p": {"property": "padding", "scale": "space"}}"#),
            Some(r#"{"space": ["p"]}"#),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            false,
        )
        .unwrap()
    }

    /// Two files export the SAME component name; an app imports both under
    /// aliases and uses a different option of each. Each origin must keep
    /// exactly the option used at ITS callsite — under bare-name keying the
    /// two usage sets pooled and both components kept both options.
    #[test]
    fn duplicate_binding_attributes_variant_usage_to_each_defining_file() {
        let variant = |quiet: &str, loud: &str| {
            format!(
                "export const Button = ds.styles({{}}).variant({{ prop: 'tone', defaultVariant: 'quiet', variants: {{ quiet: {{ padding: '{}' }}, loud: {{ padding: '{}' }} }} }}).asElement('button');\n",
                quiet, loud
            )
        };
        let out = analyze(
            &[
                ("one.tsx", &variant("1px", "2px")),
                ("two.tsx", &variant("3px", "4px")),
                (
                    "app.tsx",
                    "import { Button as ButtonOne } from './one';\nimport { Button as ButtonTwo } from './two';\nexport const App = () => (<><ButtonOne tone=\"quiet\" /><ButtonTwo tone=\"loud\" /></>);\n",
                ),
            ],
            &variant_inputs(),
        );

        let css = &out.sheets.variants;
        assert!(css.contains("padding: 1px"), "one.tsx quiet kept: {}", css);
        assert!(css.contains("padding: 4px"), "two.tsx loud kept: {}", css);
        assert!(
            !css.contains("padding: 2px"),
            "one.tsx loud is unused and must be eliminated: {}",
            css
        );
        assert!(
            !css.contains("padding: 3px"),
            "two.tsx quiet is unused and must be eliminated: {}",
            css
        );
    }

    /// A single-candidate bare name with no import and no local definition
    /// still attributes — this fallback is what keeps unique-name projects
    /// byte-identical.
    #[test]
    fn single_candidate_bare_name_fallback_still_attributes() {
        let out = analyze(
            &[
                (
                    "one.tsx",
                    "export const Button = ds.styles({}).variant({ prop: 'tone', defaultVariant: 'quiet', variants: { quiet: { padding: '1px' }, loud: { padding: '2px' } } }).asElement('button');\n",
                ),
                (
                    "app.tsx",
                    "export const App = () => <Button tone=\"quiet\" />;\n",
                ),
            ],
            &variant_inputs(),
        );

        let css = &out.sheets.variants;
        assert!(css.contains("padding: 1px"), "{}", css);
        assert!(
            !css.contains("padding: 2px"),
            "unused option must still be eliminated through the fallback: {}",
            css
        );
        assert_eq!(out.reconciliation["components_eliminated"], 0);
    }

    /// `Family.Slot` resolves to the slot component's origin — the file that
    /// COMPOSED the family — not to a same-named component elsewhere and not
    /// to the member tail.
    #[test]
    fn member_expression_attributes_to_the_slot_origin_not_a_same_named_component() {
        let out = analyze(
            &[
                (
                    "decoy.tsx",
                    "export const Panel = ds.styles({}).variant({ prop: 'tone', defaultVariant: 'quiet', variants: { quiet: { padding: '9px' }, loud: { padding: '8px' } } }).asElement('div');\n",
                ),
                (
                    "family.tsx",
                    "const Panel = ds.styles({}).variant({ prop: 'tone', defaultVariant: 'quiet', variants: { quiet: { padding: '1px' }, loud: { padding: '2px' } } }).asElement('section');\nexport const Card = compose({ Root: Panel }, { shared: {} });\n",
                ),
                (
                    "app.tsx",
                    "import { Card } from './family';\nexport const App = () => <Card.Root tone=\"loud\" />;\n",
                ),
            ],
            &variant_inputs(),
        );

        let css = &out.sheets.variants;
        assert!(
            css.contains("padding: 2px"),
            "the family's own Panel got the usage: {}",
            css
        );
        // The decoy is unrendered but compose marks slots rendered; the
        // member usage must NOT have reached it, so its unused option goes.
        assert!(
            !css.contains("padding: 8px"),
            "decoy Panel must not receive the member-expression usage: {}",
            css
        );
    }

    /// Ambiguous: a bare name with several defining files and no usable
    /// import. Attribution fans out to every candidate — the only choice
    /// that cannot eliminate CSS the bare-name keying kept.
    #[test]
    fn ambiguous_bare_name_attributes_to_every_candidate() {
        let variant = |quiet: &str, loud: &str| {
            format!(
                "export const Button = ds.styles({{}}).variant({{ prop: 'tone', defaultVariant: 'quiet', variants: {{ quiet: {{ padding: '{}' }}, loud: {{ padding: '{}' }} }} }}).asElement('button');\n",
                quiet, loud
            )
        };
        let out = analyze(
            &[
                ("one.tsx", &variant("1px", "2px")),
                ("two.tsx", &variant("3px", "4px")),
                (
                    "app.tsx",
                    "export const App = () => <Button tone=\"loud\" />;\n",
                ),
            ],
            &variant_inputs(),
        );

        let css = &out.sheets.variants;
        assert!(css.contains("padding: 2px"), "one.tsx loud kept: {}", css);
        assert!(css.contains("padding: 4px"), "two.tsx loud kept: {}", css);
        assert!(
            !css.contains("padding: 1px") && !css.contains("padding: 3px"),
            "the unused option is still pruned on BOTH candidates: {}",
            css
        );
        assert_eq!(out.reconciliation["components_eliminated"], 0);
    }

    /// An imported name that resolves to nothing extractable keeps v1's
    /// canonical-floor failure: the run goes conservative rather than
    /// silently attributing to a same-named component elsewhere.
    #[test]
    fn unresolvable_import_stays_conservative_instead_of_borrowing_a_namesake() {
        let out = analyze(
            &[
                (
                    "one.tsx",
                    "export const Button = ds.styles({}).variant({ prop: 'tone', defaultVariant: 'quiet', variants: { quiet: { padding: '1px' }, loud: { padding: '2px' } } }).asElement('button');\n",
                ),
                (
                    "app.tsx",
                    "import Button from './external';\nexport const App = () => <Button tone=\"quiet\" />;\n",
                ),
            ],
            &variant_inputs(),
        );

        let css = &out.sheets.variants;
        assert!(css.contains("padding: 1px"), "{}", css);
        assert!(
            css.contains("padding: 2px"),
            "identity-uncertain runs keep every option: {}",
            css
        );
    }
}
