//! The v2 stateful NAPI handle (row 06, design.md D7): rolldown
//! `BindingBundler`-style two-tier state — the instance owns per-build
//! fact state Rust-side, so nothing round-trips through JS per file (NS3).
//! Instances are per-plugin-instance (DEF-1: no process-global engine —
//! two differently-configured plugins in one process cannot stomp each
//! other, killing the RF-28 class).
//!
//! Fail-loud contract (G5 / extraction-diagnostics §V2 boundary error
//! reporting): malformed input and out-of-order calls are ERRORS with
//! actionable text, never silent no-ops.

use std::collections::BTreeMap;

use crate::{analyze_css, assemble, ast_store, cross_file, emit, facts};

/// v1 default system-props virtual module id (EmitterConfig default).
const SYSTEM_PROPS_MODULE_ID: &str = "virtual:animus/system-props";

/// v1 derive_compose_context_import verbatim:
/// `@scope/pkg[/subpath]` → `@scope/pkg/compose-with-context`.
fn derive_compose_context_import(runtime_import: &str) -> String {
    if runtime_import.starts_with('@') {
        let parts: Vec<&str> = runtime_import.splitn(3, '/').collect();
        if parts.len() >= 2 {
            return format!("{}/{}/compose-with-context", parts[0], parts[1]);
        }
    }
    format!("{}/compose-with-context", runtime_import)
}

/// The analyze() manifest. Field naming CONTRACT: plugin-consumed fields
/// carry v1's EXACT serde names (snake_case: system_prop_map,
/// dynamic_props, components, files, timing, report, css, sheets,
/// diagnostics) so the plugins' v2 legs read one manifest shape;
/// v2-native additions (fileFacts, crossFile, parseCount) stay camelCase.
#[derive(serde::Serialize)]
struct AnalyzeResult<'a> {
    #[serde(rename = "fileFacts")]
    file_facts: &'a BTreeMap<String, facts::FileFacts>,
    #[serde(rename = "crossFile")]
    cross_file: cross_file::CrossFileFacts,
    #[serde(rename = "parseCount")]
    parse_count: usize,
    #[serde(rename = "usageResidue")]
    usage_residue: &'a [crate::usage_facts::UsageResidueRecord],
    css: &'a str,
    sheets: &'a crate::css::CssSheets,
    diagnostics: &'a [analyze_css::CssDiagnostic],
    /// v1 manifest `report` (reconciliation report).
    report: &'a serde_json::Value,
    system_prop_map:
        &'a std::collections::BTreeMap<String, std::collections::BTreeMap<String, String>>,
    dynamic_props: &'a std::collections::BTreeMap<String, crate::dynamic_meta::DynamicPropMeta>,
    component_fragments: &'a std::collections::BTreeMap<String, crate::css::PerComponentSheets>,
    reverse_provenance: &'a std::collections::BTreeMap<String, Vec<String>>,
    components: &'a std::collections::BTreeMap<String, analyze_css::ComponentDescriptor>,
    files: &'a std::collections::BTreeMap<String, Vec<String>>,
    /// v1 timing subset (parseCount camelCase inside, matching v1's
    /// PipelineTiming serde).
    timing: serde_json::Value,
}

/// Engine options (row 07 Task 07.3 — replaces the RF-53 hardcodes).
/// All fields optional; absent = v1 defaults.
#[napi(object)]
#[derive(Default)]
pub struct EngineOptions {
    /// Class-identity prefix (v1 default "animus").
    pub prefix: Option<String>,
    /// Runtime import source (v1 default "@animus-ui/system").
    pub runtime_import: Option<String>,
    /// CSS virtual module id (v1 default "virtual:animus/styles.css").
    pub css_module_id: Option<String>,
    /// System-props virtual module id (v1 EmitterConfig default
    /// "virtual:animus/system-props").
    pub system_props_module_id: Option<String>,
    /// Flat theme scales JSON (v1 analyzeProject `theme_json`).
    pub theme_json: Option<String>,
    /// Token-alias variable map JSON (v1 `variable_map_json`).
    pub variable_map_json: Option<String>,
    /// Contextual vars JSON (v1 `contextual_vars_json`).
    pub contextual_vars_json: Option<String>,
    /// Prop config map JSON (v1 `config_json`).
    pub config_json: Option<String>,
    /// Group registry JSON (v1 `group_registry_json`).
    pub group_registry_json: Option<String>,
    /// Selector aliases JSON (v1 `selector_aliases_json`).
    pub selector_aliases_json: Option<String>,
    /// Condition aliases JSON (inc 03 — `conditionAliases` manifest field):
    /// `{ "_motionReduce": { "value": "@media …", "order": 500, "kind":
    /// "media" } }`. Absent = no registrations.
    pub condition_aliases_json: Option<String>,
    /// Global style blocks JSON (v1 `global_style_blocks_json`).
    pub global_style_blocks_json: Option<String>,
    /// Keyframes blocks JSON (v1 `keyframes_blocks_json` — feeds BOTH the
    /// global sheet and the static keyframes registry, v1 Phase 2a).
    pub keyframes_json: Option<String>,
    /// Package resolution JSON (v1 `package_resolution_json`).
    pub package_resolution_json: Option<String>,
    /// Path aliases JSON (`{aliases: [...]}` wrapper, v1 shape).
    pub path_aliases_json: Option<String>,
    /// Forced-emission declarations (spec: static-emission-overrides) —
    /// the serialized `staticCss` plugin option.
    pub static_css_json: Option<String>,
    /// v1 `dev_mode`: retain all components (skip reconciliation pruning).
    pub dev_mode: Option<bool>,
}

struct ResolvedOptions {
    prefix: String,
    runtime_import: String,
    css_module_id: String,
    system_props_module_id: String,
    css_inputs: analyze_css::CssInputs,
}

/// Runtime capabilities referenced by surviving component replacements.
/// Derived only from parsed chain facts plus the post-analysis replacement
/// payload; generated JavaScript is deliberately not an input.
#[derive(Default)]
struct ReplacementImportNeeds {
    create_component: bool,
    class_resolver: bool,
    system_prop_map: bool,
    system_prop_groups: bool,
    dynamic_prop_config: bool,
    transforms: bool,
}

fn replacement_import_needs(
    file_facts: &facts::FileFacts,
    payloads: &std::collections::HashMap<String, assemble::ReplacementPayload>,
) -> ReplacementImportNeeds {
    let mut needs = ReplacementImportNeeds::default();

    for chain in &file_facts.chains {
        if !chain.descriptor.extractable || chain.fatal_error.is_some() {
            continue;
        }
        let Some(payload) = payloads.get(&chain.descriptor.binding) else {
            continue;
        };

        match chain.descriptor.terminal {
            crate::chain_walk::TerminalKind::AsClass => needs.class_resolver = true,
            crate::chain_walk::TerminalKind::AsElement
            | crate::chain_walk::TerminalKind::AsComponent => needs.create_component = true,
        }

        let has_system_props = !payload.system_prop_names.is_empty();
        needs.system_prop_map |= has_system_props;
        needs.system_prop_groups |= !payload.system_group_names.is_empty();
        needs.dynamic_prop_config |= has_system_props && payload.has_dynamic_props;

        // Named custom transforms are the only payload field that emits a
        // direct `transforms.<name>` reference. Dynamic-prop rebinding also
        // needs the registry because its emitted loop indexes `transforms`
        // for entries carrying transformName metadata.
        needs.transforms |= needs.dynamic_prop_config
            || payload
                .custom_dynamic_config
                .as_ref()
                .is_some_and(|config| {
                    config.values().any(|meta| {
                        meta.transform_fn_source.is_none() && meta.transform_name.is_some()
                    })
                });
    }

    needs
}

#[napi]
pub struct ExtractEngine {
    opts: ResolvedOptions,
    /// Retained per-file facts — the build state consumers query without
    /// re-serializing anything through JS.
    facts: BTreeMap<String, facts::FileFacts>,
    /// Cross-file facts computed ONCE per analyze() (inc-06 review F-d:
    /// per-transform recomputation was an O(files²) smell).
    cross: Option<cross_file::CrossFileFacts>,
    /// Retained source text per file (emission input; the D4 outcome:
    /// source + facts suffice, no AST survives analyze()).
    sources: BTreeMap<String, String>,
    /// Input order of the last analyze() call — v1 iterates files in
    /// caller order (registration collisions + utility-class first-wins
    /// dedup are ORDER-SENSITIVE).
    order: Vec<String>,
    /// CSS output of the last analyze() (manifest surface; retained for
    /// future incremental surfaces).
    css: Option<analyze_css::CssOutput>,
    parse_count: usize,
}

#[napi]
impl ExtractEngine {
    #[napi(constructor)]
    #[allow(clippy::new_without_default)]
    pub fn new(options: Option<EngineOptions>) -> napi::Result<Self> {
        let o = options.unwrap_or_default();
        let css_inputs = analyze_css::CssInputs::from_json(
            o.theme_json.as_deref(),
            o.variable_map_json.as_deref(),
            o.contextual_vars_json.as_deref(),
            o.config_json.as_deref(),
            o.group_registry_json.as_deref(),
            o.selector_aliases_json.as_deref(),
            o.condition_aliases_json.as_deref(),
            o.global_style_blocks_json.as_deref(),
            o.keyframes_json.as_deref(),
            o.package_resolution_json.as_deref(),
            o.path_aliases_json.as_deref(),
            o.static_css_json.as_deref(),
            o.dev_mode.unwrap_or(false),
        )
        .map_err(napi::Error::from_reason)?;
        Ok(ExtractEngine {
            opts: ResolvedOptions {
                prefix: o.prefix.unwrap_or_else(|| "animus".to_string()),
                runtime_import: o
                    .runtime_import
                    .unwrap_or_else(|| "@animus-ui/system".to_string()),
                css_module_id: o
                    .css_module_id
                    .unwrap_or_else(|| "virtual:animus/styles.css".to_string()),
                system_props_module_id: o
                    .system_props_module_id
                    .unwrap_or_else(|| SYSTEM_PROPS_MODULE_ID.to_string()),
                css_inputs,
            },
            facts: BTreeMap::new(),
            cross: None,
            sources: BTreeMap::new(),
            order: Vec::new(),
            css: None,
            parse_count: 0,
        })
    }

    /// Parse-once fact extraction over the file set; facts and sources are
    /// RETAINED on the handle for subsequent per-file calls. Returns the
    /// fact manifest (files + parseCount) as JSON.
    #[napi]
    pub fn analyze(&mut self, file_entries_json: String) -> napi::Result<String> {
        #[derive(serde::Deserialize)]
        struct InputEntry {
            path: String,
            source: String,
        }
        let entries: Vec<InputEntry> = serde_json::from_str(&file_entries_json)
            .map_err(|e| napi::Error::from_reason(format!("invalid file entries JSON: {e}")))?;

        self.facts.clear();
        self.sources.clear();
        self.order.clear();

        let store = ast_store::AstStore::build(
            entries
                .into_iter()
                .map(|e| ast_store::FileEntry {
                    path: e.path,
                    source: e.source,
                })
                .collect(),
        );
        self.parse_count = store.parse_count();

        // Pass A (v1 Phases 1-2b over the SAME parsed store — no
        // re-parse, G1): per-file statics/imports/exports, static-export
        // maps, keyframes registry, then binding-resolved enrichment.
        use crate::usage_facts::{collect_export_facts, collect_import_facts};
        let mut statics_by_file: std::collections::BTreeMap<
            String,
            rustc_hash::FxHashMap<String, serde_json::Value>,
        > = std::collections::BTreeMap::new();
        let mut complete_statics_by_file: std::collections::BTreeMap<
            String,
            rustc_hash::FxHashMap<String, serde_json::Value>,
        > = std::collections::BTreeMap::new();
        let mut imports_by_file = std::collections::BTreeMap::new();
        let mut static_exports_by_file: std::collections::BTreeMap<
            String,
            rustc_hash::FxHashMap<String, serde_json::Value>,
        > = std::collections::BTreeMap::new();
        let mut complete_static_exports_by_file: std::collections::BTreeMap<
            String,
            rustc_hash::FxHashMap<String, serde_json::Value>,
        > = std::collections::BTreeMap::new();
        for ast in store.iter() {
            let program = ast.program();
            let statics = crate::eval::collect_static_values(program);
            let complete_statics = crate::eval::collect_complete_static_values(program);
            let exports = collect_export_facts(program);
            // v1 collect_static_exports (style_evaluator 502-519).
            let mut static_exports = rustc_hash::FxHashMap::default();
            let mut complete_static_exports = rustc_hash::FxHashMap::default();
            for exp in &exports {
                if let Some(local) = &exp.local {
                    if let Some(value) = statics.get(local) {
                        static_exports.insert(exp.exported.clone(), value.clone());
                    }
                    if let Some(value) = complete_statics.get(local) {
                        complete_static_exports.insert(exp.exported.clone(), value.clone());
                    }
                }
            }
            statics_by_file.insert(ast.path.clone(), statics);
            complete_statics_by_file.insert(ast.path.clone(), complete_statics);
            imports_by_file.insert(ast.path.clone(), (collect_import_facts(program), exports));
            static_exports_by_file.insert(ast.path.clone(), static_exports);
            complete_static_exports_by_file.insert(ast.path.clone(), complete_static_exports);
        }

        // Keyframes registry (v1 project_analyzer 551-567 verbatim shape):
        // {exportName: {keyName: {name, frames}}} → exportName →
        // {keyName: "resolved-name"}.
        let keyframes_registry: rustc_hash::FxHashMap<String, serde_json::Value> = self
            .opts
            .css_inputs
            .keyframes_blocks
            .as_ref()
            .and_then(|v| v.as_object())
            .map(|obj| {
                obj.iter()
                    .filter_map(|(export_name, collection)| {
                        let coll_obj = collection.as_object()?;
                        let mut map = serde_json::Map::new();
                        for (key_name, block) in coll_obj {
                            if let Some(name) = block.get("name").and_then(|n| n.as_str()) {
                                map.insert(
                                    key_name.clone(),
                                    serde_json::Value::String(name.to_string()),
                                );
                            }
                        }
                        Some((export_name.clone(), serde_json::Value::Object(map)))
                    })
                    .collect()
            })
            .unwrap_or_default();

        // Per-file enrichment (v1 Phase 2b, 581-615): imported consts via
        // DIRECT import resolution (re-export following is the registered
        // gap), keyframes bindings by resolved export name, and local
        // keyframes exports.
        let mut enriched_by_file: std::collections::BTreeMap<
            String,
            rustc_hash::FxHashMap<String, serde_json::Value>,
        > = std::collections::BTreeMap::new();
        let mut usage_enriched_by_file: std::collections::BTreeMap<
            String,
            rustc_hash::FxHashMap<String, serde_json::Value>,
        > = std::collections::BTreeMap::new();
        for (path, (imports, exports)) in &imports_by_file {
            let mut extra = rustc_hash::FxHashMap::default();
            let mut usage_extra = rustc_hash::FxHashMap::default();
            for imp in imports {
                let Some(direct_file) = crate::analyze_css::resolve_import_source(
                    path,
                    &imp.source,
                    &statics_by_file,
                    &self.opts.css_inputs,
                ) else {
                    continue;
                };
                // v1's binding_map hit requires the source file to EXPORT
                // the imported name (import_resolver resolve_bindings) —
                // both the static value and the keyframes injection are
                // gated on it (project_analyzer 586-600) — and FOLLOWS
                // re-export hops to the defining file.
                let export_exists = imports_by_file
                    .get(&direct_file)
                    .is_some_and(|(_, exps)| exps.iter().any(|e| e.exported == imp.imported));
                if !export_exists {
                    continue;
                }
                let mut resolved_file = direct_file;
                let mut resolved_name = imp.imported.clone();
                // v1 follow_export_chain (import_resolver 273-318): an
                // enrichment entry exists ONLY when the chain terminates
                // at a LOCAL export; a dangling hop yields nothing
                // (row-13 review A1). 32-hop cap mirrors v1.
                let mut terminated_locally = false;
                {
                    let mut seen: rustc_hash::FxHashSet<(String, String)> =
                        rustc_hash::FxHashSet::default();
                    let mut hops = 0usize;
                    while hops < 32 && seen.insert((resolved_file.clone(), resolved_name.clone())) {
                        hops += 1;
                        let Some((_, exps)) = imports_by_file.get(&resolved_file) else {
                            break;
                        };
                        let Some(exp) = exps.iter().find(|e| e.exported == resolved_name) else {
                            break;
                        };
                        if exp.source.is_none() {
                            terminated_locally = exp.local.is_some();
                            break;
                        }
                        let (Some(spec), Some(original)) = (&exp.source, &exp.original) else {
                            break;
                        };
                        let Some(next) = crate::analyze_css::resolve_import_source(
                            &resolved_file,
                            spec,
                            &statics_by_file,
                            &self.opts.css_inputs,
                        ) else {
                            break;
                        };
                        resolved_name = original.clone();
                        resolved_file = next;
                    }
                }
                if !terminated_locally {
                    continue;
                }
                if let Some(export_map) = static_exports_by_file.get(&resolved_file) {
                    if let Some(val) = export_map.get(&resolved_name) {
                        extra.insert(imp.local.clone(), val.clone());
                    }
                }
                if let Some(export_map) = complete_static_exports_by_file.get(&resolved_file) {
                    if let Some(val) = export_map.get(&resolved_name) {
                        usage_extra.insert(imp.local.clone(), val.clone());
                    }
                }
                if let Some(kf) = keyframes_registry.get(&resolved_name) {
                    extra.insert(imp.local.clone(), kf.clone());
                    usage_extra.insert(imp.local.clone(), kf.clone());
                }
            }
            for exp in exports {
                if let Some(local) = &exp.local {
                    if let Some(kf) = keyframes_registry.get(&exp.exported) {
                        extra.insert(local.clone(), kf.clone());
                        usage_extra.insert(local.clone(), kf.clone());
                    }
                }
            }
            if !extra.is_empty() {
                enriched_by_file.insert(path.clone(), extra);
            }
            if !usage_extra.is_empty() {
                usage_enriched_by_file.insert(path.clone(), usage_extra);
            }
        }

        // Pass B: chain facts with enriched statics.
        let empty = rustc_hash::FxHashMap::default();
        for ast in store.iter() {
            self.order.push(ast.path.clone());
            let extra = enriched_by_file.get(&ast.path).unwrap_or(&empty);
            let usage_extra = usage_enriched_by_file.get(&ast.path).unwrap_or(&empty);
            let local_statics = statics_by_file
                .get(&ast.path)
                .expect("Pass A must record local statics for every file");
            let local_usage_statics = complete_statics_by_file
                .get(&ast.path)
                .expect("Pass A must record complete local statics for every file");
            self.facts.insert(
                ast.path.clone(),
                facts::extract_file_facts_from_static_maps(
                    ast,
                    &self.opts.prefix,
                    local_statics,
                    local_usage_statics,
                    extra,
                    usage_extra,
                ),
            );
            self.sources
                .insert(ast.path.clone(), ast.source().to_string());
        }
        // The store — and with it every AST — drops here (D4 outcome).

        let cross = cross_file::resolve_cross_file(&self.facts);
        let css = analyze_css::run(
            &self.facts,
            &self.order,
            &self.opts.css_inputs,
            &self.opts.prefix,
        );
        let out = serde_json::to_string(&AnalyzeResult {
            cross_file: cross.clone(),
            file_facts: &self.facts,
            parse_count: self.parse_count,
            usage_residue: &css.usage_residue,
            css: &css.css,
            sheets: &css.sheets,
            diagnostics: &css.diagnostics,
            report: &css.reconciliation,
            system_prop_map: &css.system_prop_map,
            dynamic_props: &css.dynamic_props,
            component_fragments: &css.component_fragments,
            reverse_provenance: &css.reverse_provenance,
            components: &css.components,
            files: &css.files_map,
            timing: serde_json::json!({ "parseCount": self.parse_count }),
        });
        self.cross = Some(cross);
        self.css = Some(css);
        out.map_err(|e| napi::Error::from_reason(format!("serialize failed: {e}")))
    }

    /// Reset all retained build state.
    #[napi]
    pub fn clear_cache(&mut self) {
        self.facts.clear();
        self.cross = None;
        self.sources.clear();
        self.order.clear();
        self.css = None;
        self.parse_count = 0;
    }

    #[napi(getter)]
    pub fn parse_count(&self) -> u32 {
        self.parse_count as u32
    }

    /// Per-file transformation from retained source + facts (no-config
    /// subset: variants/compounds/states; system/custom payloads need the
    /// row-07 config inputs and FAIL LOUD). Returns {code, hasComponents}
    /// JSON. Import decisions come from surviving chain/payload metadata;
    /// consumed-import stripping and directive handling are the ported v1
    /// semantics.
    #[napi]
    pub fn transform_file(&mut self, path: String) -> napi::Result<String> {
        let (Some(source), Some(file_facts)) = (self.sources.get(&path), self.facts.get(&path))
        else {
            return Err(napi::Error::from_reason(format!(
                "transformFile('{path}'): path not present in the last analyze() call — \
                 analyze the project first (engine state is per-instance, not global)."
            )));
        };

        if self.cross.is_none() {
            return Err(napi::Error::from_reason(
                "transformFile: analyze() must run first".to_string(),
            ));
        }
        // v1 replaces only manifest SURVIVORS — payload presence IS the
        // survival record (inc-07 review F2: the earlier binding-name
        // ancestry re-walk here disagreed with analyze_css's provenance
        // resolution and dropped aliased-parent extension chains; the
        // payload map already encodes the authoritative decision).
        let file_payloads: std::collections::HashMap<String, assemble::ReplacementPayload> = self
            .css
            .as_ref()
            .map(|css| {
                let file_prefix = format!("{path}::");
                css.replacement_configs
                    .iter()
                    .filter_map(|(id, payload)| {
                        id.strip_prefix(&file_prefix)
                            .map(|binding| (binding.to_string(), payload.clone()))
                    })
                    .collect()
            })
            .unwrap_or_default();

        // v1 lib.rs 950-958 (inc-07 review F5): a file with NO surviving
        // components is returned UNCHANGED — before compose handling, so
        // compose-only files (slots imported from elsewhere) and files
        // whose chains all eval-failed pass through untransformed.
        if file_payloads.is_empty() {
            return Ok(serde_json::json!({ "code": source, "hasComponents": false }).to_string());
        }

        let replacements = assemble::assemble_replacements(
            &path,
            file_facts,
            &self.opts.prefix,
            Some(&file_payloads),
            &self.opts.css_inputs.group_registry,
        )
        .map_err(|e| match e {
            assemble::AssembleError::NeedsConfig(msg) => napi::Error::from_reason(format!(
                "engine v2: {msg} — system/custom payloads land with the config/theme \
                 inputs (row 07); keep engine 'v1' for builds using those stages."
            )),
        })?;

        // compose()/composeWithContext() replacements (v1 lib.rs 990-1035):
        // every scanned family emits createComposedFamily(WithContext) at
        // its span — facts carry the spans, no re-scan needed.
        let has_any_compose = !file_facts.compose.is_empty();
        let has_compose_replacements = file_facts.compose.iter().any(|f| !f.context);
        let has_compose_context_replacements = file_facts.compose.iter().any(|f| f.context);
        let import_needs = replacement_import_needs(file_facts, &file_payloads);
        let mut replacements = replacements;
        for family in &file_facts.compose {
            let slots_entries: Vec<String> = family
                .slots
                .iter()
                .map(|(slot_name, binding_name)| format!("{}: {}", slot_name, binding_name))
                .collect();
            let slots_obj = format!("{{ {} }}", slots_entries.join(", "));
            let text = if family.context {
                let shared_keys_str: Vec<String> = family
                    .shared_keys
                    .iter()
                    .map(|k| format!("\"{}\"", k))
                    .collect();
                format!(
                    "createComposedFamilyWithContext({}, {{ name: \"{}\", sharedKeys: [{}] }})",
                    slots_obj,
                    family.name,
                    shared_keys_str.join(", ")
                )
            } else {
                format!(
                    "createComposedFamily({}, {{ name: \"{}\" }})",
                    slots_obj, family.name
                )
            };
            replacements.push((family.span.0, family.span.1, text));
        }

        if replacements.is_empty() {
            return Ok(serde_json::json!({ "code": source, "hasComponents": false }).to_string());
        }

        let mut virtual_imports: Vec<&str> = Vec::new();
        if import_needs.system_prop_map {
            virtual_imports.push("systemPropMap");
        }
        if import_needs.system_prop_groups {
            virtual_imports.push("systemPropGroups");
        }
        if import_needs.dynamic_prop_config {
            virtual_imports.push("dynamicPropConfig");
        }
        if import_needs.transforms {
            virtual_imports.push("transforms");
        }

        let mut system_imports: Vec<&str> = Vec::new();
        if import_needs.create_component {
            system_imports.push("createComponent");
        }
        if import_needs.class_resolver {
            system_imports.push("createClassResolver");
        }
        // createComposedFamily (RSC-safe) — but NOT WithContext (v1 412-416).
        if has_compose_replacements {
            system_imports.push("createComposedFamily");
        }
        let system_import_str = format!(
            "import {{ {} }} from '{}';\n",
            system_imports.join(", "),
            self.opts.runtime_import
        );
        // Separate WithContext import (v1 436-442 + derive_compose_context_import).
        let compose_ctx_import_str = if has_compose_context_replacements {
            format!(
                "import {{ createComposedFamilyWithContext }} from '{}';\n",
                derive_compose_context_import(&self.opts.runtime_import)
            )
        } else {
            String::new()
        };
        // v1 apply_replacements 444-469: virtual import + transform
        // rebinding loop sit between the system import and the css import.
        let import_lines = if !virtual_imports.is_empty() {
            let virtual_import = format!(
                "import {{ {} }} from '{}';\n",
                virtual_imports.join(", "),
                self.opts.system_props_module_id
            );
            let binding_loop = if import_needs.dynamic_prop_config {
                "for (const [k, v] of Object.entries(dynamicPropConfig)) { if (v.transformName) v.transform = transforms[v.transformName]; }\n"
            } else {
                ""
            };
            format!(
                "{}{}{}{}import '{}';\n",
                system_import_str,
                compose_ctx_import_str,
                virtual_import,
                binding_loop,
                self.opts.css_module_id
            )
        } else {
            format!(
                "{}{}import '{}';\n",
                system_import_str, compose_ctx_import_str, self.opts.css_module_id
            )
        };

        // v1 lib.rs 1007-1014 (inc-07 review F4): "primary extracted"
        // means a MANIFEST SURVIVOR with no extends_from — payload
        // presence, not mere fatal-error absence (a props-serde-rejected
        // chain is non-fatal but dropped, and its import must survive).
        let has_primary_extracted = file_facts.chains.iter().any(|c| {
            c.descriptor.extends_from.is_none() && file_payloads.contains_key(&c.descriptor.binding)
        });
        let mut consumed: Vec<&str> = Vec::new();
        if has_primary_extracted || has_any_compose {
            consumed.push(self.opts.runtime_import.as_str());
        }
        // v1 1042-1051: compose sources are LITERAL strings (quirk parity).
        if has_compose_replacements {
            consumed.push("@animus-ui/system");
            consumed.push("@animus-ui/system/compose");
        }
        if has_compose_context_replacements {
            consumed.push("@animus-ui/system/compose-with-context");
            consumed.push("@animus-ui/system");
        }
        let mut extracted: Vec<&str> = Vec::new();
        if has_primary_extracted {
            extracted.push("animus");
        }
        if has_compose_replacements {
            extracted.push("compose");
        }
        if has_compose_context_replacements {
            extracted.push("composeWithContext");
        }

        // v1 1053-1054: composeWithContext files need 'use client'.
        let needs_use_client =
            has_compose_context_replacements || file_facts.compose.iter().any(|f| f.context);

        // v1 apply_replacements ORDER, exactly (transform_emitter 361-490;
        // inc-07 review F6/F7): (1) span replacements, (2) VERBATIM
        // strip_consumed_imports over the resulting string — the split/
        // rebuild loop is the trailing-newline quirk's origin, so porting
        // the loop replaces the diverging replay — (3) directive handling
        // on the POST-STRIP string, (4) directive + imports prepended.
        let body = emit::apply_plan(
            source,
            &emit::EmissionPlan {
                replacements,
                prepend: String::new(),
                removals: Vec::new(),
            },
        )
        .map_err(napi::Error::from_reason)?;

        let mut code = body.code;
        let mut directive_prologue = file_facts.directive_prologue.clone();
        if !consumed.is_empty() && !extracted.is_empty() {
            // The v1-compatible line stripper can remove import-looking
            // lines even from leading block-comment trivia. Removal metadata
            // remaps content-only deletions, but invalidates the parser fact
            // if the strip destroys an OXC-confirmed directive or delimiter.
            let (stripped, removals) =
                assemble::strip_consumed_imports_with_removals(&code, &consumed, &extracted);
            if let Some(prologue) = directive_prologue.as_mut() {
                if !prologue.remap_after_strip(code.len(), &removals) {
                    directive_prologue = None;
                }
            }
            code = stripped;
        }
        let (directive_prefix, rest) = assemble::directive_prefix_and_body(
            code,
            needs_use_client,
            directive_prologue.as_ref(),
        );
        let code = format!("{directive_prefix}{import_lines}{rest}");

        Ok(serde_json::json!({ "code": code, "hasComponents": true }).to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn import_needs_for(
        source: &str,
        payloads: std::collections::HashMap<String, assemble::ReplacementPayload>,
    ) -> ReplacementImportNeeds {
        let mut engine = ExtractEngine::new(None).unwrap();
        engine
            .analyze(
                serde_json::json!([{
                    "path": "structured-imports.tsx",
                    "source": source,
                }])
                .to_string(),
            )
            .unwrap();
        replacement_import_needs(
            engine.facts.get("structured-imports.tsx").unwrap(),
            &payloads,
        )
    }

    fn dynamic_meta(
        transform_name: Option<&str>,
        transform_fn_source: Option<&str>,
    ) -> crate::dynamic_meta::DynamicPropMeta {
        crate::dynamic_meta::DynamicPropMeta {
            var_name: "--tone".into(),
            slot_class: "tone-slot".into(),
            property: "color".into(),
            properties: Vec::new(),
            transform_name: transform_name.map(str::to_string),
            transform_fn_source: transform_fn_source.map(str::to_string),
            scale_values: BTreeMap::new(),
        }
    }

    fn payload_with_dynamic_meta(
        meta: crate::dynamic_meta::DynamicPropMeta,
    ) -> assemble::ReplacementPayload {
        assemble::ReplacementPayload {
            custom_dynamic_config: Some(std::collections::HashMap::from([(
                "tone".to_string(),
                meta,
            )])),
            ..Default::default()
        }
    }

    fn transform_result(source: &str) -> serde_json::Value {
        let mut engine = ExtractEngine::new(None).unwrap();
        engine
            .analyze(
                serde_json::json!([{
                    "path": "directive.tsx",
                    "source": source,
                }])
                .to_string(),
            )
            .unwrap();
        let result = engine.transform_file("directive.tsx".to_string()).unwrap();
        serde_json::from_str(&result).unwrap()
    }

    fn transform_source(source: &str) -> String {
        transform_result(source)["code"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn analyze_retains_state_and_reports_parse_count() {
        let mut engine = ExtractEngine::new(None).unwrap();
        let out = engine
            .analyze(
                r#"[{"path":"a.tsx","source":"export const Box = ds.styles({ p: 4 }).asElement('div');"},
                    {"path":"b.tsx","source":"export const App = () => <Box p={2} />;"}]"#
                    .to_string(),
            )
            .unwrap();
        assert!(out.contains("\"parseCount\":2"));
        assert_eq!(engine.facts.len(), 2);
        assert_eq!(engine.sources.len(), 2);
        assert!(out.contains("\"binding\":\"Box\""));
    }

    #[test]
    fn analyze_exposes_path_qualified_usage_residue_without_replacing_existing_fields() {
        let mut engine = ExtractEngine::new(Some(EngineOptions {
            config_json: Some(r#"{"p":{"property":"padding"}}"#.to_string()),
            group_registry_json: Some(r#"{"space":["p"]}"#.to_string()),
            ..Default::default()
        }))
        .unwrap();
        let a_source = r#"export const Box = ds.system({ space: true }).asElement("div"); export const A = () => <Box p={spacing} />;"#;
        let b_source =
            r#"import { Box } from "./a"; export const B = () => <Box p={ok ? 4 : 8} />;"#;
        let manifest: serde_json::Value = serde_json::from_str(
            &engine
                .analyze(
                    serde_json::json!([
                        { "path": "b.tsx", "source": b_source },
                        { "path": "a.tsx", "source": a_source }
                    ])
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();

        let residue = manifest["usageResidue"].as_array().unwrap();
        assert_eq!(residue.len(), 2);
        assert_eq!(residue[0]["file"], "a.tsx");
        assert_eq!(residue[0]["binding"], "Box");
        assert_eq!(residue[0]["prop"], "p");
        assert_eq!(residue[0]["kind"], "identifier");
        assert_eq!(residue[1]["file"], "b.tsx");
        assert_eq!(residue[1]["kind"], "conditional");
        assert_eq!(
            &a_source[residue[0]["span"]["start"].as_u64().unwrap() as usize
                ..residue[0]["span"]["end"].as_u64().unwrap() as usize],
            "spacing"
        );
        assert_eq!(
            manifest["css"],
            "@layer anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom;\n\n@layer anm-variants {\n  @layer standalone, composed;\n  @layer composed {\n  }\n}\n\n@layer anm-system {\n  .animus-dyn-p {\n    padding: var(--animus-p);\n  }\n  .animus-u-919d7eb1 {\n    padding: 4;\n  }\n  .animus-u-91c0915d {\n    padding: 8;\n  }\n}\n\n"
        );
        assert_eq!(
            manifest["system_prop_map"],
            serde_json::json!({
                "p": {
                    "4": "animus-u-919d7eb1",
                    "8": "animus-u-91c0915d"
                }
            })
        );
        assert_eq!(
            manifest["dynamic_props"],
            serde_json::json!({
                "p": {
                    "varName": "--animus-p",
                    "slotClass": "animus-dyn-p",
                    "property": "padding",
                    "transformName": null,
                    "transformFnSource": null,
                    "scaleValues": {}
                }
            })
        );
    }

    #[test]
    fn analyze_file_facts_preserve_raw_identifier_and_conditional_usage() {
        let mut engine = ExtractEngine::new(None).unwrap();
        let manifest: serde_json::Value = serde_json::from_str(
            &engine
                .analyze(
                    serde_json::json!([{
                        "path": "raw.tsx",
                        "source": "const GAP = 24; export const App = ({ open }) => <Box p={GAP} display={open ? 'block' : 'none'} />;"
                    }])
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();

        let attrs = manifest["fileFacts"]["raw.tsx"]["usage"][0]["element"]["attrs"]
            .as_array()
            .unwrap();
        let identifier = attrs.iter().find(|attr| attr["name"] == "p").unwrap();
        assert!(identifier["staticValue"].is_null());
        assert!(identifier.get("enumerableValues").is_none());
        assert_eq!(identifier["dynamic"], true);
        assert_eq!(identifier["dynamicKind"], "identifier");

        let conditional = attrs.iter().find(|attr| attr["name"] == "display").unwrap();
        assert!(conditional["staticValue"].is_null());
        assert!(conditional.get("enumerableValues").is_none());
        assert_eq!(conditional["dynamic"], true);
        assert_eq!(conditional["dynamicKind"], "conditional");
    }

    #[test]
    fn malformed_input_is_a_loud_error() {
        let mut engine = ExtractEngine::new(None).unwrap();
        let err = engine.analyze("not json".to_string()).unwrap_err();
        assert!(err.reason.contains("invalid file entries JSON"));
    }

    #[test]
    fn transform_before_analyze_names_the_contract() {
        let mut engine = ExtractEngine::new(None).unwrap();
        let err = engine.transform_file("a.tsx".to_string()).unwrap_err();
        assert!(err.reason.contains("analyze the project first"));
    }

    #[test]
    fn directive_after_ecmascript_unicode_trivia_stays_above_imports() {
        // ECMAScript WhiteSpace includes BOM and every Unicode Zs code point;
        // U+2028/U+2029 are LineTerminators. OXC recognizes the directive
        // after all of them, so emission must preserve the same prologue.
        let trivia = "\u{feff}\u{00a0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200a}\u{202f}\u{205f}\u{3000}\u{2028}\u{2029}";
        let source = format!(
            "{trivia}'use client';\nexport const Box = ds.styles({{ display: 'flex' }}).asElement('div');\nexport const App = () => <Box />;\n"
        );
        let code = transform_source(&source);
        assert!(
            code.starts_with(&format!(
                "{trivia}'use client';\nimport {{ createComponent }} from '@animus-ui/system';\n"
            )),
            "got {code}"
        );
    }

    #[test]
    fn directive_with_post_literal_comment_stays_above_imports() {
        let source = "'use client' /* keep with directive */;\nexport const Box = ds.styles({ display: 'flex' }).asElement('div');\nexport const App = () => <Box />;\n";
        let code = transform_source(source);
        assert!(
            code.starts_with(
                "'use client' /* keep with directive */;\nimport { createComponent } from '@animus-ui/system';\n"
            ),
            "got {code}"
        );
    }

    #[test]
    fn asi_directive_keeps_trailing_block_comment_above_imports() {
        let source = "'use client' /* trailing block */\nexport const Box = ds.styles({ display: 'flex' }).asElement('div');\nexport const App = () => <Box />;\n";
        let code = transform_source(source);
        assert!(
            code.starts_with(
                "'use client' /* trailing block */\nimport { createComponent } from '@animus-ui/system';\n"
            ),
            "got {code}"
        );
    }

    #[test]
    fn asi_directive_keeps_trailing_line_comment_above_imports() {
        let source = "'use client' // trailing line\nexport const Box = ds.styles({ display: 'flex' }).asElement('div');\nexport const App = () => <Box />;\n";
        let code = transform_source(source);
        assert!(
            code.starts_with(
                "'use client' // trailing line\nimport { createComponent } from '@animus-ui/system';\n"
            ),
            "got {code}"
        );
    }

    #[test]
    fn semicolon_directive_keeps_trailing_block_comment_above_imports() {
        let source = "'use client'; /* trailing block */\nexport const Box = ds.styles({ display: 'flex' }).asElement('div');\nexport const App = () => <Box />;\n";
        let code = transform_source(source);
        assert!(
            code.starts_with(
                "'use client'; /* trailing block */\nimport { createComponent } from '@animus-ui/system';\n"
            ),
            "got {code}"
        );
    }

    #[test]
    fn directive_boundary_remaps_after_import_like_comment_line_is_stripped() {
        let source = "/*\nimport { animus } from '@animus-ui/system';\n*/\n'use client';\nexport const Box = animus.styles({ display: 'flex' }).asElement('div');\nexport const App = () => <Box />;\n";
        let code = transform_source(source);
        assert!(
            code.starts_with(
                "/*\n*/\n'use client';\nimport { createComponent } from '@animus-ui/system';\n"
            ),
            "got {code}"
        );
    }

    #[test]
    fn directive_fact_clears_when_strip_removes_comment_close() {
        let source = "/*\nimport { animus } from '@animus-ui/system'; */\n'use client';\nexport const Box = animus.styles({ display: 'flex' }).asElement('div');\nexport const App = () => <Box />;\n";
        let code = transform_source(source);
        assert!(
            code.starts_with(
                "import { createComponent } from '@animus-ui/system';\nimport 'virtual:animus/styles.css';\n/*\n'use client';\n"
            ),
            "got {code}"
        );
    }

    #[test]
    fn directive_fact_clears_when_strip_removes_comment_close_and_directive() {
        let source = "/*\nimport { animus } from '@animus-ui/system'; */ 'use client';\nexport const Box = animus.styles({ display: 'flex' }).asElement('div');\nexport const App = () => <Box />;\n";
        let code = transform_source(source);
        assert!(
            code.starts_with(
                "import { createComponent } from '@animus-ui/system';\nimport 'virtual:animus/styles.css';\n/*\nexport const Box = createComponent"
            ),
            "got {code}"
        );
        assert!(!code.contains("'use client'"), "got {code}");
    }

    #[test]
    fn string_member_continuation_is_not_a_directive() {
        let source = "'use client'\n.length;\nexport const Box = ds.styles({ display: 'flex' }).asElement('div');\nexport const App = () => <Box />;\n";
        let code = transform_source(source);
        assert!(
            code.starts_with("import { createComponent } from '@animus-ui/system';\n"),
            "got {code}"
        );
        assert!(code.contains("'use client'\n.length;"), "got {code}");
    }

    #[test]
    fn two_instances_are_isolated() {
        // DEF-1 evidence: interleaved engines with different file sets
        // must not observe each other's state (no globals).
        let mut a = ExtractEngine::new(None).unwrap();
        let mut b = ExtractEngine::new(None).unwrap();
        a.analyze(r#"[{"path":"a.tsx","source":"export const A = ds.styles({ p: 1 }).asElement('div');\nexport const UseA = () => <A/>;"}]"#.to_string()).unwrap();
        b.analyze(r#"[{"path":"b.tsx","source":"export const B = ds.styles({ p: 2 }).asElement('span');"}]"#.to_string()).unwrap();
        let ta = a.transform_file("a.tsx".to_string()).unwrap();
        assert!(ta.contains("createComponent('div'"));
        assert!(b.transform_file("a.tsx".to_string()).is_err());
        let tb = b.transform_file("b.tsx".to_string()).unwrap();
        assert!(tb.contains("createComponent('span'"));
        assert_eq!(a.parse_count, 1);
        assert_eq!(b.parse_count, 1);
    }

    #[test]
    fn compose_family_emits_created_family_and_strips_imports() {
        let mut engine = ExtractEngine::new(None).unwrap();
        engine
            .analyze(
                r#"[{"path":"fam.tsx","source":"import { compose } from '@animus-ui/system/compose';\nconst Root = ds.styles({}).asElement('div');\nexport const Fam = compose({ Root }, { name: 'Card', shared: {} });\nexport const App = () => <Fam.Root />;\n"}]"#
                    .to_string(),
            )
            .unwrap();
        let out = engine.transform_file("fam.tsx".to_string()).unwrap();
        assert!(out.contains("createComposedFamily({ Root: Root }"), "{out}");
        assert!(out.contains(r#"name: \"Card\""#), "{out}");
        // compose import consumed; createComposedFamily imported.
        assert!(!out.contains("@animus-ui/system/compose'"), "{out}");
        assert!(out.contains("createComposedFamily }"), "{out}");
    }

    #[test]
    fn compose_with_context_keeps_directive_and_import_capabilities_separate() {
        let source = "'use client';\nimport { composeWithContext } from '@animus-ui/system/compose-with-context';\nconst Root = ds.styles({}).asElement('div');\nexport const Fam = composeWithContext({ Root }, { name: 'Card', shared: {} });\nexport const App = () => <Fam.Root />;\n";
        let code = transform_source(source);

        assert!(
            code.starts_with(
                "'use client';\nimport { createComponent } from '@animus-ui/system';\nimport { createComposedFamilyWithContext } from '@animus-ui/system/compose-with-context';\n"
            ),
            "got {code}"
        );
        let base_runtime_import = code
            .lines()
            .find(|line| line.ends_with("from '@animus-ui/system';"))
            .unwrap();
        assert_eq!(
            base_runtime_import,
            "import { createComponent } from '@animus-ui/system';"
        );
        assert!(!base_runtime_import.contains("createComposedFamily"));
        assert!(!code.contains("import { composeWithContext }"), "{code}");
        assert!(code.contains("createComposedFamilyWithContext({ Root: Root }"));
    }

    #[test]
    fn compose_only_without_surviving_components_returns_source_unchanged() {
        let source = "import { compose } from '@animus-ui/system/compose';\nexport const Fam = compose({ Root }, { name: 'Card', shared: {} });\n";
        let result = transform_result(source);

        assert_eq!(result["code"].as_str(), Some(source));
        assert_eq!(result["hasComponents"].as_bool(), Some(false));
        assert!(!result["code"].as_str().unwrap().contains("import {  }"));
        assert!(result["code"]
            .as_str()
            .unwrap()
            .contains("import { compose }"));
    }

    #[test]
    fn user_string_does_not_trigger_transforms_import() {
        let source = r#"export const Box = ds.variant({
  prop: 'tone',
  variants: { red: { color: 'red' } },
  defaultVariant: 'transforms.',
}).asElement('div');
export const App = () => <Box tone="red" />;
"#;
        let code = transform_source(source);

        assert!(code.contains(r#""default":"transforms.""#), "{code}");
        assert!(
            !code.contains("import { transforms } from 'virtual:animus/system-props';"),
            "user-owned config text must not trigger a transforms import: {code}"
        );
    }

    #[test]
    fn structured_import_needs_ignore_non_survivors_and_select_terminal_helpers() {
        let source = "export const Box = ds.styles({}).asElement('div');\nexport const box = ds.styles({}).asClass();\n";
        let class_only = import_needs_for(
            source,
            std::collections::HashMap::from([(
                "box".to_string(),
                assemble::ReplacementPayload::default(),
            )]),
        );
        assert!(!class_only.create_component);
        assert!(class_only.class_resolver);

        let both = import_needs_for(
            source,
            std::collections::HashMap::from([
                ("Box".to_string(), assemble::ReplacementPayload::default()),
                ("box".to_string(), assemble::ReplacementPayload::default()),
            ]),
        );
        assert!(both.create_component);
        assert!(both.class_resolver);
    }

    #[test]
    fn structured_import_needs_follow_payload_registries() {
        let source = "export const Box = ds.styles({}).asElement('div');\n";
        let needs = import_needs_for(
            source,
            std::collections::HashMap::from([(
                "Box".to_string(),
                assemble::ReplacementPayload {
                    system_prop_names: vec!["p".into()],
                    system_group_names: vec!["spacing".into()],
                    has_dynamic_props: true,
                    ..Default::default()
                },
            )]),
        );

        assert!(needs.create_component);
        assert!(needs.system_prop_map);
        assert!(needs.system_prop_groups);
        assert!(needs.dynamic_prop_config);
        assert!(needs.transforms);
    }

    #[test]
    fn named_transform_import_respects_inline_transform_precedence() {
        let source = "export const Box = ds.styles({}).asElement('div');\n";
        let needs_transforms = |meta| {
            import_needs_for(
                source,
                std::collections::HashMap::from([(
                    "Box".to_string(),
                    payload_with_dynamic_meta(meta),
                )]),
            )
            .transforms
        };

        assert!(needs_transforms(dynamic_meta(Some("tone"), None)));
        assert!(!needs_transforms(dynamic_meta(
            None,
            Some("(value) => value")
        )));
        assert!(!needs_transforms(dynamic_meta(
            Some("ignored-name"),
            Some("(value) => value")
        )));
    }

    #[test]
    fn resolved_extension_child_emits_merged_config() {
        let mut engine = ExtractEngine::new(Some(EngineOptions {
            config_json: Some(r#"{"p": {"property": "padding"}}"#.to_string()),
            ..Default::default()
        }))
        .unwrap();
        engine
            .analyze(
                r#"[{"path":"base.tsx","source":"export const Parent = ds.variant({ prop: 'size', defaultVariant: 'sm', variants: { sm: {} } }).states({ loading: {} }).asElement('div');\nexport const A = () => <Parent />;\n"},
                    {"path":"child.tsx","source":"import { Parent } from './base';\nexport const Child = Parent.extend().styles({ p: 4 }).asElement('div');\nexport const B = () => <Child size='sm' />;\n"}]"#
                    .to_string(),
            )
            .unwrap();
        let out = engine.transform_file("child.tsx".to_string()).unwrap();
        // Child inherits Parent's variant + state config (v1 908-929 merge).
        assert!(out.contains(r#"\"variants\":{\"size\""#), "{out}");
        assert!(out.contains(r#"\"states\":[\"loading\"]"#), "{out}");
    }

    #[test]
    fn imported_static_resolves_cross_file() {
        // v1 Phase 2b parity (journal 10:50): a const exported from one
        // file resolves as a static in the importer's chain eval.
        let mut engine = ExtractEngine::new(None).unwrap();
        let out = engine
            .analyze(
                r#"[{"path":"tokens.ts","source":"export const pad = { p: 4 };\n"},
                    {"path":"a.tsx","source":"import { pad } from './tokens';\nexport const C = ds.styles(pad).asElement('div');\nexport const App = () => <C />;\n"}]"#
                    .to_string(),
            )
            .unwrap();
        // The chain evaluates (no fatal error) and the style lands.
        assert!(
            out.contains(r#""p":4"#) || out.contains(r#""p":4"#),
            "{out}"
        );
    }

    #[test]
    fn enrichment_resolves_imported_and_reexported_statics_in_jsx() {
        let mut engine = ExtractEngine::new(Some(EngineOptions {
            config_json: Some(r#"{"p":{"property":"padding"}}"#.to_string()),
            group_registry_json: Some(r#"{"space":["p"]}"#.to_string()),
            ..Default::default()
        }))
        .unwrap();
        let manifest: serde_json::Value = serde_json::from_str(
            &engine
                .analyze(
                    serde_json::json!([
                        { "path": "tokens.ts", "source": "export const GAP = 24;\n" },
                        { "path": "barrel.ts", "source": "export { GAP as SPACING } from './tokens';\n" },
                        { "path": "a.tsx", "source": "import { SPACING } from './barrel';\nexport const Box = ds.system({ space: true }).asElement('div');\nexport const App = () => <Box p={SPACING} />;\n" }
                    ])
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();

        assert!(manifest["system_prop_map"]["p"]["24"].is_string());
        assert_eq!(manifest["usageResidue"], serde_json::json!([]));
    }

    #[test]
    fn enrichment_rejects_imported_partial_static_objects() {
        let mut engine = ExtractEngine::new(Some(EngineOptions {
            config_json: Some(r#"{"mt":{"property":"marginTop"}}"#.to_string()),
            group_registry_json: Some(r#"{"space":["mt"]}"#.to_string()),
            ..Default::default()
        }))
        .unwrap();
        let manifest: serde_json::Value = serde_json::from_str(
            &engine
                .analyze(
                    serde_json::json!([
                        { "path": "tokens.ts", "source": "export const PARTIAL = { _: unknown, sm: 16 };\n" },
                        { "path": "a.tsx", "source": "import { PARTIAL } from './tokens';\nexport const Box = ds.system({ space: true }).asElement('div');\nexport const App = () => <Box mt={PARTIAL} />;\n" }
                    ])
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();

        assert_eq!(manifest["system_prop_map"], serde_json::json!({}));
        assert_eq!(manifest["usageResidue"].as_array().unwrap().len(), 1);
        assert_eq!(manifest["usageResidue"][0]["kind"], "identifier");
    }

    #[test]
    fn enrichment_emits_conditional_arms_into_css_and_system_prop_map() {
        let mut engine = ExtractEngine::new(Some(EngineOptions {
            config_json: Some(r#"{"display":{"property":"display"}}"#.to_string()),
            group_registry_json: Some(r#"{"layout":["display"]}"#.to_string()),
            ..Default::default()
        }))
        .unwrap();
        let manifest: serde_json::Value = serde_json::from_str(
            &engine
                .analyze(
                    serde_json::json!([{
                        "path": "app.tsx",
                        "source": "export const Box = ds.system({ layout: true }).asElement('div');\nexport const App = ({ open }) => <Box display={open ? 'block' : 'none'} />;\n"
                    }])
                    .to_string(),
                )
                .unwrap(),
        )
        .unwrap();

        let block_class = manifest["system_prop_map"]["display"]["block"]
            .as_str()
            .unwrap();
        let none_class = manifest["system_prop_map"]["display"]["none"]
            .as_str()
            .unwrap();
        let css = manifest["css"].as_str().unwrap();
        assert!(css.contains(&format!(".{block_class} {{\n    display: block;")));
        assert!(css.contains(&format!(".{none_class} {{\n    display: none;")));
        assert_eq!(manifest["usageResidue"][0]["kind"], "conditional");
    }

    #[test]
    fn keyframes_registry_resolves_member_lookup() {
        // v1 Phase 2a/2b: keyframes collections resolve `motion.ember`
        // through the statics plumbing.
        let mut engine = ExtractEngine::new(Some(EngineOptions {
            keyframes_json: Some(
                r#"{"motion": {"ember": {"name": "anm-ember", "frames": "0%{}"}}}"#.to_string(),
            ),
            ..Default::default()
        }))
        .unwrap();
        let out = engine
            .analyze(
                r#"[{"path":"system.ts","source":"export const motion = { ember: 'placeholder' };\n"},
                    {"path":"a.tsx","source":"import { motion } from './system';\nexport const C = ds.styles({ animationName: motion.ember }).asElement('div');\nexport const App = () => <C />;\n"}]"#
                    .to_string(),
            )
            .unwrap();
        assert!(out.contains("anm-ember"), "{out}");
    }

    #[test]
    fn global_blocks_populate_global_sheet() {
        let mut engine = ExtractEngine::new(Some(EngineOptions {
            global_style_blocks_json: Some(r#"{"reset": {"body": {"margin": 0}}}"#.to_string()),
            ..Default::default()
        }))
        .unwrap();
        let out = engine
            .analyze(r#"[{"path":"a.tsx","source":"const x = 1;"}]"#.to_string())
            .unwrap();
        assert!(out.contains("anm-global"), "{out}");
        assert!(out.contains("margin"), "{out}");
    }

    #[test]
    fn multibyte_preamble_does_not_shear_spans() {
        // oxc spans are BYTE offsets; a CJK/emoji preamble before the
        // chain shifts byte offsets away from char counts — the splice
        // must land exactly on the chain (parity corpus: multibyte.tsx).
        let mut engine = ExtractEngine::new(None).unwrap();
        engine
            .analyze(
                r#"[{"path":"a.tsx","source":"const label = '日本語ラベル';\nconst x = '🔥頑張って';\nexport const C = ds.styles({ display: 'flex' }).asElement('div');\nexport const App = () => <C title={label} />;\n"}]"#
                    .to_string(),
            )
            .unwrap();
        let out = engine.transform_file("a.tsx".to_string()).unwrap();
        assert!(out.contains("createComponent('div'"), "{out}");
        // The preamble consts survive untouched — byte-exact.
        assert!(out.contains("日本語ラベル"), "{out}");
        assert!(out.contains("🔥頑張って"), "{out}");
        // The chain text is fully replaced (no straddled splice remnant).
        assert!(!out.contains("ds.styles"), "{out}");
    }

    #[test]
    fn clear_cache_resets() {
        let mut engine = ExtractEngine::new(None).unwrap();
        engine
            .analyze(r#"[{"path":"a.tsx","source":"const x = 1;"}]"#.to_string())
            .unwrap();
        engine.clear_cache();
        assert!(engine.facts.is_empty());
        assert_eq!(engine.parse_count, 0);
    }
}
