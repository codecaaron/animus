//! Project-level CSS orchestration over retained facts: extension provenance,
//! chain evaluation, usage reconciliation, and `@layer` CSS generation.

use std::collections::{BTreeMap, HashMap};
use std::fmt::Write as _;
use std::sync::Arc;

use rustc_hash::{FxHashMap, FxHashSet};
use serde_json::Value;

use crate::chain_merge::{
    authors_variant_entry, effective_variant_configs, inherit_custom_configs,
    inherit_variant_stages, topological_sort, ProvenanceNode,
    TopoResult, VariantConfigs,
};
use crate::chain_walk::{MemberParentExtension, TerminalKind};
use crate::css::{
    build_variable_slot_entries, camel_to_kebab, generate_composed_compound_css,
    generate_composed_variant_css, generate_css_sheets_ordered, layer_name,
    resolve_custom_prop_classes, resolve_utility_classes, wrap_layer, BreakpointMap, ComponentCss, ComposeFamilyRef, CompoundConditionMap,
    CssFragmentStore, CssSheets, UtilityInput, VariantCss,
};
use crate::declarations::{bind_component_declarations, check_surface_overlap, DeclarationBinding, DeclarationScales};
use crate::dynamic_meta::DynamicPropMeta;
use crate::evaluator::{EvalError, TransformEvaluator};
use crate::facts::FileFacts;
use crate::jsx_scan::{
    ComponentUsageConfig, ComposeFamilyInfo, DynamicPropUsage, SystemPropUsage, UsageScanResult,
};
use crate::pipeline::process_chain_facts;
use crate::reconcile::{build_ledger, identify_prospective_eliminations, reconcile, VariantConfigMap};
use crate::theme::{
    ConditionAliasesMap, ContextualVarsMap, CssDeclaration, FlatTheme, PropConfigMap,
    ResolveContext, ResolvedStyles, SelectorAliasesMap, StrictTokenMiss, StrictTokenMissSink,
    TransformFailure, TransformFailureSink, VariableMap, extracts_callback_value, extracts_configured_value, strict_token_miss_of,
};
use crate::transforms::CallbackDefinition;
use crate::usage_facts::{is_animus_system_specifier, TagFact, UsageFact, UsageResidueRecord};

type ComponentPropSetMap = FxHashMap<String, FxHashSet<String>>;

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

/// First alias that matches wins, so entry order is significant.
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

/// Configuration and theme inputs, parsed once from EngineOptions JSON.
#[derive(Default)]
pub struct CssInputs {
    pub theme: FlatTheme,
    pub variable_map: VariableMap,
    pub contextual_vars: ContextualVarsMap,
    pub config: PropConfigMap,
    pub group_registry: FxHashMap<String, Vec<String>>,
    pub selector_aliases: SelectorAliasesMap,
    pub condition_aliases: ConditionAliasesMap,
    pub global_style_blocks: Option<Value>,
    pub keyframes_blocks: Option<Value>,
    pub package_map: FxHashMap<String, String>,
    pub path_aliases: Vec<AliasEntry>,
    pub static_css: Option<crate::forced_usage::StaticCssConfig>,
    /// Directory prefixes, relative to rootDir, of external packages.
    pub external_dirs: Vec<String>,
    /// `{ definitionKey: sourceText }` for the loaded system's configured
    /// transforms, keyed as its props' `transformId` (or, for a system that
    /// predates identities, their name).
    pub transform_sources: FxHashMap<String, String>,
    /// The loader's host-binding evidence for those sources.
    pub transform_provenance: crate::transforms::TransformProvenance,
    /// The theme's declaration scales, lowered once for system and
    /// component props alike.
    pub declaration_scales: DeclarationScales,
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
        let mut config = parse("configJson", config_json)?;
        crate::theme::key_unidentified_transforms(&mut config);
        Ok(CssInputs {
            theme: parse("themeJson", theme_json)?,
            variable_map: parse("variableMapJson", variable_map_json)?,
            contextual_vars: parse("contextualVarsJson", contextual_vars_json)?,
            config,
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
            transform_sources: FxHashMap::default(),
            transform_provenance: Default::default(),
            declaration_scales: DeclarationScales::default(),
            external_dirs: parse("externalDirsJson", external_dirs_json)?,
            dev_mode,
        })
    }

    /// Binds the configuration's declaration props to the theme's declaration
    /// scales; a registration that cannot bind fails the whole analysis.
    pub fn bind_declarations(&mut self, json: Option<&str>) -> Result<(), String> {
        self.declaration_scales =
            crate::declarations::bind_declaration_props(&mut self.config, json, &self.theme)?;
        Ok(())
    }

    pub fn set_transform_sources(&mut self, json: Option<&str>) -> Result<(), String> {
        self.transform_sources = match json {
            None => FxHashMap::default(),
            Some(s) if s.trim().is_empty() || s.trim() == "null" => FxHashMap::default(),
            Some(s) => serde_json::from_str(s)
                .map_err(|e| format!("EngineOptions.transformSourcesJson: invalid JSON — {e}"))?,
        };
        Ok(())
    }
}

/// Manifest component entry; field names are the plugin-consumed wire shape.
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
    /// Theme token path (`scale.key`); set only by the external-token walk.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    /// Stable diagnostic code, `animus.<namespace>.<slug>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// `"error"` fails strict builds in the plugin; `"warn"` does not.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub severity: Option<String>,
}

pub(crate) fn diagnostic_code_from_message(message: &str) -> Option<String> {
    let start = message.rfind("(animus.")?;
    let rest = &message[start + 1..];
    let end = rest.find(')')?;
    let code = &rest[..end];
    code.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        .then(|| code.to_string())
}

const COMPOSE_UNRESOLVABLE_SLOT: &str = "animus.compose.unresolvable-slot";

/// Source-proven unsupported Animus declarations. Each code is `error`
/// severity: a warning by default, fatal only under explicit strictness.
const UNSUPPORTED_MEMBER_PARENT: &str = "animus.extension.unsupported-member-parent";
const UNSUPPORTED_EXTEND_ARGUMENTS: &str = "animus.extension.unsupported-arguments";
const UNSUPPORTED_VARIANT_CONFIG_REFERENCE: &str = "animus.variant.unsupported-config-reference";
const STAGE_EVALUATION_FAILED: &str = "animus.chain.stage-evaluation-failed";
const UNSUPPORTED_CHAIN_METHOD: &str = "animus.chain.unsupported-method";
const UNSUPPORTED_TERMINAL_TARGET: &str = "animus.chain.unsupported-terminal-target";
const UNSUPPORTED_TRANSFORM_REFERENCE: &str = "animus.props.unsupported-transform-reference";
const UNSUPPORTED_PROPS_CONFIG: &str = "animus.props.unsupported-config";
const UNSUPPORTED_DEFAULT_EXPORT: &str = "animus.chain.unsupported-default-export";
const UNSUPPORTED_NAMESPACE_ROOT: &str = "animus.chain.unsupported-namespace-root";
/// A configured transform rejected before registration loses its meaning
/// the same way, so it shares the optional-strict policy.
const CONFIGURED_TRANSFORM_REJECTED: &str = "animus.transform.configured-rejected";
/// A value missing from a strict, populated scale is omitted rather than
/// applied raw; the author meant a token the scale does not have.
const STRICT_TOKEN_MISS: &str = "animus.props.strict-token-miss";
/// A configured transform that exhausts its evaluation budget or reads the
/// host where no runtime slot exists (style blocks, variants, states,
/// global styles): its declaration falls back to the raw value.
const STATIC_EVALUATION_UNAVAILABLE: &str = "animus.transform.static-evaluation-unavailable";

pub(crate) fn diagnostic_severity_for_code(code: &str) -> &'static str {
    match code {
        crate::eval::SELECTOR_UNSUPPORTED_SUBJECT
        | COMPOSE_UNRESOLVABLE_SLOT
        | UNSUPPORTED_MEMBER_PARENT
        | UNSUPPORTED_EXTEND_ARGUMENTS
        | UNSUPPORTED_VARIANT_CONFIG_REFERENCE
        | STAGE_EVALUATION_FAILED
        | UNSUPPORTED_CHAIN_METHOD
        | UNSUPPORTED_TERMINAL_TARGET
        | UNSUPPORTED_TRANSFORM_REFERENCE
        | UNSUPPORTED_PROPS_CONFIG
        | UNSUPPORTED_DEFAULT_EXPORT
        | UNSUPPORTED_NAMESPACE_ROOT
        | CONFIGURED_TRANSFORM_REJECTED
        | STATIC_EVALUATION_UNAVAILABLE
        | STRICT_TOKEN_MISS => "error",
        _ => "warn",
    }
}

/// A diagnostic whose severity is the one its `code` owns; uncoded
/// diagnostics carry none.
fn diagnostic(
    file: &str,
    component: &str,
    kind: &str,
    message: String,
    code: Option<&str>,
) -> CssDiagnostic {
    CssDiagnostic {
        token: None,
        file: file.to_string(),
        component: component.to_string(),
        kind: kind.to_string(),
        message,
        code: code.map(str::to_string),
        severity: code.map(|c| diagnostic_severity_for_code(c).to_string()),
    }
}

pub struct CssOutput {
    pub css: String,
    pub sheets: CssSheets,
    pub fragments: CssFragmentStore,
    pub diagnostics: Vec<CssDiagnostic>,
    pub reconciliation: Value,
    /// component_id → replacement payload.
    pub replacement_configs: FxHashMap<String, crate::assemble::ReplacementPayload>,
    pub system_prop_map: BTreeMap<String, BTreeMap<String, String>>,
    pub dynamic_props: BTreeMap<String, DynamicPropMeta>,
    pub component_fragments: BTreeMap<String, crate::css::PerComponentSheets>,
    /// parent id → direct child ids.
    pub reverse_provenance: BTreeMap<String, Vec<String>>,
    /// component id → descriptor, for evaluated survivors only.
    pub components: BTreeMap<String, ComponentDescriptor>,
    /// file path → the component ids defined there.
    pub files_map: BTreeMap<String, Vec<String>>,
    pub usage_residue: Vec<UsageResidueRecord>,
    /// The loaded system's configured transform sources that passed
    /// admission and registered, by definition key: the runtime registry's
    /// only input.
    pub admitted_transforms: BTreeMap<String, String>,
    /// Sorted system props bound to a configured transform, whose static
    /// map keys are typed value keys.
    pub typed_system_props: Vec<String>,
}

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

/// Resolve an import specifier against the analyzed file set. Re-export hops
/// are not followed here; callers use `follow_reexports`.
pub fn resolve_import_source<T>(
    from_file: &str,
    spec: &str,
    files: &BTreeMap<String, T>,
    inputs: &CssInputs,
) -> Option<String> {
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

/// Candidate order decides which file wins when several extensions exist.
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

/// Follow `export { X as Y } from '...'` hops to the file defining the name.
/// Cycle-guarded; an unresolvable hop returns the last node reached.
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

/// `Some(true)` = an extractable chain, `Some(false)` = a chain that failed
/// its own extraction, `None` = no chain for that binding.
fn chain_extractable(
    files: &BTreeMap<String, FileFacts>,
    file: &str,
    binding: &str,
) -> Option<bool> {
    files.get(file).and_then(|ff| {
        ff.chains
            .iter()
            .filter(|c| c.descriptor.binding == binding)
            .map(|c| c.descriptor.extractable)
            .reduce(|a, b| a || b)
    })
}

fn parent_unresolvable_reason(named: &str) -> String {
    format!("chain dropped: could not resolve parent component '{}'", named)
}

fn parent_failed_reason(named: &str) -> String {
    format!(
        "chain dropped: parent chain '{}' failed evaluation before extension",
        named
    )
}

fn classify_parent(
    files: &BTreeMap<String, FileFacts>,
    file: &str,
    binding: &str,
    as_written: &str,
) -> Result<String, String> {
    match chain_extractable(files, file, binding) {
        Some(true) => Ok(format!("{}::{}", file, binding)),
        Some(false) => Err(parent_failed_reason(binding)),
        None => Err(parent_unresolvable_reason(as_written)),
    }
}

/// Where a name visible in `file_path` is declared: the landing file, the
/// declarator binding there, and whether that file declares it itself.
/// None when the name's import source is outside the analyzed set.
fn resolve_declaration(
    file_path: &str,
    ff: &FileFacts,
    name: &str,
    files: &BTreeMap<String, FileFacts>,
    inputs: &CssInputs,
) -> Option<(String, String, bool)> {
    let Some(imp) = ff.imports.iter().find(|i| i.local == name) else {
        return Some((file_path.to_string(), name.to_string(), true));
    };
    resolve_export(file_path, &imp.source, &imp.imported, files, inputs)
}

/// The declaration `imported` from `specifier` lands on, through analyzed
/// re-exports, and whether that file declares it locally.
fn resolve_export(
    file_path: &str,
    specifier: &str,
    imported: &str,
    files: &BTreeMap<String, FileFacts>,
    inputs: &CssInputs,
) -> Option<(String, String, bool)> {
    let f = resolve_import_source(file_path, specifier, files, inputs)?;
    let (pf, pn) = follow_reexports(f, imported.to_string(), files, inputs);
    let landing = files.get(&pf);

    // Component ids key on the DECLARATOR, not the exported name, so an
    // aliased export resolves through the export fact's `local`.
    let local_export = landing.and_then(|pff| {
        pff.exports
            .iter()
            .find(|e| e.exported == pn && e.source.is_none())
    });
    let binding = local_export.and_then(|e| e.local.clone()).unwrap_or(pn);

    // A barrel records `local: Some(X)`, `source: None` for a name it merely
    // imported, so `local` is a declarator only when the file declares it.
    let locally_defined = landing.is_some_and(|pff| {
        let imported_here = pff.imports.iter().any(|i| i.local == binding);
        !imported_here
            && (local_export.is_some()
                || pff.chains.iter().any(|c| c.descriptor.binding == binding))
    });
    Some((pf, binding, locally_defined))
}

/// A parent bails only when its landing file is in the analyzed set AND
/// declares the name locally; barrels and outside files stay standalone.
fn resolve_extension_parent(
    file_path: &str,
    ff: &FileFacts,
    extends_binding: &str,
    files: &BTreeMap<String, FileFacts>,
    inputs: &CssInputs,
) -> Result<String, String> {
    match resolve_declaration(file_path, ff, extends_binding, files, inputs) {
        None => Err(parent_unresolvable_reason(extends_binding)),
        // Nothing proven about the parent: keep the standalone fallback.
        Some((file, binding, false)) => Ok(format!("{}::{}", file, binding)),
        Some((file, binding, true)) => classify_parent(files, &file, &binding, extends_binding),
    }
}

/// Whether `name` in `file` is built from an `@animus-ui/system` import,
/// traced through analyzed imports, re-exports and `const` initializers.
/// Chain method names prove nothing: another library's builder has them too.
fn has_animus_origin(
    file: &str,
    name: &str,
    files: &BTreeMap<String, FileFacts>,
    inputs: &CssInputs,
    seen: &mut FxHashSet<(String, String)>,
) -> bool {
    if !seen.insert((file.to_string(), name.to_string())) {
        return false;
    }
    let Some(ff) = files.get(file) else {
        return false;
    };
    if ff
        .imports
        .iter()
        .any(|i| i.local == name && is_animus_system_specifier(&i.source))
    {
        return true;
    }
    let Some((declaring_file, binding, true)) = resolve_declaration(file, ff, name, files, inputs)
    else {
        return false;
    };
    let root = files
        .get(&declaring_file)
        .and_then(|dff| dff.declaration_roots.get(&binding))
        .cloned();
    root.is_some_and(|root| has_animus_origin(&declaring_file, &root, files, inputs, seen))
}

/// The component an `Object.member` extension parent names — `(file,
/// binding)` — when `Object` is an exported object literal whose member is a
/// chain of Animus origin. None when that provenance is not established.
fn member_parent_component(
    file_path: &str,
    ff: &FileFacts,
    extension: &MemberParentExtension,
    files: &BTreeMap<String, FileFacts>,
    inputs: &CssInputs,
) -> Option<(String, String)> {
    let Some((object_file, object_binding, true)) =
        resolve_declaration(file_path, ff, &extension.object, files, inputs)
    else {
        return None;
    };
    let object_ff = files.get(&object_file)?;
    let exported = object_ff
        .exports
        .iter()
        .any(|e| e.source.is_none() && e.local.as_deref() == Some(object_binding.as_str()));
    if !exported {
        return None;
    }
    let value = object_ff
        .object_members
        .get(&object_binding)?
        .get(&extension.member)?;
    let Some((component_file, component, true)) =
        resolve_declaration(&object_file, object_ff, value, files, inputs)
    else {
        return None;
    };
    let is_chain = files
        .get(&component_file)?
        .chains
        .iter()
        .any(|c| c.descriptor.binding == component);
    let animus = is_chain
        && has_animus_origin(
            &component_file,
            &component,
            files,
            inputs,
            &mut FxHashSet::default(),
        );
    animus.then_some((component_file, component))
}

fn unsupported_member_parent_bail(
    file: &str,
    extension: &MemberParentExtension,
    (component_file, component): (String, String),
) -> CssDiagnostic {
    diagnostic(
        file,
        &extension.binding,
        "bail",
        format!(
            "chain dropped: parent '{object}.{member}' is a member of exported object \
             '{object}', and member-parent extension is not supported; the declaration \
             in {file} is left untransformed — extend '{component}' from \
             {component_file} directly",
            object = extension.object,
            member = extension.member,
        ),
        Some(UNSUPPORTED_MEMBER_PARENT),
    )
}

/// The bail for a chain the walker could not extract. A chain of proven
/// Animus origin whose reason is a known unsupported form is classified;
/// any other keeps the walker's plain bail.
fn unextractable_chain_bail(file: &str, binding: &str, reason: &str, animus: bool) -> CssDiagnostic {
    let left = format!("the declaration in {file} is left untransformed");
    let classified = if !animus {
        None
    } else if let Some(method) = reason.strip_prefix("unknown chain method: ") {
        Some((
            format!(
                "chain dropped: unknown chain method '{method}'; {left} — use only the \
                 supported builder methods ({}, extend) before the terminal",
                crate::chain_walk::CHAIN_METHODS.join(", ")
            ),
            UNSUPPORTED_CHAIN_METHOD,
        ))
    } else if reason.starts_with("asComponent: ") {
        Some((
            format!(
                "chain dropped: {reason}; {left} — pass the target as an identifier or \
                 static member path"
            ),
            UNSUPPORTED_TERMINAL_TARGET,
        ))
    } else if reason == "extend with arguments is not supported" {
        Some((
            format!(
                "chain dropped: .extend() was called with arguments; {left} — call \
                 .extend() with no arguments and add styles in the stages that follow it"
            ),
            UNSUPPORTED_EXTEND_ARGUMENTS,
        ))
    } else {
        None
    };
    match classified {
        Some((message, code)) => diagnostic(file, binding, "bail", message, Some(code)),
        None => diagnostic(file, binding, "bail", reason.to_string(), None),
    }
}

/// A `.props()` custom prop of a proven Animus chain whose `transform`
/// callback extraction dropped.
fn unsupported_transform_reference(
    file: &str,
    binding: &str,
    (prop, reason): &(String, String),
) -> CssDiagnostic {
    diagnostic(
        file,
        binding,
        "warn",
        format!(
            "custom prop '{prop}' in {file} lost its transform callback ({reason}), so \
             '{prop}' values would apply as raw CSS values — write the transform inside the \
             .props() object literal, inline as `transform: (value) => …` or as a reference \
             to a const function, a never-reassigned function declaration or a const created \
             by createTransform imported from @animus-ui/system, declared in this module or \
             imported, through named re-exports too, from an analyzed source module"
        ),
        Some(UNSUPPORTED_TRANSFORM_REFERENCE),
    )
}

/// A warning, never escalated by build strictness: the prop keeps its raw
/// value on both paths, as an untransformed prop does.
fn unbound_transform_name(
    file: &str,
    binding: &str,
    unbound: &crate::pipeline::UnboundTransform,
) -> CssDiagnostic {
    let crate::pipeline::UnboundTransform { prop, name, candidates } = unbound;
    let (carriers, advice) = match candidates {
        0 => (
            "no configured transform carries".to_string(),
            "bind a configured transform with that name",
        ),
        n => (
            format!("{n} configured transforms carry"),
            "give the configured transforms distinct names",
        ),
    };
    diagnostic(
        file,
        binding,
        "warn",
        format!(
            "custom prop '{prop}' in {file} names transform '{name}', which {carriers}, \
             so it binds no transform and '{prop}' values apply as raw CSS values — \
             {advice} or write the transform inline inside the .props() object literal"
        ),
        None,
    )
}

/// Keeps the authored value so the omission can be traced to its source.
fn strict_token_miss(file: &str, component: &str, miss: &StrictTokenMiss) -> CssDiagnostic {
    let authored = serde_json::to_string(&miss.value).unwrap_or_default();
    let listed: Vec<String> = miss
        .rejected
        .iter()
        .filter_map(|(breakpoint, entry)| breakpoint.as_deref().map(|bp| format!("{entry} at {bp}")))
        .collect();
    let entries = if listed.is_empty() {
        String::new()
    } else {
        format!(" ({})", listed.join(", "))
    };
    diagnostic(
        file,
        component,
        "warn",
        format!(
            "prop '{}' value {authored} is not a token of its strict scale{entries}; its \
             styling is omitted — use a scale key, or declare the prop strict: false to \
             accept raw values",
            miss.prop
        ),
        Some(STRICT_TOKEN_MISS),
    )
}

fn drain_strict_token_misses(
    sink: &StrictTokenMissSink,
    file: &str,
    component: &str,
    diagnostics: &mut Vec<CssDiagnostic>,
) {
    for miss in sink.borrow_mut().drain(..) {
        diagnostics.push(strict_token_miss(file, component, &miss));
    }
}

/// A `.props()` custom prop of a proven Animus chain whose whole config
/// the evaluator skipped, so it is no styling prop at all.
fn unsupported_props_config(
    file: &str,
    binding: &str,
    (prop, reason): &(String, String),
) -> CssDiagnostic {
    diagnostic(
        file,
        binding,
        "warn",
        format!(
            "custom prop '{prop}' in {file} was dropped ({reason}), so it is not extracted \
             as a styling prop — write its config as an object literal of static values \
             inside .props(), without spreads, calls or unresolved references"
        ),
        Some(UNSUPPORTED_PROPS_CONFIG),
    )
}

/// The chain a module default-exports, when its root has proven Animus
/// origin; the walker never makes it a chain.
fn unsupported_default_export(
    file: &str,
    ff: &FileFacts,
    files: &BTreeMap<String, FileFacts>,
    inputs: &CssInputs,
) -> Option<CssDiagnostic> {
    let export = ff.default_export_chain.as_ref()?;
    let root = export.root.as_deref()?;
    has_animus_origin(file, root, files, inputs, &mut FxHashSet::default()).then(|| {
        diagnostic(
            file,
            "default",
            "bail",
            format!(
                "chain dropped: the default-exported chain at {file}:{}:{} is not \
                 extracted, since extraction collects only top-level const declarations; \
                 it is left untransformed — declare it as `export const Name = …` and \
                 `export default Name`",
                export.line, export.column
            ),
            Some(UNSUPPORTED_DEFAULT_EXPORT),
        )
    })
}

/// A chain rooted in `ns.member` where `ns` is a namespace import of an
/// analyzed module whose `member` has proven Animus origin.
fn unsupported_namespace_root(
    file: &str,
    ff: &FileFacts,
    chain: &crate::chain_walk::MemberRootedChain,
    files: &BTreeMap<String, FileFacts>,
    inputs: &CssInputs,
) -> Option<CssDiagnostic> {
    let specifier = ff.namespace_imports.get(&chain.object)?;
    let Some((defining_file, defining_name, true)) =
        resolve_export(file, specifier, &chain.member, files, inputs)
    else {
        return None;
    };
    has_animus_origin(
        &defining_file,
        &defining_name,
        files,
        inputs,
        &mut FxHashSet::default(),
    )
    .then(|| {
        diagnostic(
            file,
            &chain.binding,
            "bail",
            format!(
                "chain dropped: its root '{object}.{member}' reads '{member}' through \
                 namespace import '{object}'; the declaration in {file} is left \
                 untransformed — use a named import (import {{ {member} }} from \
                 '{specifier}') and build from '{member}'",
                object = chain.object,
                member = chain.member,
            ),
            Some(UNSUPPORTED_NAMESPACE_ROOT),
        )
    })
}

/// Brace spans surviving resolution are unresolved token aliases: the resolver
/// passes them through verbatim and resolved values never contain braces.
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
            code: None,
            severity: None,
        });
        false
    });
}

/// Properties whose values legitimately carry dotted bare identifiers, so a
/// dotted value there is never evidence of an unresolved token.
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

/// A bare dotted token path, `^[A-Za-z][\w-]*(\.[\w-]+)+$`. Never valid
/// standalone CSS for a color or a length, which makes the warn safe.
fn is_token_shaped_value(value: &str) -> bool {
    let mut chars = value.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() => {}
        _ => return false,
    }
    let mut segment_len = 1usize;
    let mut dots = 0usize;
    for c in chars {
        if c == '.' {
            if segment_len == 0 {
                return false;
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

/// Warns without dropping: the value may be legal under another theme or
/// arrive through a spread, and browsers discard an invalid declaration.
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
        code: None,
        severity: None,
    });
}

/// Inline object/array scales resolve locally, so only string scales map.
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

/// A possible unresolved scale key (bare segment or dotted path). Broad on
/// purpose: the TS-side join filters candidates against the source manifest.
fn is_scale_key_shaped_value(value: &str) -> bool {
    let mut segment_len = 0usize;
    for (i, c) in value.chars().enumerate() {
        if c == '.' {
            if segment_len == 0 {
                return false;
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

/// Bare values presumed CSS literals even when a source package defines a
/// same-named token; reporting them would fail correct strict-mode builds.
const CSS_KEYWORD_VALUES: &[&str] = &[
    "inherit",
    "initial",
    "unset",
    "revert",
    "revert-layer",
    "auto",
    "none",
    "normal",
    "transparent",
    "currentcolor",
    "bold",
    "bolder",
    "lighter",
];

fn is_css_keyword_value(value: &str) -> bool {
    CSS_KEYWORD_VALUES
        .iter()
        .any(|kw| value.eq_ignore_ascii_case(kw))
}

struct CandidateWalk<'a> {
    scale_names: &'a FxHashMap<String, String>,
    theme: &'a FlatTheme,
    file: &'a str,
    component: &'a str,
}

fn record_external_candidates_in_decls(
    walk: &CandidateWalk<'_>,
    decls: &[CssDeclaration],
    diagnostics: &mut Vec<CssDiagnostic>,
) {
    let CandidateWalk { scale_names, theme, file, component } = *walk;
    for d in decls {
        if d.property.starts_with("--") {
            continue;
        }
        // A brace alias carries its own token path and may sit on any
        // property; a bare survivor needs a scale-qualified, non-exempt one.
        let spans = unresolved_alias_spans(&d.value);
        let tokens: Vec<String> = if spans.is_empty() {
            if TOKEN_SHAPE_EXEMPT_PROPERTIES.contains(&d.property.as_str()) {
                continue;
            }
            let Some(scale) = scale_names.get(&d.property) else {
                continue;
            };
            if !is_scale_key_shaped_value(&d.value) || is_css_keyword_value(&d.value) {
                continue;
            }
            let synthesized = format!("{}.{}", scale, d.value);
            // An identity-valued token round-trips: its resolved value
            // re-synthesizes its own path, so a theme hit means it resolved.
            if theme.contains_key(&synthesized) {
                continue;
            }
            vec![synthesized]
        } else {
            spans
                .iter()
                .map(|s| {
                    let content = s.trim_matches(|c| c == '{' || c == '}');
                    // `{colors.primary/40}`: the token is the path before
                    // the alpha suffix.
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
                code: None,
                severity: None,
            });
        }
    }
}

fn record_external_candidates_in_styles(
    walk: &CandidateWalk<'_>,
    styles: &ResolvedStyles,
    diagnostics: &mut Vec<CssDiagnostic>,
) {
    record_external_candidates_in_decls(walk, &styles.declarations, diagnostics);
    for (_, decls) in &styles.pseudo_selectors {
        record_external_candidates_in_decls(walk, decls, diagnostics);
    }
    for group in &styles.conditioned {
        record_external_candidates_in_decls(walk, &group.declarations, diagnostics);
    }
}

/// Runs before the alias shed, so unresolved brace aliases still contribute
/// their token paths. Its diagnostic kind is consumed by the TS-side join.
fn record_external_token_candidates(
    walk: &CandidateWalk<'_>,
    css: &ComponentCss,
    diagnostics: &mut Vec<CssDiagnostic>,
) {
    if let Some(base) = css.base.as_ref() {
        record_external_candidates_in_styles(walk, base, diagnostics);
    }
    for vc in &css.variants {
        for (_, styles) in &vc.options {
            record_external_candidates_in_styles(walk, styles, diagnostics);
        }
    }
    for styles in &css.compounds {
        record_external_candidates_in_styles(walk, styles, diagnostics);
    }
    for (_, styles) in &css.states {
        record_external_candidates_in_styles(walk, styles, diagnostics);
    }
}

/// Paths come from the host's `path.relative`, so Windows sends backslashes;
/// normalization is for comparison only and diagnostics keep authored paths.
fn is_external_file(file: &str, external_dirs: &[String]) -> bool {
    if external_dirs.is_empty() {
        return false;
    }
    let file = file.replace('\\', "/");
    external_dirs.iter().any(|dir| {
        let dir = dir.replace('\\', "/");
        let dir = dir.trim_end_matches('/');
        !dir.is_empty()
            && file
                .strip_prefix(dir)
                .is_some_and(|rest| rest.starts_with('/'))
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

/// Why a chain was dropped at a stage: its argument could not be evaluated,
/// or it evaluated to a config of the wrong shape.
enum DropCause<'a> {
    Unevaluable { config_identifier: Option<&'a str> },
    /// Carries the offending custom prop when one config alone fails.
    InvalidShape { offending: Option<String> },
}

/// The declaration props among `props` with a runtime slot.
fn runtime_declarations_of<'a>(
    props: impl Iterator<Item = &'a String>,
    config: &PropConfigMap,
) -> Vec<(String, Arc<DeclarationBinding>)> {
    props
        .filter_map(|prop| Some((prop.clone(), Arc::clone(config.get(prop)?.declaration.binding.as_ref()?))))
        .collect()
}

/// `animus` classifies the drop; a chain of unproven origin keeps the plain
/// bail, since only Animus provenance makes the loss an Animus failure.
fn emit_eval_drop_bail(
    diagnostics: &mut Vec<CssDiagnostic>,
    file: &str,
    binding: &str,
    stage: &str,
    cause: DropCause<'_>,
    detail: &str,
    animus: bool,
) {
    let left = format!("the declaration in {file} is left untransformed");
    let (message, code) = match (cause, animus) {
        (_, false) => (
            format!("chain dropped: stage '{stage}' evaluation failed — {detail}"),
            None,
        ),
        (DropCause::InvalidShape { offending }, true) => (
            format!(
                "chain dropped: stage '{stage}' config is invalid — {}; {left} — \
                 write each custom prop in the documented .props() shape, \
                 {{ property: '<css property>' }} with optional properties, scale, \
                 negative and transform",
                offending.as_deref().unwrap_or(detail)
            ),
            Some(STAGE_EVALUATION_FAILED),
        ),
        (DropCause::Unevaluable { config_identifier: Some(identifier) }, true) => (
            format!(
                "chain dropped: .variant({identifier}) passes the whole variant config \
                 through identifier '{identifier}', which extraction cannot evaluate; \
                 {left} — write the config inline as .variant({{ prop: '…', variants: … }}); \
                 its options table may stay a shared identifier (variants: TABLE)"
            ),
            Some(UNSUPPORTED_VARIANT_CONFIG_REFERENCE),
        ),
        (DropCause::Unevaluable { config_identifier: None }, true) => (
            format!(
                "chain dropped: stage '{stage}' evaluation failed — {detail}; {left} — \
                 pass an object literal, or a module-level const object of static values"
            ),
            Some(STAGE_EVALUATION_FAILED),
        ),
    };
    diagnostics.push(diagnostic(file, binding, "bail", message, code));
}

/// Slot bindings are local identifiers, resolved in the composing file.
fn resolve_compose_slot_class<'a>(
    family_file: &str,
    binding: &str,
    files: &BTreeMap<String, FileFacts>,
    inputs: &CssInputs,
    id_to_class: &FxHashMap<&str, &'a str>,
) -> Option<&'a str> {
    let binding = resolve_alias_terminal(family_file, binding, files);
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

fn emit_compose_slot_bail(
    diagnostics: &mut Vec<CssDiagnostic>,
    file: &str,
    family_name: &str,
    slot_name: &str,
    binding: &str,
) {
    diagnostics.push(diagnostic(
        file,
        family_name,
        "bail",
        format!(
            "compose slot '{}' names binding '{}', which resolves to no extracted \
             component in this file or through its imports — composed variant CSS dropped",
            slot_name, binding
        ),
        Some(COMPOSE_UNRESOLVABLE_SLOT),
    ));
}

/// Runs before the extension merge, so parent contributions are already shed
/// and each leak is diagnosed once, on its defining component.
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

// Usage maps are keyed by component id (`{file}::{binding}`); bare-binding
// fallback keys share the space and are told apart by the absence of `::`.

/// bare binding → the component ids that define it, in `sorted_ids` order.
type IdsByBinding = FxHashMap<String, Vec<String>>;

/// For report text and the residue record only — never as a map key.
fn binding_of(component_id: &str) -> &str {
    component_id
        .rfind("::")
        .map(|pos| &component_id[pos + 2..])
        .unwrap_or(component_id)
}

/// Follow a file's local `const X = Y;` aliases to the terminal name.
/// A name with no alias entry, or one in a cycle, resolves to itself.
fn resolve_alias_terminal<'a>(
    file: &str,
    binding: &'a str,
    files: &'a BTreeMap<String, FileFacts>,
) -> &'a str {
    let Some(aliases) = files.get(file).map(|ff| &ff.aliases) else {
        return binding;
    };
    let mut current = binding;
    let mut visited: FxHashSet<&str> = FxHashSet::default();
    while let Some(next) = aliases.get(current) {
        if !visited.insert(current) {
            return binding;
        }
        current = next.as_str();
    }
    current
}

fn resolve_usage_identity(
    file: &str,
    local: &str,
    files: &BTreeMap<String, FileFacts>,
    inputs: &CssInputs,
    evaluated_ids: &FxHashSet<String>,
    ids_by_binding: &IdsByBinding,
) -> Vec<String> {
    // Dotted member path: the root resolves through the import table and the
    // last segment names the component there (`const Compound = { Item }`).
    if let Some((path_head, last)) = local.rsplit_once('.') {
        let root = path_head.split('.').next().unwrap_or(path_head);
        let root_file = files
            .get(file)
            .and_then(|ff| ff.imports.iter().find(|i| i.local == root))
            .and_then(|imp| resolve_import_source(file, &imp.source, files, inputs))
            .unwrap_or_else(|| file.to_string());
        let local_id = format!("{}::{}", root_file, last);
        if evaluated_ids.contains(&local_id) {
            return vec![local_id];
        }
        return ids_by_binding.get(last).cloned().unwrap_or_default();
    }
    let local = resolve_alias_terminal(file, local, files);
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
            // Without this walk a renamed consumer's usage never reaches the
            // chain, and another consumer prunes the variant it renders.
            let (mut terminal_file, mut terminal_name) =
                follow_reexports(source_file, imp.imported.clone(), files, inputs);
            let mut hop_guard: FxHashSet<(String, String)> = FxHashSet::default();
            loop {
                let terminal_id = format!("{}::{}", terminal_file, terminal_name);
                if evaluated_ids.contains(&terminal_id) {
                    return vec![terminal_id];
                }
                if !hop_guard.insert((terminal_file.clone(), terminal_name.clone())) {
                    break;
                }
                let Some(ff) = files.get(&terminal_file) else {
                    break;
                };
                if let Some(local) = ff
                    .exports
                    .iter()
                    .find(|e| e.exported == terminal_name && e.source.is_none())
                    .and_then(|e| e.local.clone())
                {
                    if local != terminal_name {
                        terminal_name = local;
                        continue;
                    }
                }
                let Some(hop) = ff.imports.iter().find(|i| i.local == terminal_name) else {
                    break;
                };
                let Some(next) = resolve_import_source(&terminal_file, &hop.source, files, inputs)
                else {
                    break;
                };
                let (next_file, next_name) =
                    follow_reexports(next, hop.imported.clone(), files, inputs);
                terminal_file = next_file;
                terminal_name = next_name;
            }
        }
        return ids_by_binding
            .get(&imp.imported)
            .cloned()
            .unwrap_or_default();
    }
    ids_by_binding.get(local).cloned().unwrap_or_default()
}

/// The maps the per-file JSX filter consults. All four share one lookup-key
/// space: component ids plus bare bindings.
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
    /// Values union over the candidates: the filter reads only key sets, so a
    /// union is sound for an ambiguous name and exact for a single component.
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
        // An empty set and a missing key behave the same downstream, but the
        // emptiness gates observe the missing key.
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

/// The props a confined component receives, read from the raw attribute
/// syntax of its JSX elements, the only places it is rendered. Unlike the
/// usage scans, a value only statics resolve (possibly a mutable object or an
/// import) or an element-valued attribute counts as a runtime value here.
#[derive(Default)]
struct ConfinedUse {
    /// A spread attribute can deliver any prop.
    spread: bool,
    /// Props with an attribute value that is not a literal.
    runtime_props: FxHashSet<String>,
    static_values: FxHashMap<String, Vec<Value>>,
}

impl ConfinedUse {
    /// Every value `prop` can receive is a literal for which `has_class` holds.
    fn covers(&self, prop: &str, has_class: impl Fn(&Value) -> bool) -> bool {
        !self.spread
            && !self.runtime_props.contains(prop)
            && self.static_values.get(prop).is_none_or(|values| values.iter().all(has_class))
    }
}

/// The evaluated components whose module confines them, keyed by id.
fn confined_uses(
    files: &BTreeMap<String, FileFacts>,
    chain_lookup: &FxHashMap<&str, (&str, usize)>,
    evaluated_ids: &FxHashSet<String>,
) -> FxHashMap<String, ConfinedUse> {
    let mut uses = FxHashMap::default();
    for component_id in evaluated_ids {
        let Some((file, chain_idx)) = chain_lookup.get(component_id.as_str()) else {
            continue;
        };
        let ff = &files[*file];
        let binding = &ff.chains[*chain_idx].descriptor.binding;
        if !ff.confined_components.contains(binding) {
            continue;
        }
        let mut confined = ConfinedUse::default();
        for fact in &ff.usage {
            let UsageFact::Element { tag: TagFact::Ident(tag), attrs, spread } = fact else {
                continue;
            };
            if tag != binding {
                continue;
            }
            confined.spread |= *spread;
            for attr in attrs {
                match (&attr.static_value, attr.dynamic) {
                    (Some(value), false) => confined
                        .static_values
                        .entry(attr.name.clone())
                        .or_default()
                        .push(value.clone()),
                    _ => {
                        confined.runtime_props.insert(attr.name.clone());
                    }
                }
            }
        }
        uses.insert(component_id.clone(), confined);
    }
    uses
}

#[derive(Default)]
struct UsageIdentityPolicy {
    rendered_ids: FxHashSet<String>,
    uncertain: bool,
}

impl UsageIdentityPolicy {
    /// An unresolved key makes the run identity-uncertain and comes back
    /// as-is; dropping the record would delete the utility CSS it feeds.
    fn resolve_all(&mut self, key: &str, attribution: &IdsByBinding) -> Vec<String> {
        match attribution.get(key) {
            Some(ids) => ids.clone(),
            None => {
                self.uncertain = true;
                vec![key.to_string()]
            }
        }
    }

    /// One representative id, for records whose binding is unread downstream.
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

/// staticCss names components by binding, so the comparison happens there.
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

/// A forced declaration is a statement about the NAME, so it keeps every
/// component that answers to it.
fn expand_forced_scan(scan: UsageScanResult, ids_by_binding: &IdsByBinding) -> UsageScanResult {
    let ids_for = |binding: &str| ids_by_binding.get(binding).cloned().unwrap_or_default();
    let mut out = UsageScanResult {
        // System-prop values ride the utility stream by (prop, value), so the
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

/// An error diagnostic held until reconciliation decides what ships: emitting
/// at drain time would fail production builds over pruned declarations.
struct DeferredComponentError {
    component_id: String,
    /// `(variant prop, option name)`; `None` = a failure outside any variant
    /// option, which survives as long as its component does.
    variant_origin: Option<(String, String)>,
    /// Reported once among the entries carrying the same diagnostic, as an
    /// inherited callback's failure surfaced through several extensions is.
    once: bool,
    diagnostic: CssDiagnostic,
}

/// What makes two reports of one failure the same report.
type ReportKey = (String, String, String);

fn report_key(diagnostic: &CssDiagnostic) -> ReportKey {
    (diagnostic.file.clone(), diagnostic.component.clone(), diagnostic.message.clone())
}

fn resolve_deferred_component_errors(
    deferred: &mut Vec<DeferredComponentError>,
    reconciled: &[(String, ComponentCss)],
    diagnostics: &mut Vec<CssDiagnostic>,
) {
    let by_id: FxHashMap<&str, &ComponentCss> = reconciled
        .iter()
        .map(|(id, css)| (id.as_str(), css))
        .collect();
    let mut reported_once: FxHashSet<ReportKey> = FxHashSet::default();
    for entry in deferred.drain(..) {
        let Some(component) = by_id.get(entry.component_id.as_str()) else {
            // Component eliminated wholesale — none of its CSS ships.
            continue;
        };
        if let Some((prop, option)) = &entry.variant_origin {
            let survives = component
                .variants
                .iter()
                .find(|variant| &variant.prop == prop)
                .is_some_and(|variant| {
                    variant.options.iter().any(|(name, _)| name == option)
                });
            if !survives {
                continue;
            }
        }
        let diagnostic = &entry.diagnostic;
        if entry.once && !reported_once.insert(report_key(diagnostic)) {
            continue;
        }
        diagnostics.push(entry.diagnostic);
    }
}

/// The readable name and sorted bound props of each configured definition,
/// by registry key.
fn configured_definitions(config: &PropConfigMap) -> FxHashMap<&str, (&str, Vec<&str>)> {
    let mut definitions: FxHashMap<&str, (&str, Vec<&str>)> = FxHashMap::default();
    for (prop, entry) in config {
        if let Some((key, name)) = entry.bound_definition() {
            definitions.entry(key).or_insert((name, Vec::new())).1.push(prop);
        }
    }
    for (_, props) in definitions.values_mut() {
        props.sort_unstable();
    }
    definitions
}

/// ` bound to prop 'a'` or ` bound to props 'a', 'b'`; empty without props.
fn bound_props_clause(props: &[&str]) -> String {
    let quoted: Vec<String> = props.iter().map(|prop| format!("'{prop}'")).collect();
    match quoted.as_slice() {
        [] => String::new(),
        [prop] => format!(" bound to prop {prop}"),
        props => format!(" bound to props {}", props.join(", ")),
    }
}

/// Whether `definition` is registered for evaluation, admitting it on first
/// use; a callback that cannot be isolated keeps only its runtime delivery,
/// which is no authoring failure.
fn admit_callback(
    definition: &CallbackDefinition,
    evaluator: &TransformEvaluator,
    attempted: &mut FxHashSet<String>,
) -> bool {
    if attempted.insert(definition.key.clone()) {
        if let Some(source) = definition.isolated_source() {
            // A source the engine cannot compile stays unregistered.
            let _ = evaluator.register(&definition.key, &source);
        }
    }
    evaluator.is_registered(&definition.key)
}

fn drain_transform_failures(
    sink: &TransformFailureSink,
    file: &str,
    component: Option<&str>,
    component_id: Option<&str>,
    diagnostics: &mut Vec<CssDiagnostic>,
    deferred: &mut Vec<DeferredComponentError>,
) {
    for failure in sink.borrow_mut().drain(..) {
        // A failure outside a component is a configured transform's: the
        // `system` sentinel, since the configuration carries no location.
        let file = if file.is_empty() { "system" } else { file };
        let component = component
            .map(str::to_string)
            .unwrap_or_else(|| format!("transform '{}'", failure.transform_name));
        let diagnostic = match &failure.failure {
            EvalError::Unevaluable => diagnostic(
                file,
                &component,
                "warn",
                format!(
                    "transform '{}' could not be evaluated during extraction for prop '{}' in {} \
                     (it exhausted its evaluation budget or read the host environment), and this \
                     position has no runtime fallback; raw value applied — keep the callback to its \
                     argument and standard globals, or pass the value as a JSX prop",
                    failure.transform_name, failure.prop, file
                ),
                Some(STATIC_EVALUATION_UNAVAILABLE),
            ),
            EvalError::InvalidResultShape { shape } => CssDiagnostic {
                token: None,
                file: file.to_string(),
                component,
                kind: "error".to_string(),
                message: format!(
                    "transform '{}' returned {} for prop '{}' — transforms must \
                     return a string or finite number; rule-level styling ships \
                     as declaration scales (see composite-style-scales)",
                    failure.transform_name, shape, failure.prop
                ),
                code: None,
                severity: Some("error".to_string()),
            },
            EvalError::Throw { message } => CssDiagnostic {
                token: None,
                file: file.to_string(),
                component,
                kind: "warn".to_string(),
                message: format!(
                    "transform '{}' threw for prop '{}' in {}; raw value \
                     applied as fallback ({})",
                    failure.transform_name, failure.prop, file, message
                ),
                code: None,
                severity: None,
            },
        };
        // Only an error that names a component can be pruned by reconciliation.
        match (&failure.failure, component_id) {
            (EvalError::InvalidResultShape { .. }, Some(id)) => {
                deferred.push(DeferredComponentError {
                    component_id: id.to_string(),
                    variant_origin: failure.variant_origin.clone(),
                    once: false,
                    diagnostic,
                });
            }
            _ => diagnostics.push(diagnostic),
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
    let transform_failures = TransformFailureSink::default();
    let token_misses = StrictTokenMissSink::default();
    let mut diagnostics: Vec<CssDiagnostic> = Vec::new();
    let mut deferred_errors: Vec<DeferredComponentError> = Vec::new();

    // Configured definitions register by identity as isolated definitions,
    // so a same-named project declaration never reaches a configured binding
    // and no evaluation reaches another's realm; a project declaration
    // registers only as an admitted component callback's definition, under
    // its own identity. Sorted for deterministic diagnostics.
    let definitions = configured_definitions(&inputs.config);
    let mut seeded: Vec<(&String, &String)> = inputs.transform_sources.iter().collect();
    seeded.sort_by(|a, b| a.0.cmp(b.0));
    let mut admitted_transforms: BTreeMap<String, String> = BTreeMap::new();
    for (key, source) in seeded {
        let (name, props) = definitions
            .get(key.as_str())
            .map_or((key.as_str(), &[][..]), |(name, props)| (*name, props.as_slice()));
        let bound = bound_props_clause(props);
        let component = format!("createTransform('{}')", name);
        // The system configuration carries no source location for its transforms.
        let rejected_with = |reason: String, advice: &str| {
            diagnostic(
                "system",
                &component,
                "warn",
                format!(
                    "configured transform '{name}'{bound} on the loaded system was rejected before \
                     registration ({reason}), so it is not delivered to the runtime and its \
                     values fall back to the raw value — {advice}"
                ),
                Some(CONFIGURED_TRANSFORM_REJECTED),
            )
        };
        let rejected = |reason: String| {
            rejected_with(
                reason,
                "make it a single self-contained function that uses only its parameters, \
                 standard globals, btoa and atob",
            )
        };
        let hosts = match crate::transforms::admit_configured_host_reads(name, source) {
            Ok(hosts) => hosts,
            Err(rejections) => {
                diagnostics.extend(rejections.into_iter().map(rejected));
                continue;
            }
        };
        // Equal text cannot show which binding of a standard-global name a
        // callable closes over; the loader's evidence for its own function can.
        if let Some(reason) = inputs.transform_provenance.captured_rejection(key, name).filter(|_| hosts.is_empty()) {
            diagnostics.push(rejected_with(
                reason,
                "declare what it reads inside the callback or read the standard global itself; \
                 a configured source is evaluated and delivered as its own text, so it cannot \
                 carry its module's bindings",
            ));
            continue;
        }
        // Its text alone cannot show which `btoa` or `atob` it captured.
        if let Some(reason) = inputs.transform_provenance.host_rejection(key, name, &hosts) {
            diagnostics.push(rejected_with(
                reason,
                "read the host btoa or atob, not a binding of its module or an enclosing \
                 function, and upgrade @animus-ui/system together with the extractor",
            ));
            continue;
        }
        match evaluator.register(key, source) {
            Ok(()) => {
                admitted_transforms.insert(key.clone(), source.clone());
            }
            Err(err) => diagnostics.push(rejected(format!(
                "failed to register transform in evaluator: {err}"
            ))),
        }
    }

    // A reference may capture a declaration of another module.
    let captured: FxHashSet<(&str, &str)> = files
        .values()
        .flat_map(|ff| ff.captured_transform_bindings.iter())
        .map(|(file, binding)| (file.as_str(), binding.as_str()))
        .collect();
    for path in order {
        let Some(ff) = files.get(path) else { continue };
        for t in &ff.transforms {
            let reached = |binding: &String| captured.contains(&(t.file.as_str(), binding.as_str()));
            if !t.valid && !t.binding.as_ref().is_some_and(reached) {
                for diag in &t.diagnostics {
                    diagnostics.push(CssDiagnostic {
                        token: None,
                        file: t.file.clone(),
                        component: format!("createTransform('{}')", t.name),
                        kind: "bail".to_string(),
                        message: diag.clone(),
                        code: None,
                        severity: None,
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
        transform_failures: Some(&transform_failures),
        token_misses: Some(&token_misses),
    };

    let mut parent_map: FxHashMap<String, String> = FxHashMap::default();
    let mut unresolvable_extensions: FxHashSet<String> = FxHashSet::default();
    for (file_path, ff) in files {
        for chain in &ff.chains {
            let d = &chain.descriptor;
            if !d.extractable {
                if let Some(reason) = &d.bail_reason {
                    let animus = has_animus_origin(
                        file_path,
                        &d.binding,
                        files,
                        inputs,
                        &mut FxHashSet::default(),
                    );
                    diagnostics.push(unextractable_chain_bail(file_path, &d.binding, reason, animus));
                }
                continue;
            }
            let component_id = format!("{}::{}", file_path, d.binding);
            if let Some(extends_binding) = &d.extends_from {
                let resolved =
                    resolve_extension_parent(file_path, ff, extends_binding, files, inputs);
                match resolved {
                    Ok(parent_id) => {
                        parent_map.insert(component_id, parent_id);
                    }
                    Err(reason) => {
                        // The child is excluded from `sorted_ids` elsewhere;
                        // this diagnostic is the only witness for that drop.
                        diagnostics.push(CssDiagnostic {
                            token: None,
                            file: file_path.clone(),
                            component: d.binding.clone(),
                            kind: "bail".to_string(),
                            message: reason,
                            code: None,
                            severity: None,
                        });
                        unresolvable_extensions.insert(component_id);
                    }
                }
            }
        }
        for extension in &ff.member_parent_extensions {
            if let Some(component) = member_parent_component(file_path, ff, extension, files, inputs)
            {
                diagnostics.push(unsupported_member_parent_bail(file_path, extension, component));
            }
        }
        for chain in &ff.member_rooted_chains {
            diagnostics.extend(unsupported_namespace_root(file_path, ff, chain, files, inputs));
        }
        diagnostics.extend(unsupported_default_export(file_path, ff, files, inputs));
    }

    let sorted_ids = sorted_resolvable_component_ids(files, &parent_map, &unresolvable_extensions);

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

    type EvalEntry = (
        ComponentCss,
        String,       // binding
        TerminalKind, // terminal
        Option<FxHashSet<String>>,
        Vec<String>, // active group names (sorted)
        Option<PropConfigMap>,
        Vec<(BTreeMap<String, Value>, String)>, // POST-MERGE compound configs
    );
    let mut evaluated: FxHashMap<String, EvalEntry> = FxHashMap::default();
    let scale_family_props = scale_family_css_properties(&inputs.config);
    let scale_names = if inputs.external_dirs.is_empty() {
        FxHashMap::default()
    } else {
        scale_name_by_css_property(&inputs.config)
    };
    let mut inherited_active_props: FxHashMap<String, FxHashSet<String>> = FxHashMap::default();
    // An extension's callback props it reads from its parent's component.
    let mut parent_callbacks: FxHashMap<String, FxHashSet<String>> = FxHashMap::default();
    let mut inherited_variant_configs: FxHashMap<String, VariantConfigs> = FxHashMap::default();

    for component_id in &sorted_ids {
        let Some((file_path, chain_idx)) = chain_lookup.get(component_id.as_str()) else {
            continue;
        };
        let chain = &files[*file_path].chains[*chain_idx];
        // Traced at most once, and only when a failure needs classifying.
        let origin = std::cell::OnceCell::new();
        let animus = || {
            *origin.get_or_init(|| {
                has_animus_origin(
                    file_path,
                    &chain.descriptor.binding,
                    files,
                    inputs,
                    &mut FxHashSet::default(),
                )
            })
        };
        if let Some(fatal) = &chain.fatal_error {
            let failed = chain.stages.iter().find(|s| s.eval_error.is_some());
            emit_eval_drop_bail(
                &mut diagnostics,
                file_path,
                &chain.descriptor.binding,
                failed.map_or("<unknown>", |s| s.method.as_str()),
                DropCause::Unevaluable {
                    config_identifier: failed.and_then(|s| s.config_identifier.as_deref()),
                },
                fatal,
                animus(),
            );
            continue;
        }
        let parent_variant_configs = parent_map
            .get(component_id)
            .and_then(|parent_id| inherited_variant_configs.get(parent_id))
            .map_or(&[][..], Vec::as_slice);
        let merged_chain = inherit_variant_stages(chain, parent_variant_configs);
        // A component's own declaration props bind under its identity; an
        // inherited one keeps the identity of the component that declared it.
        let result = process_chain_facts(
            merged_chain.as_ref().unwrap_or(chain),
            &resolve_ctx,
            &inputs.group_registry,
        )
        .and_then(|mut out| {
            if let Some(own) = out.custom_prop_configs.as_mut() {
                bind_component_declarations(own, &inputs.declaration_scales, &inputs.theme, component_id)
                    .map_err(|detail| ("props".to_string(), detail))?;
            }
            Ok(out)
        });
        // Drained before the match so failures recorded before a later bail
        // still report; topo order keeps emission deterministic.
        drain_transform_failures(
            &transform_failures,
            file_path,
            Some(&chain.descriptor.binding),
            Some(component_id.as_str()),
            &mut diagnostics,
            &mut deferred_errors,
        );
        if merged_chain.is_some() {
            // A parent option merged into this chain was reported at the
            // parent's declaration; only this chain's own declarations remain.
            token_misses.borrow_mut().retain_mut(|miss| {
                let Some((axis, option)) = &miss.variant_origin else {
                    return true;
                };
                miss.rejected.retain(|(breakpoint, entry)| {
                    authors_variant_entry(
                        chain,
                        axis,
                        option.as_deref(),
                        &miss.prop,
                        breakpoint.as_deref(),
                        entry,
                    )
                });
                !miss.rejected.is_empty()
            });
        }
        drain_strict_token_misses(
            &token_misses,
            file_path,
            &chain.descriptor.binding,
            &mut diagnostics,
        );
        match result {
            Ok(out) => {
                let mut component_css = out.component_css;
                let active_props = out.active_prop_names;
                let active_group_names = out.active_group_names;
                let custom_configs =
                    match (parent_map.get(component_id), &chain.descriptor.extends_from) {
                        (Some(parent_id), Some(parent_binding)) => {
                            let (configs, read_from_parent) = inherit_custom_configs(
                                evaluated.get(parent_id).and_then(
                                    |(_, _, _, _, _, parent_custom, _)| parent_custom.as_ref(),
                                ),
                                out.custom_prop_configs,
                                parent_binding,
                            );
                            if !read_from_parent.is_empty() {
                                parent_callbacks.insert(component_id.clone(), read_from_parent);
                            }
                            configs
                        }
                        _ => out.custom_prop_configs,
                    };
                // An extension's own declaration props share its surface with
                // the ones it inherits.
                if let Some(Err(detail)) = custom_configs.as_ref().map(check_surface_overlap) {
                    emit_eval_drop_bail(
                        &mut diagnostics,
                        file_path,
                        &chain.descriptor.binding,
                        "props",
                        DropCause::InvalidShape { offending: None },
                        &detail,
                        animus(),
                    );
                    continue;
                }
                let dropped: Vec<&(String, String)> = chain
                    .stages
                    .iter()
                    .flat_map(|s| &s.dropped_transforms)
                    .collect();
                let dropped_configs: Vec<&(String, String)> = chain
                    .stages
                    .iter()
                    .flat_map(|s| &s.dropped_configs)
                    .collect();
                let classify_drops =
                    !(dropped.is_empty() && dropped_configs.is_empty()) && animus();
                // A classified drop replaces its generic skip line; a
                // const-config drop never had one.
                let mut replaced: Vec<String> = if classify_drops {
                    let binding = &chain.descriptor.binding;
                    dropped
                        .iter()
                        .map(|(_, reason)| crate::pipeline::skip_warning(binding, "transform", reason))
                        .chain(
                            dropped_configs
                                .iter()
                                .map(|(prop, reason)| crate::pipeline::skip_warning(binding, prop, reason)),
                        )
                        .collect()
                } else {
                    Vec::new()
                };
                for unbound in &out.unbound_transforms {
                    diagnostics.push(unbound_transform_name(
                        file_path,
                        &chain.descriptor.binding,
                        unbound,
                    ));
                }
                for warning in &out.skip_warnings {
                    if let Some(index) = replaced.iter().position(|line| line == warning) {
                        replaced.swap_remove(index);
                        continue;
                    }
                    let code = diagnostic_code_from_message(warning);
                    let severity = code
                        .as_deref()
                        .map(|c| diagnostic_severity_for_code(c).to_string());
                    diagnostics.push(CssDiagnostic {
                        token: None,
                        file: file_path.to_string(),
                        component: chain.descriptor.binding.clone(),
                        kind: "skip".to_string(),
                        message: warning.clone(),
                        code,
                        severity,
                    });
                }
                if classify_drops {
                    for dropped in dropped {
                        diagnostics.push(unsupported_transform_reference(
                            file_path,
                            &chain.descriptor.binding,
                            dropped,
                        ));
                    }
                    for dropped in dropped_configs {
                        diagnostics.push(unsupported_props_config(
                            file_path,
                            &chain.descriptor.binding,
                            dropped,
                        ));
                    }
                }

                if is_external_file(file_path, &inputs.external_dirs) {
                    record_external_token_candidates(
                        &CandidateWalk {
                            scale_names: &scale_names,
                            theme: &inputs.theme,
                            file: file_path,
                            component: &chain.descriptor.binding,
                        },
                        &component_css,
                        &mut diagnostics,
                    );
                }

                shed_unresolved_aliases(
                    &mut component_css,
                    &scale_family_props,
                    file_path,
                    &chain.descriptor.binding,
                    &mut diagnostics,
                );

                let variant_configs = effective_variant_configs(chain, parent_variant_configs);
                if !variant_configs.is_empty() {
                    inherited_variant_configs.insert(component_id.clone(), variant_configs);
                }

                let mut compound_configs: Vec<(BTreeMap<String, Value>, String)> = Vec::new();
                {
                    let mut idx = 0usize;
                    for stage in &chain.stages {
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

                                // Child groups replace parent groups by name
                                // (breakpoints) or by conditions+selector.
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

                        // The emitter enumerates merged compounds positionally
                        // under the child class, so index i must name rule i.
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
                emit_eval_drop_bail(
                    &mut diagnostics,
                    file_path,
                    &chain.descriptor.binding,
                    &stage,
                    DropCause::InvalidShape {
                        offending: chain
                            .stages
                            .iter()
                            .find(|s| s.method == "props")
                            .and_then(|s| s.value.as_ref())
                            .and_then(crate::pipeline::invalid_custom_prop),
                    },
                    &detail,
                    animus(),
                );
            }
        }
    }

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

    // Paired with the file whose compose() call declared the family.
    let mut compose_families: Vec<(&String, &ComposeFamilyInfo)> = Vec::new();
    for path in order {
        if let Some(ff) = files.get(path) {
            compose_families.extend(ff.compose.iter().map(|family| (path, family)));
        }
    }
    // A member tag resolves in the file that composed the family, not in the
    // consuming file; an unresolvable slot keeps its raw binding name.
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

    // Each component's own custom configuration: equally named custom props
    // of different components are distinct props.
    let custom_configs_by_id: FxHashMap<&str, &PropConfigMap> = sorted_ids
        .iter()
        .filter_map(|component_id| match evaluated.get(component_id) {
            Some((_, _, _, _, _, Some(custom_configs), _)) => {
                Some((component_id.as_str(), custom_configs))
            }
            _ => None,
        })
        .collect();
    // A literal that misses a strict scale gets no class; it is reported at
    // its usage, which the shared utility stream no longer knows. A value
    // whose configured transform the runtime would resolve differently gets
    // no class either: the runtime finds no key and computes it.
    let admitted_input = |config: &PropConfigMap,
                          file: &str,
                          component: &str,
                          prop_name: &str,
                          value: &Value,
                          diagnostics: &mut Vec<CssDiagnostic>| {
        let prop_config = config.get(prop_name);
        let miss = prop_config.and_then(|prop_config| {
            strict_token_miss_of(prop_name, prop_config, value, &resolve_ctx)
        });
        if let Some(miss) = miss {
            diagnostics.push(strict_token_miss(file, component, &miss));
            return None;
        }
        if prop_config.is_some_and(|prop_config| !extracts_configured_value(prop_config, value, &resolve_ctx)) {
            return None;
        }
        Some(UtilityInput {
            prop_name: prop_name.to_string(),
            value: value.clone(),
        })
    };

    let mut all_utility_inputs: Vec<UtilityInput> = Vec::new();
    let mut all_custom_inputs: Vec<(String, UtilityInput)> = Vec::new();
    let mut attempted_callbacks: FxHashSet<String> = FxHashSet::default();
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
                // Dropping only the attribution entry keeps the tag readable
                // as a component while nothing may be attributed to it.
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
            &lookup.custom_props,
            &lookup.configs,
            &member_expr_bindings,
        );
        identity_policy.attribute_result(&mut usage_result, &lookup.attribution);

        usage_residue.extend(
            usage_result
                .residue_sites
                .iter()
                .map(|site| UsageResidueRecord {
                    binding: binding_of(&site.binding).to_string(),
                    prop: site.prop_name.clone(),
                    file: path.clone(),
                    span: site.span,
                    kind: site.kind,
                }),
        );

        for usage in &usage_result.system_prop_usages {
            all_utility_inputs.extend(admitted_input(
                &inputs.config,
                path,
                binding_of(&usage.binding),
                &usage.prop_name,
                &usage.value,
                &mut diagnostics,
            ));
        }

        if !lookup.custom_props.is_empty() {
            let mut custom_scan = crate::usage_facts::filter_custom_prop_scan(
                ff.usage_for_analysis(),
                &lookup.custom_props,
                &member_expr_bindings,
            );
            custom_scan
                .dynamic_usages
                .extend(crate::usage_facts::uncertain_custom_renders(
                    ff.usage_for_analysis(),
                    &lookup.custom_props,
                    &member_expr_bindings,
                ));
            identity_policy
                .attribute_dynamic_usages(&mut custom_scan.dynamic_usages, &lookup.attribution);
            for usage in &custom_scan.static_usages {
                // An ambiguous binding names every component it may render.
                for owner in identity_policy.resolve_all(&usage.binding, &lookup.attribution) {
                    let Some(config) = custom_configs_by_id.get(owner.as_str()) else {
                        continue;
                    };
                    let Some(prop_config) = config.get(&usage.prop_name) else {
                        continue;
                    };
                    let input = admitted_input(
                        config,
                        path,
                        binding_of(&owner),
                        &usage.prop_name,
                        &usage.value,
                        &mut diagnostics,
                    );
                    // A callback that cannot evaluate this value applies it at runtime.
                    let extracted = match &prop_config.callback {
                        _ if prop_config.transform_fn_source.is_none() => true,
                        Some(callback) => {
                            let definition = &callback.definition;
                            admit_callback(definition, &evaluator, &mut attempted_callbacks)
                                && extracts_callback_value(
                                    prop_config,
                                    &definition.key,
                                    &definition.name,
                                    &usage.value,
                                    &resolve_ctx,
                                )
                        }
                        None => false,
                    };
                    if extracted {
                        all_custom_inputs.extend(input.map(|input| (owner.clone(), input)));
                    }
                }
            }
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
        let observed_ledger = project_ledger_to_bindings(&crate::reconcile::build_ledger(
            &all_usage_results,
            &observed_variant_configs,
        ));

        // Unlike the usage configs, this map keeps variants with no default:
        // staticCss must still recognize them as declared.
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
        for (prop_name, value) in &injection.utility_values {
            all_utility_inputs.extend(admitted_input(
                &inputs.config,
                crate::forced_usage::STATIC_CSS_SOURCE,
                crate::forced_usage::STATIC_CSS_SOURCE,
                prop_name,
                value,
                &mut diagnostics,
            ));
        }
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
    let confined_uses = confined_uses(files, &chain_lookup, &evaluated_ids);
    let utility_classes = resolve_utility_classes(&all_utility_inputs, &resolve_ctx, class_prefix);
    // A system prop keeps its slot while any component it is active on can
    // receive a value without a utility class; a same-named custom prop takes
    // that component's values instead.
    let (proven_static_props, dynamic_prop_names): (FxHashSet<String>, FxHashSet<String>) =
        if total_system_floor {
            let mut uncovered: FxHashSet<&String> = FxHashSet::default();
            for (component_id, (_, _, _, active_props, _, custom_configs, _)) in &evaluated {
                let confined = confined_uses.get(component_id);
                for prop in active_props.iter().flatten() {
                    let custom = custom_configs.as_ref().is_some_and(|configs| configs.contains_key(prop));
                    let covered = confined.is_some_and(|confined| {
                        confined.covers(prop, |value| utility_classes.has_class(prop, value))
                    });
                    if !custom && !covered {
                        uncovered.insert(prop);
                    }
                }
            }
            active_system_prop_names.into_iter().partition(|prop| !uncovered.contains(prop))
        } else {
            (FxHashSet::default(), detected_dynamic_prop_names)
        };

    let typed_system_props = utility_classes.typed_props().clone();
    let mut dynamic_props: HashMap<String, DynamicPropMeta> = HashMap::new();
    for prop_name in &dynamic_prop_names {
        if let Some(prop_config) = inputs.config.get(prop_name.as_str()) {
            if let Some(binding) = prop_config.declaration_binding() {
                dynamic_props.insert(
                    prop_name.clone(),
                    DynamicPropMeta::declarations(class_prefix, prop_name, binding),
                );
                continue;
            }
            let kebab = camel_to_kebab(prop_name);
            dynamic_props.insert(
                prop_name.clone(),
                DynamicPropMeta::new(
                    format!("--{}-{}", class_prefix, kebab),
                    format!("{}-dyn-{}", class_prefix, kebab),
                    prop_config,
                    &inputs.theme,
                    &inputs.contextual_vars,
                ),
            );
        }
    }
    let slot_entries = if !dynamic_props.is_empty() {
        Some(build_variable_slot_entries(&dynamic_props, &breakpoints))
    } else {
        None
    };

    // Consuming rules serve literal and runtime-selected keys alike.
    let runtime_declarations = runtime_declarations_of(dynamic_props.keys(), &inputs.config);

    let utility_output = if !all_utility_inputs.is_empty()
        || slot_entries.is_some()
        || utility_classes.has_declarations()
        || !runtime_declarations.is_empty()
    {
        let out = Some(utility_classes.render(&breakpoints, slot_entries, &runtime_declarations));
        drain_transform_failures(
            &transform_failures,
            "",
            None,
            None,
            &mut diagnostics,
            &mut deferred_errors,
        );
        out
    } else {
        None
    };

    // A component callback's failure belongs to the component whose
    // `.props()` declares the prop, reported once however many extensions
    // surface it, and kept while the rendering owner survives. A
    // configured transform's failure stays the system's.
    let mut reported: FxHashSet<ReportKey> = FxHashSet::default();
    let attribute_callback_failures = |owner: &str, failures: Vec<TransformFailure>| {
        for failure in failures {
            let declarer = custom_configs_by_id
                .get(owner)
                .and_then(|configs| configs.get(&failure.prop)?.callback.as_ref())
                .and_then(|callback| chain_lookup.get(callback.declarer.as_str()));
            let Some((file, chain_idx)) = declarer else {
                transform_failures.borrow_mut().push(failure);
                continue;
            };
            let (mut attributed, mut deferred) = (Vec::new(), Vec::new());
            drain_transform_failures(
                &TransformFailureSink::new(vec![failure]),
                file,
                Some(&files[*file].chains[*chain_idx].descriptor.binding),
                Some(owner),
                &mut attributed,
                &mut deferred,
            );
            diagnostics.extend(attributed.into_iter().filter(|d| reported.insert(report_key(d))));
            deferred_errors.extend(deferred.into_iter().map(|entry| DeferredComponentError { once: true, ..entry }));
        }
    };
    let custom_classes = resolve_custom_prop_classes(
        &all_custom_inputs,
        &custom_configs_by_id,
        &resolve_ctx,
        class_prefix,
        attribute_callback_failures,
    );

    let mut custom_dynamic_by_id: FxHashMap<String, FxHashSet<String>> = FxHashMap::default();
    for dyn_usage in &all_custom_dynamic_usages {
        custom_dynamic_by_id
            .entry(dyn_usage.binding.clone())
            .or_default()
            .insert(dyn_usage.prop_name.clone());
    }
    // A callback prop, inline or naming a configured definition, keeps its
    // slot (and an inline callback its delivery) unless its component is
    // confined and every value the prop receives there has an extracted
    // class: a literal the runtime resolves differently gets no class and
    // needs the slot. Inline text that
    // reads more than its parameters and admitted globals stays delivered:
    // dropping it would drop the imports it reads. Admission checks names
    // alone, so a free name its module imports (an import named `Math`)
    // still reads that import.
    let reads_import = |callback: &crate::transforms::CallbackBinding| {
        let Some((file, _)) = chain_lookup.get(callback.declarer.as_str()) else {
            return true;
        };
        let ff = &files[*file];
        callback.definition.free_names().is_none_or(|names| {
            names.iter().any(|name| {
                ff.imports.iter().any(|import| &import.local == name) || ff.namespace_imports.contains_key(name)
            })
        })
    };
    for (component_id, custom_configs) in &custom_configs_by_id {
        let confined = confined_uses.get(*component_id);
        for (prop_name, config) in custom_configs.iter() {
            // The callback-bound props are the ones whose keys are typed.
            if !config.keys_typed() {
                continue;
            }
            let delivery = config.transform_fn_source.as_deref();
            let covered = confined.is_some_and(|confined| {
                confined.covers(prop_name, |value| custom_classes.has_class(component_id, prop_name, value))
            }) && config.callback.as_ref().is_none_or(|callback| {
                delivery != Some(callback.definition.source.as_str())
                    || (admit_callback(&callback.definition, &evaluator, &mut attempted_callbacks)
                        && !reads_import(callback))
            });
            if !covered {
                custom_dynamic_by_id
                    .entry(component_id.to_string())
                    .or_default()
                    .insert(prop_name.clone());
            }
        }
    }
    // An extension reads an inherited callback from its parent's runtime
    // component, so a parent delivers each callback a delivering extension
    // inherits from it; children precede parents in reverse order.
    for component_id in sorted_ids.iter().rev() {
        let (Some(parent_id), Some(read_from_parent)) =
            (parent_map.get(component_id), parent_callbacks.get(component_id))
        else {
            continue;
        };
        let read: Vec<String> = custom_dynamic_by_id
            .get(component_id)
            .into_iter()
            .flatten()
            .filter(|prop| read_from_parent.contains(*prop))
            .cloned()
            .collect();
        if !read.is_empty() {
            custom_dynamic_by_id.entry(parent_id.clone()).or_default().extend(read);
        }
    }

    let mut per_component_custom_dynamic: FxHashMap<String, HashMap<String, DynamicPropMeta>> =
        FxHashMap::default();
    let mut runtime_custom_declarations: Vec<(String, Arc<DeclarationBinding>)> = Vec::new();
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
        runtime_custom_declarations.extend(runtime_declarations_of(dynamic_props_for_binding.iter(), cc));
        let class_hash = component_css
            .class_name
            .rsplit('-')
            .next()
            .unwrap_or(&component_css.class_name);
        let hash8 = &class_hash[..class_hash.len().min(8)];
        for prop_name in dynamic_props_for_binding {
            if let Some(prop_config) = cc.get(prop_name) {
                if let Some(binding) = prop_config.declaration_binding() {
                    component_dynamic.insert(
                        prop_name.clone(),
                        DynamicPropMeta::declarations(class_prefix, prop_name, binding),
                    );
                    continue;
                }
                let kebab = camel_to_kebab(prop_name);
                component_dynamic.insert(
                    prop_name.clone(),
                    DynamicPropMeta::new(
                        format!("--{}-{}", class_prefix, kebab),
                        format!("{}-dyn-{}-{}", class_prefix, hash8, kebab),
                        prop_config,
                        &inputs.theme,
                        &inputs.contextual_vars,
                    ),
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

    let custom_output = if !all_custom_inputs.is_empty()
        || custom_slot_entries.is_some()
        || custom_classes.has_declarations()
        || !runtime_custom_declarations.is_empty()
    {
        let out = Some(custom_classes.render(&breakpoints, custom_slot_entries, &runtime_custom_declarations));
        drain_transform_failures(
            &transform_failures,
            "",
            None,
            None,
            &mut diagnostics,
            &mut deferred_errors,
        );
        out
    } else {
        None
    };

    // A definition only proven-static props bind leaves the runtime registry
    // unless a delivered binding still reads it.
    let delivered_ids: FxHashSet<&String> = dynamic_props
        .values()
        .chain(per_component_custom_dynamic.values().flat_map(|metas| metas.values()))
        .filter_map(DynamicPropMeta::value)
        .filter(|meta| meta.transform_fn_source.is_none())
        .filter_map(|meta| meta.transform_id.as_ref())
        .collect();
    let unread_ids = proven_static_props
        .iter()
        .filter_map(|prop| inputs.config.get(prop)?.transform_id.as_ref())
        .filter(|id| !delivered_ids.contains(id));
    for id in unread_ids {
        admitted_transforms.remove(id);
    }

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

        // Every declared custom prop is listed, with no classes when none were
        // extracted, so the runtime never resolves it through the system map.
        let custom_prop_class_map = custom_configs.as_ref().filter(|cc| !cc.is_empty()).map(|cc| {
            let own = custom_output
                .as_ref()
                .and_then(|custom_out| custom_out.class_map.get(component_id));
            cc.keys()
                .map(|prop_name| {
                    let classes = own.and_then(|map| map.get(prop_name)).cloned().unwrap_or_default();
                    (prop_name.clone(), classes)
                })
                .collect::<HashMap<String, HashMap<String, String>>>()
        });
        // Only a callback prop with extracted classes needs typed lookups.
        let typed_custom_props: Vec<String> = custom_output
            .as_ref()
            .and_then(|custom_out| custom_out.typed.get(component_id))
            .map(|props| props.iter().cloned().collect())
            .unwrap_or_default();

        let has_system_dynamic_props = active_props
            .as_ref()
            .is_some_and(|props| props.iter().any(|name| dynamic_prop_names.contains(name)));
        let reads_typed_system_props = active_props
            .as_ref()
            .is_some_and(|props| props.iter().any(|name| typed_system_props.contains(name)));
        let has_custom_dynamic_props = per_component_custom_dynamic
            .get(component_id)
            .is_some_and(|config| !config.is_empty());
        let has_dynamic_props = has_system_dynamic_props || has_custom_dynamic_props;

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
                typed_custom_props,
                reads_typed_system_props,
                merged_config,
                drops_parent_reference: parent_callbacks.get(component_id).is_some_and(|inherited| {
                    !inherited.iter().any(|prop| {
                        custom_dynamic_by_id.get(component_id).is_some_and(|delivered| delivered.contains(prop))
                    })
                }),
            },
        );
    }

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

    // The wrapper merges the target's class at runtime, so the target's CSS
    // must survive even though it never appears as a JSX tag itself.
    for component_id in &sorted_ids {
        let Some((file_path, chain_idx)) = chain_lookup.get(component_id.as_str()) else {
            continue;
        };
        let chain = &files[*file_path].chains[*chain_idx];
        if chain.descriptor.terminal != TerminalKind::AsComponent {
            continue;
        }
        let tag = chain.descriptor.tag.as_str();
        if tag.is_empty() {
            continue;
        }
        let target_ids =
            resolve_usage_identity(file_path, tag, files, inputs, &evaluated_ids, &ids_by_binding);
        for id in target_ids {
            if let Some(variant_config) = variant_configs_for_ledger.get(&id) {
                let used = usage_ledger.variant_usage.entry(id.clone()).or_default();
                for (prop, options) in variant_config {
                    used.entry(prop.clone())
                        .or_default()
                        .extend(options.0.iter().cloned());
                }
            }
            if let Some((target_css, _, _, _, _, _, _)) = evaluated.get(&id) {
                if !target_css.states.is_empty() {
                    let states = usage_ledger.state_usage.entry(id.clone()).or_default();
                    for (state_name, _) in &target_css.states {
                        states.insert(state_name.clone());
                    }
                }
            }
            usage_ledger.rendered_components.insert(id);
        }
    }

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

    resolve_deferred_component_errors(
        &mut deferred_errors,
        &reconciled_components,
        &mut diagnostics,
    );

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

    let mut composed_variant_css = String::new();
    let mut composed_compound_css = String::new();
    if !compose_families.is_empty() {
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
            let compound_conditions: CompoundConditionMap = evaluated
                .iter()
                .map(|(_, (css, _, _, _, _, _, configs))| {
                    (css.class_name.as_str(), configs.as_slice())
                })
                .collect();
            composed_compound_css = generate_composed_compound_css(
                &family_refs,
                &component_css_list,
                &compound_conditions,
                &breakpoints,
            );
        }
    }

    // Ancestor forms outrank the flat rules on class count inside the same
    // layer, so no cross-layer precedence moves.
    if !composed_compound_css.is_empty() {
        // Rebuilt from fragments: `extract_layer_content` keeps the newline
        // after the brace, which a second wrap would turn into a blank line.
        let mut compounds_content = fragments.concat_compounds();
        compounds_content.push_str(&composed_compound_css);
        sheets.compounds = wrap_layer("compounds", &compounds_content);
    }

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

    let global_css_raw = if let Some(blocks) = &inputs.global_style_blocks {
        let css = crate::theme::resolve_all_global_blocks(blocks, &resolve_ctx);
        // Global blocks come from system config, not a resolved source file.
        drain_transform_failures(
            &transform_failures,
            "",
            None,
            None,
            &mut diagnostics,
            &mut deferred_errors,
        );
        drain_strict_token_misses(&token_misses, "system", "system", &mut diagnostics);
        css
    } else {
        String::new()
    };
    let keyframes_css_raw = if let Some(blocks) = &inputs.keyframes_blocks {
        let css = crate::theme::resolve_all_keyframes_blocks(blocks, &resolve_ctx);
        drain_transform_failures(
            &transform_failures,
            "",
            None,
            None,
            &mut diagnostics,
            &mut deferred_errors,
        );
        drain_strict_token_misses(&token_misses, "system", "system", &mut diagnostics);
        css
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

    // Global is excluded here; it flows through `sheets`.
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
        admitted_transforms,
        typed_system_props: typed_system_props.into_iter().collect(),
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

    fn diagnostics_of<'a>(out: &'a CssOutput, kind: &str) -> Vec<&'a CssDiagnostic> {
        out.diagnostics.iter().filter(|d| d.kind == kind).collect()
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
    fn as_component_targets_survive_prod_reconciliation() {
        let out = analyze(
            &[(
                "a.tsx",
                "const Inner = ds.styles({ display: 'grid' }).asElement('i');\n\
                 export const Wrapped = ds.styles({ p: 8 }).asComponent(Inner);\n\
                 const Item = ds.styles({ display: 'inline-grid' }).asElement('i');\n\
                 export const Compound = { Item };\n\
                 export const MemberWrapped = ds.styles({ p: 8 }).asComponent(Compound.Item);\n\
                 export const App = () => <><Wrapped /><MemberWrapped /></>;\n",
            )],
            &test_inputs(),
        );
        // `display: grid` is not a substring of `display: inline-grid`, so
        // each arm is asserted independently.
        assert!(
            out.sheets.base.contains("display: grid"),
            "{}",
            out.sheets.base
        );
        assert!(
            out.sheets.base.contains("display: inline-grid"),
            "{}",
            out.sheets.base
        );
    }

    #[test]
    fn as_component_target_variants_and_states_survive_prod() {
        // Unconsumed props forward to the target at runtime and activate its
        // own variant and state classes, so they are retained in full.
        let out = analyze(
            &[(
                "a.tsx",
                "const Chip = ds.styles({ display: 'flex' })\n\
                 .variant({ prop: 'tone', variants: { blue: { opacity: 1 }, red: { opacity: 0.5 } } })\n\
                 .states({ active: { visibility: 'visible' } })\n\
                 .asElement('span');\n\
                 export const Wrapped = ds.styles({ p: 8 }).asComponent(Chip);\n\
                 export const App = () => <Wrapped tone='red' />;\n",
            )],
            &test_inputs(),
        );
        assert!(
            out.sheets.variants.contains("opacity: 1"),
            "{}",
            out.sheets.variants
        );
        assert!(
            out.sheets.variants.contains("opacity: 0.5"),
            "{}",
            out.sheets.variants
        );
        assert!(
            out.sheets.states.contains("visibility: visible"),
            "{}",
            out.sheets.states
        );
    }

    #[test]
    fn external_file_containment_normalizes_windows_separators() {
        let dirs = vec!["kit/src".to_string()];
        assert!(is_external_file("kit\\src\\Card.tsx", &dirs));
        assert!(is_external_file(
            "kit/src/Card.tsx",
            &["kit\\src".to_string()]
        ));
        assert!(!is_external_file("kit\\src-extra\\Card.tsx", &dirs));
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
        let warns = diagnostics_of(&out, "warn");
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

    /// Scale entries on two exemption-list properties keep the exemption
    /// assertions from being vacuous.
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
        inputs
            .theme
            .insert("colors.primary".into(), "#ff2800".into());
        inputs
    }

    #[test]
    fn token_shaped_value_warns_but_is_emitted_as_authored() {
        let out = analyze(
            &[(
                "a.tsx",
                "export const Typo = ds.styles({ display: 'flex', bg: 'accent.solid' }).asElement('div');\nexport const App = () => <Typo />;\n",
            )],
            &token_shape_inputs(),
        );
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
        let warns = diagnostics_of(&out, "warn");
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

    fn external_dir_inputs() -> CssInputs {
        let mut inputs = token_shape_inputs();
        inputs.external_dirs = vec!["kit/src".into()];
        inputs
    }

    #[test]
    fn external_scale_key_miss_records_candidate_with_token() {
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
        let candidates = diagnostics_of(&out, "external-token-candidate");
        assert_eq!(candidates.len(), 1, "{:?}", out.diagnostics);
        let c = candidates[0];
        assert_eq!(c.file, "kit/src/Card.tsx");
        assert_eq!(c.component, "KitCard");
        assert_eq!(c.token.as_deref(), Some("colors.externalAccent"));
        // Candidates are NOT the always-on warn channel.
        assert!(diagnostics_of(&out, "warn").is_empty(), "{:?}", out.diagnostics);
    }

    #[test]
    fn external_brace_alias_records_candidate_before_shed() {
        let out = analyze(
            &[(
                "kit/src/Card.tsx",
                "export const KitCard = ds.styles({ display: 'flex', bg: '{colors.kitAccent/40}' }).asElement('div');\nexport const App = () => <KitCard />;\n",
            )],
            &external_dir_inputs(),
        );
        assert!(!out.css.contains("{colors.kitAccent"), "{}", out.css);
        let candidates = diagnostics_of(&out, "external-token-candidate");
        assert_eq!(candidates.len(), 1, "{:?}", out.diagnostics);
        assert_eq!(
            candidates[0].token.as_deref(),
            Some("colors.kitAccent"),
            "{:?}",
            out.diagnostics
        );
        assert_eq!(diagnostics_of(&out, "warn").len(), 1, "{:?}", out.diagnostics);
    }

    #[test]
    fn bare_css_keywords_record_no_candidate() {
        // A non-keyword bare key on the same property still becomes a
        // candidate (positive control).
        let out = analyze(
            &[(
                "kit/src/Card.tsx",
                "export const KitCard = ds.styles({ bg: 'transparent', color: 'inherit', borderColor: 'currentColor' }).asElement('div');\nexport const App = () => <KitCard />;\n",
            )],
            &external_dir_inputs(),
        );
        assert!(diagnostics_of(&out, "external-token-candidate").is_empty(), "{:?}", out.diagnostics);

        let control = analyze(
            &[(
                "kit/src/Card.tsx",
                "export const KitCard = ds.styles({ bg: 'externalAccent' }).asElement('div');\nexport const App = () => <KitCard />;\n",
            )],
            &external_dir_inputs(),
        );
        assert_eq!(
            diagnostics_of(&control, "external-token-candidate").len(),
            1,
            "{:?}",
            control.diagnostics
        );
    }

    #[test]
    fn consumer_local_miss_records_no_candidate() {
        let out = analyze(
            &[(
                "src/App.tsx",
                "export const Local = ds.styles({ bg: 'externalAccent' }).asElement('div');\nexport const App = () => <Local />;\n",
            )],
            &external_dir_inputs(),
        );
        assert!(diagnostics_of(&out, "external-token-candidate").is_empty(), "{:?}", out.diagnostics);
    }

    #[test]
    fn external_resolved_and_literal_values_record_no_scale_key_candidate_noise() {
        // A resolving key becomes a theme literal (rejected by shape) and
        // `display` has no scale, so neither is a candidate.
        let out = analyze(
            &[(
                "kit/src/Card.tsx",
                "export const KitCard = ds.styles({ display: 'flex', bg: 'primary' }).asElement('div');\nexport const App = () => <KitCard />;\n",
            )],
            &external_dir_inputs(),
        );
        assert!(diagnostics_of(&out, "external-token-candidate").is_empty(), "{:?}", out.diagnostics);
    }

    #[test]
    fn identity_valued_token_round_trip_records_no_candidate() {
        let mut inputs = external_dir_inputs();
        inputs.config.insert(
            "p".into(),
            serde_json::from_str(r#"{"property": "padding", "scale": "space"}"#).unwrap(),
        );
        inputs.theme.insert("space.0".into(), "0".into());
        let out = analyze(
            &[(
                "kit/src/Card.tsx",
                "export const KitCard = ds.styles({ p: 0 }).asElement('div');\nexport const App = () => <KitCard />;\n",
            )],
            &inputs,
        );
        assert!(
            out.sheets.base.contains("padding: 0"),
            "emission unchanged:\n{}",
            out.sheets.base
        );
        assert!(diagnostics_of(&out, "external-token-candidate").is_empty(), "{:?}", out.diagnostics);
    }

    #[test]
    fn unresolved_token_in_external_file_still_records_candidate() {
        // True-positive control for the membership rule.
        let mut inputs = external_dir_inputs();
        inputs.theme.insert("space.0".into(), "0".into());
        let out = analyze(
            &[(
                "kit/src/Card.tsx",
                "export const KitCard = ds.styles({ bg: 'externalAccent' }).asElement('div');\nexport const App = () => <KitCard />;\n",
            )],
            &inputs,
        );
        let candidates = diagnostics_of(&out, "external-token-candidate");
        assert_eq!(candidates.len(), 1, "{:?}", out.diagnostics);
        assert_eq!(candidates[0].token.as_deref(), Some("colors.externalAccent"));
    }

    #[test]
    fn same_scale_value_collision_is_decided_by_membership_alone() {
        // `colors.pill: '0'` resolves, then re-synthesizes as `colors.0`, a
        // path the theme does not define: membership alone decides.
        let mut inputs = external_dir_inputs();
        inputs.theme.insert("colors.pill".into(), "0".into());
        let out = analyze(
            &[(
                "kit/src/Card.tsx",
                "export const KitCard = ds.styles({ bg: 'pill' }).asElement('div');\nexport const App = () => <KitCard />;\n",
            )],
            &inputs,
        );
        let candidates = diagnostics_of(&out, "external-token-candidate");
        assert_eq!(candidates.len(), 1, "{:?}", out.diagnostics);
        assert_eq!(candidates[0].token.as_deref(), Some("colors.0"));
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
        assert!(diagnostics_of(&out, "warn").is_empty(), "{:?}", out.diagnostics);
    }

    #[test]
    fn exempt_properties_do_not_warn_on_dotted_values() {
        // Both are scale-family in these inputs, so only the exemption list
        // keeps them quiet.
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
        assert!(diagnostics_of(&out, "warn").is_empty(), "{:?}", out.diagnostics);
    }

    #[test]
    fn dotted_value_on_non_scale_property_does_not_warn() {
        // `display` has no scale and `maskImage` is unregistered, so neither
        // carries theme meaning.
        let out = analyze(
            &[(
                "a.tsx",
                "export const Passthrough = ds.styles({ display: 'a.b', maskImage: 'foo.bar' }).asElement('div');\nexport const App = () => <Passthrough />;\n",
            )],
            &token_shape_inputs(),
        );
        assert!(diagnostics_of(&out, "warn").is_empty(), "{:?}", out.diagnostics);
    }

    #[test]
    fn token_shape_admits_only_bare_dotted_identifiers() {
        assert!(is_token_shaped_value("accent.solid"));
        assert!(is_token_shaped_value("colors.accent.solid-2"));
        assert!(is_token_shaped_value("a.b"));
        assert!(!is_token_shaped_value("red"));
        assert!(!is_token_shaped_value("not-allowed"));
        assert!(!is_token_shaped_value("2px solid accent.solid"));
        assert!(!is_token_shaped_value("Inter, sans-serif"));
        assert!(!is_token_shaped_value("var(--current-bg)"));
        assert!(!is_token_shaped_value("url(a.png)"));
        assert!(!is_token_shaped_value("\"a.b\""));
        assert!(!is_token_shaped_value("{colors.missing}"));
        assert!(!is_token_shaped_value("--color-primary"));
        assert!(!is_token_shaped_value("1.5rem"));
        assert!(!is_token_shaped_value("transforms."));
        assert!(!is_token_shaped_value("a..b"));
        assert!(!is_token_shaped_value(".leading"));
        assert!(!is_token_shaped_value(""));
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
        // Exactly one warn: the shed pre-empts the token-shape warn.
        let out = analyze(
            &[(
                "a.tsx",
                "export const Broken = ds.styles({ bg: '{colors.missing}' }).asElement('div');\nexport const App = () => <Broken />;\n",
            )],
            &token_shape_inputs(),
        );
        assert!(!out.css.contains("{colors.missing}"), "{}", out.css);
        let warns = diagnostics_of(&out, "warn");
        assert_eq!(warns.len(), 1, "{:?}", out.diagnostics);
        assert!(
            warns[0].message.contains("declaration dropped"),
            "{}",
            warns[0].message
        );
    }

    #[test]
    fn serde_rejected_props_chain_emits_bail_diagnostic() {
        let out = analyze(
            &[(
                "a.tsx",
                "export const Broken = ds.props({ w: { property: 123 } }).asElement('div');\nexport const App = () => <Broken />;\n",
            )],
            &test_inputs(),
        );
        assert!(out.components.is_empty(), "{:?}", out.components.keys());
        let bails = diagnostics_of(&out, "bail");
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
        let out = analyze(
            &[(
                "a.tsx",
                "export const Broken = ds.styles(notStatic).asElement('div');\nexport const App = () => <Broken />;\n",
            )],
            &test_inputs(),
        );
        assert!(out.components.is_empty(), "{:?}", out.components.keys());
        let bails = diagnostics_of(&out, "bail");
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
    fn known_values_through_isolatable_callbacks_extract_beside_their_runtime_path() {
        let source = r#"import { createTransform as ct } from '@animus-ui/system';
const double = (v: number) => v * 2;
function half(v) { return `${v / 2}px`; }
const named = ct('triple', (v) => `${v * 3}px`);
const factor = 4;
const closed = (v) => `${v * factor}px`;
export const Box = ds
  .props({
    inl: { property: 'minWidth', transform: (v) => v * 2 },
    loc: { property: 'minHeight', transform: double },
    fn: { property: 'maxWidth', transform: half },
    ct: { property: 'marginLeft', transform: named },
    shut: { property: 'marginTop', transform: closed },
  })
  .asElement('div');
export const App = ({ n }) => (
  <Box inl={10} loc={10} fn={10} ct={10} shut={10} {...n} />
);
"#;
        let out = analyze(&[("a.tsx", source)], &test_inputs());
        let custom = &out.sheets.custom;
        for declaration in [
            "min-width: 20;",
            "min-height: 20;",
            "max-width: 5px;",
            "margin-left: 30px;",
        ] {
            assert!(custom.contains(declaration), "{declaration} missing:\n{custom}");
        }
        // The closure cannot be isolated: its value stays on the runtime path.
        assert!(!custom.contains("margin-top: 10"), "{custom}");
        assert!(!custom.contains("margin-top: 40px"), "{custom}");

        let payload = &out.replacement_configs["a.tsx::Box"];
        let classes = payload.custom_prop_class_map.as_ref().unwrap();
        for prop in ["inl", "loc", "fn", "ct"] {
            assert!(classes[prop].contains_key("10"), "{prop}: {classes:?}");
        }
        assert!(classes["shut"].is_empty(), "{classes:?}");
        // Every callback keeps its delivery for values the build cannot know.
        let dynamic = payload.custom_dynamic_config.as_ref().unwrap();
        for prop in ["inl", "loc", "fn", "ct", "shut"] {
            assert!(dynamic[prop].value().unwrap().transform_fn_source.is_some(), "{prop}");
        }
        assert_eq!(
            out.diagnostics.iter().filter(|d| d.component == "Box").count(),
            0,
            "{:?}",
            out.diagnostics
        );
    }

    fn custom_classes<'a>(out: &'a CssOutput, id: &str, prop: &str) -> &'a HashMap<String, String> {
        &out.replacement_configs[id].custom_prop_class_map.as_ref().unwrap()[prop]
    }

    #[test]
    fn component_callback_lookups_keep_the_authored_value_type() {
        let source = r#"export const Box = ds
  .props({
    tp: { property: 'width', transform: (v) => (typeof v === 'number' ? `${v}px` : `${v}%`) },
    plain: { property: 'height' },
  })
  .asElement('div');
export const App = () => (
  <><Box tp={100} plain={5} /><Box tp="100" /><Box tp={{ _: 100, sm: '100' }} /></>
);
"#;
        let out = analyze(&[("a.tsx", source)], &test_inputs());
        let classes = custom_classes(&out, "a.tsx::Box", "tp");
        let mut keys: Vec<&String> = classes.keys().collect();
        keys.sort();
        assert_eq!(keys, ["\"100\"", "100", "{\"_\":100,\"sm\":\"100\"}"]);
        assert_ne!(classes["100"], classes["\"100\""]);
        assert!(out.sheets.custom.contains("width: 100px;"), "{}", out.sheets.custom);
        assert!(out.sheets.custom.contains("width: 100%;"), "{}", out.sheets.custom);
        // A prop without a callback keeps the shared value keys.
        assert_eq!(custom_classes(&out, "a.tsx::Box", "plain").keys().collect::<Vec<_>>(), ["5"]);
        assert_eq!(out.replacement_configs["a.tsx::Box"].typed_custom_props, ["tp"]);
    }

    #[test]
    fn unbounded_host_sensitive_or_mutating_callbacks_keep_their_runtime_path() {
        let declare = |props: &str, renders: &str| {
            format!(
                "export const Box = ds.props({{ {props} }}).asElement('div');\nexport const S = ds.styles({{ w: 2.6 }}).asElement('span');\nexport const App = () => <><S />{renders}</>;\n"
            )
        };
        let spin = "spin: { property: 'minWidth', transform: (v) => { while (v > 0) { v = v + 1; } return v; } }";
        let host = "host: { property: 'minHeight', transform: (v) => (typeof globalThis.window === 'undefined' ? `${v}px` : `${v * 2}px`) }";
        let fin = "fin: { property: 'maxWidth', transform: (v) => v * 2 }";
        let mutate = "ma: { property: 'paddingTop', transform: (v) => { Math.round = () => 7; return `${v}px`; } }";
        let reads = "mb: { property: 'paddingLeft', transform: (v) => `${Math.round(v)}px` }";
        let mut inputs = test_inputs();
        inputs.config.insert(
            "w".into(),
            serde_json::from_str(r#"{"property": "width", "transform": "round", "transformId": "round@system.w"}"#)
                .unwrap(),
        );
        inputs
            .set_transform_sources(Some(r#"{"round@system.w": "(v) => `${Math.round(v)}px`"}"#))
            .unwrap();
        for (props, renders) in [
            (
                [spin, host, fin, mutate, reads].join(", "),
                "<Box spin={1} host={3} fin={10} ma={1} mb={2.4} />",
            ),
            (
                [reads, mutate, fin, host, spin].join(", "),
                "<Box mb={2.4} ma={1} fin={10} host={3} spin={1} />",
            ),
        ] {
            let started = std::time::Instant::now();
            let out = analyze(&[("a.tsx", &declare(&props, renders))], &inputs);
            assert!(started.elapsed() < std::time::Duration::from_secs(10));
            let custom = &out.sheets.custom;
            assert!(custom_classes(&out, "a.tsx::Box", "spin").is_empty(), "{custom}");
            assert!(custom_classes(&out, "a.tsx::Box", "host").is_empty(), "{custom}");
            assert!(custom.contains("max-width: 20;"), "{custom}");
            assert!(custom.contains("padding-left: 2px;"), "{custom}");
            assert!(out.css.contains("width: 3px;"), "{}", out.css);
            let dynamic = out.replacement_configs["a.tsx::Box"].custom_dynamic_config.as_ref().unwrap();
            assert!(dynamic.contains_key("spin") && dynamic.contains_key("host"));
            assert!(out.diagnostics.iter().all(|d| d.component != "Box"), "{:?}", out.diagnostics);
        }
    }

    #[test]
    fn component_callback_failures_name_the_declaring_component() {
        let parents = r#"export const Parent = ds
  .props({
    w: { property: 'width', transform: (v) => { if (v === 7) throw new Error('seven'); return `${v}px`; } },
    o: { property: 'height', transform: (v) => ({ v }) },
  })
  .asElement('div');
"#;
        let children = r#"import { Parent } from './parents';
export const Child = Parent.extend().styles({ display: 'grid' }).asElement('div');
export const Grand = Child.extend().styles({ display: 'flex' }).asElement('div');
export const Override = Parent.extend()
  .props({ w: { property: 'width', transform: (v) => { if (v === 7) throw new Error('mine'); return v; } } })
  .asElement('div');
export const App = () => <><Child w={7} o={3} /><Grand w={7} o={3} /><Override w={7} /></>;
"#;
        let out = analyze(&[("parents.tsx", parents), ("children.tsx", children)], &test_inputs());
        let of = |kind: &str| -> Vec<(&str, &str)> {
            out.diagnostics
                .iter()
                .filter(|d| d.kind == kind && d.message.contains("transform 'inline'"))
                .map(|d| (d.file.as_str(), d.component.as_str()))
                .collect()
        };
        assert_eq!(of("warn"), [("parents.tsx", "Parent"), ("children.tsx", "Override")], "{:?}", out.diagnostics);
        assert_eq!(of("error"), [("parents.tsx", "Parent")], "{:?}", out.diagnostics);
    }

    #[test]
    fn callback_strings_post_processing_would_reinterpret_stay_runtime() {
        let source = r#"export const Box = ds
  .props({
    nstr: { property: 'minWidth', transform: (v) => `${v * 2}` },
    num: { property: 'minHeight', transform: (v) => v * 2 },
    tok: { property: 'maxWidth', transform: (v) => `{space.${v}}` },
    fnv: { property: 'maxHeight', transform: (v) => `var(--k, ${v}px)` },
    mix: { property: 'paddingTop', transform: (v) => (v > 5 ? `${v}` : `${v}px`) },
  })
  .asElement('div');
export const App = () => <Box nstr={10} num={10} tok={8} fnv={3} mix={{ _: 2, sm: 10 }} />;
"#;
        let out = analyze(&[("a.tsx", source)], &test_inputs());
        for prop in ["nstr", "tok", "mix"] {
            assert!(custom_classes(&out, "a.tsx::Box", prop).is_empty(), "{prop}: {}", out.sheets.custom);
        }
        for prop in ["num", "fnv"] {
            assert_eq!(custom_classes(&out, "a.tsx::Box", prop).len(), 1, "{prop}: {}", out.sheets.custom);
        }
        assert!(out.sheets.custom.contains("max-height: var(--k, 3px);"), "{}", out.sheets.custom);
    }

    #[test]
    fn identifier_variant_map_resolves_through_statics() {
        let out = analyze(
            &[(
                "a.tsx",
                "const sizes = { sm: { p: 8 } };\nexport const Button = ds.styles({ display: 'flex' }).variant({ prop: 'size', defaultVariant: 'sm', variants: sizes }).asElement('button');\nexport const App = () => <Button size='sm' />;\n",
            )],
            &test_inputs(),
        );
        let skips = diagnostics_of(&out, "skip");
        assert_eq!(skips.len(), 0, "{:?}", out.diagnostics);
        let desc = out
            .components
            .values()
            .find(|c| c.binding == "Button")
            .expect("Button component");
        assert!(
            desc.replacement.contains(r#""options":["sm"]"#),
            "{}",
            desc.replacement
        );
        assert!(
            desc.replacement.contains(r#""default":"sm""#),
            "{}",
            desc.replacement
        );

        // The same map authored inline must produce identical output.
        let inline = analyze(
            &[(
                "a.tsx",
                "export const Button = ds.styles({ display: 'flex' }).variant({ prop: 'size', defaultVariant: 'sm', variants: { sm: { p: 8 } } }).asElement('button');\nexport const App = () => <Button size='sm' />;\n",
            )],
            &test_inputs(),
        );
        let inline_desc = inline
            .components
            .values()
            .find(|c| c.binding == "Button")
            .expect("Button component");
        assert_eq!(desc.replacement, inline_desc.replacement);
        assert_eq!(out.css, inline.css);
    }

    #[test]
    fn as_const_chain_arguments_are_not_fatal() {
        let out = analyze(
            &[(
                "a.tsx",
                "const s = { color: 'red' } as const;\nexport const A = ds.styles({ display: 'flex' } as const).asElement('div');\nexport const B = ds.styles(s as const).asElement('span');\nexport const App = () => <><A /><B /></>;\n",
            )],
            &test_inputs(),
        );
        assert_eq!(diagnostics_of(&out, "bail").len(), 0, "{:?}", out.diagnostics);
        assert!(out.css.contains("display:flex") || out.css.contains("display: flex"), "{}", out.css);
        assert!(out.css.contains("color:red") || out.css.contains("color: red"), "{}", out.css);
    }

    #[test]
    fn genuinely_dynamic_variant_map_still_surfaces_a_skip_diagnostic() {
        let out = analyze(
            &[(
                "a.tsx",
                "export const Button = ds.styles({ display: 'flex' }).variant({ prop: 'size', defaultVariant: 'sm', variants: makeSizes() }).asElement('button');\nexport const App = () => <Button />;\n",
            )],
            &test_inputs(),
        );
        let skips = diagnostics_of(&out, "skip");
        assert_eq!(skips.len(), 1, "{:?}", out.diagnostics);
        assert_eq!(skips[0].component, "Button");
        assert!(
            skips[0].message.contains("variant map (non-static)"),
            "{}",
            skips[0].message
        );
        let desc = out
            .components
            .values()
            .find(|c| c.binding == "Button")
            .expect("Button component");
        assert!(
            desc.replacement.contains(r#""options":[]"#),
            "{}",
            desc.replacement
        );
    }

    #[test]
    fn ancestor_subject_selectors_emit_with_class_at_subject_position() {
        let out = analyze(
            &[(
                "a.tsx",
                "export const Mark = ds.styles({ '[aria-sort=\"ascending\"] &': { color: 'red' }, '[aria-sort=\"descending\"] &:hover': { opacity: 0.8 }, '&:focus-visible, .group:hover &': { outline: '2px solid' }, '& + &': { gap: 4 } }).asElement('span');\nexport const App = () => <Mark />;\n",
            )],
            &test_inputs(),
        );
        assert_eq!(diagnostics_of(&out, "skip").len(), 0, "{:?}", out.diagnostics);
        let class = out
            .components
            .values()
            .find(|c| c.binding == "Mark")
            .and_then(|c| {
                c.replacement
                    .split('\'')
                    .find(|part| part.starts_with("animus-Mark-"))
                    .map(|part| part.to_string())
            })
            .expect("Mark component class");
        assert!(
            out.css.contains(&format!("[aria-sort=\"ascending\"] .{class}")),
            "{}",
            out.css
        );
        assert!(
            out.css
                .contains(&format!("[aria-sort=\"descending\"] .{class}:hover")),
            "{}",
            out.css
        );
        assert!(
            out.css
                .contains(&format!(".{class}:focus-visible, .group:hover .{class}")),
            "{}",
            out.css
        );
        assert!(
            out.css.contains(&format!(".{class} + .{class}")),
            "{}",
            out.css
        );
        assert!(!out.css.contains('&'), "{}", out.css);
    }

    #[test]
    fn variant_descendant_selectors_keep_combinator_space() {
        let out = analyze(
            &[(
                "a.tsx",
                "export const Group = ds.variant({ prop: 'density', variants: { roomy: { '& span, & strong': { p: '12px' } } } }).asElement('div');\nexport const App = () => <Group density=\"roomy\" />;\n",
            )],
            &test_inputs(),
        );
        assert_eq!(diagnostics_of(&out, "skip").len(), 0, "{:?}", out.diagnostics);
        let class = out
            .components
            .values()
            .find(|c| c.binding == "Group")
            .and_then(|c| {
                c.replacement
                    .split('\'')
                    .find(|part| part.starts_with("animus-Group-"))
                    .map(|part| part.to_string())
            })
            .expect("Group component class");
        assert!(
            out.css.contains(&format!(".{class}--density-roomy span")),
            "{}",
            out.css
        );
        assert!(
            out.css.contains(&format!(".{class}--density-roomy strong")),
            "{}",
            out.css
        );
        assert!(!out.css.contains("roomyspan"), "{}", out.css);
        assert!(!out.css.contains('&'), "{}", out.css);
    }

    #[test]
    fn quoted_only_subject_key_surfaces_coded_error_diagnostic() {
        // Every `&` sits inside a quoted attribute value: nothing to anchor to.
        let out = analyze(
            &[(
                "a.tsx",
                "export const Mark = ds.styles({ '[data-x=\"a&b\"]': { color: 'red' }, color: 'blue' }).asElement('span');\nexport const App = () => <Mark />;\n",
            )],
            &test_inputs(),
        );
        let skips = diagnostics_of(&out, "skip");
        assert_eq!(skips.len(), 1, "{:?}", out.diagnostics);
        assert_eq!(skips[0].component, "Mark");
        assert_eq!(
            skips[0].code.as_deref(),
            Some(crate::eval::SELECTOR_UNSUPPORTED_SUBJECT)
        );
        assert_eq!(skips[0].severity.as_deref(), Some("error"));
        assert!(out.css.contains("color:blue") || out.css.contains("color: blue"), "{}", out.css);
        assert!(!out.css.contains('&'), "{}", out.css);
    }

    #[test]
    fn unregistered_keyframe_reference_severity_is_warn() {
        assert_eq!(
            diagnostic_severity_for_code(crate::eval::KEYFRAMES_UNREGISTERED_REFERENCE),
            "warn"
        );
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
        let child_rule = child_rule(&out);
        assert!(child_rule.contains("display: grid"), "{}", out.sheets.base);
        assert!(
            child_rule.contains("padding: 0.5rem"),
            "{}",
            out.sheets.base
        );
    }

    fn child_rule(out: &CssOutput) -> &str {
        let start = out
            .sheets
            .base
            .find("animus-Child-")
            .unwrap_or_else(|| panic!("child dropped:\n{}", out.sheets.base));
        let rule = &out.sheets.base[start..];
        &rule[..rule.find('}').unwrap()]
    }

    fn unresolvable_parent_bails<'a>(out: &'a CssOutput, parent: &str) -> Vec<&'a CssDiagnostic> {
        let reason = parent_unresolvable_reason(parent);
        diagnostics_of(out, "bail")
            .into_iter()
            .filter(|d| d.message == reason)
            .collect()
    }

    fn bails_for<'a>(out: &'a CssOutput, component: &str) -> Vec<&'a CssDiagnostic> {
        diagnostics_of(out, "bail")
            .into_iter()
            .filter(|d| d.component == component)
            .collect()
    }

    #[test]
    fn aliased_local_export_parent_resolves_to_its_declarator_and_inherits() {
        let out = analyze(
            &[
                (
                    "base.tsx",
                    "const CardBase = ds.styles({ display: 'flex', p: 8 }).asElement('div');\nexport { CardBase as Card };\nexport const A = () => <CardBase />;\n",
                ),
                (
                    "child.tsx",
                    "import { Card } from './base';\nexport const Child = Card.extend().styles({ display: 'grid' }).asElement('div');\nexport const B = () => <Child />;\n",
                ),
            ],
            &test_inputs(),
        );
        assert!(
            unresolvable_parent_bails(&out, "Card").is_empty(),
            "{:?}",
            out.diagnostics
        );
        let child_rule = child_rule(&out);
        assert!(child_rule.contains("display: grid"), "{}", out.sheets.base);
        assert!(
            child_rule.contains("padding: 0.5rem"),
            "inherited through the aliased export:\n{}",
            out.sheets.base
        );
    }

    #[test]
    fn aliased_local_export_of_non_chain_parent_still_bails() {
        // Resolving through `local` lands on a declarator that is not a chain.
        let out = analyze(
            &[
                (
                    "base.tsx",
                    "const CardBase = ds.styles({ display: 'flex' });\nexport { CardBase as Card };\n",
                ),
                (
                    "child.tsx",
                    "import { Card } from './base';\nexport const Child = Card.extend().styles({ p: 8 }).asElement('div');\nexport const B = () => <Child />;\n",
                ),
            ],
            &test_inputs(),
        );
        let bails = unresolvable_parent_bails(&out, "Card");
        assert_eq!(bails.len(), 1, "{:?}", out.diagnostics);
        assert_eq!(bails[0].component, "Child");
        assert!(
            !out.sheets.base.contains("animus-Child-"),
            "{}",
            out.sheets.base
        );
    }

    #[test]
    fn import_then_reexport_barrel_stays_standalone() {
        // The barrel's export fact names an import, not a declarator.
        for (barrel_export, imported) in [
            ("export { CardBase as Card };", "Card"),
            ("export { CardBase };", "CardBase"),
        ] {
            let out = analyze(
                &[
                    (
                        "base.tsx",
                        "export const CardBase = ds.styles({ display: 'flex', p: 8 }).asElement('div');\nexport const A = () => <CardBase />;\n",
                    ),
                    (
                        "barrel.tsx",
                        &format!("import {{ CardBase }} from './base';\n{}\n", barrel_export),
                    ),
                    (
                        "child.tsx",
                        &format!(
                            "import {{ {0} }} from './barrel';\nexport const Child = {0}.extend().styles({{ display: 'grid' }}).asElement('div');\nexport const B = () => <Child />;\n",
                            imported
                        ),
                    ),
                ],
                &test_inputs(),
            );
            assert!(
                unresolvable_parent_bails(&out, imported).is_empty(),
                "{barrel_export}: {:?}",
                out.diagnostics
            );
            assert!(
                bails_for(&out, "Child").is_empty(),
                "{barrel_export}: {:?}",
                out.diagnostics
            );
            let child_rule = child_rule(&out);
            assert!(child_rule.contains("display: grid"), "{}", out.sheets.base);
            assert!(
                !child_rule.contains("padding"),
                "standalone fallback, not inheritance:\n{}",
                out.sheets.base
            );
        }
    }

    #[test]
    fn extend_of_bailed_parent_chain_reports_evaluation_failure_not_resolution() {
        // The child still drops: standalone would silently lose the
        // inherited styles.
        let out = analyze(
            &[
                (
                    "base.tsx",
                    "export const Parent = ds.styles({ display: 'flex' }).asComponent(makeIt());\nexport const A = () => <Parent />;\n",
                ),
                (
                    "child.tsx",
                    "import { Parent } from './base';\nexport const Child = Parent.extend().styles({ p: 8 }).asElement('div');\nexport const B = () => <Child />;\n",
                ),
            ],
            &test_inputs(),
        );
        let child_bails = bails_for(&out, "Child");
        assert_eq!(child_bails.len(), 1, "{:?}", out.diagnostics);
        assert_eq!(
            child_bails[0].message,
            parent_failed_reason("Parent"),
            "{}",
            child_bails[0].message
        );
        assert_ne!(
            child_bails[0].message,
            parent_unresolvable_reason("Parent"),
            "{}",
            child_bails[0].message
        );
        assert!(
            !out.sheets.base.contains("animus-Child-"),
            "{}",
            out.sheets.base
        );
        // The parent keeps reporting its own failure, so the two correlate.
        assert!(!bails_for(&out, "Parent").is_empty(), "{:?}", out.diagnostics);
    }

    #[test]
    fn same_file_extend_of_bailed_parent_chain_uses_the_same_reason() {
        let out = analyze(
            &[(
                "a.tsx",
                "const Parent = ds.styles({ display: 'flex' }).asComponent(makeIt());\nexport const Child = Parent.extend().styles({ p: 8 }).asElement('div');\nexport const B = () => <Child />;\n",
            )],
            &test_inputs(),
        );
        let child_bails = bails_for(&out, "Child");
        assert_eq!(child_bails.len(), 1, "{:?}", out.diagnostics);
        assert_eq!(
            child_bails[0].message,
            parent_failed_reason("Parent"),
            "{}",
            child_bails[0].message
        );
    }

    #[test]
    fn cross_file_extend_of_non_chain_parent_bails_loudly() {
        // `ds.styles({...})` never terminates, so P is not a chain.
        let out = analyze(
            &[
                (
                    "base.tsx",
                    "export const P = ds.styles({ display: 'flex' });\n",
                ),
                (
                    "child.tsx",
                    "import { P } from './base';\nexport const Child = P.extend().styles({ p: 8 }).asElement('div');\nexport const B = () => <Child />;\n",
                ),
            ],
            &test_inputs(),
        );
        let bails = unresolvable_parent_bails(&out, "P");
        assert_eq!(bails.len(), 1, "{:?}", out.diagnostics);
        assert_eq!(bails[0].file, "child.tsx");
        assert_eq!(bails[0].component, "Child");
        assert!(
            !out.sheets.base.contains("animus-Child-"),
            "{}",
            out.sheets.base
        );
        assert!(
            !out.components.values().any(|c| c.binding == "Child"),
            "{:?}",
            out.components.keys().collect::<Vec<_>>()
        );
    }

    #[test]
    fn same_file_extend_of_non_chain_parent_bails_loudly() {
        let out = analyze(
            &[(
                "a.tsx",
                "const P = ds.styles({ display: 'flex' });\nexport const Child = P.extend().styles({ p: 8 }).asElement('div');\nexport const B = () => <Child />;\n",
            )],
            &test_inputs(),
        );
        let bails = unresolvable_parent_bails(&out, "P");
        assert_eq!(bails.len(), 1, "{:?}", out.diagnostics);
        assert_eq!(bails[0].component, "Child");
        assert!(
            !out.sheets.base.contains("animus-Child-"),
            "{}",
            out.sheets.base
        );
    }

    #[test]
    fn extend_of_parent_outside_the_universe_stays_standalone() {
        // Only an in-universe parent can be provably not a chain.
        let mut inputs = test_inputs();
        inputs
            .package_map
            .insert("@kit/ui".into(), "node_modules/@kit/ui/index.js".into());
        let out = analyze(
            &[(
                "child.tsx",
                "import { Card } from '@kit/ui';\nexport const Child = Card.extend().styles({ p: 8 }).asElement('div');\nexport const B = () => <Child />;\n",
            )],
            &inputs,
        );
        assert!(
            unresolvable_parent_bails(&out, "Card").is_empty(),
            "{:?}",
            out.diagnostics
        );
        assert!(
            out.sheets.base.contains("animus-Child-"),
            "{}",
            out.sheets.base
        );
        assert!(
            out.sheets.base.contains("padding: 0.5rem"),
            "{}",
            out.sheets.base
        );
    }

    #[test]
    fn extend_through_opaque_barrel_stays_standalone() {
        // Star exports are not collected, so landing on the barrel proves
        // nothing about the parent.
        let out = analyze(
            &[
                (
                    "barrel.tsx",
                    "export * from './base';\n",
                ),
                (
                    "base.tsx",
                    "export const P = ds.styles({ display: 'flex' });\n",
                ),
                (
                    "child.tsx",
                    "import { P } from './barrel';\nexport const Child = P.extend().styles({ p: 8 }).asElement('div');\nexport const B = () => <Child />;\n",
                ),
            ],
            &test_inputs(),
        );
        assert!(
            unresolvable_parent_bails(&out, "P").is_empty(),
            "{:?}",
            out.diagnostics
        );
        assert!(
            out.sheets.base.contains("animus-Child-"),
            "{}",
            out.sheets.base
        );
    }

    #[test]
    fn extend_through_named_barrel_still_inherits() {
        // Positive control: a named re-export reaches the defining chain.
        let out = analyze(
            &[
                (
                    "barrel.tsx",
                    "export { Parent } from './base';\n",
                ),
                (
                    "base.tsx",
                    "export const Parent = ds.styles({ display: 'flex', p: 8 }).asElement('div');\nexport const A = () => <Parent />;\n",
                ),
                (
                    "child.tsx",
                    "import { Parent } from './barrel';\nexport const Child = Parent.extend().styles({ display: 'grid' }).asElement('div');\nexport const B = () => <Child />;\n",
                ),
            ],
            &test_inputs(),
        );
        assert!(
            unresolvable_parent_bails(&out, "Parent").is_empty(),
            "{:?}",
            out.diagnostics
        );
        let child_rule = child_rule(&out);
        assert!(child_rule.contains("display: grid"), "{}", out.sheets.base);
        assert!(
            child_rule.contains("padding: 0.5rem"),
            "{}",
            out.sheets.base
        );
    }

    #[test]
    fn extension_child_condition_block_carries_through_merge() {
        // The child's own condition block must wrap the child's class.
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
        // A child [Breakpoint]+selector group must survive the extend-merge.
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
    fn configured_transform_registers_and_applies() {
        let out = analyze_with_battle_transform("(v) => `${v}px`");
        assert!(
            out.sheets.base.contains("width: 3px"),
            "{}",
            out.sheets.base
        );
    }

    fn analyze_with_battle_transform(transform_source: &str) -> CssOutput {
        let mut inputs = test_inputs();
        inputs.config.insert(
            "w".into(),
            serde_json::from_str(
                r#"{"property": "width", "transform": "battle", "transformId": "battle@system.w"}"#,
            )
            .unwrap(),
        );
        inputs
            .set_transform_sources(Some(
                &serde_json::json!({ "battle@system.w": transform_source }).to_string(),
            ))
            .unwrap();
        analyze(
            &[(
                "a.tsx",
                "export const C = ds.styles({ w: 3 }).asElement('div');\nexport const App = () => <C />;\n",
            )],
            &inputs,
        )
    }

    #[test]
    fn invalid_transform_result_emits_error_diagnostic_and_drops_declaration() {
        let out = analyze_with_battle_transform("(v) => ({ w: v })");
        let errors = diagnostics_of(&out, "error");
        assert_eq!(errors.len(), 1, "{:?}", out.diagnostics);
        assert_eq!(errors[0].file, "a.tsx");
        assert_eq!(errors[0].component, "C");
        assert_eq!(errors[0].severity.as_deref(), Some("error"));
        assert_eq!(
            errors[0].message,
            "transform 'battle' returned object for prop 'w' — transforms must \
             return a string or finite number; rule-level styling ships as \
             declaration scales (see composite-style-scales)"
        );
        // Its only source was C's `.styles()`, so no value ships anywhere.
        assert!(!out.sheets.base.contains("width"), "{}", out.sheets.base);
        assert!(!out.css.contains("[object"), "{}", out.css);
    }

    #[test]
    fn throwing_transform_emits_warn_diagnostic_and_keeps_raw_fallback() {
        let out = analyze_with_battle_transform("(v) => { throw new Error('kaboom') }");
        let warns: Vec<_> = diagnostics_of(&out, "warn")
            .into_iter()
            .filter(|d| d.message.contains("transform 'battle'"))
            .collect();
        assert_eq!(warns.len(), 1, "{:?}", out.diagnostics);
        assert_eq!(warns[0].file, "a.tsx");
        assert_eq!(warns[0].component, "C");
        assert!(warns[0].severity.is_none(), "{:?}", warns[0]);
        assert!(
            warns[0].message.contains("raw value applied as fallback"),
            "{}",
            warns[0].message
        );
        assert!(warns[0].message.contains("in a.tsx"), "{}", warns[0].message);
        assert!(warns[0].message.contains("kaboom"), "{}", warns[0].message);
        assert!(out.sheets.base.contains("width: 3"), "{}", out.sheets.base);
    }

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
        // Two files define the same local recipe names.
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
        // The composing file neither defines nor imports the slot bindings.
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

        let bails: Vec<_> = diagnostics_of(&out, "bail")
            .into_iter()
            .filter(|d| d.component == "Fam")
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

    #[test]
    fn compose_slot_through_local_alias_resolves_identically() {
        let direct = "export const CardRoot = ds.styles({ display: 'flex' }).asElement('div');\n\
             export const CardBody = ds.variant({ prop: 'size', variants: { sm: { p: 8 } } }).asElement('div');\n\
             export const Card = compose({ Root: CardRoot, Body: CardBody }, { name: 'Card', shared: { size: true } });\n\
             export const App = () => <Card.Root><Card.Body size=\"sm\" /></Card.Root>;\n";
        let aliased = "export const CardRoot = ds.styles({ display: 'flex' }).asElement('div');\n\
             export const CardBody = ds.variant({ prop: 'size', variants: { sm: { p: 8 } } }).asElement('div');\n\
             const RootAlias = CardRoot;\n\
             const BodyAlias = CardBody;\n\
             export const Card = compose({ Root: RootAlias, Body: BodyAlias }, { name: 'Card', shared: { size: true } });\n\
             export const App = () => <Card.Root><Card.Body size=\"sm\" /></Card.Root>;\n";
        let out_direct = analyze(&[("card.tsx", direct)], &test_inputs());
        let out_aliased = analyze(&[("card.tsx", aliased)], &test_inputs());
        assert!(
            !out_aliased.diagnostics.iter().any(|d| d.kind == "bail"),
            "{:?}",
            out_aliased.diagnostics
        );
        assert_eq!(
            out_direct.sheets.variants, out_aliased.sheets.variants,
            "aliased slot variants CSS diverges from direct spelling"
        );
        assert_eq!(
            out_direct.css, out_aliased.css,
            "aliased slot full CSS diverges from direct spelling"
        );
    }

    #[test]
    fn unresolvable_compose_slot_bail_carries_code_and_severity() {
        let out = analyze(
            &[(
                "fam.tsx",
                "export const Fam = compose({ Root, Body }, { name: 'Fam', shared: {} });\n\
                 export const App = () => <Fam.Root><Fam.Body /></Fam.Root>;\n",
            )],
            &test_inputs(),
        );
        let bails: Vec<_> = diagnostics_of(&out, "bail")
            .into_iter()
            .filter(|d| d.component == "Fam")
            .collect();
        assert!(!bails.is_empty(), "{:?}", out.diagnostics);
        for bail in &bails {
            assert_eq!(
                bail.code.as_deref(),
                Some("animus.compose.unresolvable-slot"),
                "{:?}",
                bail
            );
            assert_eq!(bail.severity.as_deref(), Some("error"), "{:?}", bail);
        }
    }

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
        // Pairing follows the flattened parent-first order the emitter
        // enumerates.
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

    #[test]
    fn shared_axis_child_compounds_expand_beside_their_flat_rules() {
        // Body's compounds require `size`, which the family shares from the
        // Root, so the flat rules alone are unreachable under composition.
        let out = analyze(
            &[(
                "card.tsx",
                "export const Root = ds\n\
                   .variant({ prop: 'size', defaultVariant: 'sm', variants: { sm: { p: 8 }, lg: { p: 8 } } })\n\
                   .asElement('div');\n\
                 export const Body = ds\n\
                   .variant({ prop: 'size', variants: { sm: { p: 8 }, lg: { p: 8 } } })\n\
                   .variant({ prop: 'tone', defaultVariant: 'loud', variants: { loud: { p: 8 }, quiet: { p: 8 } } })\n\
                   .compound({ size: 'sm' }, { display: 'flex' })\n\
                   .compound({ size: 'lg', tone: 'loud' }, { display: 'grid' })\n\
                   .asElement('div');\n\
                 export const Card = compose({ Root, Body }, { name: 'Card', shared: { size: true } });\n\
                 export const App = () => <Card.Root size=\"lg\"><Card.Body tone=\"loud\" /></Card.Root>;\n",
            )],
            &test_inputs(),
        );

        let root = class_of(&out, "card.tsx::Root");
        let body = class_of(&out, "card.tsx::Body");
        assert_eq!(
            out.sheets.compounds,
            format!(
                "@layer anm-compounds {{\n\
                 \x20 .{body}--compound-0 {{\n    display: flex;\n  }}\n\
                 \x20 .{body}--compound-1 {{\n    display: grid;\n  }}\n\
                 \x20 :is(.{root}--size-sm,.{root}--size-default) \
                 .{body}:not(.{body}--size-lg) {{\n    display: flex;\n  }}\n\
                 \x20 .{root}--size-lg \
                 .{body}:is(.{body}--tone-loud,.{body}--tone-default):not(.{body}--size-sm) \
                 {{\n    display: grid;\n  }}\n\
                 }}\n"
            ),
            "{}",
            out.sheets.compounds
        );
    }

    #[test]
    fn expansion_leaves_flat_class_numbering_and_per_component_fragments_alone() {
        // Expansion only reads the compound data: neither the config list nor
        // the per-component fragment may move.
        let out = analyze(
            &[
                (
                    "base.tsx",
                    "export const Root = ds\n\
                       .variant({ prop: 'size', variants: { sm: { p: 8 }, lg: { p: 8 } } })\n\
                       .asElement('div');\n\
                     export const Base = ds\n\
                       .variant({ prop: 'size', variants: { sm: { p: 8 }, lg: { p: 8 } } })\n\
                       .compound({ size: 'sm' }, { display: 'flex' })\n\
                       .asElement('div');\n",
                ),
                (
                    "card.tsx",
                    "import { Root, Base } from './base';\n\
                     export const Body = Base.extend()\n\
                       .compound({ size: 'lg' }, { display: 'grid' })\n\
                       .asElement('div');\n\
                     export const Card = compose({ Root, Body }, { name: 'Card', shared: { size: true } });\n\
                     export const App = () => <Card.Root size=\"lg\"><Card.Body /></Card.Root>;\n",
                ),
            ],
            &test_inputs(),
        );

        let root = class_of(&out, "base.tsx::Root");
        let body = class_of(&out, "card.tsx::Body");
        let configs = merged_compound_configs(&out, "card.tsx::Body");
        assert_eq!(configs.len(), 2, "{configs:?}");
        for (idx, (_, class)) in configs.iter().enumerate() {
            assert_eq!(*class, format!("{body}--compound-{idx}"));
        }

        let fragment = out.component_fragments["card.tsx::Body"]
            .compounds
            .as_deref()
            .unwrap_or_else(|| panic!("Body has no compounds fragment"));
        assert_eq!(
            fragment,
            format!(
                "  .{body}--compound-0 {{\n    display: flex;\n  }}\n\
                 \x20 .{body}--compound-1 {{\n    display: grid;\n  }}\n"
            ),
            "per-component fragment must stay flat-only: {fragment}"
        );
        assert!(
            out.sheets.compounds.contains(&format!(
                ".{root}--size-sm .{body}:not(.{body}--size-lg) {{"
            )),
            "{}",
            out.sheets.compounds
        );
        assert!(
            out.sheets.compounds.contains(&format!(
                ".{root}--size-lg .{body}:not(.{body}--size-sm) {{"
            )),
            "{}",
            out.sheets.compounds
        );
    }

    #[test]
    fn compound_free_of_shared_axes_keeps_the_compounds_layer_flat() {
        let out = analyze(
            &[(
                "card.tsx",
                "export const Root = ds\n\
                   .variant({ prop: 'size', variants: { sm: { p: 8 }, lg: { p: 8 } } })\n\
                   .asElement('div');\n\
                 export const Body = ds\n\
                   .variant({ prop: 'tone', variants: { loud: { p: 8 }, quiet: { p: 8 } } })\n\
                   .compound({ tone: 'loud' }, { display: 'flex' })\n\
                   .asElement('div');\n\
                 export const Card = compose({ Root, Body }, { name: 'Card', shared: { size: true } });\n\
                 export const App = () => <Card.Root size=\"lg\"><Card.Body tone=\"loud\" /></Card.Root>;\n",
            )],
            &test_inputs(),
        );

        let body = class_of(&out, "card.tsx::Body");
        assert_eq!(
            out.sheets.compounds,
            format!(
                "@layer anm-compounds {{\n  .{body}--compound-0 {{\n    display: flex;\n  }}\n}}\n"
            ),
            "{}",
            out.sheets.compounds
        );
    }

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

    /// Two files export the same component name and an app aliases both: each
    /// origin keeps exactly the option used at its own callsite.
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

    /// Inputs with one `layout` group over `config` and its configured sources.
    fn configured_inputs(config: &str, props: &str, sources: Option<&str>, dev_mode: bool) -> CssInputs {
        let mut inputs = CssInputs::from_json(
            None,
            None,
            None,
            Some(config),
            Some(&format!(r#"{{"layout": {props}}}"#)),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            dev_mode,
        )
        .unwrap();
        inputs.set_transform_sources(sources).unwrap();
        inputs
    }

    /// A configured source reading a free `btoa`/`atob` is admitted only when
    /// the loader's evidence for its own definition shows the host function;
    /// absent, malformed, missing or rejecting evidence leaves the raw value.
    /// Any other source is rejected only by evidence of a captured binding.
    #[test]
    fn host_reading_configured_sources_need_their_own_host_binding_evidence() {
        let config = r#"{"a": {"property": "width", "transform": "enc", "transformId": "enc@a"}, "b": {"property": "height", "transform": "enc", "transformId": "enc@b"}, "c": {"property": "top", "transform": "plain", "transformId": "plain@c"}}"#;
        let sources = r#"{"enc@a": "(v) => btoa(String(v))", "enc@b": "(v) => btoa(String(v))", "plain@c": "(v) => String(v)"}"#;
        let usage = "export const Box = ds.styles({ a: 'x', b: 'x', c: 'x' }).asElement('div');\nexport const App = () => <Box />;\n";
        for (provenance, admitted, reason) in [
            (Some(r#"{"enc@a": {"hostGlobals": ["btoa"]}, "enc@b": {"rejection": "reads 'btoa' declared in /m.ts outside the callback"}, "plain@c": {"hostGlobals": []}}"#),
                vec!["enc@a", "plain@c"], "its callable reads 'btoa' declared in /m.ts outside the callback"),
            (Some(r#"{"enc@a": {"hostGlobals": ["btoa"]}, "plain@c": {"hostGlobals": []}}"#), vec!["enc@a", "plain@c"], "supplied no host-binding provenance for it"),
            (Some(r#"{"enc@a": {"hostGlobals": []}, "enc@b": {"hostGlobals": ["atob"]}}"#), vec!["plain@c"], "is not shown to read the host 'btoa'"),
            (Some("{not json"), vec!["plain@c"], "host-binding provenance is malformed"),
            (None, vec!["plain@c"], "no host-binding provenance was supplied"),
        ] {
            let mut inputs = configured_inputs(config, r#"["a", "b", "c"]"#, Some(sources), false);
            inputs.transform_provenance = crate::transforms::TransformProvenance::from_json(provenance);
            let out = analyze(&[("use.tsx", usage)], &inputs);
            let keys: Vec<&str> = out.admitted_transforms.keys().map(String::as_str).collect();
            assert_eq!(keys, admitted, "{provenance:?}");
            let rejected: Vec<&String> = out.diagnostics.iter()
                .filter(|d| d.code.as_deref() == Some(CONFIGURED_TRANSFORM_REJECTED)).map(|d| &d.message).collect();
            assert!(rejected.iter().any(|m| m.contains("configured source reads 'btoa', but") && m.contains(reason)), "{provenance:?}: {rejected:#?}");
            assert!(rejected.iter().all(|m| !m.contains("'plain'")), "{rejected:#?}");
        }
        // A source reading neither name is rejected only when the evidence
        // shows its callable reading a binding outside itself.
        let mut inputs = configured_inputs(config, r#"["a", "b", "c"]"#, Some(sources), false);
        inputs.transform_provenance = crate::transforms::TransformProvenance::from_json(Some(
            r#"{"enc@a": {"hostGlobals": ["btoa"]}, "enc@b": {"hostGlobals": ["btoa"]}, "plain@c": {"rejection": "reads 'String' declared in /m.ts outside the callback"}}"#,
        ));
        let out = analyze(&[("use.tsx", usage)], &inputs);
        assert_eq!(out.admitted_transforms.keys().collect::<Vec<_>>(), ["enc@a", "enc@b"]);
        assert!(out.diagnostics.iter().any(|d| d.code.as_deref() == Some(CONFIGURED_TRANSFORM_REJECTED)
            && d.message.contains("'plain'") && d.message.contains("its callable reads 'String' declared in /m.ts outside the callback")));
    }

    fn failing_transform_variant_inputs(dev_mode: bool) -> CssInputs {
        configured_inputs(
            r#"{"w": {"property": "width", "transform": "boom"}}"#,
            r#"["w"]"#,
            Some(r#"{"boom": "(v) => ({ bad: v })"}"#),
            dev_mode,
        )
    }

    /// `wide` and `tall` share one configured callable; `inset` and `lift`
    /// bind two different callables that share the readable name `unit`;
    /// `count` binds a callable whose readable name is a standard global.
    fn binding_inputs() -> CssInputs {
        configured_inputs(
            r#"{
                "wide": {"property": "width", "transform": "double", "transformId": "double@system.tall"},
                "tall": {"property": "height", "transform": "double", "transformId": "double@system.tall"},
                "inset": {"property": "left", "transform": "unit", "transformId": "unit@system.inset"},
                "lift": {"property": "top", "transform": "unit", "transformId": "unit@system.lift"},
                "count": {"property": "zIndex", "transform": "Map", "transformId": "Map@system.count"},
                "keyed": {"property": "order", "transform": "keyed", "transformId": "keyed@system.keyed"}
            }"#,
            r#"["wide", "tall", "inset", "lift", "count", "keyed"]"#,
            Some(
                r#"{
                    "double@system.tall": "(v) => `${v * 2}px`",
                    "unit@system.inset": "(v) => `${v}px`",
                    "unit@system.lift": "(v) => `${v}rem`",
                    "Map@system.count": "(v) => v + 1",
                    "keyed@system.keyed": "(v) => new Map([[1, String(v * 3)]]).get(1)"
                }"#,
            ),
            false,
        )
    }

    const BINDING_USE: (&str, &str) = (
        "use.tsx",
        "export const Box = ds.styles({ wide: 10, tall: 12, inset: 3, lift: 3, count: 4, keyed: 2 }).asElement('div');\nexport const App = () => <Box />;\n",
    );
    const SAME_NAMED_A: (&str, &str) = (
        "decl-a.tsx",
        "import { createTransform } from '@animus-ui/system';\nexport const a = createTransform('unit', (v) => 'HIJACK-A');\nexport const d = createTransform('double', (v) => 'HIJACK-D');\n",
    );
    const SAME_NAMED_B: (&str, &str) = (
        "decl-b.tsx",
        "import { createTransform } from '@animus-ui/system';\nexport const b = createTransform('unit', (v) => 'HIJACK-B');\nexport const m = createTransform('Map', (v) => 'HIJACK-M');\n",
    );

    #[test]
    fn configured_bindings_own_their_props_in_either_analysis_order() {
        let inputs = binding_inputs();
        let forward = analyze(&[SAME_NAMED_A, SAME_NAMED_B, BINDING_USE], &inputs);
        let reversed = analyze(&[BINDING_USE, SAME_NAMED_B, SAME_NAMED_A], &inputs);
        for out in [&forward, &reversed] {
            for declaration in [
                "width: 20px",
                "height: 24px",
                "left: 3px",
                "top: 3rem",
                "z-index: 5",
                "order: 6",
            ] {
                assert!(out.css.contains(declaration), "{declaration}: {}", out.css);
            }
            assert!(!out.css.contains("HIJACK"), "{}", out.css);
            assert_eq!(
                out.admitted_transforms.keys().collect::<Vec<_>>(),
                vec![
                    "Map@system.count",
                    "double@system.tall",
                    "keyed@system.keyed",
                    "unit@system.inset",
                    "unit@system.lift",
                ]
            );
        }
        assert_eq!(forward.css, reversed.css);
    }

    #[test]
    fn dynamic_metadata_names_the_bound_definition_and_keeps_the_readable_name() {
        let out = analyze(
            &[(
                "use.tsx",
                "export const Box = ds.styles({}).system({ layout: true }).asElement('div');\nexport const App = ({ v }) => <Box inset={v} lift={v} wide={v} tall={v} />;\n",
            )],
            &binding_inputs(),
        );
        let meta = |prop: &str| {
            let meta = out.dynamic_props[prop].value().unwrap();
            (meta.transform_name.as_deref(), meta.transform_id.as_deref())
        };
        assert_eq!(meta("inset"), (Some("unit"), Some("unit@system.inset")));
        assert_eq!(meta("lift"), (Some("unit"), Some("unit@system.lift")));
        assert_eq!(meta("wide"), meta("tall"));
        assert_eq!(meta("wide"), (Some("double"), Some("double@system.tall")));
    }

    fn name_keyed_size_inputs(sources: Option<&str>) -> CssInputs {
        configured_inputs(
            r#"{"w": {"property": "width", "transform": "size"}}"#,
            r#"["w"]"#,
            sources,
            false,
        )
    }

    const SIZE_HIJACK: (&str, &str) = (
        "hijack.tsx",
        "import { createTransform } from '@animus-ui/system';\nexport const size = createTransform('size', (v) => 'HIJACK');\n",
    );
    const SIZE_USE: (&str, &str) = (
        "use.tsx",
        "export const Box = ds.styles({ w: 4 }).asElement('div');\nexport const App = () => <Box />;\n",
    );

    #[test]
    fn a_project_declaration_cannot_replace_a_name_keyed_configured_source() {
        let inputs = name_keyed_size_inputs(Some(r#"{"size": "(v) => `${v}px`"}"#));
        for entries in [[SIZE_HIJACK, SIZE_USE], [SIZE_USE, SIZE_HIJACK]] {
            let out = analyze(&entries, &inputs);
            assert!(out.css.contains("width: 4px"), "{}", out.css);
            assert!(!out.css.contains("HIJACK"), "{}", out.css);
        }
    }

    #[test]
    fn a_project_declaration_does_not_supply_a_missing_configured_source() {
        let out = analyze(&[SIZE_HIJACK, SIZE_USE], &name_keyed_size_inputs(None));
        assert!(!out.css.contains("HIJACK"), "{}", out.css);
        assert!(out.css.contains("width: 4;"), "raw fallback: {}", out.css);
        assert!(out.admitted_transforms.is_empty());
    }

    const NAMED_PROPS: &str = "export const C = ds.props({ shared: { property: 'left', transform: 'double' }, ambiguous: { property: 'top', transform: 'unit' }, unknown: { property: 'right', transform: 'nope' } }).asElement('div');\n";

    fn unbound_warnings(out: &CssOutput) -> Vec<(String, String, String)> {
        let mut found: Vec<_> = diagnostics_of(out, "warn")
            .into_iter()
            .filter(|d| d.message.contains("names transform"))
            .map(|d| (d.file.clone(), d.component.clone(), d.message.clone()))
            .collect();
        found.sort();
        found
    }

    fn assert_one_warning_per_unbound_name(out: &CssOutput, file: &str, component: &str) {
        let found = unbound_warnings(out);
        assert_eq!(found.len(), 2, "{:#?}", out.diagnostics);
        assert!(found.iter().all(|(f, c, _)| f == file && c == component), "{found:#?}");
        assert!(found.iter().any(|(_, _, m)| m.contains("'ambiguous'") && m.contains("'unit'") && m.contains("2 configured transforms")), "{found:#?}");
        assert!(found.iter().any(|(_, _, m)| m.contains("'unknown'") && m.contains("'nope'") && m.contains("no configured transform")), "{found:#?}");
        assert!(
            !out.diagnostics.iter().any(|d| d.message.contains("'double'") || d.message.contains("not bound")),
            "{:#?}",
            out.diagnostics
        );
    }

    #[test]
    fn a_component_transform_name_binds_only_one_configured_definition() {
        let out = analyze(
            &[
                SAME_NAMED_A,
                ("use.tsx", &format!("{NAMED_PROPS}export const App = () => <C shared={{3}} ambiguous={{3}} unknown={{3}} />;\n")),
            ],
            &binding_inputs(),
        );
        assert!(out.css.contains("left: 6px"), "{}", out.css);
        assert!(out.css.contains("top: 3;"), "{}", out.css);
        assert!(out.css.contains("right: 3;"), "{}", out.css);
        assert!(!out.css.contains("HIJACK"), "{}", out.css);
        assert_one_warning_per_unbound_name(&out, "use.tsx", "C");
    }

    #[test]
    fn an_unbound_component_transform_name_warns_without_static_usage() {
        let out = analyze(
            &[(
                "use.tsx",
                &format!("{NAMED_PROPS}export const App = ({{ v }}) => <C shared={{v}} ambiguous={{v}} unknown={{v}} />;\n"),
            )],
            &binding_inputs(),
        );
        assert_one_warning_per_unbound_name(&out, "use.tsx", "C");
    }

    #[test]
    fn independent_declarations_warn_separately_and_extensions_do_not_repeat() {
        let declaration = |name: &str| {
            format!("export const {name} = ds.props({{ unknown: {{ property: 'right', transform: 'nope' }} }}).asElement('div');\n")
        };
        let out = analyze(
            &[
                ("a.tsx", &format!("{}export const AppA = () => <A unknown={{1}} />;\n", declaration("A"))),
                (
                    "b.tsx",
                    &format!(
                        "{}export const Child = B.extend().styles({{ display: 'block' }}).asElement('div');\nexport const AppB = ({{ v }}) => <><B unknown={{v}} /><Child unknown={{2}} /></>;\n",
                        declaration("B")
                    ),
                ),
            ],
            &binding_inputs(),
        );
        let found = unbound_warnings(&out);
        let sites: Vec<(&str, &str)> = found.iter().map(|(f, c, _)| (f.as_str(), c.as_str())).collect();
        assert_eq!(sites, vec![("a.tsx", "A"), ("b.tsx", "B")], "{:#?}", out.diagnostics);
    }

    #[test]
    fn rejected_same_named_definitions_name_their_bound_props() {
        let closed = "(v) => `${v / BASE}px`";
        let out = analyze(
            &[(
                "use.tsx",
                "export const Box = ds.styles({ inset: 2, lift: 2, wide: 2 }).asElement('div');\nexport const App = () => <Box />;\n",
            )],
            &configured_inputs(
                r#"{
                    "inset": {"property": "left", "transform": "unit", "transformId": "unit@system.inset"},
                    "lift": {"property": "top", "transform": "unit", "transformId": "unit@system.lift"},
                    "wide": {"property": "width", "transform": "double", "transformId": "double@system.tall"},
                    "tall": {"property": "height", "transform": "double", "transformId": "double@system.tall"}
                }"#,
                r#"["inset", "lift", "wide", "tall"]"#,
                Some(
                    &serde_json::json!({
                        "unit@system.inset": closed,
                        "unit@system.lift": closed,
                        "double@system.tall": closed,
                    })
                    .to_string(),
                ),
                false,
            ),
        );
        let rejected = |name: &str| -> Vec<String> {
            out.diagnostics
                .iter()
                .filter(|d| d.code.as_deref() == Some(CONFIGURED_TRANSFORM_REJECTED))
                .filter(|d| d.component == format!("createTransform('{name}')"))
                .map(|d| {
                    assert_eq!((d.file.as_str(), d.kind.as_str()), ("system", "warn"));
                    d.message.clone()
                })
                .collect()
        };
        let unit = rejected("unit");
        assert_eq!(unit.len(), 2, "{:#?}", out.diagnostics);
        assert_ne!(unit[0], unit[1]);
        assert!(unit.iter().any(|m| m.contains("bound to prop 'inset'")), "{unit:#?}");
        assert!(unit.iter().any(|m| m.contains("bound to prop 'lift'")), "{unit:#?}");
        let double = rejected("double");
        assert_eq!(double.len(), 1, "{:#?}", out.diagnostics);
        assert!(double[0].contains("bound to props 'tall', 'wide'"), "{}", double[0]);
    }

    #[test]
    fn configured_source_failing_admission_is_neither_registered_nor_admitted() {
        let mut inputs = CssInputs::from_json(
            None,
            None,
            None,
            Some(
                r#"{"w": {"property": "width", "transform": "closed"}, "g": {"property": "height", "transform": "open"}}"#,
            ),
            Some(r#"{"layout": ["w", "g"]}"#),
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
        inputs
            .set_transform_sources(Some(
                r#"{"closed": "(v) => `${v / BASE}rem`", "open": "(v) => `${v / 4}rem`"}"#,
            ))
            .unwrap();
        let out = analyze(
            &[(
                "one.tsx",
                "export const Box = ds.styles({ w: 8, g: 8 }).asElement('div');\nexport const App = () => <Box />;\n",
            )],
            &inputs,
        );

        assert_eq!(
            out.admitted_transforms.keys().collect::<Vec<_>>(),
            vec!["open"],
            "only the self-contained configured source is admitted"
        );
        assert!(out.css.contains("height: 2rem"), "{}", out.css);
        assert!(out.css.contains("width: 8"), "raw fallback: {}", out.css);
        let admission: Vec<_> = out
            .diagnostics
            .iter()
            .filter(|d| d.kind == "warn" && d.component == "createTransform('closed')")
            .map(|d| d.message.as_str())
            .collect();
        assert!(
            admission
                .iter()
                .any(|m| m.contains("external symbol 'BASE'")),
            "{admission:?}"
        );
        assert!(
            !out.diagnostics
                .iter()
                .any(|d| d.message.contains("BASE is not defined")),
            "a rejected source must never be evaluated: {:#?}",
            out.diagnostics
        );
    }

    /// Both options hit the invalid-result-shape gate, but reconciliation
    /// prunes the unrendered one, so failing on it would be a false failure.
    #[test]
    fn pruned_variant_option_does_not_emit_a_build_failing_error() {
        let source = "export const Button = ds.styles({}).variant({ prop: 'tone', defaultVariant: 'quiet', variants: { quiet: { w: 1 }, loud: { w: 2 } } }).asElement('button');\n";
        let out = analyze(
            &[
                ("one.tsx", source),
                (
                    "app.tsx",
                    "export const App = () => <Button tone=\"quiet\" />;\n",
                ),
            ],
            &failing_transform_variant_inputs(false),
        );

        let errors: Vec<_> = out
            .diagnostics
            .iter()
            .filter(|d| d.kind == "error")
            .collect();
        assert_eq!(
            errors.len(),
            1,
            "expected only the rendered option's error, got {:#?}",
            errors
        );
    }

    /// Dev prunes nothing, so the unrendered option's CSS ships and its
    /// error is real.
    #[test]
    fn dev_mode_keeps_errors_for_every_resolved_variant_option() {
        let source = "export const Button = ds.styles({}).variant({ prop: 'tone', defaultVariant: 'quiet', variants: { quiet: { w: 1 }, loud: { w: 2 } } }).asElement('button');\n";
        let out = analyze(
            &[
                ("one.tsx", source),
                (
                    "app.tsx",
                    "export const App = () => <Button tone=\"quiet\" />;\n",
                ),
            ],
            &failing_transform_variant_inputs(true),
        );

        let errors = out.diagnostics.iter().filter(|d| d.kind == "error").count();
        assert_eq!(
            errors, 2,
            "dev emits both options, so both errors are real: {:#?}",
            out.diagnostics
        );
    }

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
        // Compose marks slots rendered, so the decoy survives; its unused
        // option goes because the member usage never reached it.
        assert!(
            !css.contains("padding: 8px"),
            "decoy Panel must not receive the member-expression usage: {}",
            css
        );
    }

    /// A bare name with several defining files and no usable import fans out
    /// to every candidate: any other choice could eliminate live CSS.
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

    /// An import that resolves to nothing makes the run conservative.
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

    #[test]
    fn renamed_sourced_reexport_usage_prunes_through_the_hop() {
        // The direct `source_file::imported` probe misses, so the hop must
        // find the defining chain.
        let out = analyze(
            &[
                (
                    "definition.ts",
                    "export const badge = ds.variant({ prop: 'tone', defaultVariant: 'quiet', variants: { quiet: { opacity: 1 }, loud: { opacity: 0.5 } } }).asClass();",
                ),
                (
                    "barrel.ts",
                    "export { badge as pill } from './definition';",
                ),
                (
                    "usage.tsx",
                    "import { pill } from './barrel';\nexport const App = () => <pill tone='quiet' />;",
                ),
            ],
            &test_inputs(),
        );
        assert!(
            out.sheets.variants.contains("opacity: 1"),
            "used option survives the renamed hop: {}",
            out.sheets.variants
        );
        assert!(
            !out.sheets.variants.contains("opacity: 0.5"),
            "unused option prunes through the renamed hop: {}",
            out.sheets.variants
        );
    }

    #[test]
    fn import_then_local_export_barrel_usage_prunes_through_both_hops() {
        // The unwrapped local is itself an import, so the walk hops again.
        let out = analyze(
            &[
                (
                    "definition.ts",
                    "export const badge = ds.variant({ prop: 'tone', defaultVariant: 'quiet', variants: { quiet: { opacity: 1 }, loud: { opacity: 0.5 } } }).asClass();",
                ),
                (
                    "barrel.ts",
                    "import { badge } from './definition';\nexport { badge as pill };",
                ),
                (
                    "usage.tsx",
                    "import { pill } from './barrel';\nexport const App = () => <pill tone='quiet' />;",
                ),
            ],
            &test_inputs(),
        );
        assert!(
            out.sheets.variants.contains("opacity: 1"),
            "used option survives the import-then-local-export barrel: {}",
            out.sheets.variants
        );
        assert!(
            !out.sheets.variants.contains("opacity: 0.5"),
            "unused option prunes through the import-then-local-export barrel: {}",
            out.sheets.variants
        );
    }

    #[test]
    fn defining_module_rename_export_usage_prunes_to_the_local_binding() {
        // The walk's terminal is the exported name; it maps back to the
        // chain's own binding.
        let out = analyze(
            &[
                (
                    "definition.ts",
                    "const badge = ds.variant({ prop: 'tone', defaultVariant: 'quiet', variants: { quiet: { opacity: 1 }, loud: { opacity: 0.5 } } }).asClass();\nexport { badge as fancyBadge };",
                ),
                (
                    "usage.tsx",
                    "import { fancyBadge } from './definition';\nexport const App = () => <fancyBadge tone='quiet' />;",
                ),
            ],
            &test_inputs(),
        );
        assert!(
            out.sheets.variants.contains("opacity: 1"),
            "used option survives the local rename: {}",
            out.sheets.variants
        );
        assert!(
            !out.sheets.variants.contains("opacity: 0.5"),
            "unused option prunes through the local rename: {}",
            out.sheets.variants
        );
    }

    fn runtime_custom_props(out: &CssOutput, id: &str) -> Vec<String> {
        let mut props: Vec<String> = out.replacement_configs[id]
            .custom_dynamic_config
            .iter()
            .flat_map(|config| config.keys().cloned())
            .collect();
        props.sort();
        props
    }

    const CONFINED_CARD: &str = "const Card = ds\n  .props({\n    inl: { property: 'minWidth', transform: (v) => `${v * 2}px` },\n    idle: { property: 'minHeight', transform: (v) => `${v * 3}px` },\n  })\n  .asElement('div');\n";

    #[test]
    fn a_confined_component_delivers_only_callbacks_a_value_without_a_class_needs() {
        let source = r#"import { helper } from './fx';
import Math from './m';
import Set from './s';
import Map from './unread';
const factor = 3;
const Card = ds
  .props({
    inl: { property: 'minWidth', transform: (v) => `${v * 2}px` },
    idle: { property: 'minHeight', transform: (v) => `${v * 3}px` },
    shut: { property: 'maxWidth', transform: (v) => `${v * factor}px` },
    tone: { property: 'maxHeight', scale: { sm: 4 }, transform: (v) => `${v}px` },
    reads: { property: 'top', transform: (v) => helper(v) },
    rounds: { property: 'left', transform: (v) => `${Math.round(v)}px` },
    sets: { property: 'right', transform: (v) => `${new Set([v]).size}px` },
    plain: { property: 'bottom', transform: (v) => `${Number.parseFloat(v)}px` },
    param: { property: 'width', transform: (Map) => `${Map}px` },
  })
  .asElement('div');
type CardProps = React.ComponentProps<typeof Card>;
export const App = () => <main><Card inl={10} shut={10} tone="lg">text</Card></main>;
"#;
        let out = analyze(&[("a.tsx", source)], &test_inputs());
        // The closure declines evaluation, `lg` misses the strict scale, and
        // the never-passed `reads`, `rounds` and `sets` are text that reads an
        // import, even one named like a standard global.
        assert_eq!(runtime_custom_props(&out, "a.tsx::Card"), ["reads", "rounds", "sets", "shut", "tone"]);
        assert!(out.sheets.custom.contains("min-width: 20px"), "{}", out.sheets.custom);
        let payload = &out.replacement_configs["a.tsx::Card"];
        let classes = payload.custom_prop_class_map.as_ref().unwrap();
        assert!(classes["inl"].contains_key("10"), "{classes:?}");
        assert!(classes["idle"].is_empty(), "{classes:?}");
        assert_eq!(payload.typed_custom_props, ["inl"]);
        let replacement = &out.components["a.tsx::Card"].replacement;
        assert!(!replacement.contains("v * 2") && !replacement.contains("v * 3"), "{replacement}");
        assert!(replacement.contains("v * factor"), "{replacement}");
        assert!(replacement.contains("\"inl\"") && replacement.contains("\"idle\""), "{replacement}");
    }

    #[test]
    fn uses_outside_the_proof_keep_callback_delivery() {
        let both: &[&str] = &["idle", "inl"];
        let inl: &[&str] = &["inl"];
        let none: &[&str] = &[];
        let cases: [(&str, &str, &[&str]); 27] = [
            ("export ", "export const App = () => <><Card inl={10} /></>;\n", both),
            ("", "export { Card };\nexport const App = () => <><Card inl={10} /></>;\n", both),
            ("", "export default Card;\n", both),
            ("", "export const App = () => <><Card inl={10} /></>;\nexport const Alias = Card;\n", both),
            ("", "export const App = () => createElement(Card, { inl: 10 });\n", both),
            ("", "export const App = () => <><Card inl={10} /></>;\nexport const peek = () => eval('Card');\n", both),
            ("", "export const App = () => <Card inl={10} />;\n", both),
            ("", "export const App = () => <Layout><Card inl={10} /></Layout>;\n", both),
            ("", "export const App = () => <ul>{[1].map((n) => <Card key={n} inl={10} />)}</ul>;\n", both),
            ("", "export const App = () => <div title={<Card inl={10} />} />;\n", both),
            ("", "export const App = (p) => <><Card inl={10} {...p} /></>;\n", both),
            ("", "export const App = () => <><Card inl={-10} /></>;\nexport const Box = Card.extend().asElement('span');\n", both),
            ("", "export const App = (p) => <><Card inl={p.n} /></>;\n", inl),
            ("", "export const App = ({ on }) => <section>{on ? <Card inl={10} /> : (<Card inl={10}><span><Card inl={10} /></span></Card>)}</section>;\nexport const Loose = ({ n }) => <><Card inl={n} /></>;\n", inl),
            ("", "export const App = () => <><Card inl={1e21} /></>;\n", inl),
            ("", "export const App = () => <><Card inl=<b /> /></>;\n", inl),
            // An element inside another element's attributes reaches whatever receives it.
            ("", "export const App = () => <Frame header={<div><Card inl={10} /></div>} />;\n", both),
            ("", "export const App = () => <List render={(i) => <li><Card inl={10} /></li>} />;\n", both),
            ("", "export const App = () => <Frame {...{ header: <div><Card inl={10} /></div> }} />;\n", both),
            ("", "export const App = ({ n }) => <Frame><div><Card inl={n} /></div></Frame>;\n", inl),
            // Literal keys must be the runtime's: digits JavaScript prints the same way.
            ("", "export const App = () => <><Card inl={0.000005} /></>;\n", inl),
            ("", "export const App = () => <><Card inl={0.000001} /></>;\n", inl),
            ("", "export const App = () => <><Card inl={-0.000005} /></>;\n", inl),
            ("", "export const App = () => <><Card inl={0.00001} /></>;\n", none),
            ("", "export const App = () => <><Card inl={-0.00001} /></>;\n", none),
            ("", "export const App = () => <><Card inl={{ _: 10, sm: { a: 1 } }} /></>;\n", inl),
            ("", "export const App = () => <><Card inl={{ _: 10, sm: 20 }} /></>;\n", none),
        ];
        for (prefix, rest, retained) in cases {
            let source = format!("{prefix}{CONFINED_CARD}{rest}");
            let out = analyze(&[("a.tsx", source.as_str())], &test_inputs());
            assert_eq!(runtime_custom_props(&out, "a.tsx::Card"), retained, "{prefix}{rest}");
            let replacement = &out.components["a.tsx::Card"].replacement;
            assert_eq!(replacement.contains("v * 2"), retained.contains(&"inl"), "{rest}: {replacement}");
        }
    }

    #[test]
    fn a_confined_parent_delivers_the_callbacks_its_runtime_descendants_read() {
        let source = r#"import { Kit } from './kit';
const Parent = ds
  .props({ inl: { property: 'minWidth', transform: (v) => `${v * 2}px` } })
  .asElement('div');
const Child = Parent.extend().asElement('section');
export const Grand = Child.extend().asElement('article');
const Quiet = Parent.extend().asElement('aside');
const Base = ds
  .props({ k: { property: 'minHeight', transform: (v) => `${v * 3}px` } })
  .asElement('div');
export const Over = Base.extend()
  .props({ k: { property: 'minHeight', transform: (v) => `${v * 7}px` } })
  .asElement('span');
const Kid = Kit.extend().asElement('i');
export const App = () => <><Quiet inl={10} /><Base k={10} /><Kid lift={10} /></>;
"#;
        let kit = "export const Kit = ds.props({ lift: { property: 'top', transform: (v) => `${v}px` } }).asElement('div');\n";
        let out = analyze(&[("kit.tsx", kit), ("a.tsx", source)], &test_inputs());
        // A pruned extension of an imported parent no longer names it, which
        // the transform answers by keeping the parent's module imported.
        assert!(runtime_custom_props(&out, "a.tsx::Kid").is_empty());
        assert!(out.replacement_configs["a.tsx::Kid"].drops_parent_reference);
        assert!(!out.replacement_configs["a.tsx::Child"].drops_parent_reference);
        for id in ["a.tsx::Parent", "a.tsx::Child", "a.tsx::Grand"] {
            assert_eq!(runtime_custom_props(&out, id), ["inl"], "{id}");
        }
        assert!(out.components["a.tsx::Parent"].replacement.contains("v * 2"));
        assert!(out.components["a.tsx::Child"].replacement.contains("Parent.customTransforms"));
        assert!(out.components["a.tsx::Grand"].replacement.contains("Child.customTransforms"));
        assert!(runtime_custom_props(&out, "a.tsx::Quiet").is_empty());
        assert!(runtime_custom_props(&out, "a.tsx::Base").is_empty());
        assert_eq!(runtime_custom_props(&out, "a.tsx::Over"), ["k"]);
        assert!(out.components["a.tsx::Over"].replacement.contains("v * 7"));
        assert!(!out.components["a.tsx::Base"].replacement.contains("v * 3"));
    }

    /// `wide` and `tall` share one configured callable, in different groups;
    /// `inset` binds a callable no other prop shares.
    fn split_group_inputs() -> CssInputs {
        let mut inputs = CssInputs::from_json(
            None,
            None,
            None,
            Some(
                r#"{
                    "wide": {"property": "width", "transform": "double", "transformId": "double@system.wide"},
                    "tall": {"property": "height", "transform": "double", "transformId": "double@system.wide"},
                    "inset": {"property": "left", "transform": "unit", "transformId": "unit@system.inset"}
                }"#,
            ),
            Some(r#"{"frame": ["wide", "inset"], "layout": ["tall"]}"#),
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
        inputs
            .set_transform_sources(Some(
                r#"{"double@system.wide": "(v) => `${v * 2}px`", "unit@system.inset": "(v) => `${v}px`"}"#,
            ))
            .unwrap();
        for (name, px) in [("sm", "480"), ("sm2", "560"), ("md", "768")] {
            inputs.theme.insert(format!("breakpoints.{name}"), px.into());
        }
        inputs
    }

    #[test]
    fn system_props_active_only_on_confined_static_uses_ship_no_slot_or_callback() {
        let render = "export const App = ({ n }) => <><Frame wide={4} inset={3} /><Panel tall={n} /></>;\n";
        let declare = |frame: &str, render: &str| {
            format!("{frame}const Frame = ds.system({{ frame: true }}).asElement('div');\nexport const Panel = ds.system({{ layout: true }}).asElement('section');\n{render}")
        };
        let out = analyze(&[("a.tsx", declare("", render).as_str())], &split_group_inputs());
        assert_eq!(out.dynamic_props.keys().collect::<Vec<_>>(), ["tall"]);
        assert_eq!(out.admitted_transforms.keys().collect::<Vec<_>>(), ["double@system.wide"]);
        for declaration in ["width: 8px", "left: 3px"] {
            assert!(out.css.contains(declaration), "{declaration}: {}", out.css);
        }
        assert!(!out.css.contains("-dyn-wide") && !out.css.contains("-dyn-inset"), "{}", out.css);
        assert!(!out.components["a.tsx::Frame"].replacement.contains("dynamicPropConfig"));

        let exported = analyze(
            &[("a.tsx", declare("export { Frame };\n", render).as_str())],
            &split_group_inputs(),
        );
        assert_eq!(exported.dynamic_props.keys().collect::<Vec<_>>(), ["inset", "tall", "wide"]);
        assert_eq!(exported.admitted_transforms.len(), 2);

        let dynamic = analyze(
            &[("a.tsx", declare("", "export const App = ({ n }) => <><Frame wide={n} inset={3} /></>;\n").as_str())],
            &split_group_inputs(),
        );
        assert_eq!(dynamic.dynamic_props.keys().collect::<Vec<_>>(), ["wide"]);
        assert_eq!(dynamic.admitted_transforms.keys().collect::<Vec<_>>(), ["double@system.wide"]);

        // Inside an attribute nothing is proven (and the unresolved `Layout`
        // widens the floor); `wide` keeps its slot for a value whose runtime
        // key differs from the build's. A configured transform's keys are
        // typed, which order `sm2` after `sm` as the runtime does.
        let cases: [(&str, &[&str]); 3] = [
            ("export const App = () => <Layout header={<div><Frame wide={4} inset={3} /></div>} />;\n", &["inset", "tall", "wide"]),
            ("export const App = () => <><Frame wide={0.000005} inset={3} /></>;\n", &["wide"]),
            ("export const App = () => <><Frame wide={{ sm: 4, sm2: 6 }} inset={{ sm: 3, md: 5 }} /></>;\n", &[]),
        ];
        for (render, want) in cases {
            let out = analyze(&[("a.tsx", declare("", render).as_str())], &split_group_inputs());
            assert_eq!(out.dynamic_props.keys().collect::<Vec<_>>(), want, "{render}");
        }
        // An untransformed prop's untyped key orders `sm2` before `sm`, unlike
        // the runtime, so such a value keeps its slot.
        let mut untyped = split_group_inputs();
        let inset = untyped.config.get_mut("inset").unwrap();
        inset.transform = None;
        inset.transform_id = None;
        let render = "export const App = () => <><Frame wide={4} inset={{ sm: 3, sm2: 5 }} /></>;\n";
        let out = analyze(&[("a.tsx", declare("", render).as_str())], &untyped);
        assert_eq!(out.dynamic_props.keys().collect::<Vec<_>>(), ["inset"]);
    }

    /// A custom prop naming a configured transform keeps its runtime slot when
    /// a literal declines static extraction, as a callback prop does: unless
    /// its component is confined and every literal has a class.
    #[test]
    fn named_configured_custom_literals_that_decline_keep_their_slot() {
        let inputs = configured_inputs(
            r#"{
                "hw": {"property": "columnGap", "transform": "host", "transformId": "host@system.hw"},
                "ns": {"property": "marginTop", "transform": "nstr", "transformId": "nstr@system.ns"},
                "un": {"property": "marginLeft", "transform": "unit", "transformId": "unit@system.un"}
            }"#,
            r#"["hw", "ns", "un"]"#,
            Some(
                &serde_json::json!({
                    "host@system.hw": "(v) => `${new Date(0).getUTCFullYear() - 1970 + Number(v)}px`",
                    "nstr@system.ns": "(v) => String(Number(v) * 2)",
                    "unit@system.un": "(v) => `${v}px`",
                })
                .to_string(),
            ),
            false,
        );
        let props = "{ e: { property: 'left', transform: 'host' }, n: { property: 'top', transform: 'nstr' }, u: { property: 'right', transform: 'unit' } }";
        let source = format!(
            "export const Card = ds.props({props}).asElement('div');\nconst Conf = ds.props({props}).asElement('div');\n\
             export const Kid = Card.extend().asElement('div');\n\
             export const App = () => <><Card e={{3}} n={{2}} u={{4}} /><Conf e={{3}} n={{2}} u={{4}} /><Kid e={{3}} n={{2}} u={{4}} /></>;\n"
        );
        let out = analyze(&[("a.tsx", source.as_str())], &inputs);
        assert_eq!(runtime_custom_props(&out, "a.tsx::Card"), ["e", "n", "u"]);
        assert_eq!(runtime_custom_props(&out, "a.tsx::Conf"), ["e", "n"]);
        assert_eq!(runtime_custom_props(&out, "a.tsx::Kid"), ["e", "n", "u"]);
        assert!(out.components["a.tsx::Conf"].replacement.contains("transforms[\"host@system.hw\"]"));
    }

    #[test]
    fn configured_transforms_evaluate_in_isolation_with_typed_keys_and_runtime_results() {
        let inputs = configured_inputs(
            r#"{
                "tw": {"property": "outlineOffset", "transform": "typed", "transformId": "typed@system.tw"},
                "mm": {"property": "marginRight", "transform": "mutate", "transformId": "mutate@system.mm"},
                "mr": {"property": "marginBottom", "transform": "reads", "transformId": "reads@system.mr"},
                "hw": {"property": "columnGap", "transform": "host", "transformId": "host@system.hw"},
                "ns": {"property": "marginTop", "transform": "nstr", "transformId": "nstr@system.ns"}
            }"#,
            r#"["tw", "mm", "mr", "hw", "ns"]"#,
            Some(
                &serde_json::json!({
                    "typed@system.tw": "(v) => typeof v === 'number' ? `${v}px` : `${v}em`",
                    "mutate@system.mm": "(v) => { Math.round = () => 7; return `${v}px`; }",
                    "reads@system.mr": "(v) => `${Math.round(Number(v))}px`",
                    "host@system.hw": "(v) => typeof globalThis.window === 'undefined' ? `${v}px` : `${v * 2}px`",
                    "nstr@system.ns": "(v) => String(Number(v) * 2)",
                })
                .to_string(),
            ),
            false,
        );
        let declare = |render: &str| {
            format!("export const Box = ds.system({{ layout: true }}).asElement('div');\nexport const S = ds.styles({{ hw: 5 }}).asElement('p');\n{render}")
        };
        for render in [
            "export const App = () => <><Box mm={1} /><Box mr={4.4} tw={100} /><Box tw=\"100\" hw={5} ns={10} /><S /></>;\n",
            "export const App = () => <><S /><Box ns={10} hw={5} tw=\"100\" /><Box tw={100} mr={4.4} /><Box mm={1} /></>;\n",
        ] {
            let out = analyze(&[("a.tsx", declare(render).as_str())], &inputs);
            let rule = |prop: &str, key: &str| {
                let class = &out.system_prop_map[prop][key];
                out.css.split(&format!(".{class}")).nth(1).and_then(|r| r.split('}').next()).unwrap_or_default().to_string()
            };
            // A callback tells `100` from `"100"`, so each keeps its own class.
            assert!(rule("tw", "100").contains("100px"), "{render}\n{}", out.css);
            assert!(rule("tw", "\"100\"").contains("100em"), "{render}\n{}", out.css);
            // Each evaluation has its own realm, whatever the order.
            assert!(rule("mr", "4.4").contains("4px"), "{render}\n{}", out.css);
            // A host read and a numeric-string result stay on the runtime path.
            assert!(!out.system_prop_map.contains_key("hw") && !out.system_prop_map.contains_key("ns"), "{render}");
            assert_eq!(out.typed_system_props, ["hw", "mm", "mr", "ns", "tw"]);
            // Only the style block, with no runtime path, reports the decline.
            let declined: Vec<_> = out
                .diagnostics
                .iter()
                .filter(|d| d.code.as_deref() == Some(STATIC_EVALUATION_UNAVAILABLE))
                .collect();
            assert_eq!(declined.len(), 1, "{:?}", out.diagnostics);
            assert_eq!(declined[0].severity.as_deref(), Some("error"));
            assert!(out.css.contains("column-gap: 5;"), "{}", out.css);
        }
    }
}
