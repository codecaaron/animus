//! Stateful NAPI handle owning per-build facts and sources. State is
//! per-instance; malformed input and out-of-order calls are loud errors.

use std::collections::BTreeMap;

use crate::identity::LocalId;
use crate::link::ProjectLinks;
use crate::usage_facts::{handed_on, ReadingsOf};
use crate::{analyze_css, assemble, ast_store, cross_file, emit, facts};
use animus_system_loader::module_table::{ExportLookup, ImportName, ModuleIndex, OpeningReason, Request, Terminal};

const SYSTEM_PROPS_MODULE_ID: &str = "virtual:animus/system-props";

/// Whether a finished analysis's tables are being freed on a pool thread,
/// in any engine: `analyze_prepared` hands at most one there.
static TEARDOWN_PENDING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn derive_compose_context_import(runtime_import: &str) -> String {
    if runtime_import.starts_with('@') {
        let parts: Vec<&str> = runtime_import.splitn(3, '/').collect();
        if parts.len() >= 2 {
            return format!("{}/{}/compose-with-context", parts[0], parts[1]);
        }
    }
    format!("{}/compose-with-context", runtime_import)
}

/// The manifest. The host manifest `analyzePrepared` returns leaves out
/// `fileFacts`, `crossFile`, `usageResidue` and `component_fragments`, which
/// no host reads, and carries `chainBindings` in place of `fileFacts`; the
/// full manifest (`fullManifestJson`) holds every section but `chainBindings`.
#[derive(serde::Serialize)]
struct AnalyzeResult<'a> {
    #[serde(rename = "fileFacts", skip_serializing_if = "Option::is_none")]
    file_facts: Option<&'a BTreeMap<String, facts::FileFacts>>,
    /// Each analysed file's chain bindings: what a host reads of the facts.
    #[serde(rename = "chainBindings", skip_serializing_if = "Option::is_none")]
    chain_bindings: Option<BTreeMap<&'a str, Vec<&'a str>>>,
    #[serde(rename = "crossFile", skip_serializing_if = "Option::is_none")]
    cross_file: Option<&'a cross_file::CrossFileFacts>,
    #[serde(rename = "parseCount")]
    parse_count: usize,
    #[serde(rename = "usageResidue", skip_serializing_if = "Option::is_none")]
    usage_residue: Option<&'a [crate::usage_facts::UsageResidueRecord]>,
    css: &'a str,
    sheets: &'a crate::css::CssSheets,
    diagnostics: &'a [analyze_css::CssDiagnostic],
    report: &'a serde_json::Value,
    system_prop_map:
        &'a std::collections::BTreeMap<String, std::collections::BTreeMap<String, String>>,
    dynamic_props: &'a std::collections::BTreeMap<String, crate::dynamic_meta::DynamicPropMeta>,
    admitted_transforms: &'a std::collections::BTreeMap<String, String>,
    typed_system_props: &'a [String],
    #[serde(skip_serializing_if = "Option::is_none")]
    component_fragments: Option<&'a std::collections::BTreeMap<String, crate::css::PerComponentSheets>>,
    system_fingerprint: &'a str,
    reverse_provenance: &'a std::collections::BTreeMap<String, Vec<String>>,
    components: &'a std::collections::BTreeMap<String, analyze_css::ComponentDescriptor>,
    files: &'a std::collections::BTreeMap<String, Vec<String>>,
    /// Files whose transform marks a builder chain `/* @__PURE__ */`: a host
    /// transforms them although they hold no component. Present only where
    /// one does.
    #[serde(rename = "builderFiles", skip_serializing_if = "<[_]>::is_empty")]
    builder_files: &'a [&'a str],
    /// Present only where an extension was dropped over its parent.
    #[serde(skip_serializing_if = "<[_]>::is_empty")]
    missing_inputs: &'a [analyze_css::MissingInput],
    /// Present only where an emitted face asks for a preload.
    #[serde(skip_serializing_if = "<[_]>::is_empty")]
    font_preloads: &'a [crate::theme::FontPreload],
    /// Present only where a runtime config references a shared table.
    #[serde(skip_serializing_if = "crate::dynamic_meta::RuntimeTables::is_empty")]
    runtime_tables: &'a crate::dynamic_meta::RuntimeTables,
    /// Present only for a host that publishes the prop-order file, or
    /// where slot provenance is asked for.
    #[serde(skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    tag_components: &'a std::collections::BTreeMap<String, std::collections::BTreeMap<String, String>>,
    /// Present only where slot provenance is asked for.
    #[serde(skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    tag_declarations: &'a std::collections::BTreeMap<String, std::collections::BTreeMap<String, String>>,
    /// Present only where slot provenance is asked for.
    #[serde(skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    as_component_targets: &'a std::collections::BTreeMap<String, String>,
    /// Present only where slot provenance is asked for.
    #[serde(skip_serializing_if = "std::collections::BTreeSet::is_empty")]
    unmatched_routes: &'a std::collections::BTreeSet<String>,
    /// Present only where a runtime config references a shared list.
    #[serde(skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    prop_name_lists: &'a std::collections::BTreeMap<String, String>,
    /// Present only where a runtime config references it.
    #[serde(skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    superseded_by: &'a std::collections::BTreeMap<String, Vec<String>>,
    /// Present only where the options ask for it.
    #[serde(skip_serializing_if = "Option::is_none")]
    slot_provenance: Option<&'a crate::slot_provenance::SlotProvenance>,
    timing: serde_json::Value,
}

#[napi(object)]
#[derive(Default)]
pub struct EngineOptions {
    pub runtime_import: Option<String>,
    pub css_module_id: Option<String>,
    pub system_props_module_id: Option<String>,
    pub theme_json: Option<String>,
    pub variable_map_json: Option<String>,
    pub contextual_vars_json: Option<String>,
    /// Declaration scales, `{ scale: { kind, members, values } }`; absent
    /// means none.
    pub declaration_scales_json: Option<String>,
    pub config_json: Option<String>,
    pub group_registry_json: Option<String>,
    pub transform_sources_json: Option<String>,
    pub transform_provenance_json: Option<String>,
    pub selector_aliases_json: Option<String>,
    pub condition_aliases_json: Option<String>,
    pub global_style_blocks_json: Option<String>,
    pub keyframes_json: Option<String>,
    /// Position-try collections, `{ exportName: { key: { name, descriptors }
    /// } }`; absent means none.
    pub position_try_json: Option<String>,
    /// View-transition collections, `{ exportName: { key: { name, slots } }
    /// }`; absent means none.
    pub view_transitions_json: Option<String>,
    pub package_resolution_json: Option<String>,
    pub path_aliases_json: Option<String>,
    pub static_css_json: Option<String>,
    pub external_dirs_json: Option<String>,
    pub dev_mode: Option<bool>,
    /// What the host knows about renders the analysis cannot see:
    /// `{ skippedSources, unbundledComputedImports, packageDirs }`, each
    /// optional.
    pub analysis_context_json: Option<String>,
    /// Under a prefix, each name the theme generates and its final name,
    /// without `--`: authored component styles take the final names.
    pub generated_names_json: Option<String>,
    /// The theme's property records (`name`, `syntax`, `registered`, …): a
    /// prop that writes only properties registered with a numeric syntax
    /// takes a number without a unit.
    pub property_records_json: Option<String>,
    /// Production names components `{prefix}-{id}` and utilities
    /// `{prefix}_{id}`, short ids of what their names hash today, under this
    /// prefix: a letter, then letters and digits. Development keeps the
    /// readable names.
    pub short_class_prefix: Option<String>,
    /// Records what keeps each system slot open (`slot_provenance` in the
    /// manifest), which verbose output prints.
    pub slot_provenance: Option<bool>,
}

/// The runtimes Animus ships. Each reads a compiled variant's prop and
/// default only, never its options.
const OFFICIAL_RUNTIMES: [&str; 3] =
    ["@animus-ui/system", "@animus-ui/system/runtime", "@animus-ui/system/class-resolver"];

struct ResolvedOptions {
    runtime_import: String,
    css_module_id: String,
    system_props_module_id: String,
    css_inputs: analyze_css::CssInputs,
}

#[derive(Default)]
struct ReplacementImportNeeds {
    create_component: bool,
    class_resolver: bool,
    system_prop_map: bool,
    system_prop_groups: bool,
    typed_system_props: bool,
    dynamic_prop_config: bool,
    transforms: bool,
    runtime_tables: bool,
    superseded_by: bool,
    /// The keys of the shared `systemPropNames` lists the configs reference.
    prop_name_lists: std::collections::BTreeSet<String>,
    /// Import declarations, by span, whose imported callback a replacement no
    /// longer references because its delivery was pruned: with that last use
    /// gone, TypeScript elides the declaration and its module's effects.
    effect_imports: std::collections::BTreeMap<(u32, u32), String>,
}

/// An unregistered keyframe reference declared in a kit's compiled output,
/// where a bundler can rename a collection's export, names the fix: the kit's
/// source condition, through which its registered keyframes resolve.
fn name_compiled_kit_fix(
    diagnostic: &mut analyze_css::CssDiagnostic,
    compiled_declarations: &rustc_hash::FxHashMap<(String, String), String>,
    output_dirs: &[String],
) {
    let code = crate::eval::KEYFRAMES_UNREGISTERED_REFERENCE;
    if diagnostic.code.as_deref() != Some(code) {
        return;
    }
    let Some(base) = diagnostic
        .message
        .split_once("member expression '")
        .and_then(|(_, rest)| rest.split_once('.'))
        .map(|(base, _)| base.to_string())
    else {
        return;
    };
    let declared_in = match compiled_declarations.get(&(diagnostic.file.clone(), base.clone())) {
        Some(file) => file.clone(),
        None if analyze_css::is_external_file(&diagnostic.file, output_dirs) => diagnostic.file.clone(),
        None => return,
    };
    diagnostic.message = format!(
        "{}; '{base}' is declared in {declared_in}, a kit's compiled output, where a bundler can rename a collection's export — publish the kit with an \"animus\" export condition naming its source, through which its keyframes resolve",
        diagnostic.message
    );
}

/// Declaration spans of staged builders the replaced module no longer
/// needs: every reference is a chain that continued into the builder and
/// was extracted, or a builder dropped before it. A kept declaration of an
/// extension builder would throw, since an extracted parent cannot extend
/// at runtime.
fn dead_staged_builders(
    file_facts: &facts::FileFacts,
    payloads: &std::collections::HashMap<String, assemble::ReplacementPayload>,
) -> Vec<(u32, u32)> {
    let mut consumed: rustc_hash::FxHashMap<&str, usize> = rustc_hash::FxHashMap::default();
    for chain in &file_facts.chains {
        if let Some(builder) = &chain.descriptor.followed_builder {
            if payloads.contains_key(&chain.descriptor.binding) {
                *consumed.entry(builder.as_str()).or_default() += 1;
            }
        }
    }
    let mut dead = Vec::new();
    // Last first: a builder only continues one declared before it.
    for builder in file_facts.staged_builders.iter().rev() {
        let Some(statement) = builder.statement else {
            continue;
        };
        if consumed.get(builder.name.as_str()).copied().unwrap_or(0) < builder.references {
            continue;
        }
        dead.push(statement);
        if let Some(root) = &builder.followed_builder {
            *consumed.entry(root.as_str()).or_default() += 1;
        }
    }
    dead
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
        match &payload.prop_names_key {
            Some(key) => {
                needs.prop_name_lists.insert(key.clone());
            }
            None => needs.system_prop_groups |= !payload.system_group_names.is_empty(),
        }
        needs.superseded_by |= !payload.superseded_by.is_empty();
        needs.typed_system_props |= has_system_props && payload.reads_typed_system_props;
        needs.dynamic_prop_config |= has_system_props && payload.has_dynamic_props;

        // The system-props module binds the system's own transforms.
        needs.transforms |= payload.custom_dynamic_config.as_ref().is_some_and(|config| {
            config
                .values()
                .filter_map(crate::dynamic_meta::DynamicPropMeta::value)
                .any(|meta| meta.transform_id.is_some())
        });

        needs.runtime_tables |= payload
            .custom_dynamic_config
            .as_ref()
            .is_some_and(|config| config.values().any(|meta| !meta.tables().is_empty()));

        // A chain-stage reference or extended parent resolves at module
        // scope, where an import and a local cannot share a name.
        let import_of = |local: &str| file_facts.import_of(local);
        let namespace_of = |local: &str| file_facts.namespace_import_facts.iter().find(|import| import.local == local);
        if payload.drops_parent_reference {
            let parent = chain.descriptor.extends_from.as_deref().and_then(|parent| match parent.split_once('.') {
                None => import_of(parent),
                // A namespace member parent (`Parts.Base`) keeps its namespace's module.
                Some((namespace, _)) => namespace_of(namespace),
            });
            needs.effect_imports.extend(parent.map(|import| (import.declaration, import.source.clone())));
        }
        let delivered = |prop: &str| {
            payload
                .custom_dynamic_config
                .as_ref()
                .is_some_and(|config| config.contains_key(prop))
        };
        let captures = chain
            .stages
            .iter()
            .filter(|stage| stage.method == "props")
            .flat_map(|stage| &stage.captured)
            .filter(|capture| !delivered(capture.key.split('.').next().unwrap_or_default()));
        for capture in captures {
            let import = import_of(&capture.source);
            needs.effect_imports.extend(import.map(|import| (import.declaration, import.source.clone())));
        }
    }

    needs
}

/// A file entry's analysis identity: its path with `\\` read as `/`, and
/// empty and `.` segments dropped and `..` taken back lexically, so every
/// spelling of one path sorts as one. A root (`/`, a drive `C:` or `C:/`,
/// a share `//host/share/`) is kept whole and never climbed past; a `..`
/// that would climb past an absolute root is dropped, as Node's
/// `path.win32.normalize` does. Case and Unicode stay as written, no
/// symlink is followed, and a `?query` suffix stays part of the identity.
fn canonical_analysis_id(path: &str) -> String {
    let (path, query) = path.split_at(path.find('?').unwrap_or(path.len()));
    let path = path.replace('\\', "/");
    let (root, rest, absolute) = path_root(&path);
    let mut segments: Vec<&str> = Vec::new();
    for segment in rest.split('/') {
        match segment {
            "" | "." => {}
            ".." => match segments.last() {
                Some(&last) if last != ".." => {
                    segments.pop();
                }
                _ if absolute => {}
                _ => segments.push(".."),
            },
            segment => segments.push(segment),
        }
    }
    format!("{root}{}{query}", segments.join("/"))
}

/// A `/`-separated path's root, the rest after it, and whether the root is
/// absolute: a drive with its top (`C:/`) or without (`C:`, relative to
/// that drive's current directory), a share (`//host/share/`), or `/`.
fn path_root(path: &str) -> (String, &str, bool) {
    let bytes = path.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        let (drive, rest) = path.split_at(2);
        return match rest.strip_prefix('/') {
            Some(rest) => (format!("{drive}/"), rest, true),
            None => (drive.to_string(), rest, false),
        };
    }
    if let Some(share) = path.strip_prefix("//") {
        let mut parts = share.splitn(3, '/');
        if let (Some(host), Some(name)) = (parts.next(), parts.next()) {
            if !host.is_empty() && !name.is_empty() {
                return (format!("//{host}/{name}/"), parts.next().unwrap_or(""), true);
            }
        }
    }
    match path.strip_prefix('/') {
        Some(rest) => ("/".to_string(), rest, true),
        None => (String::new(), path, false),
    }
}

#[napi]
pub struct ExtractEngine {
    opts: ResolvedOptions,
    facts: BTreeMap<String, facts::FileFacts>,
    sources: BTreeMap<String, String>,
    /// The files of the last `analyzePrepared`, by path: the canonical
    /// order every order-sensitive choice reads (registration collisions,
    /// first-wins utility dedup, composed-family rules, report examples),
    /// never the caller's.
    order: Vec<String>,
    css: Option<analyze_css::CssOutput>,
    parse_count: usize,
    /// What `prepare` read of its files, which the next `analyzePrepared`
    /// reads instead of parsing them again.
    prepared: Option<Prepared>,
    /// What each phase of the last `prepare` and `analyzePrepared` took, in
    /// order (`analysisTimings`): kept beside the manifest, never in it, so
    /// the manifest's bytes stay the same run to run.
    timings: Vec<(&'static str, f64)>,
}

/// Milliseconds per named phase, each measured from the previous mark.
struct PhaseClock {
    last: std::time::Instant,
    phases: Vec<(&'static str, f64)>,
}

impl PhaseClock {
    fn start() -> Self {
        PhaseClock { last: std::time::Instant::now(), phases: Vec::new() }
    }

    fn mark(&mut self, phase: &'static str) {
        let now = std::time::Instant::now();
        self.phases.push((phase, (now - self.last).as_secs_f64() * 1000.0));
        self.last = now;
    }
}

/// A `prepare`'s files: their identity and synthesized components, their
/// parse, and each module's Lower output and object facts in store order.
struct Prepared {
    identity: String,
    synthesized: BTreeMap<String, std::collections::BTreeSet<String>>,
    store: ast_store::AstStore,
    modules: Vec<(crate::link::Lowered, facts::ObjectFacts)>,
}

#[derive(serde::Deserialize)]
struct InputEntry {
    path: String,
    source: String,
    /// The components the host's adapter wrote into the file
    /// (`FileFacts::synthesized_components`).
    #[serde(default, rename = "synthesizedComponents")]
    synthesized_components: Vec<String>,
}

/// The files of `file_entries_json` in canonical order (by canonical
/// analysis id), so analysis does not depend on the order a host lists them
/// in, or on how it spells a path. A path listed twice with the same source
/// is one file; listed twice with different sources, or spelled two ways
/// (`a.tsx`, `./a.tsx`), it names no single input, so this fails rather than
/// pick one: lookups keep the spelling the host passed.
fn canonical_entries(file_entries_json: &str) -> napi::Result<Vec<InputEntry>> {
    let entries: Vec<InputEntry> = serde_json::from_str(file_entries_json)
        .map_err(|e| napi::Error::from_reason(format!("invalid file entries JSON: {e}")))?;
    let mut keyed: Vec<(String, InputEntry)> =
        entries.into_iter().map(|entry| (canonical_analysis_id(&entry.path), entry)).collect();
    keyed.sort_by(|(a, x), (b, y)| a.cmp(b).then_with(|| x.path.cmp(&y.path)));
    let mut entries: Vec<InputEntry> = Vec::with_capacity(keyed.len());
    let mut kept_id: Option<String> = None;
    for (id, entry) in keyed {
        match entries.last() {
            Some(kept) if kept_id.as_ref() == Some(&id) => {
                if kept.path != entry.path {
                    return Err(napi::Error::from_reason(format!(
                        "file entries list one file as '{}' and as '{}'; pass each file once, under one path",
                        kept.path, entry.path
                    )));
                }
                if kept.source != entry.source {
                    return Err(napi::Error::from_reason(format!(
                        "file entries list '{}' twice with different sources; pass each file once",
                        entry.path
                    )));
                }
            }
            _ => {
                kept_id = Some(id);
                entries.push(entry);
            }
        }
    }
    Ok(entries)
}

/// The identity of an analysis input: its files, by path and source, in
/// canonical order, and the extension order its probes walk (appended,
/// NodeNext substitutions, aliases). Evidence gathered for one input is
/// never read for another, even one with as many files, or the same files
/// under another host's order.
/// Each file's synthesized components, by path, where it has any.
fn synthesized_of(entries: &[InputEntry]) -> BTreeMap<String, std::collections::BTreeSet<String>> {
    entries
        .iter()
        .filter(|entry| !entry.synthesized_components.is_empty())
        .map(|entry| (entry.path.clone(), entry.synthesized_components.iter().cloned().collect()))
        .collect()
}

fn input_identity(entries: &[InputEntry], inputs: &analyze_css::CssInputs) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    let policy = match &inputs.analysis_context.extensions {
        Some(policy) => policy,
        None => animus_system_loader::resolution::extension_policy(),
    };
    format!("{policy:?}").hash(&mut hasher);
    for entry in entries {
        entry.path.hash(&mut hasher);
        entry.source.hash(&mut hasher);
    }
    format!("{:016x}", hasher.finish())
}

type ModuleFacts = BTreeMap<
    String,
    (Vec<crate::usage_facts::ImportFact>, Vec<crate::usage_facts::ExportFact>),
>;

/// Where an import of `imported` from `source` in `path` is declared: the
/// module and its binding. `None` unless the import resolves to a local
/// binding.
fn import_binding<T>(
    path: &str,
    source: &str,
    imported: &str,
    links: &ProjectLinks,
    files: &BTreeMap<String, T>,
    inputs: &analyze_css::CssInputs,
) -> Option<(ModuleIndex, LocalId)> {
    let target = analyze_css::resolve_import_source(path, source, files, inputs)?;
    links.declared(&target, imported)
}

/// The local bindings among a module table answer's terminals.
fn local_bindings(terminals: Vec<Terminal<LocalId>>) -> impl Iterator<Item = (ModuleIndex, LocalId)> {
    terminals.into_iter().filter_map(|terminal| match terminal {
        Terminal::Local { module, binding } => Some((module, binding)),
        _ => None,
    })
}

/// Every analysed binding a route the analysis cannot open may reach: each
/// one some module's export of the name it was asked for reaches, or, asked
/// for any name, each one any export reaches.
fn exposed_bindings(links: &ProjectLinks, name: Option<&str>) -> Vec<(ModuleIndex, LocalId)> {
    let reached = |module: ModuleIndex, name: &str| {
        let terminals = match links.table.resolve_export(module, name) {
            ExportLookup::Resolved(terminal) => vec![terminal],
            ExportLookup::Incomplete { known, .. } => known,
            ExportLookup::Absent | ExportLookup::Ambiguous(_) => Vec::new(),
        };
        local_bindings(terminals).collect::<Vec<_>>()
    };
    (0..links.paths.len())
        .flat_map(|module| match name {
            Some(name) => reached(module, name),
            None => {
                let names = links.table.exported_names(module).names;
                names.iter().flat_map(|name| reached(module, name)).collect()
            }
        })
        .collect()
}

/// Every binding a module table answer may name: the one it resolves to
/// or, when an open route leaves it incomplete, each binding it already
/// knows and every binding the open route may reach. `through_namespace`
/// says the answer is a namespace member's.
fn possible_bindings(links: &ProjectLinks, lookup: ExportLookup<LocalId>, through_namespace: bool) -> Vec<(ModuleIndex, LocalId)> {
    let (terminals, openings) = match lookup {
        ExportLookup::Resolved(terminal) => (vec![terminal], Vec::new()),
        ExportLookup::Incomplete { known, openings } => (known, openings),
        ExportLookup::Absent | ExportLookup::Ambiguous(_) => return Vec::new(),
    };
    // Through a namespace, a module the analysis cannot find may export any
    // binding under the member's name; where another route already answers
    // it, that name would be ambiguous and export nothing.
    let unanswered = through_namespace && terminals.is_empty();
    let mut found: Vec<(ModuleIndex, LocalId)> = local_bindings(terminals).collect();
    for opening in openings {
        let name = match opening.reason {
            OpeningReason::UnresolvedRequest(_) if unanswered => None,
            _ => opening.name.as_deref(),
        };
        found.extend(exposed_bindings(links, name));
    }
    found.sort();
    found.dedup();
    found
}

/// One module's inputs to `unstable_style_statics`.
struct StyleModule {
    facts: crate::usage_facts::StyleObjectFacts,
    /// See `FileFacts::written_namespaces`.
    written_namespaces: crate::usage_facts::WrittenNamespaces,
}

/// Whether a static may be an object: an object or array, the `asset`
/// function, or what evaluation could not settle. No use can change a
/// primitive.
fn object_like(value: &crate::static_value::StaticValue) -> bool {
    use crate::static_value::StaticValue;
    matches!(
        value,
        StaticValue::Object(_)
            | StaticValue::Array(_)
            | StaticValue::SystemFunction(_)
            | StaticValue::Unevaluated(_)
    )
}

/// Whether a declaration's value at a path may be an object.
fn holds_object(value: &crate::static_value::StaticValue, path: &[String]) -> bool {
    use crate::static_value::StaticValue;
    let Some((key, rest)) = path.split_first() else { return object_like(value) };
    match value {
        StaticValue::Object(entries) if key == crate::flow::ANY_MEMBER => {
            entries.iter().any(|(_, value)| holds_object(value, rest))
        }
        StaticValue::Array(items) if key == crate::flow::ANY_MEMBER => items.iter().any(|value| holds_object(value, rest)),
        StaticValue::Object(_) | StaticValue::Array(_) => value.get(key).is_some_and(|value| holds_object(value, rest)),
        other => object_like(other),
    }
}

/// Records into `flow` what a use anywhere in the analysis may change of
/// the module-scope statics styles read, each said as a clause: `preset is
/// passed to decorate() in a.tsx on line 4`. A namespace re-export or a
/// runtime load of a module unsettles every static it exports. Statics
/// stored in an unstable object, or read from an unstable binding, are
/// unstable too.
#[allow(clippy::too_many_arguments)]
fn record_style_changes(
    style: &BTreeMap<String, StyleModule>,
    modules: &ModuleFacts,
    links: &ProjectLinks,
    lowered: &BTreeMap<String, crate::link::Lowered>,
    files: &BTreeMap<String, rustc_hash::FxHashMap<String, crate::static_value::StaticValue>>,
    structural: &BTreeMap<String, facts::FileFacts>,
    inputs: &analyze_css::CssInputs,
    readings_of: &mut ReadingsOf<'_>,
    flow: &mut crate::flow::FlowBuilder,
) {
    analyze_css::note_build_chunks(structural, inputs);
    // Each module's first import of each local: a module may import
    // thousands of names, and each lookup below asks one.
    let first_imports: Vec<rustc_hash::FxHashMap<LocalId, usize>> = (0..links.paths.len())
        .map(|module| {
            let mut first = rustc_hash::FxHashMap::default();
            for (at, import) in links.table.record(module).imports.iter().enumerate() {
                first.entry(import.local).or_insert(at);
            }
            first
        })
        .collect();
    let import_of = |module: ModuleIndex, local: LocalId| {
        first_imports[module].get(&local).map(|&at| &links.table.record(module).imports[at])
    };
    // The declarations a binding names: itself or, for `export default
    // X`'s cell, X, whose object the cell shares, through each binding X's
    // import may be.
    let declarations = |start: (ModuleIndex, LocalId)| -> Vec<(String, String)> {
        let (mut found, mut seen, mut work) = (Vec::new(), std::collections::BTreeSet::new(), vec![start]);
        while let Some((module, binding)) = work.pop() {
            if !seen.insert((module, binding)) {
                continue;
            }
            let path = &links.paths[module];
            let bindings = &lowered[path].bindings;
            let held = bindings.held(binding);
            match import_of(module, held).filter(|_| held != binding) {
                Some(import) => {
                    work.extend(possible_bindings(links, links.table.resolve_request(module, import.request, &import.name), false))
                }
                None => found.push((path.clone(), bindings.binding(held).name.clone())),
            }
        }
        found
    };
    // The declarations a module's binding may name: itself, or each binding
    // what it imports may be.
    let possible = |file: &str, name: &str| -> Vec<(String, String)> {
        let imported = links.module(file).and_then(|module| {
            let local = lowered[file].bindings.module_binding(name)?;
            let import = import_of(module, local)?;
            Some(links.table.resolve_request(module, import.request, &import.name))
        });
        match imported {
            Some(lookup) => possible_bindings(links, lookup, false).into_iter().flat_map(declarations).collect(),
            None => vec![(file.to_string(), name.to_string())],
        }
    };
    // What a module's namespace import names, by the record's request.
    // A named import whose answer is a namespace (`export * as ns from …`
    // in the module it names) is read as that namespace's request.
    let namespace_of = |file: &str, name: &str| -> Option<Request> {
        let module = links.module(file)?;
        let local = lowered[file].bindings.module_binding(name)?;
        let record = links.table.record(module);
        let import = import_of(module, local)?;
        if import.name == ImportName::Namespace {
            return Some(record.requests[import.request].clone());
        }
        match links.table.resolve_request(module, import.request, &import.name) {
            ExportLookup::Resolved(Terminal::Namespace(target)) => Some(Request::Module(target)),
            ExportLookup::Resolved(Terminal::External { module, export: None }) => Some(Request::Outside(module)),
            ExportLookup::Incomplete { known, openings } if known.is_empty() => {
                openings.into_iter().find_map(|opening| match opening.reason {
                    OpeningReason::UnresolvedRequest(specifier)
                        if opening.name.is_none() =>
                    {
                        Some(Request::Unresolved(specifier))
                    }
                    _ => None,
                })
            }
            _ => None,
        }
    };
    let exported = |target: &str, name: &str| -> Vec<(ModuleIndex, LocalId)> {
        links.module(target).map(|module| possible_bindings(links, links.table.resolve_export(module, name), true)).unwrap_or_default()
    };
    // The declaration a module's binding names: itself, or what it imports.
    let declared = |file: &str, name: &str| -> Option<(String, String)> {
        let (imports, _) = modules.get(file)?;
        match imports.iter().find(|import| import.local == name) {
            Some(import) => {
                // Only one declaration answers for a callee.
                let declared = import_binding(file, &import.source, &import.imported, links, files, inputs);
                match declared.map(declarations).as_deref() {
                    Some([one]) => Some(one.clone()),
                    _ => None,
                }
            }
            None => Some((file.to_string(), name.to_string())),
        }
    };
    // Every binding a module's namespace may hold: each export's, and, past
    // a star the analysis cannot open, every binding it may reach.
    let every_export = |target: &str| -> Vec<(String, String)> {
        let Some(module) = links.module(target) else { return Vec::new() };
        let names = links.table.exported_names(module);
        let mut found: Vec<(ModuleIndex, LocalId)> =
            names.names.iter().flat_map(|name| exported(target, name)).collect();
        if !names.complete() {
            found.extend(exposed_bindings(links, None));
        }
        found.sort();
        found.dedup();
        found.into_iter().flat_map(declarations).collect()
    };
    // A call to a function that returns its argument hands the argument to
    // the `const` it initializes, which holds it from then on.
    let callee_of = |file: &str, handoff: &crate::usage_facts::Handoff| {
        declared(file, &handoff.callee)
            .map(|(callee_file, name)| (callee_file, crate::usage_facts::returned_function(&name, handoff.calls - 1)))
    };
    // (module, the hand-off's position in its module, the holder, each path
    // in it that holds the argument).
    let mut held: Vec<(&str, usize, &String, Vec<Vec<String>>)> = Vec::new();
    for (file, module) in style {
        for (at, handoff) in module.facts.handoffs.iter().enumerate() {
            let Some(holder) = &handoff.holder else { continue };
            let positions = callee_of(file, handoff).and_then(|(callee_file, function)| {
                crate::usage_facts::alias_positions(&callee_file, &function, handoff.index, 0, &declared, readings_of)
            });
            if let Some(positions) = positions {
                held.push((file, at, holder, positions));
            }
        }
    }
    // The `const`s that hold an object stored in them, a static or not.
    let holders: std::collections::BTreeSet<(String, String)> = held
        .iter()
        .map(|(file, _, holder, _)| (file.to_string(), holder.to_string()))
        .chain(style.iter().flat_map(|(file, module)| {
            module.facts.stored.iter().map(move |(_, container, ..)| (file.clone(), container.clone()))
        }))
        .collect();
    let mutable = |(file, local): &(String, String)| {
        files.get(file).and_then(|statics| statics.get(local)).is_some_and(object_like)
            || holders.contains(&(file.clone(), local.clone()))
    };
    // Whether a declaration's static holds an object among its values; a
    // holder with no static holds the object stored in it.
    let nested = |(file, local): &(String, String)| match files.get(file).and_then(|statics| statics.get(local)) {
        Some(crate::static_value::StaticValue::Object(entries)) => entries.iter().any(|(_, value)| object_like(value)),
        Some(_) => false,
        None => holders.contains(&(file.clone(), local.clone())),
    };
    let may_hold_object = |(file, local): &(String, String), path: &[String]| match files.get(file).and_then(|statics| statics.get(local)) {
        Some(value) => holds_object(value, path),
        None => true,
    };
    // The paths of the members of a declaration's object at `at` that pass
    // `keep`; the object itself when it has none or is not an object.
    let members_at = |(file, local): &(String, String), at: &[String], keep: &dyn Fn(&crate::static_value::StaticValue) -> bool| {
        let mut value = files.get(file).and_then(|statics| statics.get(local));
        for segment in at {
            value = value.and_then(|value| value.get(segment));
        }
        let members: Vec<Vec<String>> = match value {
            Some(crate::static_value::StaticValue::Object(entries)) => entries
                .iter()
                .filter(|(_, value)| keep(value))
                .map(|(key, _)| at.iter().cloned().chain(std::iter::once(key.clone())).collect())
                .collect(),
            _ => Vec::new(),
        };
        if members.is_empty() { vec![at.to_vec()] } else { members }
    };
    // Where a use changes a declaration's object: a member's value handed on
    // escapes below the member's slot, and an escape of a nested object's
    // members leaves the object's own slots as they were.
    let changes_of = |target: &(String, String), at: &crate::usage_facts::UseAt| -> Vec<(Vec<String>, ChangeKind)> {
        use crate::usage_facts::UseAt;
        match at {
            UseAt::Member(path) => vec![(path.clone(), ChangeKind::Escape)],
            UseAt::AnyMember(path) => {
                members_at(target, path, &|_| true).into_iter().map(|path| (path, ChangeKind::Escape)).collect()
            }
            UseAt::Written(path) => vec![(path.clone(), ChangeKind::Write)],
            UseAt::UnknownKeyWritten(path) => vec![(path.clone(), ChangeKind::UnknownKeyWrite)],
        }
    };
    let nested_members = |target: &(String, String)| members_at(target, &[], &object_like);
    let said = |file: &str, name: &str, used: &crate::usage_facts::ObjectUse| used.said(name, file);
    use crate::flow::{ChangeKind, FlowBuilder, ObjectId, ReasonId, Region, RegionAtom};
    let object = |(file, local): (String, String)| ObjectId { module: file, binding: local };
    // Each object a module exports, under each name it exports it as.
    for (module, path) in links.paths.iter().enumerate() {
        for name in links.table.exported_names(module).names {
            let terminals = match links.table.resolve_export(module, &name) {
                ExportLookup::Resolved(terminal) => vec![terminal],
                ExportLookup::Incomplete { known, .. } => known,
                ExportLookup::Absent | ExportLookup::Ambiguous(_) => Vec::new(),
            };
            for declared in local_bindings(terminals).flat_map(declarations) {
                flow.export(object(declared), path, &name);
            }
        }
    }
    // A namespace handed on exposes every object the module exports,
    // through `export *` too, and past a star the analysis cannot open,
    // whatever that star may bring.
    let hand_on = |flow: &mut FlowBuilder, target: &str, reason: &str| {
        let Some(module) = links.module(target) else { return };
        flow.open(ReasonId::OpaqueEffect, Region::of(RegionAtom::ExportsOf(target.to_string())), reason.to_string());
        let names = links.table.exported_names(module);
        for name in &names.names {
            if let ExportLookup::Incomplete { openings, .. } = links.table.resolve_export(module, name) {
                for opening in openings {
                    let reason_id = match opening.reason {
                        animus_system_loader::module_table::OpeningReason::OutsideStar(_) => ReasonId::OpaqueStar,
                        OpeningReason::UnresolvedRequest(_) => {
                            ReasonId::UnresolvedSpecifier
                        }
                    };
                    let region = match opening.name {
                        Some(asked) => RegionAtom::ExportedAs(asked),
                        None => RegionAtom::AllExports,
                    };
                    flow.open(reason_id, Region::of(region), reason.to_string());
                }
            }
        }
        if !names.complete() {
            flow.open(ReasonId::OpaqueStar, Region::of(RegionAtom::AllExports), reason.to_string());
        }
    };
    for (file, module) in style {
        // The declarations a use's name stands for that hold an object: a
        // namespace's member, every export of a namespace used whole, or
        // the binding's own.
        // A module the analysis cannot find may re-export any object under
        // any name, so a use through its namespace may reach every exported
        // object, as the member tables read it.
        let targets_of = |name: &str| -> Vec<(String, String)> {
            let anywhere = || exposed_bindings(links, None).into_iter().flat_map(declarations).collect();
            let targets: Vec<(String, String)> = match name.split_once('.') {
                Some((namespace, member)) => match namespace_of(file, namespace) {
                    Some(Request::Module(target)) => {
                        exported(&links.paths[target], member).into_iter().flat_map(declarations).collect()
                    }
                    Some(Request::Unresolved(_)) => anywhere(),
                    Some(Request::Outside(_)) | None => Vec::new(),
                },
                None => match namespace_of(file, name) {
                    Some(Request::Module(target)) => every_export(&links.paths[target]),
                    Some(Request::Unresolved(_)) => anywhere(),
                    Some(Request::Outside(_)) => Vec::new(),
                    None => possible(file, name),
                },
            };
            targets.into_iter().filter(|target| mutable(target)).collect()
        };
        // A function hands a nested object on to whatever it hands
        // members to, so only an object of primitives passes as a read.
        for (at, handoff) in module.facts.handoffs.iter().enumerate() {
            if held.iter().any(|(held_in, held_at, ..)| *held_in == file.as_str() && *held_at == at) {
                continue;
            }
            // A callee that only reads the object may still hand on members
            // of it; one that reads a literal may hand on the object itself.
            let handed = if handoff.nested {
                None
            } else {
                callee_of(file, handoff).and_then(|(callee_file, function)| {
                    handed_on(&callee_file, &function, handoff.index, 0, &declared, readings_of)
                })
            };
            let paths = handed.unwrap_or_else(|| vec![Vec::new()]);
            for target in possible(file, &handoff.binding).into_iter().filter(|target| mutable(target)) {
                for below in &paths {
                    let path: Vec<String> = handoff.at.iter().chain(below).take(crate::flow::PATH_DEPTH).cloned().collect();
                    // Handing on a primitive cannot change the object.
                    if may_hold_object(&target, &path) {
                        let cause = said(file, &handoff.binding, &handoff.used);
                        flow.change(object(target.clone()), path, ChangeKind::Escape, cause);
                    }
                }
            }
        }
        for (name, used, at) in &module.facts.uses {
            // A namespace used whole may change anything its module exports,
            // as the member tables read it.
            if let Some(Request::Module(target)) = namespace_of(file, name).filter(|_| !name.contains('.')) {
                hand_on(flow, &links.paths[target], &said(file, name, used));
                continue;
            }
            for target in targets_of(name) {
                for (path, kind) in changes_of(&target, at) {
                    flow.change(object(target.clone()), path, kind, said(file, name, used));
                }
            }
        }
        for (name, used) in &module.facts.flat_reads {
            for target in targets_of(name).into_iter().filter(|target| nested(target)) {
                for path in nested_members(&target) {
                    let reason = format!("{}, and it holds a nested object", said(file, name, used));
                    flow.change(object(target.clone()), path, ChangeKind::Escape, reason);
                }
            }
        }
        // A package may re-export our objects (a linked workspace package)
        // under any name: a use that may write through its namespace may
        // reach any of them.
        for (namespace, (subject, used)) in &module.written_namespaces {
            let Some(Request::Outside(identity)) = namespace_of(file, namespace) else { continue };
            if let Some(unread) = crate::link::unread_package(&identity, files, inputs) {
                let opening = |opened| crate::link::UnreadOpening::namespace_write(file, used.line, namespace, &identity, opened);
                crate::link::open_unread(flow, unread, &said(file, subject, used), inputs, opening, &mut |flow, target, reason| {
                    hand_on(flow, target, reason)
                });
            }
        }
        crate::link::record_module_openings(file, &structural[file], structural, inputs, flow, &mut |flow, target, reason| {
            hand_on(flow, target, reason)
        });
    }
    // A static stored in an object, or read from a binding, may change with
    // it.
    for (file, module) in style {
        // A container's change where an object sits in it reaches the
        // object as far below; a spread's copy holds the object's members
        // where it sits, so a change there names the member.
        let stored = module.facts.stored.iter().map(|(stored, container, at)| (stored, Vec::new(), container, at.clone()));
        // A call's result holds the argument at each path the callee returns
        // it at, and the object where it sits in the argument.
        let held_here = held.iter().filter(|(held_in, ..)| *held_in == file.as_str()).flat_map(|(_, at, holder, positions)| {
            let handoff = &module.facts.handoffs[*at];
            positions.iter().map(move |position| {
                let on_at = position.iter().chain(&handoff.within).cloned().collect();
                (&handoff.binding, handoff.at.clone(), *holder, on_at)
            })
        });
        for (dependent, dependent_at, on, on_at) in stored.chain(held_here) {
            let to = possible(file, dependent).into_iter().map(|target| (object(target), dependent_at.clone())).collect();
            let from = possible(file, on).into_iter().map(|target| (object(target), on_at.clone())).collect();
            flow.hold(to, from, format!("{dependent} is stored in {on}, and "));
        }
        // A `const` that reads a binding holds what it read where the read
        // sits, or in its members; one that holds the binding's object
        // there changes as far below as the object does. One with no static
        // keeps no value a change could leave stale, and holds the objects
        // stored in it by their own edges.
        let derives = module
            .facts
            .derives
            .iter()
            .filter(|(derived, ..)| files.get(file).is_some_and(|statics| statics.contains_key(derived)));
        for (derived, read, at, held) in derives {
            let to = possible(file, derived)
                .into_iter()
                .flat_map(|target| {
                    let paths = if at.is_empty() && !held { members_at(&target, &[], &|_| true) } else { vec![at.clone()] };
                    paths.into_iter().map(move |path| (object(target.clone()), path))
                })
                .collect();
            let from = possible(file, read).into_iter().map(|target| (object(target), Vec::new())).collect();
            let prefix = format!("{derived} reads {read}, and ");
            if *held {
                flow.hold(to, from, prefix);
            } else {
                flow.flow(to, from, prefix);
            }
        }
    }
}

/// Each module-scope static that `changes` says may change before a style
/// reads it, keyed by its module and local name, with the first such change
/// said as a clause, and the site of every opening among them.
fn unstable_style_statics(
    changes: &crate::flow::ValueEffects,
    files: &BTreeMap<String, rustc_hash::FxHashMap<String, crate::static_value::StaticValue>>,
) -> BTreeMap<(String, String), (String, crate::flow::Uncertainty, Vec<String>)> {
    use crate::flow::{AbsenceQuery, ChangeKind, Coverage, ObjectId};
    let mut unstable = BTreeMap::new();
    for (file, statics) in files {
        for (local, value) in statics {
            let query = AbsenceQuery::Stable(ObjectId::new(file, local), Vec::new());
            if let Coverage::Exposed(mut exposures) = changes.covers(&query) {
                // A primitive handed on cannot change the object.
                exposures.retain(|exposure| match exposure {
                    crate::flow::Exposure::Changed(change) if change.kind == ChangeKind::Escape => {
                        holds_object(value, &change.path)
                    }
                    _ => true,
                });
                if exposures.is_empty() {
                    continue;
                }
                // Every exposure is what the binding is uncertain as; the
                // first names it.
                let uncertainty = exposures
                    .iter()
                    .map(crate::flow::Exposure::uncertainty)
                    .reduce(crate::flow::Uncertainty::join)
                    .expect("an exposed subject has an exposure");
                // Every opening among them, which a warning names its cost
                // under.
                let openings = exposures
                    .iter()
                    .filter(|exposure| matches!(exposure, crate::flow::Exposure::Opened(_)))
                    .map(|exposure| exposure.cause().to_string())
                    .collect();
                unstable.insert((file.clone(), local.clone()), (exposures[0].cause().to_string(), uncertainty, openings));
            }
        }
    }
    unstable
}

/// An unread package `prepare` lists, as a module names it, for the host to
/// say how it was installed (spec §6.3).
#[derive(serde::Serialize, PartialEq, Eq, PartialOrd, Ord)]
struct PreparedPackage {
    importer: String,
    specifier: String,
    /// As the analysis names it (see `link::Named::Package`).
    identity: String,
}

/// A computed load `prepare` lists, with the module that makes it.
#[derive(serde::Serialize)]
struct ListedLoad {
    importer: String,
    #[serde(flatten)]
    load: crate::loads::HostLoad,
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
            o.external_dirs_json.as_deref(),
            o.dev_mode.unwrap_or(false),
        )
        .map_err(napi::Error::from_reason)?;
        let mut css_inputs = css_inputs;
        css_inputs.analysis_context = match o.analysis_context_json.as_deref().map(str::trim) {
            None | Some("" | "null") => analyze_css::AnalysisContext::default(),
            Some(json) => serde_json::from_str(json)
                .map_err(|e| napi::Error::from_reason(format!("EngineOptions.analysisContextJson: {e}")))?,
        };
        css_inputs
            .bind_declarations(o.declaration_scales_json.as_deref())
            .map_err(napi::Error::from_reason)?;
        css_inputs
            .set_transform_sources(o.transform_sources_json.as_deref())
            .map_err(napi::Error::from_reason)?;
        css_inputs.set_transform_provenance(o.transform_provenance_json.as_deref());
        css_inputs
            .set_generated_names(o.generated_names_json.as_deref())
            .map_err(napi::Error::from_reason)?;
        css_inputs
            .set_property_records(o.property_records_json.as_deref())
            .map_err(napi::Error::from_reason)?;
        css_inputs
            .set_registered_collections(o.position_try_json.as_deref(), o.view_transitions_json.as_deref())
            .map_err(napi::Error::from_reason)?;
        css_inputs
            .set_short_class_prefix(o.short_class_prefix.as_deref())
            .map_err(napi::Error::from_reason)?;
        css_inputs.slot_provenance = o.slot_provenance.unwrap_or(false);
        let runtime_import = o.runtime_import.unwrap_or_else(|| "@animus-ui/system".to_string());
        css_inputs.variant_options = !OFFICIAL_RUNTIMES.contains(&runtime_import.as_str());
        Ok(ExtractEngine {
            opts: ResolvedOptions {
                runtime_import,
                css_module_id: o
                    .css_module_id
                    .unwrap_or_else(|| "virtual:animus/styles.css".to_string()),
                system_props_module_id: o
                    .system_props_module_id
                    .unwrap_or_else(|| SYSTEM_PROPS_MODULE_ID.to_string()),
                css_inputs,
            },
            facts: BTreeMap::new(),
            sources: BTreeMap::new(),
            order: Vec::new(),
            css: None,
            parse_count: 0,
            prepared: None,
            timings: Vec::new(),
        })
    }

    /// Parses `file_entries_json` for the next `analyzePrepared`, and returns
    /// the files' input identity, the path each of their specifiers probes
    /// (`probe_base`), sorted, and their computed loads: the bases a session
    /// gathers host-candidate evidence for, and the loads it lists the
    /// host's expansions of (spec §6.3), which carry that identity.
    #[napi]
    pub fn prepare(&mut self, file_entries_json: String) -> napi::Result<String> {
        let mut clock = PhaseClock::start();
        let entries = canonical_entries(&file_entries_json)?;
        let identity = input_identity(&entries, &self.opts.css_inputs);
        let synthesized = synthesized_of(&entries);
        // Each module's Lower output and object facts read its parse and
        // semantic build alone, never another file, an option, the evidence
        // or the file system, so the parse workers build them.
        let (store, modules): (_, Vec<_>) = ast_store::AstStore::build_with(
            entries.into_iter().map(|e| ast_store::FileEntry { path: e.path, source: e.source }).collect(),
            |ast| {
                let (lowered, listed) = crate::link::Lowered::of_listed(ast);
                let objects = facts::object_facts(ast.program(), &lowered);
                ((lowered, objects), listed)
            },
        );
        let (modules, listed): (Vec<_>, Vec<_>) = modules.into_iter().unzip();
        clock.mark("prepareParse");
        let mut bases = std::collections::BTreeSet::new();
        let mut loads = Vec::new();
        let mut packages = std::collections::BTreeSet::new();
        let analysed: BTreeMap<String, ()> = store.iter().map(|ast| (ast.path.clone(), ())).collect();
        for ((ast, (lowered, _)), listed) in store.iter().zip(&modules).zip(listed) {
            let all = &lowered.loads;
            loads.extend(listed.into_iter().map(|load| ListedLoad { importer: ast.path.clone(), load }));
            // A package a runtime load, a re-export or a namespace import
            // names may reach analysed modules: the host says which.
            let namespaces = crate::usage_facts::collect_namespace_imports(ast.module_record()).into_values();
            let opening = all
                .iter()
                .filter(|load| !matches!(load.kind, crate::loads::LoadKind::Import { .. }))
                .filter_map(|load| load.specifier().map(str::to_string))
                .chain(namespaces);
            for spec in opening {
                if let crate::link::Named::Package(package) = crate::link::named(&ast.path, &spec, &analysed, &self.opts.css_inputs) {
                    if !crate::link::is_node_builtin(&package) {
                        packages.insert(PreparedPackage { importer: ast.path.clone(), specifier: spec, identity: package });
                    }
                }
            }
            for load in all {
                if let Some(base) =
                    load.specifier().and_then(|spec| analyze_css::probe_base(&ast.path, spec, &self.opts.css_inputs))
                {
                    bases.insert(base);
                }
            }
        }
        self.prepared = Some(Prepared { identity: identity.clone(), synthesized, store, modules });
        clock.mark("prepareProbes");
        self.timings = clock.phases;
        serde_json::to_string(
            &serde_json::json!({ "identity": identity, "bases": bases, "loads": loads, "packages": packages }),
        )
        .map_err(|e| napi::Error::from_reason(format!("probe bases: {e}")))
    }

    /// The files the last `prepare` read: analyzes them, reading
    /// `probe_evidence_json`, the session's host-candidate evidence for this
    /// ingest generation, where given. The preparation is consumed; without
    /// one, it fails.
    #[napi]
    pub fn analyze_prepared(&mut self, probe_evidence_json: Option<String>) -> napi::Result<String> {
        let mut clock = PhaseClock::start();
        let Prepared { identity, mut synthesized, store, modules } = self
            .prepared
            .take()
            .ok_or_else(|| napi::Error::from_reason("analyzePrepared needs a prepare first, once per analysis"))?;
        if let Ok(mut shadowing) = self.opts.css_inputs.shadowing_probes.lock() {
            shadowing.clear();
        }
        if let Ok(mut openings) = self.opts.css_inputs.unread_openings.lock() {
            openings.clear();
        }
        // The config-only modules are this file set's own: an edit may move
        // a module into the app's reach.
        self.opts.css_inputs.config_only = Default::default();
        self.opts.css_inputs.runtime_imports = Default::default();
        if let Ok(mut incomplete) = self.opts.css_inputs.incomplete_probes.lock() {
            incomplete.clear();
            // Ingestion's openings are this analysis's own.
            for opening in &self.opts.css_inputs.analysis_context.openings {
                incomplete.insert(analyze_css::IncompleteProbe {
                    importer: opening.importer.clone(),
                    specifier: opening.specifier.clone(),
                    candidate: opening.candidate.clone(),
                    opened: opening.opened.clone(),
                    why: match opening.why {
                        analyze_css::IngestionOpeningKind::CaseMismatch => analyze_css::Opening::CaseMismatch,
                        analyze_css::IngestionOpeningKind::Skipped => {
                            analyze_css::Opening::Skipped { later: opening.later.clone() }
                        }
                    },
                });
            }
        }
        // Evidence gathered for other files (a same-count edit since the
        // `prepare`) is not this preparation's, so the probes ask the file set.
        self.opts.css_inputs.probe_evidence = match probe_evidence_json {
            Some(json) => Some(
                serde_json::from_str::<analyze_css::ProbeEvidence>(&json)
                    .map_err(|e| napi::Error::from_reason(format!("invalid probe evidence JSON: {e}")))?,
            )
            .filter(|evidence| evidence.identity == identity),
            None => None,
        };
        self.facts.clear();
        self.sources.clear();
        self.order.clear();

        // The `prepare` that parsed the files leads the phases.
        clock.phases = std::mem::take(&mut self.timings);
        clock.mark("input");
        self.parse_count = store.parse_count();
        clock.mark("parse");

        use crate::usage_facts::{collect_export_facts, collect_import_facts};
        let mut statics_by_file: std::collections::BTreeMap<
            String,
            rustc_hash::FxHashMap<String, crate::static_value::StaticValue>,
        > = std::collections::BTreeMap::new();
        let mut complete_statics_by_file: std::collections::BTreeMap<
            String,
            rustc_hash::FxHashMap<String, crate::static_value::StaticValue>,
        > = std::collections::BTreeMap::new();
        let mut imports_by_file: ModuleFacts = std::collections::BTreeMap::new();
        let mut style_modules: BTreeMap<String, StyleModule> = BTreeMap::new();
        // Each file's Lower output, before anything reads across files, and
        // what its parse and semantic build give alone, the object facts the
        // member tables follow among them, read before any static value is
        // evaluated; fact extraction completes them.
        let mut lowered_by_file: BTreeMap<String, crate::link::Lowered> = BTreeMap::new();
        let mut structural_by_file: BTreeMap<String, facts::FileFacts> = BTreeMap::new();
        for (ast, (lowered, objects)) in store.iter().zip(modules) {
            structural_by_file.insert(ast.path.clone(), facts::structural_facts(ast, &lowered, objects));
            lowered_by_file.insert(ast.path.clone(), lowered);
        }
        // One analysed path set, and inputs that hold still from here: each
        // base is probed once for every map keyed by exactly these paths.
        let _probes = analyze_css::ProbeScope::within(&lowered_by_file, &self.opts.css_inputs);
        analyze_css::ProbeScope::admit(&structural_by_file, &self.opts.css_inputs);
        analyze_css::distrust_promise(&mut structural_by_file, &self.opts.css_inputs);
        clock.mark("lowering");
        let links = ProjectLinks::of_records(&lowered_by_file, |lowered| &*lowered.record, &self.opts.css_inputs);
        // A hand-off to a function that does more than read is a use like
        // any other, judged before any static value is evaluated.
        analyze_css::judge_object_handoffs(&mut structural_by_file, &self.opts.css_inputs, &links);
        // Static reads follow explicit exports only, never `export *`, until
        // mutation tracking can bound every source a star exposes a binding
        // to; mutation tracking follows stars.
        let explicit: BTreeMap<String, crate::link::OwnedModuleRecord> = lowered_by_file
            .iter()
            .map(|(path, lowered)| {
                (path.clone(), crate::link::OwnedModuleRecord { star_exports: Vec::new(), ..(*lowered.record).clone() })
            })
            .collect();
        analyze_css::ProbeScope::admit(&explicit, &self.opts.css_inputs);
        let read_links = ProjectLinks::of_records(&explicit, |record| record, &self.opts.css_inputs);
        clock.mark("links");
        for ast in store.iter() {
            let program = ast.program();
            let statics = if crate::analyze_css::is_external_file(&ast.path, &self.opts.css_inputs.external_dirs) {
                crate::eval::collect_package_static_values(program, &ast.path)
            } else {
                crate::eval::collect_static_values(program, &ast.path)
            };
            let complete_statics = crate::eval::collect_complete_static_values(program, &ast.path);
            let exports = collect_export_facts(program);
            let imports = collect_import_facts(ast.module_record());
            statics_by_file.insert(ast.path.clone(), statics);
            complete_statics_by_file.insert(ast.path.clone(), complete_statics);
            imports_by_file.insert(ast.path.clone(), (imports, exports));
        }
        analyze_css::ProbeScope::admit(&statics_by_file, &self.opts.css_inputs);

        // Names some module exports an object static under, by name alone:
        // a module that imports none of them and declares no object static
        // has no use to scan. `export default X` exports X's object too, and
        // an imported X may be one.
        // A `const` may hold an object stored in it though it has no static.
        let holder_consts: BTreeMap<&str, rustc_hash::FxHashSet<&str>> =
            store.iter().map(|ast| (ast.path.as_str(), crate::usage_facts::holder_consts(ast.program()).collect())).collect();
        let is_object = |path: &str, local: &str| {
            matches!(statics_by_file[path].get(local), Some(crate::static_value::StaticValue::Object(_)))
                || holder_consts[path].contains(local)
        };
        let default_object = |path: &str| {
            let bindings = &lowered_by_file[path].bindings;
            match bindings.default_export {
                Some(crate::identity::DefaultExport::Snapshot { cell, of: Some(_) }) => {
                    let held = &bindings.binding(bindings.held(cell)).name;
                    is_object(path, held) || bindings.module_import(held).is_some()
                }
                _ => false,
            }
        };
        let object_exports: rustc_hash::FxHashSet<&str> = imports_by_file
            .iter()
            .flat_map(|(path, (_, exports))| {
                exports
                    .iter()
                    .filter(|export| {
                        export.source.is_some() || export.local.as_ref().is_some_and(|local| is_object(path, local))
                    })
                    .map(|export| export.exported.as_str())
                    .chain(default_object(path).then_some("default"))
            })
            .collect();
        // A namespace a module re-exports by name (`export * as ns from …`)
        // may hold any object.
        let namespace_exports: rustc_hash::FxHashSet<String> = store
            .iter()
            .flat_map(|ast| crate::usage_facts::collect_namespace_exports(ast.module_record()).into_keys())
            .collect();
        for ast in store.iter() {
            let program = ast.program();
            let module = ast.module_record();
            let statics = &statics_by_file[&ast.path];
            let (imports, _) = &imports_by_file[&ast.path];
            let namespace_imports = crate::usage_facts::collect_namespace_imports(module);
            let facts = if statics.values().any(|value| matches!(value, crate::static_value::StaticValue::Object(_)))
                || !namespace_imports.is_empty()
                || imports.iter().any(|import| {
                    object_exports.contains(import.imported.as_str()) || namespace_exports.contains(&import.imported)
                })
            {
                crate::usage_facts::style_object_uses(program, &lowered_by_file[&ast.path].scoping, statics, lowered_by_file[&ast.path].direct_eval)
            } else {
                crate::usage_facts::StyleObjectFacts::default()
            };
            style_modules.insert(
                ast.path.clone(),
                StyleModule {
                    facts,
                    written_namespaces: if namespace_imports.is_empty() {
                        BTreeMap::new()
                    } else {
                        crate::usage_facts::written_namespaces(program, &lowered_by_file[&ast.path].scoping, lowered_by_file[&ast.path].direct_eval)
                    },
                },
            );
        }

        // A static that some use may change before a style reads it is
        // unsettled, naming that use, so every reader refuses it.
        let mut unsettled_by_file: BTreeMap<String, rustc_hash::FxHashMap<String, crate::eval::Unsettled>> =
            BTreeMap::new();
        let programs: BTreeMap<&str, &oxc::ast::ast::Program<'_>> =
            store.iter().map(|ast| (ast.path.as_str(), ast.program())).collect();
        let readings_by_file: BTreeMap<String, crate::usage_facts::ParamReadings> =
            lowered_by_file.iter().map(|(path, lowered)| (path.clone(), std::sync::Arc::clone(&lowered.readings))).collect();
        let mut readings_of = |file: &str| readings_by_file.get(file).cloned().unwrap_or_default();
        // What may change of the statics styles read. The member tables keep
        // a relation of their own, since a call they must assume changes an
        // object (`styles(preset)`) only reads a static; both record a
        // module's openings through one recorder, in the same words.
        clock.mark("staticsAndUses");
        let mut flow = crate::flow::FlowBuilder::new();
        // A config file runs in its tool, never in the app (`config_files`).
        let config_files = analyze_css::config_files(&structural_by_file, &self.opts.css_inputs);
        style_modules.retain(|file, _| !config_files.contains(file));
        record_style_changes(
            &style_modules,
            &imports_by_file,
            &links,
            &lowered_by_file,
            &statics_by_file,
            &structural_by_file,
            &self.opts.css_inputs,
            &mut readings_of,
            &mut flow,
        );
        let changes = flow.close();
        clock.mark("flow");
        #[cfg(test)]
        OPENINGS.with(|openings| openings.borrow_mut().clear());
        #[cfg(test)]
        note_openings("style statics", &changes);
        for ((file, local), (reason, uncertainty, openings)) in unstable_style_statics(&changes, &statics_by_file) {
            if statics_by_file.get_mut(&file).and_then(|statics| statics.remove(&local)).is_some() {
                // Only a value the binding had before const initializers read
                // other consts is held; one derived from them is not.
                let in_package = crate::analyze_css::is_external_file(&file, &self.opts.css_inputs.external_dirs);
                let held = programs
                    .get(file.as_str())
                    .and_then(|program| crate::eval::pre_read_static(program, &file, &local, in_package));
                unsettled_by_file
                    .entry(file)
                    .or_default()
                    .insert(local, crate::eval::Unsettled { reason, uncertainty, held, openings });
            }
        }

        // Every registered collection, keyframes, position tries or view
        // transitions, by export name: each key's generated name. The kinds
        // share one name-space.
        let inputs = &self.opts.css_inputs;
        let registered_collections: rustc_hash::FxHashMap<String, crate::static_value::StaticValue> =
            [&inputs.keyframes_blocks, &inputs.position_try_blocks, &inputs.view_transition_blocks]
                .into_iter()
                .flat_map(|blocks| blocks.as_ref().and_then(|v| v.as_object()).into_iter().flatten())
                .filter_map(|(export_name, collection)| {
                    let coll_obj = collection.as_object()?;
                    let mut map = crate::static_value::StaticValue::Object(Vec::new());
                    for (key_name, block) in coll_obj {
                        if let Some(name) = block.get("name").and_then(|n| n.as_str()) {
                            map.insert(key_name, crate::static_value::StaticValue::String(name.to_string()));
                        }
                    }
                    Some((export_name.clone(), map))
                })
                .collect();

        let mut enriched_by_file: std::collections::BTreeMap<
            String,
            rustc_hash::FxHashMap<String, crate::static_value::StaticValue>,
        > = std::collections::BTreeMap::new();
        let mut usage_enriched_by_file: std::collections::BTreeMap<
            String,
            rustc_hash::FxHashMap<String, crate::static_value::StaticValue>,
        > = std::collections::BTreeMap::new();
        let mut unsettled_imports_by_file: BTreeMap<String, rustc_hash::FxHashMap<String, crate::eval::Unsettled>> =
            BTreeMap::new();
        let output_dirs = &self.opts.css_inputs.analysis_context.output_dirs;
        // Each unregistered import, by file and local, whose declaration is
        // in a kit's compiled output: the file declaring it.
        let mut compiled_declarations: rustc_hash::FxHashMap<(String, String), String> =
            rustc_hash::FxHashMap::default();
        for (path, (imports, exports)) in &imports_by_file {
            let mut extra = rustc_hash::FxHashMap::default();
            let mut usage_extra = rustc_hash::FxHashMap::default();
            let mut unsettled_extra: rustc_hash::FxHashMap<String, crate::eval::Unsettled> =
                rustc_hash::FxHashMap::default();
            for imp in imports {
                let Some(target) =
                    analyze_css::resolve_import_source(path, &imp.source, &statics_by_file, &self.opts.css_inputs)
                else {
                    continue;
                };
                let Some(module) = read_links.module(&target) else { continue };
                let (lookup, spelled) = read_links.table.resolve_export_spelled(module, &imp.imported);
                match lookup {
                    ExportLookup::Resolved(Terminal::Local { module, binding }) => {
                        let declaring = &read_links.paths[module];
                        let local = &lowered_by_file[declaring].bindings.binding(binding).name;
                        // A relative `asset()` specifier means its own file's
                        // directory, which an importer cannot carry.
                        if let Some(val) = statics_by_file[declaring]
                            .get(local)
                            .filter(|value| !crate::eval::carries_relative_asset(value))
                        {
                            extra.insert(imp.local.clone(), val.clone());
                        }
                        if let Some(unsettled) =
                            unsettled_by_file.get(declaring).and_then(|unsettled| unsettled.get(local)).filter(
                                |unsettled| unsettled.held.as_ref().is_none_or(|held| !crate::eval::carries_relative_asset(held)),
                            )
                        {
                            unsettled_extra.insert(imp.local.clone(), unsettled.clone());
                        }
                        if let Some(val) = complete_statics_by_file[declaring].get(local) {
                            usage_extra.insert(imp.local.clone(), val.clone());
                        }
                    }
                    ExportLookup::Resolved(Terminal::Namespace(_)) => {}
                    _ => continue,
                }
                // A registered collection, by the name the import's route
                // reaches it by; routes naming different registrations name
                // none.
                let mut registered = spelled.iter().filter_map(|(_, name)| registered_collections.get(name));
                let first = registered.next();
                if let Some(kf) = first.filter(|kf| registered.all(|other| other == *kf)) {
                    extra.insert(imp.local.clone(), kf.clone());
                    unsettled_extra.remove(&imp.local);
                    usage_extra.insert(imp.local.clone(), kf.clone());
                } else if let Some((at, _)) = spelled.first() {
                    let declared_in = &read_links.paths[*at];
                    if crate::analyze_css::is_external_file(declared_in, output_dirs) {
                        compiled_declarations.insert((path.clone(), imp.local.clone()), declared_in.clone());
                    }
                }
            }
            for exp in exports {
                if let Some(local) = &exp.local {
                    if let Some(kf) = registered_collections.get(&exp.exported) {
                        extra.insert(local.clone(), kf.clone());
                        unsettled_extra.remove(local);
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
            if !unsettled_extra.is_empty() {
                unsettled_imports_by_file.insert(path.clone(), unsettled_extra);
            }
        }

        clock.mark("enrich");
        let mut references = crate::transforms::TransformReferences::new(&self.opts.css_inputs);
        for ast in store.iter() {
            let (imports, exports) = &imports_by_file[&ast.path];
            references.add(&ast.path, ast.program(), imports, exports);
        }

        // The declarations each module declares a registered global block
        // with, whose keys locate the block's diagnostics.
        let mut global_declarations: rustc_hash::FxHashMap<&str, std::collections::BTreeSet<String>> =
            rustc_hash::FxHashMap::default();
        if let Some(serde_json::Value::Object(blocks)) = &self.opts.css_inputs.global_style_blocks {
            for block in blocks.values() {
                let Some(source) = block.get("source").and_then(serde_json::Value::as_str) else { continue };
                let Some(declared_by) = block.get("sourceExport").and_then(serde_json::Value::as_str) else { continue };
                global_declarations.entry(source).or_default().insert(declared_by.to_string());
            }
        }
        let empty = rustc_hash::FxHashMap::default();
        let none_unsettled = rustc_hash::FxHashMap::default();
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
            let mut file_facts = facts::extract_file_facts_from_static_maps(
                ast,
                crate::ids::CLASS_PREFIX,
                local_statics,
                local_usage_statics,
                extra,
                usage_extra,
                unsettled_by_file.get(&ast.path).unwrap_or(&none_unsettled),
                unsettled_imports_by_file.get(&ast.path).unwrap_or(&none_unsettled),
                &references,
                lowered_by_file.remove(&ast.path),
                structural_by_file.remove(&ast.path),
            );
            if let Some(names) = global_declarations.get(ast.path.as_str()) {
                file_facts.global_keys = facts::declaration_keys(ast.program(), ast.source(), names);
            }
            file_facts.synthesized_components = synthesized.remove(&ast.path).unwrap_or_default();
            self.facts.insert(ast.path.clone(), file_facts);
            self.sources
                .insert(ast.path.clone(), ast.source().to_string());
        }

        // Facts own every resolved reference; release the modules' scopings.
        drop(references);
        clock.mark("fileFacts");
        analyze_css::ProbeScope::admit(&self.facts, &self.opts.css_inputs);
        crate::pure_builders::resolve(&mut self.facts, &links, &self.opts.css_inputs);
        clock.mark("pureBuilders");
        let (mut css, css_read) = analyze_css::run_reading(
            &self.facts,
            &self.order,
            &self.opts.css_inputs,
            crate::ids::CLASS_PREFIX,
        );
        clock.mark("cssResolution");
        // Only the engine holds the sources a diagnostic's line and column
        // are read from; each file's line starts are found once.
        let mut lines = facts::SourceLines::new(&self.sources);
        for diagnostic in &mut css.diagnostics {
            diagnostic.locate(&mut lines);
            name_compiled_kit_fix(diagnostic, &compiled_declarations, output_dirs);
        }
        analyze_css::report_unread_openings(&mut css.diagnostics, &self.facts, &self.opts.css_inputs);
        if let Some(provenance) = &mut css.slot_provenance {
            provenance.locate(&mut lines);
        }
        self.css = Some(css);
        clock.mark("post");
        let manifest = self.manifest_json(false);
        clock.mark("serialize");
        // The parse and the analysis's own tables, the per-file statics
        // most of all, and CSS resolution's own, are freed on a pool thread
        // while the host reads the manifest; the engine keeps its facts and
        // sources. At most one
        // analysis's are pending there: while one is, a busy pool would hold
        // every later one too, so those are freed here.
        let read = (
            store,
            links,
            read_links,
            explicit,
            statics_by_file,
            complete_statics_by_file,
            enriched_by_file,
            usage_enriched_by_file,
            unsettled_by_file,
            unsettled_imports_by_file,
            imports_by_file,
            style_modules,
            changes,
            css_read,
        );
        if TEARDOWN_PENDING.swap(true, std::sync::atomic::Ordering::AcqRel) {
            drop(read);
        } else {
            rayon::spawn(move || {
                drop(read);
                TEARDOWN_PENDING.store(false, std::sync::atomic::Ordering::Release);
            });
        }
        self.timings = clock.phases;
        manifest
    }

    /// What each phase of the last `analyzePrepared` took, in milliseconds,
    /// as a JSON object in phase order, with its `prepare` first:
    /// `cssResolution` is the CSS resolution `rust-extract` holds. Hosts
    /// print it as timing; it is never part of the manifest.
    #[napi]
    pub fn analysis_timings(&self) -> String {
        let phases: serde_json::Map<String, serde_json::Value> = self
            .timings
            .iter()
            .map(|(phase, ms)| (phase.to_string(), serde_json::json!((ms * 100.0).round() / 100.0)))
            .collect();
        serde_json::Value::Object(phases).to_string()
    }

    /// The full manifest of the last `analyzePrepared`: every section but
    /// `chainBindings`. A host that persists the manifest, and tooling, ask
    /// for it.
    #[napi]
    pub fn full_manifest_json(&self) -> napi::Result<String> {
        self.manifest_json(true)
    }

    /// `analyze`, then its full manifest: for tests that read a section the
    /// host manifest leaves out.
    #[cfg(test)]
    pub(crate) fn analyze_full(&mut self, file_entries_json: String, probe_evidence_json: Option<String>) -> napi::Result<String> {
        self.analyze(file_entries_json, probe_evidence_json)?;
        self.full_manifest_json()
    }

    /// One section the host manifest leaves out (`fileFacts`, `crossFile`,
    /// `usageResidue` or `component_fragments`) of the last
    /// `analyzePrepared`, as JSON.
    #[napi]
    pub fn manifest_section(&self, name: String) -> napi::Result<String> {
        let Some(css) = &self.css else {
            return Err(napi::Error::from_reason("manifestSection: prepare() and analyzePrepared() must run first".to_string()));
        };
        let out = match name.as_str() {
            "fileFacts" => serde_json::to_string(&self.facts),
            "crossFile" => serde_json::to_string(&self.cross_file(css)),
            "usageResidue" => serde_json::to_string(&css.usage_residue),
            "component_fragments" => serde_json::to_string(&css.component_fragments),
            other => return Err(napi::Error::from_reason(format!("manifestSection: no section {other:?}"))),
        };
        out.map_err(|e| napi::Error::from_reason(format!("serialize failed: {e}")))
    }

    /// The cross-file facts of the last `analyzePrepared`, which only the full
    /// manifest carries.
    fn cross_file(&self, css: &analyze_css::CssOutput) -> cross_file::CrossFileFacts {
        cross_file::resolve_cross_file(&self.facts, css.member_bindings.clone())
    }

    /// The last `analyzePrepared`'s manifest: the full one, or the host's.
    fn manifest_json(&self, full: bool) -> napi::Result<String> {
        let Some(css) = &self.css else {
            return Err(napi::Error::from_reason("manifest: prepare() and analyzePrepared() must run first".to_string()));
        };
        let cross = full.then(|| self.cross_file(css));
        let builder_files: Vec<&str> = self
            .facts
            .iter()
            .filter(|(_, facts)| !facts.pure_builder_edits.is_empty())
            .map(|(path, _)| path.as_str())
            .collect();
        let chain_bindings = (!full).then(|| {
            self.facts
                .iter()
                .map(|(path, facts)| {
                    (path.as_str(), facts.chains.iter().map(|chain| chain.descriptor.binding.as_str()).collect())
                })
                .collect()
        });
        let out = serde_json::to_string(&AnalyzeResult {
            cross_file: cross.as_ref(),
            file_facts: full.then_some(&self.facts),
            chain_bindings,
            parse_count: self.parse_count,
            usage_residue: full.then_some(&css.usage_residue),
            css: &css.css,
            sheets: &css.sheets,
            diagnostics: &css.diagnostics,
            report: &css.reconciliation,
            system_prop_map: &css.system_prop_map,
            dynamic_props: &css.dynamic_props,
            admitted_transforms: &css.admitted_transforms,
            typed_system_props: &css.typed_system_props,
            component_fragments: full.then_some(&css.component_fragments),
            system_fingerprint: &css.system_fingerprint,
            reverse_provenance: &css.reverse_provenance,
            components: &css.components,
            files: &css.files_map,
            builder_files: &builder_files,
            missing_inputs: &css.missing_inputs,
            font_preloads: &css.font_preloads,
            runtime_tables: &css.runtime_tables,
            tag_components: &css.tag_components,
            tag_declarations: &css.tag_declarations,
            as_component_targets: &css.as_component_targets,
            unmatched_routes: &css.unmatched_routes,
            prop_name_lists: &css.prop_name_lists,
            superseded_by: &css.superseded_by,
            slot_provenance: css.slot_provenance.as_ref(),
            timing: serde_json::json!({ "parseCount": self.parse_count }),
        });
        out.map_err(|e| napi::Error::from_reason(format!("serialize failed: {e}")))
    }

    #[napi]
    pub fn clear_cache(&mut self) {
        self.facts.clear();
        self.sources.clear();
        self.order.clear();
        self.css = None;
        self.parse_count = 0;
        self.prepared = None;
    }

    #[napi(getter)]
    pub fn parse_count(&self) -> u32 {
        self.parse_count as u32
    }

    #[napi]
    pub fn transform_file(&mut self, path: String) -> napi::Result<String> {
        let (Some(source), Some(file_facts)) = (self.sources.get(&path), self.facts.get(&path))
        else {
            return Err(napi::Error::from_reason(format!(
                "transformFile('{path}'): path not present in the last analyzePrepared() call — \
                 analyze the project first (engine state is per-instance, not global)."
            )));
        };

        if self.css.is_none() {
            return Err(napi::Error::from_reason(
                "transformFile: prepare() and analyzePrepared() must run first".to_string(),
            ));
        }
        // Payload presence is the survival record; re-deriving it from
        // binding ancestry drops aliased-parent extension chains.
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

        // A file with no component: the source, with its builder chains'
        // pure marks if it has any.
        let no_components = || -> napi::Result<String> {
            if file_facts.pure_builder_edits.is_empty() {
                return Ok(serde_json::json!({ "code": source, "hasComponents": false }).to_string());
            }
            let annotated = emit::apply_plan(
                source,
                &emit::EmissionPlan { replacements: file_facts.pure_builder_edits.clone(), ..Default::default() },
            )
            .map_err(napi::Error::from_reason)?;
            Ok(serde_json::json!({ "code": annotated.code, "hasComponents": false, "annotated": true }).to_string())
        };
        if file_payloads.is_empty() {
            return no_components();
        }

        let names = assemble::GeneratedNames::free_in(
            source,
            file_payloads.values().filter_map(|payload| payload.prop_names_key.as_ref()),
        );
        let replacements = assemble::assemble_replacements(
            &path,
            file_facts,
            crate::ids::CLASS_PREFIX,
            Some(&file_payloads),
            assemble::ConfigInputs {
                group_registry: &self.opts.css_inputs.group_registry,
                variant_options: self.opts.css_inputs.variant_options,
                trusted_factories: !self.opts.css_inputs.variant_options,
            },
            &names,
        )
        .map_err(|e| match e {
            assemble::AssembleError::NeedsConfig(msg) => napi::Error::from_reason(format!(
                "extractor: {msg} — system/custom payloads land with the config/theme \
                 inputs (row 07)."
            )),
        })?;

        let mut replacements = replacements;
        replacements.extend(
            dead_staged_builders(file_facts, &file_payloads)
                .into_iter()
                .map(|(start, end)| (start, end, String::new())),
        );

        let has_any_compose = !file_facts.compose.is_empty();
        let has_compose_replacements = file_facts.compose.iter().any(|f| !f.context);
        let has_compose_context_replacements = file_facts.compose.iter().any(|f| f.context);
        let import_needs = replacement_import_needs(file_facts, &file_payloads);
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
                // Never marked: the factory reads Root's variantDefaults, and
                // a user's Root (a Proxy, a getter) can make that read run code.
                format!(
                    "{}({}, {{ name: \"{}\", sharedKeys: [{}] }})",
                    names.create_composed_family_with_context,
                    slots_obj,
                    family.name,
                    shared_keys_str.join(", ")
                )
            } else {
                // Pure as a component factory is, under an official runtime:
                // it reads nothing of its slots, and every argument is a slot
                // binding or a literal.
                let mark = if self.opts.css_inputs.variant_options { "" } else { assemble::PURE_ANNOTATION };
                format!(
                    "{}{}({}, {{ name: \"{}\" }})",
                    mark,
                    names.create_composed_family,
                    slots_obj,
                    family.name
                )
            };
            replacements.push((family.span.0, family.span.1, text));
        }

        if replacements.is_empty() {
            return no_components();
        }
        // A builder chain's pure mark, where no component replacement covers it.
        let annotations: Vec<_> = file_facts
            .pure_builder_edits
            .iter()
            .filter(|&&(start, end, _)| !replacements.iter().any(|&(from, to, _)| start < to && from < end))
            .cloned()
            .collect();
        replacements.extend(annotations);

        let needed = |imports: &[(bool, &assemble::GeneratedName)]| -> Vec<String> {
            imports.iter().filter(|(needed, _)| *needed).map(|(_, name)| name.specifier()).collect()
        };
        let lists: Vec<assemble::GeneratedName> =
            import_needs.prop_name_lists.iter().map(|key| names.prop_name_list(key)).collect();
        let mut virtual_imports = needed(&[
            (import_needs.system_prop_map, &names.system_prop_map),
            (import_needs.system_prop_groups, &names.system_prop_groups),
            (import_needs.typed_system_props, &names.typed_system_props),
            (import_needs.dynamic_prop_config, &names.dynamic_prop_config),
            (import_needs.transforms, &names.transforms),
            (import_needs.runtime_tables, &names.animus_tables),
            (import_needs.superseded_by, &names.superseded_by),
        ]);
        virtual_imports.extend(lists.iter().map(assemble::GeneratedName::specifier));
        let system_imports = needed(&[
            (import_needs.create_component, &names.create_component),
            (import_needs.class_resolver, &names.create_class_resolver),
            (has_compose_replacements, &names.create_composed_family),
        ]);
        let system_import_str = format!(
            "import {{ {} }} from '{}';\n",
            system_imports.join(", "),
            self.opts.runtime_import
        );
        // The module stays imported where its declaration was, so it still
        // evaluates in authored order.
        for (&(start, end), module) in &import_needs.effect_imports {
            let declaration = &source[start as usize..end as usize];
            let separator = if declaration.ends_with(';') { "" } else { ";" };
            let specifier = crate::evaluator::js_string_literal(module);
            replacements.push((start, end, format!("{declaration}{separator}import {specifier};")));
        }
        let compose_ctx_import_str = if has_compose_context_replacements {
            format!(
                "import {{ {} }} from '{}';\n",
                names.create_composed_family_with_context.specifier(),
                derive_compose_context_import(&self.opts.runtime_import)
            )
        } else {
            String::new()
        };
        let import_lines = if !virtual_imports.is_empty() {
            let virtual_import = format!(
                "import {{ {} }} from '{}';\n",
                virtual_imports.join(", "),
                self.opts.system_props_module_id
            );
            format!(
                "{}{}{}import '{}';\n",
                system_import_str, compose_ctx_import_str, virtual_import, self.opts.css_module_id
            )
        } else {
            format!(
                "{}{}import '{}';\n",
                system_import_str, compose_ctx_import_str, self.opts.css_module_id
            )
        };

        // Payload presence, not absence of a fatal error: a chain rejected
        // after parsing is dropped, and its import must survive.
        let has_primary_extracted = file_facts.chains.iter().any(|c| {
            c.descriptor.extends_from.is_none() && file_payloads.contains_key(&c.descriptor.binding)
        });
        let mut consumed: Vec<&str> = Vec::new();
        if has_primary_extracted || has_any_compose {
            consumed.push(self.opts.runtime_import.as_str());
        }
        if has_compose_replacements {
            consumed.push("@animus-ui/system");
            consumed.push("@animus-ui/system/compose");
        }
        if has_compose_context_replacements {
            consumed.push("@animus-ui/system/compose-with-context");
            consumed.push("@animus-ui/system");
        }
        // A builder import the strip would remove stays while any reference
        // to it lies outside every replaced span, such as a chain left
        // untransformed beside one that was replaced.
        let still_referenced = |callee: &str| {
            file_facts.builder_import_references.iter().any(|import| {
                import.imported == callee
                    && consumed.contains(&import.source.as_str())
                    && import.spans.iter().any(|&(start, end)| {
                        !replacements
                            .iter()
                            .any(|&(from, to, _)| from <= start && end <= to)
                    })
            })
        };
        let mut extracted: Vec<&str> = Vec::new();
        if has_primary_extracted && !still_referenced("animus") {
            extracted.push("animus");
        }
        if has_compose_replacements && !still_referenced("compose") {
            extracted.push("compose");
        }
        if has_compose_context_replacements && !still_referenced("composeWithContext") {
            extracted.push("composeWithContext");
        }

        let needs_use_client =
            has_compose_context_replacements || file_facts.compose.iter().any(|f| f.context);

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
thread_local! {
    /// The last analysis's openings on this thread, by relation, kind and
    /// site.
    static OPENINGS: std::cell::RefCell<std::collections::BTreeSet<(&'static str, crate::flow::ReasonId, String)>> =
        const { std::cell::RefCell::new(std::collections::BTreeSet::new()) };
}

/// Adds the openings of `relation`, closed, to the analysis's, for check 6.
#[cfg(test)]
pub(crate) fn note_openings(relation: &'static str, changes: &crate::flow::ValueEffects) {
    OPENINGS.with(|openings| {
        let mut openings = openings.borrow_mut();
        openings.extend(changes.closure().openings.iter().map(|opening| (relation, opening.reason, opening.site.clone())));
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    impl ExtractEngine {
        /// A host's analysis of `files`: `prepare`, then `analyzePrepared`.
        pub(super) fn analyze(&mut self, files: String, evidence: Option<String>) -> napi::Result<String> {
            self.prepare(files)?;
            self.analyze_prepared(evidence)
        }
    }

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
                None,
            )
            .unwrap();
        replacement_import_needs(
            &engine.facts["structured-imports.tsx"],
            &payloads,
        )
    }

    fn dynamic_meta(
        transform_name: Option<&str>,
        transform_id: Option<&str>,
        transform_fn_source: Option<&str>,
    ) -> crate::dynamic_meta::DynamicPropMeta {
        crate::dynamic_meta::DynamicPropMeta::Value(crate::dynamic_meta::ValuePropMeta {
            var_name: "--tone".into(),
            slot_class: "tone-slot".into(),
            property: "color".into(),
            negative: false,
            strict: false,
            keywords: vec![],
            properties: Vec::new(),
            transform_name: transform_name.map(str::to_string),
            transform_id: transform_id.map(str::to_string),
            transform_fn_source: transform_fn_source.map(str::to_string),
            scale_values: BTreeMap::new(),
            current_var: None,
            production_conditions: None,
            declared_numeric: false,
            tables: Default::default(),
        })
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
                None,
            )
            .unwrap();
        let result = engine.transform_file("directive.tsx".to_string()).unwrap();
        serde_json::from_str(&result).unwrap()
    }

    /// Contract: every component a production analysis emits CSS for is
    /// named, in its file's transformed code, by its class as a string
    /// literal: plain, extended, `asComponent`, `asClass`, a compose
    /// family's slots, one whose compound and slot names the runtime
    /// derives from its class, short class names, and an installed kit's
    /// prebuilt definitions. A build's removal of components no output file
    /// names (`removeUnbundledComponents`) reads that literal as the only way
    /// the class enters a page.
    #[test]
    fn every_definition_passes_its_class_name_as_a_literal() {
        let files = serde_json::json!([
            {
                "path": "app.tsx",
                "source": "import { compose } from '@animus-ui/system';\n\
                    const Link = (props) => <a {...props} />;\n\
                    export const Box = ds.styles({ display: 'flex' }).asElement('div');\n\
                    export const Ext = Box.extend().styles({ display: 'grid' }).asElement('section');\n\
                    export const Anchor = ds.styles({ display: 'block' }).asComponent(Link);\n\
                    export const cls = ds.styles({ display: 'inline' }).asClass();\n\
                    export const Derived = ds.styles({ display: 'flex' })\n\
                      .variant({ prop: 'size', variants: { sm: { display: 'grid' }, lg: { display: 'block' } } })\n\
                      .states({ active: { display: 'inline' } })\n\
                      .compound({ size: 'sm', active: true }, { display: 'contents' })\n\
                      .props({ tone: { property: 'color' } })\n\
                      .asElement('div');\n\
                    const Root = ds.styles({ display: 'flex' }).asElement('div');\n\
                    const Body = ds.styles({ display: 'grid' }).asElement('div');\n\
                    export const Card = compose({ Root, Body }, { name: 'Card' });\n\
                    export const App = () => <><Box /><Ext /><Anchor /><Derived size={x} active tone={y} /><Card.Root><Card.Body /></Card.Root><div className={cls()} /></>;\n",
            },
            {
                "path": "node_modules/kit/dist/index.js",
                "source": "export const KitButton = ds.styles({ display: 'flex' }).variant({ prop: 'size', variants: { sm: { display: 'grid' } } }).asElement('button');\n",
            },
        ])
        .to_string();
        for short in [None, Some("x")] {
            let mut engine = ExtractEngine::new(Some(EngineOptions {
                dev_mode: Some(false),
                short_class_prefix: short.map(str::to_string),
                external_dirs_json: Some(r#"["node_modules/kit"]"#.to_string()),
                ..Default::default()
            }))
            .unwrap();
            let manifest: serde_json::Value =
                serde_json::from_str(&engine.analyze(files.clone(), None).unwrap()).unwrap();
            let components = manifest["components"].as_object().unwrap();
            let ids: Vec<&String> = components.keys().collect();
            for expected in ["::Box", "::Ext", "::Anchor", "::cls", "::Derived", "::Root", "::Body", "::KitButton"] {
                assert!(ids.iter().any(|id| id.ends_with(expected)), "{expected} missing from {ids:?}");
            }
            for (id, component) in components {
                let class = component["class_name"].as_str().unwrap();
                let file = component["file"].as_str().unwrap();
                let result: serde_json::Value =
                    serde_json::from_str(&engine.transform_file(file.to_string()).unwrap()).unwrap();
                let code = result["code"].as_str().unwrap();
                assert!(
                    code.contains(&format!("'{class}'")) || code.contains(&format!("\"{class}\"")),
                    "{id} ({class}, short {short:?}) has no class literal in:\n{code}"
                );
            }
        }
    }

    fn transform_source(source: &str) -> String {
        transform_result(source)["code"]
            .as_str()
            .unwrap()
            .to_string()
    }

    /// Contract: evidence is read only for the files it was gathered for. A
    /// same-count edit since the `prepare` (an unrelated file replaced by
    /// `x.ts`) leaves the old evidence for `./x` (`x.tsx`) unread, so the
    /// probe finds `x.ts`, as a plain analysis does.
    #[test]
    fn evidence_for_other_files_is_never_read() {
        let entries = |second: (&str, &str)| {
            serde_json::json!([
                { "path": "app.tsx", "source": "import { Parent } from './x';\nexport const Child = Parent.extend().styles({ m: 1 }).asElement('div');\nexport const App = () => <Child />;" },
                { "path": "x.tsx", "source": "export const Parent = ds.styles({ p: 2 }).asElement('div');" },
                { "path": second.0, "source": second.1 },
            ])
            .to_string()
        };
        let before = entries(("unrelated.ts", "export const u = 1;"));
        let after = entries(("x.ts", "export const Parent = ds.styles({ p: 1 }).asElement('div');"));
        let mut engine = ExtractEngine::new(None).unwrap();
        let prepared: serde_json::Value = serde_json::from_str(&engine.prepare(before).unwrap()).unwrap();
        let evidence = serde_json::json!({
            "generation": 1,
            "identity": prepared["identity"],
            "bases": { "x": { "candidate": "x.tsx", "actual": null, "analysedAs": "x.tsx" } },
        })
        .to_string();
        let parent_of = |manifest: String| {
            let manifest: serde_json::Value = serde_json::from_str(&manifest).unwrap();
            manifest["components"]["app.tsx::Child"]["extends_from"].clone()
        };
        let stale = parent_of(engine.analyze(after.clone(), Some(evidence)).unwrap());
        let plain = parent_of(ExtractEngine::new(None).unwrap().analyze(after, None).unwrap());
        assert_eq!(plain, serde_json::json!("x.ts::Parent"));
        assert_eq!(stale, plain);
    }

    /// Contract: evidence gathered under one host's extension order is never
    /// read under another's, though the files are the same: gathered where
    /// `./x` opens `x.ts`, it leaves an engine whose order opens `x.tsx`
    /// first to its own probe.
    #[test]
    fn evidence_for_another_extension_order_is_never_read() {
        let files = serde_json::json!([
            { "path": "app.tsx", "source": "import { Parent } from './x';\nexport const Child = Parent.extend().styles({ m: 1 }).asElement('div');\nexport const App = () => <Child />;" },
            { "path": "x.ts", "source": "export const Parent = ds.styles({ p: 1 }).asElement('div');" },
            { "path": "x.tsx", "source": "export const Parent = ds.styles({ p: 2 }).asElement('div');" },
        ])
        .to_string();
        let ordered = |appended: [&str; 2]| {
            ExtractEngine::new(Some(EngineOptions {
                analysis_context_json: Some(
                    serde_json::json!({ "extensions": { "appended": appended, "nodeNext": [], "alias": [] } }).to_string(),
                ),
                ..Default::default()
            }))
            .unwrap()
        };
        let prepared: serde_json::Value =
            serde_json::from_str(&ordered([".ts", ".tsx"]).prepare(files.clone()).unwrap()).unwrap();
        let evidence = serde_json::json!({
            "generation": 1,
            "identity": prepared["identity"],
            "bases": { "x": { "candidate": "x.ts", "actual": null, "analysedAs": "x.ts" } },
        })
        .to_string();
        let parent_of = |manifest: String| {
            let manifest: serde_json::Value = serde_json::from_str(&manifest).unwrap();
            manifest["components"]["app.tsx::Child"]["extends_from"].clone()
        };
        let replayed = parent_of(ordered([".tsx", ".ts"]).analyze(files.clone(), Some(evidence)).unwrap());
        let plain = parent_of(ordered([".tsx", ".ts"]).analyze(files, None).unwrap());
        assert_eq!(plain, serde_json::json!("x.tsx::Parent"));
        assert_eq!(replayed, plain);
    }

    /// Contract: `prepare` names every base analysis probes, so a session
    /// that gathers evidence for its bases leaves no probe unanswered:
    /// imports, re-exports, `import()` and an alias's expansion alike.
    #[test]
    fn prepare_names_every_base_analysis_probes() {
        let mut engine = ExtractEngine::new(Some(EngineOptions {
            path_aliases_json: Some(r#"{"aliases":[{"pattern":"@ui/","replacement":"ui/","type":"prefix"}]}"#.to_string()),
            ..Default::default()
        }))
        .unwrap();
        let files = serde_json::json!([
            { "path": "src/app.tsx", "source": "import { Box } from './box';\nexport { Row } from '../row';\nimport { Card } from '@ui/card';\nconst Lazy = () => import('./lazy');\nexport const App = () => <Box><Card /></Box>;" },
            { "path": "src/box.tsx", "source": "export const Box = ds.styles({ p: 4 }).asElement('div');" },
            { "path": "row.tsx", "source": "export const Row = ds.styles({ m: 2 }).asElement('div');" },
            { "path": "ui/card.tsx", "source": "export const Card = ds.styles({ p: 1 }).asElement('div');" },
            { "path": "src/lazy.tsx", "source": "export default 1;" },
        ])
        .to_string();
        let prepared: serde_json::Value = serde_json::from_str(&engine.prepare(files.clone()).unwrap()).unwrap();
        let bases: std::collections::BTreeSet<String> = serde_json::from_value(prepared["bases"].clone()).unwrap();
        crate::analyze_css::PROBED.with(|probed| probed.borrow_mut().clear());
        engine.analyze(files, None).unwrap();
        let probed = crate::analyze_css::PROBED.with(|probed| probed.borrow().clone());
        assert!(!probed.is_empty());
        let unprepared: Vec<_> = probed.difference(&bases).collect();
        assert!(unprepared.is_empty(), "probed without a prepared base: {unprepared:?} (prepared {bases:?})");
    }

    /// Contract: an object-use diagnostic names the 1-based line of the
    /// use, however far into the file it is.
    #[test]
    fn object_use_diagnostic_names_the_line_of_the_use() {
        let mut engine = ExtractEngine::new(None).unwrap();
        let source = [
            "const base = { p: 4 };",
            "",
            "",
            "",
            "",
            "export const helper = (o: any) => { o.p = 8; return o; };",
            "",
            "helper(base);",
            "export const Box = ds.styles(base).asElement('div');",
        ]
        .join("\n");
        let files = serde_json::json!([{ "path": "a.tsx", "source": source }]).to_string();
        let out = engine.analyze(files, None).unwrap();
        assert!(out.contains("base is passed to helper() in a.tsx on line 8"), "{out}");
    }

    #[test]
    fn analyze_retains_state_and_reports_parse_count() {
        let mut engine = ExtractEngine::new(None).unwrap();
        let out = engine
            .analyze(
                r#"[{"path":"a.tsx","source":"export const Box = ds.styles({ p: 4 }).asElement('div');"},
                    {"path":"b.tsx","source":"export const App = () => <Box p={2} />;"}]"#
                    .to_string(),
                None,
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
            r#"import { Box } from "./a"; export const B = () => <><Box p={ok ? 4 : 8} /><Box p={gap} /></>;"#;
        let manifest: serde_json::Value = serde_json::from_str(
            &engine
                .analyze_full(
                    serde_json::json!([
                        { "path": "b.tsx", "source": b_source },
                        { "path": "a.tsx", "source": a_source }
                    ])
                    .to_string(),
                    None,
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
        // A conditional of literals is no residue: its classes stand for it.
        assert_eq!(residue[1]["file"], "b.tsx");
        assert_eq!(residue[1]["kind"], "identifier");
        assert_eq!(
            &a_source[residue[0]["span"]["start"].as_u64().unwrap() as usize
                ..residue[0]["span"]["end"].as_u64().unwrap() as usize],
            "spacing"
        );
        assert_eq!(
            manifest["css"],
            "@layer anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom;\n\n@layer anm-variants {\n  @layer standalone, composed;\n  @layer composed {\n  }\n}\n\n@layer anm-system {\n  .animus-dyn-p_ {\n    padding: var(--animus-p_);\n  }\n  .animus-u-919d7eb1 {\n    padding: 4;\n  }\n  .animus-u-91c0915d {\n    padding: 8;\n  }\n}\n\n"
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
                    "varName": "--animus-p_",
                    "slotClass": "animus-dyn-p_",
                    "property": "padding",
                    "transformName": null,
                    "transformFnSource": null,
                    "scaleValues": {}
                }
            })
        );
    }

    /// Contract: the manifest's `usage` stays the raw syntax, which Oracle
    /// checks source against, and `proven` beside it proves a value only
    /// where the pruning analysis does (`AttrFact::proven_values`): a
    /// `const` as its value and a conditional of literals as its
    /// alternatives, but never a value evaluated through an object
    /// something changes.
    #[test]
    fn manifest_proven_is_what_pruning_proves() {
        let mut engine = ExtractEngine::new(None).unwrap();
        let manifest: serde_json::Value = serde_json::from_str(
            &engine
                .analyze_full(
                    serde_json::json!([{
                        "path": "raw.tsx",
                        "source": "const GAP = 24; const options = { size: 'sm' }; options.size = 'lg';\n\
                                   export const App = ({ open, n }) => <Box p={GAP} display={open ? 'block' : 'none'} m={n} size={options.size} />;"
                    }])
                    .to_string(),
                    None,
                )
                .unwrap(),
        )
        .unwrap();
        let facts = &manifest["fileFacts"]["raw.tsx"];
        let attr = |list: &str, name: &str| {
            facts[list][0]["element"]["attrs"].as_array().unwrap().iter().find(|attr| attr["name"] == name).unwrap().clone()
        };

        assert_eq!(attr("usage", "p")["dynamic"], true, "raw usage reads a const as written");
        assert_eq!(attr("proven", "p"), serde_json::json!({ "name": "p", "values": [24], "proven": true }));
        assert_eq!(attr("proven", "display")["values"], serde_json::json!(["block", "none"]));
        assert_eq!(attr("proven", "display")["proven"], true);

        let runtime = attr("proven", "m");
        assert_eq!(runtime["proven"], false);
        assert_eq!(runtime["values"], serde_json::json!([]));
        // Evaluated as 'sm', written as 'lg': listed, never proven.
        assert_eq!(attr("proven", "size")["proven"], false);
    }

    /// Contract: a `const` bound to a conditional of literals is one of
    /// those literals wherever it is read, as a literal written at the site
    /// is: proven, and an option no branch names prunes.
    #[test]
    fn a_const_of_literal_branches_is_proven_and_prunes() {
        let mut engine = ExtractEngine::new(None).unwrap();
        let source = "export const Grip = ds.variant({ prop: 'tone', defaultVariant: 'light', variants: { tertiary: { margin: 1 }, extraLight: { margin: 2 }, light: { margin: 3 }, heavy: { margin: 4 } } }).asElement('div');\n\
                      export const Item = ({ withIcon, disabled }) => {\n\
                        const tone = withIcon ? 'tertiary' : disabled ? 'extraLight' : 'light';\n\
                        return <Grip tone={tone} />;\n\
                      };\n";
        let manifest: serde_json::Value = serde_json::from_str(
            &engine.analyze_full(serde_json::json!([{ "path": "a.tsx", "source": source }]).to_string(), None).unwrap(),
        )
        .unwrap();
        let attr = manifest["fileFacts"]["a.tsx"]["proven"][0]["element"]["attrs"][0].clone();
        assert_eq!(attr["values"], serde_json::json!(["tertiary", "extraLight", "light"]));
        assert_eq!(attr["proven"], true);
        let css = manifest["css"].as_str().unwrap();
        assert!(css.contains("--tone-tertiary") && css.contains("--tone-extraLight"), "{css}");
        assert!(!css.contains("--tone-heavy"), "an option no branch names prunes: {css}");
    }

    /// Contract: a proven value that may be `undefined` or `null` also
    /// selects what leaving the prop out does, inline, through `const`s or
    /// at a breakpoint: the variant's default keeps its CSS, and so does a
    /// compound keyed on the default option; an option no branch names
    /// still prunes.
    #[test]
    fn a_proven_value_that_may_be_absent_keeps_the_default() {
        for site in [
            "const size = on ? 'sm' : undefined; return <Chip size={size} />;",
            "return <Chip size={on ? 'sm' : null} />;",
            "const picked = on ? 'sm' : undefined; const size = picked; return <Chip size={size} />;",
            "return <Chip size={{ _: on ? 'sm' : undefined }} />;",
        ] {
            let mut engine = ExtractEngine::new(None).unwrap();
            let source = format!(
                "export const Chip = ds.variant({{ prop: 'size', defaultVariant: 'md', variants: {{ sm: {{ color: 'red' }}, md: {{ color: 'green' }}, lg: {{ color: 'blue' }} }} }}).compound({{ size: 'md' }}, {{ order: 2 }}).asElement('div');\n\
                 export default ({{ on }}) => {{ {site} }};\n"
            );
            let manifest: serde_json::Value = serde_json::from_str(
                &engine.analyze_full(serde_json::json!([{ "path": "a.tsx", "source": source }]).to_string(), None).unwrap(),
            )
            .unwrap();
            let attr = &manifest["fileFacts"]["a.tsx"]["proven"][0]["element"]["attrs"][0];
            assert_eq!((&attr["values"], &attr["proven"], &attr["absent"]), (&serde_json::json!(["sm"]), &serde_json::json!(true), &serde_json::json!(true)), "{site}");
            let css = manifest["css"].as_str().unwrap();
            assert!(css.contains("color: red") && css.contains("--size-default {\n    color: green") && css.contains("order: 2"), "{site}: {css}");
            assert!(!css.contains("color: blue"), "{site}: an option no branch names prunes: {css}");
        }
    }

    /// Contract: a module with a `with` statement proves no `const` by its
    /// declarator, since the statement's object can stand in for the name.
    #[test]
    fn a_const_read_where_a_with_statement_may_shadow_it_is_not_proven() {
        let mut engine = ExtractEngine::new(None).unwrap();
        let source = "function Page({ on }) {\n\
                        const size = on ? 'sm' : 'lg';\n\
                        with ({ size: 'md' }) { return <Chip size={size} />; }\n\
                      }\n";
        let manifest: serde_json::Value = serde_json::from_str(
            &engine.analyze_full(serde_json::json!([{ "path": "a.js", "source": source }]).to_string(), None).unwrap(),
        )
        .unwrap();
        let attr = &manifest["fileFacts"]["a.js"]["proven"][0]["element"]["attrs"][0];
        assert_eq!(attr["name"], "size", "{manifest:#}");
        assert_eq!(attr["proven"], false);
    }

    /// Contract: the manifest names the component's own prop a runtime
    /// value passes on unchanged, destructured or read off its props
    /// object, so a reader can tell a forward, which its callers write,
    /// from a value the site computes; and names none where the value may
    /// be another: a props object something writes, a `memo` no import of
    /// React names (a module's own, or an unbound `React`'s), or a falsy prop
    /// replaced (`size || undefined`).
    #[test]
    fn manifest_proven_names_only_an_unchanged_forward() {
        let mut engine = ExtractEngine::new(None).unwrap();
        let source = "import { memo } from 'react';\n\
                      export const Button = ({ size }) => <Box p={size} />;\n\
                      export function Tag(props) { return <Box m={props.tone} />; }\n\
                      export const plain = ({ n }) => <Box p={n} />;\n\
                      export const Pill = memo(({ size = 'md' }) => <Box p={size} />);\n\
                      export const Or = ({ size }) => <Box p={size || undefined} />;\n\
                      export function Written(props) { props.size = 'lg'; return <Box p={props.size} />; }\n\
                      export function Assigned(props) { Object.assign(props, { size: 'lg' }); return <Box p={props.size} />; }\n";
        let local = "function memo(fn) { return () => fn({ size: 'lg' }); }\n\
                     export const Wrap = memo(({ size }) => <Box p={size} />);\n";
        let global = "globalThis.React = { memo: (fn) => () => fn({ size: 'lg' }) };\n\
                      export const Wrap = React.memo(({ size }) => <Box p={size} />);\n";
        let manifest: serde_json::Value = serde_json::from_str(
            &engine
                .analyze_full(
                    serde_json::json!([
                        { "path": "a.tsx", "source": source },
                        { "path": "b.tsx", "source": local },
                        { "path": "c.tsx", "source": global }
                    ])
                    .to_string(),
                    None,
                )
                .unwrap(),
        )
        .unwrap();
        let attr = |file: &str, element: usize| manifest["fileFacts"][file]["proven"][element]["element"]["attrs"][0].clone();
        assert_eq!(attr("a.tsx", 0)["forwarded"], serde_json::json!({ "component": "Button", "prop": "size" }));
        assert_eq!(attr("a.tsx", 1)["forwarded"], serde_json::json!({ "component": "Tag", "prop": "tone" }));
        assert!(attr("a.tsx", 2).get("forwarded").is_none(), "a function not named as a component forwards nothing");
        // Through React's `memo`, with the literal a caller that leaves it out passes.
        assert_eq!(attr("a.tsx", 3)["forwarded"], serde_json::json!({ "component": "Pill", "prop": "size", "default": "md" }));
        for (element, why) in [
            (4, "`|| undefined` replaces a falsy option"),
            (5, "a write to the props object"),
            (6, "the props object handed to a call"),
        ] {
            assert!(attr("a.tsx", element).get("forwarded").is_none(), "{why} forwards nothing");
        }
        assert!(attr("b.tsx", 0).get("forwarded").is_none(), "a module's own `memo` forwards nothing");
        assert!(attr("c.tsx", 0).get("forwarded").is_none(), "an unbound `React`'s `memo` forwards nothing");
        assert!(manifest["fileFacts"]["a.tsx"]["usage"][0]["element"]["attrs"][0].get("forwarded").is_none(), "raw usage names no forward");
    }

    /// Contract: `?? undefined` forwards, passing a caller's `null` on as
    /// `undefined`. An Animus lookup reads the two alike: a variant as
    /// `props[prop] ?? default` (packages/system/src/runtime/resolveClasses.ts
    /// `applyVariantClasses` and `applyCompoundClasses`), a state by
    /// truthiness (`applyStateClasses`), a system or custom prop only where
    /// it is `!= null` (`resolveClasses`' slot loop), a forwarded variant's
    /// default filled with `??=` (runtime/index.ts). An ordinary component's
    /// parameter default takes `undefined` and not `null`, so the forward
    /// says the `null` is changed (`nullToUndefined`), a prop a left side
    /// never makes nullish passes on unchanged, and a `??` literal after
    /// the change names no forward.
    #[test]
    fn coalescing_to_undefined_passes_null_on_as_undefined() {
        let mut engine = ExtractEngine::new(None).unwrap();
        let source = "export const Coalesce = ({ size }) => <Box p={size ?? undefined} />;\n\
                      export const Kept = ({ size }) => <Box p={(size ?? 'md') ?? undefined} />;\n\
                      export const Late = ({ size }) => <Box p={(size ?? undefined) ?? 'md'} />;\n";
        let manifest: serde_json::Value = serde_json::from_str(
            &engine.analyze_full(serde_json::json!([{ "path": "a.tsx", "source": source }]).to_string(), None).unwrap(),
        )
        .unwrap();
        let attr = |index: usize| manifest["fileFacts"]["a.tsx"]["proven"][index]["element"]["attrs"][0].clone();
        assert_eq!(attr(0)["forwarded"], serde_json::json!({ "component": "Coalesce", "prop": "size", "nullToUndefined": true }));
        assert_eq!(attr(1)["forwarded"], serde_json::json!({ "component": "Kept", "prop": "size", "nullish": "md" }));
        assert!(attr(2).get("forwarded").is_none(), "a `??` literal after `?? undefined` forwards nothing");
    }

    /// Contract: the manifest says where a runtime value comes from: a prop
    /// passed on unchanged (through body destructuring, as a member of an
    /// object prop, with a boolean default, or `?? literal`, which replaces
    /// a missing or `null` prop), a prop a site computes from, a React
    /// state hook's state slot, and a spread that passes on the props object
    /// or a rest of it.
    #[test]
    fn manifest_proven_says_where_a_value_comes_from() {
        let mut engine = ExtractEngine::new(None).unwrap();
        let source = "import { useState } from 'react';\n\
                      export function Item(props) { const { type, disabled } = props; return <Box tone={type} />; }\n\
                      export function Split({ buttonProps = {} }) { return <Box size={buttonProps.size} />; }\n\
                      export function Card({ interactive = false }) { return <Box interactive={interactive} />; }\n\
                      export function Tree({ variant }) { return <Box tone={variant ?? 'default'} />; }\n\
                      export function Pill({ color }) { return <Box bg={parseThemeColor(color)} />; }\n\
                      export function Rail() { const [mode, setMode] = useState('hover'); return <Box mode={mode} />; }\n\
                      export function Button(props) { return <Box {...props} />; }\n\
                      export function Custom({ normal, ...props }) { return <Box {...props} tone={normal} />; }\n\
                      export function Frame({ borderRadius, interactive = false }) { const radius = borderRadius ?? (interactive ? 'md' : 'none'); return <Box radius={radius} />; }\n\
                      export function Alias({ size }) { const kept = size; return <Box size={kept} />; }\n\
                      export function Opts({ options = {} }) { return <Box value={options} />; }\n";
        let manifest: serde_json::Value = serde_json::from_str(
            &engine.analyze_full(serde_json::json!([{ "path": "a.tsx", "source": source }]).to_string(), None).unwrap(),
        )
        .unwrap();
        let element = |index: usize| manifest["fileFacts"]["a.tsx"]["proven"][index]["element"].clone();
        let attr = |index: usize| element(index)["attrs"][0].clone();
        assert_eq!(attr(0)["forwarded"], serde_json::json!({ "component": "Item", "prop": "type" }));
        assert_eq!(attr(1)["forwarded"], serde_json::json!({ "component": "Split", "prop": "buttonProps", "path": ["size"] }));
        assert_eq!(attr(2)["forwarded"], serde_json::json!({ "component": "Card", "prop": "interactive", "default": false }));
        assert_eq!(attr(3)["forwarded"], serde_json::json!({ "component": "Tree", "prop": "variant", "nullish": "default" }));
        assert_eq!(
            attr(4)["derived"],
            serde_json::json!({ "component": "Pill", "props": ["color"], "through": "parseThemeColor" })
        );
        assert_eq!(attr(5)["runtimeState"]["hook"], "useState");
        assert_eq!(element(6)["spreadForward"], serde_json::json!({ "component": "Button" }));
        assert_eq!(element(7)["spreadForward"], serde_json::json!({ "component": "Custom", "omits": ["normal"] }));
        // A `const` computed from the props, or holding one unchanged.
        assert_eq!(
            attr(8)["derived"],
            serde_json::json!({ "component": "Frame", "props": ["borderRadius", "interactive"], "through": "??" })
        );
        assert_eq!(attr(9)["forwarded"], serde_json::json!({ "component": "Alias", "prop": "size" }));
        // A prop an empty object defaults holds `{}` where a caller leaves
        // it out, so it is computed from the prop, not the prop unchanged.
        assert_eq!(attr(10)["forwarded"], serde_json::Value::Null);
        assert_eq!(attr(10)["derived"]["props"], serde_json::json!(["options"]));
    }

    #[test]
    fn malformed_input_is_a_loud_error() {
        let mut engine = ExtractEngine::new(None).unwrap();
        let err = engine.analyze("not json".to_string(), None).unwrap_err();
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
        // ECMAScript WhiteSpace covers BOM and every Zs code point; U+2028
        // and U+2029 are LineTerminators. OXC sees the directive after all.
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

    /// Contract (with assemble's): an emitted composed-family call carries
    /// a pure annotation; its arguments are slot bindings and literals. A
    /// context family's call never does.
    #[test]
    fn emitted_composed_family_calls_are_pure() {
        let code = transform_source(
            "import { compose } from '@animus-ui/system/compose';\nconst Root = ds.styles({ display: 'flex' }).asElement('div');\nconst Body = ds.styles({ display: 'grid' }).asElement('div');\nexport const Card = compose({ Root, Body }, { name: 'Card' });\nexport const App = () => <Card.Root><Card.Body /></Card.Root>;\n",
        );
        assert!(
            code.contains("export const Card = /* @__PURE__ */ createComposedFamily({ Root: Root, Body: Body }, { name: \"Card\" });"),
            "got {code}"
        );
        assert_eq!(code.matches("@__PURE__").count(), 3, "got {code}");
        // A context family's factory reads Root's variantDefaults, which a
        // user's Root (a Proxy, a getter) can turn into code: never marked.
        let context = transform_source(
            "import { composeWithContext } from '@animus-ui/system/compose-with-context';\nconst Root = ds.styles({ display: 'flex' }).asElement('div');\nconst Body = ds.styles({ display: 'grid' }).asElement('div');\nexport const Card = composeWithContext({ Root, Body }, { name: 'Card', shared: {} });\nexport const App = () => <Card.Root><Card.Body /></Card.Root>;\n",
        );
        assert!(context.contains("export const Card = createComposedFamilyWithContext("), "got {context}");
        assert_eq!(context.matches("@__PURE__").count(), 2, "got {context}");
    }

    #[test]
    fn directive_fact_clears_when_strip_removes_comment_close_and_directive() {
        let source = "/*\nimport { animus } from '@animus-ui/system'; */ 'use client';\nexport const Box = animus.styles({ display: 'flex' }).asElement('div');\nexport const App = () => <Box />;\n";
        let code = transform_source(source);
        assert!(
            code.starts_with(
                "import { createComponent } from '@animus-ui/system';\nimport 'virtual:animus/styles.css';\n/*\nexport const Box = /* @__PURE__ */ createComponent"
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
        let mut a = ExtractEngine::new(None).unwrap();
        let mut b = ExtractEngine::new(None).unwrap();
        a.analyze(r#"[{"path":"a.tsx","source":"export const A = ds.styles({ p: 1 }).asElement('div');\nexport const UseA = () => <A/>;"}]"#.to_string(), None).unwrap();
        b.analyze(r#"[{"path":"b.tsx","source":"export const B = ds.styles({ p: 2 }).asElement('span');"}]"#.to_string(), None).unwrap();
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
                None,
            )
            .unwrap();
        let out = engine.transform_file("fam.tsx".to_string()).unwrap();
        assert!(out.contains("createComposedFamily({ Root: Root }"), "{out}");
        assert!(out.contains(r#"name: \"Card\""#), "{out}");
        assert!(!out.contains("@animus-ui/system/compose'"), "{out}");
        assert!(out.contains("createComposedFamily }"), "{out}");
    }

    #[test]
    fn manifest_lists_each_files_family_member_tags() {
        let mut engine = ExtractEngine::new(None).unwrap();
        let manifest = engine
            .analyze_full(
                serde_json::json!([
                    {
                        "path": "a.tsx",
                        "source": "export const Root = ds.styles({}).asElement('div');\n\
                                   export const Body = ds.styles({}).asElement('div');\n\
                                   export const Card = compose({ Root, Body });\n",
                    },
                    {
                        "path": "app.tsx",
                        "source": "import { Card as Panel } from './a';\n\
                                   export const App = () => <Panel.Body />;\n",
                    },
                    {
                        "path": "ns.tsx",
                        "source": "import * as ui from './a';\n\
                                   export const App = () => <ui.Card.Body />;\n",
                    },
                ])
                .to_string(),
                None,
            )
            .unwrap();
        let manifest: serde_json::Value = serde_json::from_str(&manifest).unwrap();

        assert_eq!(
            manifest["crossFile"]["memberBindings"],
            serde_json::json!({
                "a.tsx": { "Card.Root": "a.tsx::Root", "Card.Body": "a.tsx::Body" },
                "app.tsx": { "Panel.Root": "a.tsx::Root", "Panel.Body": "a.tsx::Body" },
                "ns.tsx": { "ui.Card.Root": "a.tsx::Root", "ui.Card.Body": "a.tsx::Body" },
            })
        );
    }

    #[test]
    fn compose_import_survives_while_an_unrecognised_call_still_uses_it() {
        let source = "import { compose } from '@animus-ui/system';\n\
                      const Root = ds.styles({}).asElement('div');\n\
                      export const Fam = compose({ Root }, { name: 'Card', shared: {} }) as Family;\n\
                      export function makeFamily(Slot) { return compose({ Root: Slot }); }\n\
                      export const App = () => <Fam.Root />;\n";
        let code = transform_source(source);

        assert!(
            code.contains("createComposedFamily({ Root: Root }, { name: \"Card\" }) as Family"),
            "{code}"
        );
        assert!(code.contains("return compose({ Root: Slot })"), "{code}");
        let allocator = oxc::allocator::Allocator::default();
        let parsed =
            oxc::parser::Parser::new(&allocator, &code, oxc::span::SourceType::tsx()).parse();
        assert!(parsed.diagnostics.is_empty(), "{:?}\n{code}", parsed.diagnostics);
        let scoping = oxc::semantic::SemanticBuilder::new()
            .build(&parsed.program)
            .semantic
            .into_scoping();
        assert!(
            !scoping.root_unresolved_references().contains_key("compose"),
            "the remaining compose() call lost its import:\n{code}"
        );
    }

    /// Only references to the imported binding keep the import: a parameter
    /// that shadows it, or a `typeof` type query, does not.
    #[test]
    fn compose_import_goes_when_only_shadows_or_type_queries_remain() {
        for remaining in [
            "export function make(compose) { return compose({ Root }); }",
            "export type Composer = typeof compose;",
        ] {
            let source = format!(
                "import {{ compose }} from '@animus-ui/system';\n\
                 const Root = ds.styles({{}}).asElement('div');\n\
                 export const Fam = compose({{ Root }}, {{ name: 'Card', shared: {{}} }});\n\
                 {remaining}\n\
                 export const App = () => <Fam.Root />;\n"
            );
            let code = transform_source(&source);
            assert!(code.contains("createComposedFamily({ Root: Root }"), "{code}");
            assert!(!code.contains("import { compose }"), "{remaining}: the import stayed:\n{code}");
        }
    }

    /// `compose` and `compose as c` import one export twice; the call through
    /// `c` is no family, so its import must survive the replacement.
    #[test]
    fn compose_import_survives_while_an_aliased_binding_still_calls_it() {
        let source = "import { compose, compose as c } from '@animus-ui/system';\n\
                      const Root = ds.styles({}).asElement('div');\n\
                      export const Fam = compose({ Root }, { name: 'Card', shared: {} });\n\
                      export const Other = c({ Root });\n\
                      export const App = () => <Fam.Root />;\n";
        let code = transform_source(source);

        assert!(code.contains("createComposedFamily({ Root: Root }"), "{code}");
        let allocator = oxc::allocator::Allocator::default();
        let parsed =
            oxc::parser::Parser::new(&allocator, &code, oxc::span::SourceType::tsx()).parse();
        assert!(parsed.diagnostics.is_empty(), "{:?}\n{code}", parsed.diagnostics);
        let scoping = oxc::semantic::SemanticBuilder::new()
            .build(&parsed.program)
            .semantic
            .into_scoping();
        assert!(
            !scoping.root_unresolved_references().contains_key("c"),
            "the call through `c` lost its import:\n{code}"
        );
    }

    /// Another library's `compose`, imported under another name, keeps only
    /// its own import: the Animus `compose` import still goes.
    #[test]
    fn another_librarys_compose_does_not_keep_the_animus_import() {
        let source = "import { compose } from '@animus-ui/system';\n\
                      import { compose as rc } from 'redux';\n\
                      const Root = ds.styles({}).asElement('div');\n\
                      export const Fam = compose({ Root }, { name: 'Card', shared: {} });\n\
                      export const enhance = rc(first, second);\n\
                      export const App = () => <Fam.Root />;\n";
        let code = transform_source(source);

        assert!(code.contains("createComposedFamily({ Root: Root }"), "{code}");
        assert!(!code.contains("import { compose } from '@animus-ui/system'"), "{code}");
        assert!(code.contains("import { compose as rc } from 'redux'"), "{code}");
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

    /// Contract: a generated import never collides with the module's own
    /// bindings. A module that already binds `animusTables` and every runtime
    /// factory gets each under a free alias that the generated calls use, and
    /// the whole transformed module parses.
    #[test]
    fn generated_imports_never_collide_with_module_bindings() {
        let source = "import { compose } from '@animus-ui/system';\n\
            import { composeWithContext } from '@animus-ui/system/compose-with-context';\n\
            const animusTables = 'user';\n\
            const createComponent = 1, createClassResolver = 2;\n\
            const createComposedFamily = 3, createComposedFamilyWithContext = 4;\n\
            export const C = ds.props({ tone: { property: 'color', scale: { x: 'red' } } }).asElement('div');\n\
            export const card = ds.styles({ p: 1 }).asClass();\n\
            const Root = ds.styles({}).asElement('div');\n\
            const Slot = ds.styles({}).asElement('div');\n\
            export const Fam = compose({ Root }, { name: 'Card' });\n\
            export const Ctx = composeWithContext({ Root: Slot }, { name: 'Ctx', shared: {} });\n\
            export const own = [animusTables, createComponent, createClassResolver, createComposedFamily, createComposedFamilyWithContext];\n\
            export const App = ({ v }) => <C tone={v} />;\n";
        let code = transform_source(source);

        assert!(code.contains("animusTables as "), "the tables arrive under an alias: {code}");
        for factory in
            ["createComponent", "createClassResolver", "createComposedFamily", "createComposedFamilyWithContext"]
        {
            let alias = format!("{factory}$1");
            assert!(code.contains(&format!("{factory} as {alias}")), "{factory} arrives under an alias: {code}");
            assert!(code.contains(&format!("{alias}(")), "the generated call uses {alias}: {code}");
        }
        assert_binds_each_name_once(&code);

        // `\u0024` is `$`: the module binds `createComponent$1`, never the
        // plain name, so neither spelling may decide which name is free.
        let escaped = "const createComponent\\u00241 = 'user';\n\
            const createClassResolver\\u{24}1 = 'user';\n\
            export const C = ds.styles({ p: 1 }).asElement('div');\n\
            export const card = ds.styles({ p: 1 }).asClass();\n\
            export const App = () => <C title={createComponent\\u00241 + createClassResolver\\u{24}1} />;\n";
        let code = transform_source(escaped);
        assert!(code.contains("import { createComponent, createClassResolver } from"), "{code}");
        assert_binds_each_name_once(&code);

        // The system-props module's `supersededBy` and each shared list take
        // their names the same way.
        let sized = |prelude: &str| {
            let mut engine = ExtractEngine::new(Some(EngineOptions {
                config_json: Some(
                    r#"{"height":{"property":"height"},"h":{"property":"height"},"rawH":{"property":"height"}}"#.into(),
                ),
                group_registry_json: Some(r#"{"sizes":["height","h","rawH"]}"#.into()),
                ..Default::default()
            }))
            .unwrap();
            let source = format!(
                "{prelude}export const C = ds.system({{ sizes: true }}).asElement('div');\n\
                 export const App = ({{ v }}) => <C height={{v}} h=\"2px\" />;\n"
            );
            engine.analyze(serde_json::json!([{ "path": "directive.tsx", "source": source }]).to_string(), None).unwrap();
            let result: serde_json::Value =
                serde_json::from_str(&engine.transform_file("directive.tsx".to_string()).unwrap()).unwrap();
            result["code"].as_str().unwrap().to_string()
        };
        let plain = sized("");
        let list = plain.split("systemPropNames_").nth(1).and_then(|rest| rest.get(..8)).expect("a shared list").to_string();
        let code = sized(&format!(
            "const supersededBy\\u00241 = 'user';\nconst systemPropNames_{list}\\u00241 = 'user';\n\
             export const own = [supersededBy\\u00241, systemPropNames_{list}\\u00241];\n"
        ));
        assert!(code.contains(&format!("supersededBy, systemPropNames_{list} }}")), "{code}");
        assert!(code.contains(r#""supersededBy":supersededBy"#) && !code.contains("supersededBy$1"), "{code}");
        assert_binds_each_name_once(&code);
    }

    /// Parses `code` as JavaScript, where oxc reports a redeclared binding,
    /// and asserts it parses and its module scope binds each decoded name
    /// once, which an escaped spelling of a generated name would break.
    fn assert_binds_each_name_once(code: &str) {
        let ast = crate::owned_ast::OwnedAst::parse(
            "directive.jsx".into(),
            code.to_string(),
            &crate::owned_ast::ParseCounter::new(0),
        );
        let semantic =
            oxc::semantic::SemanticBuilder::new().with_check_syntax_error(true).build(ast.program());
        let errors: Vec<String> = ast
            .diagnostics
            .iter()
            .cloned()
            .chain(semantic.diagnostics.iter().map(ToString::to_string))
            .collect();
        assert!(errors.is_empty(), "{errors:?}\n{code}");
        let scoping = semantic.semantic.scoping();
        let mut module_names: Vec<&str> = scoping
            .symbol_ids()
            .filter(|symbol| scoping.symbol_scope_id(*symbol) == scoping.root_scope_id())
            .map(|symbol| scoping.symbol_name(symbol))
            .collect();
        module_names.sort_unstable();
        let repeated: Vec<&&str> = module_names.windows(2).filter(|pair| pair[0] == pair[1]).map(|pair| &pair[0]).collect();
        assert!(repeated.is_empty(), "bound twice: {repeated:?}\n{code}");
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
        // The system-props module binds the system's own transforms.
        assert!(!needs.transforms);
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

        assert!(needs_transforms(dynamic_meta(Some("tone"), Some("tone@system.tone"), None)));
        assert!(!needs_transforms(dynamic_meta(Some("tone"), None, None)));
        assert!(!needs_transforms(dynamic_meta(
            None,
            None,
            Some("(value) => value")
        )));
        assert!(!needs_transforms(dynamic_meta(
            Some("ignored-name"),
            None,
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
                None,
            )
            .unwrap();
        let out = engine.transform_file("child.tsx".to_string()).unwrap();
        assert!(out.contains(r#"\"variants\":{\"size\""#), "{out}");
        assert!(out.contains(r#"\"states\":[\"loading\"]"#), "{out}");
    }

    #[test]
    fn relative_asset_specifiers_never_cross_files() {
        // The host resolves an `asset()` specifier without its importer, so a
        // relative one evaluates only in its own file.
        let mut engine = ExtractEngine::new(None).unwrap();
        let out = engine
            .analyze(
                serde_json::json!([
                    { "path": "assets.ts", "source": "import { asset } from '@animus-ui/system';\nexport const relative = `url(\"${asset('./hero.svg')}\")`;\nexport const bare = `url(\"${asset('@kit/hero.svg')}\")`;\n" },
                    { "path": "a.tsx", "source": "import { asset } from '@animus-ui/system';\nimport { relative, bare } from './assets';\nexport const Own = ds.styles({ backgroundImage: `url(\"${asset('./own.svg')}\")` }).asElement('div');\nexport const Relative = ds.styles({ backgroundImage: relative }).asElement('div');\nexport const Bare = ds.styles({ backgroundImage: bare }).asElement('div');\nexport const App = () => <><Own /><Relative /><Bare /></>;\n" }
                ])
                .to_string(),
                None,
            )
            .unwrap();
        let manifest: serde_json::Value = serde_json::from_str(&out).unwrap();
        let css = manifest["css"].as_str().unwrap();
        assert!(css.contains("animus-asset:./own.svg"), "{css}");
        assert!(css.contains("animus-asset:@kit/hero.svg"), "{css}");
        assert!(!css.contains("animus-asset:./hero.svg"), "{css}");
    }

    #[test]
    fn imported_static_resolves_cross_file() {
        let mut engine = ExtractEngine::new(None).unwrap();
        let out = engine
            .analyze_full(
                r#"[{"path":"tokens.ts","source":"export const pad = { p: 4 };\n"},
                    {"path":"a.tsx","source":"import { pad } from './tokens';\nexport const C = ds.styles(pad).asElement('div');\nexport const App = () => <C />;\n"}]"#
                    .to_string(),
                None,
            )
            .unwrap();
        assert!(
            out.contains(r#""p":4"#) || out.contains(r#""p":4"#),
            "{out}"
        );
    }

    /// Contract: a possibly-mutated static never yields its pre-mutation
    /// value as static CSS. Each row writes `pad.padding = 9` before the
    /// reader runs, as Node runs the modules; the reader's style is refused
    /// rather than emitting `padding: 4`.
    #[test]
    fn a_possibly_mutated_static_never_yields_its_pre_mutation_value_as_static_css() {
        // The mutating module imports `pad` itself, except where code from a
        // string loads it.
        macro_rules! import_pad {
            () => {
                "import { pad } from './tokens.js';\n"
            };
        }
        let rows = [
            // A concise arrow returns what it evaluates (PF2).
            ("sync return", concat!(import_pad!(), "const get = () => pad; get().padding = 9;"), "{ ...pad }"),
            ("async return", concat!(import_pad!(), "const get = async () => pad; (await get()).padding = 9;"), "{ ...pad }"),
            ("then callback return", concat!(import_pad!(), "await Promise.resolve(0).then(() => pad).then((p) => { p.padding = 9; });"), "{ ...pad }"),
            // A read by name or by one member takes no held value (PF1).
            ("held by name", concat!(import_pad!(), "pad.padding = 9;"), "pad"),
            ("held one member", concat!(import_pad!(), "pad.padding = 9;"), "{ padding: pad.padding }"),
            ("direct eval, by name", concat!(import_pad!(), "eval('pad.padding = 9');"), "pad"),
            // A package outside the analysis may re-export `pad` (a linked
            // workspace package): a write or hand-off through its namespace
            // may change it.
            ("package namespace, member written", "import * as ui from '@local/proxy';\nui.pad.padding = 9;", "{ ...pad }"),
            ("package namespace, handed on", "import * as ui from '@local/proxy';\nregister(ui);", "{ ...pad }"),
            // A template literal with no substitution is a literal specifier.
            ("package import(), template literal", "await import(`@local/proxy`).then((m) => { m.pad.padding = 9; });", "{ ...pad }"),
            ("package require(), template literal", "require(`@local/proxy`).pad.padding = 9;", "{ ...pad }"),
            // A path the analysis cannot find may be a module at run time.
            ("missing module import()", "await import('./generated.js').then((m) => { m.pad.padding = 9; });", "{ ...pad }"),
            ("missing module side-effect import", "import './generated.js';", "{ ...pad }"),
            ("missing module imported by absolute path", "import '/workspace/generated.js';", "{ ...pad }"),
            // A computed load hands on every module it may load.
            (
                "template import() that may load the module",
                "const name = 'tokens';\nawait import(`./${name}.js`).then((m) => { m.pad.padding = 9; });",
                "{ ...pad }",
            ),
            (
                "wrapped require of a computed specifier",
                "const name = './tokens.js';\n(require)(name).pad.padding = 9;",
                "{ ...pad }",
            ),
            (
                "optional wrapped require of a computed specifier",
                "const name = './tokens.js';\nconst loaded = (require)?.(name);\nloaded.pad.padding = 9;",
                "{ ...pad }",
            ),
            (
                "eager glob that loads the module",
                "const modules = import.meta.glob('./*.js', { eager: true });\nmodules['./tokens.js'].pad.padding = 9;",
                "{ ...pad }",
            ),
            // A loader read anywhere but as a direct callee can load any
            // module under a name the analysis never sees.
            ("sequence-wrapped require", "const name = './tokens.js';\n(0, require)(name).pad.padding = 9;", "{ ...pad }"),
            ("an alias of require", "const name = './tokens.js';\nconst r = require;\nr(name).pad.padding = 9;", "{ ...pad }"),
            ("require.call", "const name = './tokens.js';\nrequire.call(null, name).pad.padding = 9;", "{ ...pad }"),
            ("require.apply", "const name = './tokens.js';\nrequire.apply(null, [name]).pad.padding = 9;", "{ ...pad }"),
            ("require.bind", "const name = './tokens.js';\nrequire.bind(null)(name).pad.padding = 9;", "{ ...pad }"),
            ("the global object's require", "const name = './tokens.js';\nglobalThis.require(name).pad.padding = 9;", "{ ...pad }"),
            ("module.require", "const name = './tokens.js';\nmodule.require(name).pad.padding = 9;", "{ ...pad }"),
            ("an alias of module", "const name = './tokens.js';\nconst m = module;\nm.require(name).pad.padding = 9;", "{ ...pad }"),
            (
                "require destructured from module",
                "const name = './tokens.js';\nconst { require: r } = module;\nr.call(module, name).pad.padding = 9;",
                "{ ...pad }",
            ),
            ("a computed member of module", "const name = './tokens.js';\nconst k = 'require';\nmodule[k](name).pad.padding = 9;", "{ ...pad }"),
            (
                "a computed member of the builtin imported by a template",
                "const name = './tokens.js';\nconst m = await import(`node:module`), k = 'createRequire';\nm[k](__filename)(name).pad.padding = 9;",
                "{ ...pad }",
            ),
            (
                "a computed member of the builtin required by a template",
                "const name = './tokens.js';\nconst m = require(`node:module`), k = 'createRequire';\nm[k](__filename)(name).pad.padding = 9;",
                "{ ...pad }",
            ),
            (
                "a computed member of the builtin required with an extra argument",
                "const name = './tokens.js';\nconst m = require('node:module', null), k = 'createRequire';\nm[k](__filename)(name).pad.padding = 9;",
                "{ ...pad }",
            ),
            (
                "a computed member of the required builtin",
                "const name = './tokens.js';\nconst m = require('node:module'), k = 'createRequire';\nm[k](__filename)(name).pad.padding = 9;",
                "{ ...pad }",
            ),
            (
                "a createRequire result",
                "import { createRequire } from 'node:module';\nconst name = './tokens.js';\ncreateRequire(import.meta.url)(name).pad.padding = 9;",
                "{ ...pad }",
            ),
            (
                "a held createRequire result",
                "import { createRequire } from 'node:module';\nconst name = './tokens.js';\nconst load = createRequire(import.meta.url);\nload(name).pad.padding = 9;",
                "{ ...pad }",
            ),
            // Code from a string can load and change any module (PF3).
            (
                "eval loads the module",
                "await eval(\"import('./tokens.js')\").then((m) => { m.pad.padding = 9; });",
                "{ ...pad }",
            ),
            (
                "indirect eval loads the module",
                "await (0, eval)(\"import('./tokens.js')\").then((m) => { m.pad.padding = 9; });",
                "{ ...pad }",
            ),
            (
                "a function from a string loads the module",
                "await new Function(\"return import('./tokens.js')\")().then((m) => { m.pad.padding = 9; });",
                "{ ...pad }",
            ),
            (
                "the global object's eval loads the module",
                "await globalThis.eval(\"import('./tokens.js')\").then((m) => { m.pad.padding = 9; });",
                "{ ...pad }",
            ),
            (
                "Reflect constructs a function that loads the module",
                "await Reflect.construct(Function, [\"return import('./tokens.js')\"])().then((m) => { m.pad.padding = 9; });",
                "{ ...pad }",
            ),
            (
                "an alias of Function loads the module",
                "const Make = Function;\nawait Make(\"return import('./tokens.js')\")().then((m) => { m.pad.padding = 9; });",
                "{ ...pad }",
            ),
            // A timer runs a string however the code names it.
            (
                "a computed timer member loads the module",
                "window['setTimeout'](\"import('./tokens.js').then((m) => { m.pad.padding = 9; })\", 0);",
                "{ ...pad }",
            ),
            (
                "top's timer loads the module",
                "top.setTimeout(\"import('./tokens.js').then((m) => { m.pad.padding = 9; })\", 0);",
                "{ ...pad }",
            ),
            (
                "a timer off a chain of the global object's names loads the module",
                "window.self.setTimeout(\"import('./tokens.js').then((m) => { m.pad.padding = 9; })\", 0);",
                "{ ...pad }",
            ),
            (
                "a Promise replaced through a parameter hands its timer a string",
                "function replace(target) { target['Prom' + 'ise'] = class { constructor(run) { run(\"import('./tokens.js').then((m) => { m.pad.padding = 9; })\"); } }; }\nreplace(window);\nnew Promise((cb) => setTimeout(cb, 0));",
                "{ ...pad }",
            ),
            // `typeof` and `instanceof` run what their member's object runs.
            (
                "a typeof operand's object loads the module",
                "typeof (await eval(\"import('./tokens.js')\").then((m) => { m.pad.padding = 9; return m; })).Function;",
                "{ ...pad }",
            ),
            (
                "an instanceof right side's object loads the module",
                "try { ({}) instanceof (await eval(\"import('./tokens.js')\").then((m) => { m.pad.padding = 9; return m; })).Function; } catch {}",
                "{ ...pad }",
            ),
        ];
        // An ambient declaration binds no loader.
        let ambient = [
            (
                "an ambient require",
                "declare const require: any;\nconst name = './tokens.js';\nconst r = require;\nr(name).pad.padding = 9;",
                "{ ...pad }",
            ),
            (
                "an ambient module",
                "declare const module: any;\nconst name = './tokens.js';\nmodule.require(name).pad.padding = 9;",
                "{ ...pad }",
            ),
        ];
        let rows = (rows.map(|(row, mutation, read)| (row, "mutate.js", mutation, read)).into_iter())
            .chain(ambient.map(|(row, mutation, read)| (row, "mutate.cts", mutation, read)));
        for (row, path, mutation, read) in rows {
            let mut engine = ExtractEngine::new(None).unwrap();
            let files = serde_json::json!([
                { "path": "tokens.js", "source": "export const pad = { padding: 4 };\n" },
                { "path": path, "source": format!("{mutation}\n") },
                {
                    "path": "reader.tsx",
                    "source": format!(
                        "import './{path}';\nimport {{ pad }} from './tokens.js';\n\
                         export const C = ds.styles({read}).asElement('div');\nexport const App = () => <C />;\n"
                    ),
                },
            ]);
            let out: serde_json::Value = serde_json::from_str(&engine.analyze_full(files.to_string(), None).unwrap()).unwrap();
            assert!(!out["css"].as_str().unwrap_or_default().contains("padding"), "{row}: {}", out["css"]);
        }
        // A read of the global object the code only inspects replaces
        // nothing, so the timer its executor proves stays proven.
        let mut engine = ExtractEngine::new(None).unwrap();
        let files = serde_json::json!([
            { "path": "tokens.js", "source": "export const pad = { padding: 4 };\n" },
            {
                "path": "inspect.js",
                "source": "export const has = (name) => typeof window[name] !== 'undefined';\nexport const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));\n",
            },
            {
                "path": "reader.tsx",
                "source": "import './inspect.js';\nimport { pad } from './tokens.js';\nexport const C = ds.styles({ ...pad }).asElement('div');\nexport const App = () => <C />;\n",
            },
        ]);
        let out: serde_json::Value = serde_json::from_str(&engine.analyze_full(files.to_string(), None).unwrap()).unwrap();
        assert!(out["css"].as_str().unwrap_or_default().contains("padding"), "an inspected global read: {}", out["css"]);
        // A concise arrow returns the member it evaluates too: a write
        // through the call's result changes it.
        let member_returns = [
            ("member returned by a called arrow", "const get = () => pad.inner;\nget().padding = 9;\n"),
            ("member returned by a then callback", "Promise.resolve().then(() => pad.inner).then((o) => { o.padding = 9; });\n"),
        ];
        for (row, mutation) in member_returns {
            let mut engine = ExtractEngine::new(None).unwrap();
            let files = serde_json::json!([
                { "path": "tokens.js", "source": "export const pad = { inner: { padding: 4 } };\n" },
                { "path": "mutate.js", "source": format!("import {{ pad }} from './tokens.js';\n{mutation}") },
                {
                    "path": "reader.tsx",
                    "source": "import './mutate.js';\nimport { pad } from './tokens.js';\n\
                               export const C = ds.styles({ ...pad.inner }).asElement('div');\nexport const App = () => <C />;\n",
                },
            ]);
            let out: serde_json::Value = serde_json::from_str(&engine.analyze_full(files.to_string(), None).unwrap()).unwrap();
            assert!(!out["css"].as_str().unwrap_or_default().contains("padding"), "{row}: {}", out["css"]);
        }
        // A hot update's data can hold a loader its disposed version stored:
        // the replacement changes `pad` through it, then loads the reader,
        // which the bundle keeps reachable through an unused load.
        let mut engine = ExtractEngine::new(None).unwrap();
        let files = serde_json::json!([
            { "path": "tokens.js", "source": "export const pad = { padding: 4 };\n" },
            { "path": "entry.js", "source": "export const later = () => require('./reader.js');\n" },
            {
                "path": "replacement.js",
                "source": "module.hot.data.load('./tokens.js').pad.padding = 9;\nrequire('./reader.js');\n",
            },
            {
                "path": "reader.js",
                "source": "import { pad } from './tokens.js';\nexport const C = ds.styles({ ...pad }).asElement('div');\n\
                           export const App = () => <C />;\n",
            },
        ]);
        let out: serde_json::Value = serde_json::from_str(&engine.analyze_full(files.to_string(), None).unwrap()).unwrap();
        assert!(!out["css"].as_str().unwrap_or_default().contains("padding"), "a loader held in hot data: {}", out["css"]);
        // `export default pad` holds `pad`'s object, so a write through the
        // default reaches it: by default import, a re-export by name, a star
        // past that, the namespace's `default`, a hand-off, or a further
        // module's `export default` of the imported `pad`. A read through the
        // default changes nothing.
        // Each row: its name, the route's modules, and whether `pad` still
        // extracts.
        type Row<'r> = (&'r str, &'r [(&'r str, &'r str)], bool);
        let default_rows: [Row<'_>; 7] = [
            ("default import written", &[("mutate.js", "import d from './tokens.js';\nd.padding = 9;\n")], false),
            (
                "default re-exported by name, written",
                &[
                    ("named.js", "export { default as p } from './tokens.js';\n"),
                    ("mutate.js", "import { p } from './named.js';\np.padding = 9;\n"),
                ],
                false,
            ),
            (
                "default re-exported by name behind a star, written",
                &[
                    ("named.js", "export { default as p } from './tokens.js';\n"),
                    ("barrel.js", "export * from './named.js';\n"),
                    ("mutate.js", "import { p } from './barrel.js';\np.padding = 9;\n"),
                ],
                false,
            ),
            ("the namespace's default written", &[("mutate.js", "import * as ns from './tokens.js';\nns.default.padding = 9;\n")], false),
            ("default handed on", &[("mutate.js", "import d from './tokens.js';\nregister(d);\n")], false),
            (
                "an imported default re-exported by default, written",
                &[
                    ("defaults.js", "import { pad } from './tokens.js';\nexport default pad;\n"),
                    ("mutate.js", "import d from './defaults.js';\nd.padding = 9;\n"),
                ],
                false,
            ),
            ("default only read", &[("mutate.js", "import d from './tokens.js';\nexport const read = () => d.padding;\n")], true),
        ];
        for (row, route, extracts) in default_rows {
            let mut files = vec![
                serde_json::json!({ "path": "tokens.js", "source": "const pad = { padding: 4 };\nexport { pad };\nexport default pad;\n" }),
                serde_json::json!({
                    "path": "reader.tsx",
                    "source": "import './mutate.js';\nimport { pad } from './tokens.js';\n\
                               export const C = ds.styles({ ...pad }).asElement('div');\nexport const App = () => <C />;\n",
                }),
            ];
            files.extend(route.iter().map(|(path, source)| serde_json::json!({ "path": path, "source": source })));
            let mut engine = ExtractEngine::new(None).unwrap();
            let out: serde_json::Value =
                serde_json::from_str(&engine.analyze_full(serde_json::Value::Array(files).to_string(), None).unwrap()).unwrap();
            assert_eq!(out["css"].as_str().unwrap_or_default().contains("padding"), extracts, "{row}: {}", out["css"]);
        }
        // An extension of a parent refused for a possibly-mutated static is
        // refused with it, named, never shipped without what it inherits;
        // with nothing mutated, it inherits the parent's styles.
        let kit = "import { pad } from './tokens';\n\
                   export const Parent = ds.styles({ ...pad, display: 'flex', cursor: 'pointer' }).asElement('button');\n\
                   export const Child = Parent.extend().styles({ color: 'red' }).asElement('button');\n";
        for mutated in [true, false] {
            let mut engine = ExtractEngine::new(None).unwrap();
            let mut files = vec![
                serde_json::json!({ "path": "tokens.ts", "source": "export const pad = { padding: 4 };\n" }),
                serde_json::json!({ "path": "kit.tsx", "source": kit }),
                serde_json::json!({
                    "path": "app.tsx",
                    "source": "import { Parent, Child } from './kit';\nexport const App = () => <><Parent /><Child /></>;\n",
                }),
            ];
            if mutated {
                files.push(serde_json::json!({ "path": "mutate.ts", "source": "import { pad } from './tokens';\npad.padding = 9;\n" }));
            }
            let files = serde_json::Value::Array(files);
            let out: serde_json::Value = serde_json::from_str(&engine.analyze_full(files.to_string(), None).unwrap()).unwrap();
            let child = out["component_fragments"]["kit.tsx::Child"]["base"].as_str().unwrap_or_default();
            let named = out["diagnostics"].as_array().unwrap().iter().any(|d| {
                d["component"] == "Child" && d["code"] == "animus.extension.unresolved-parent"
            });
            if mutated {
                assert!(child.is_empty() && named, "{child}: {}", out["diagnostics"]);
            } else {
                assert!(["padding", "display: flex", "cursor: pointer", "color: red"].iter().all(|d| child.contains(d)), "{child}");
            }
        }
        // A parent that skips one property for a possibly-mutated static
        // still extracts the rest, and so does its extension, which reports
        // the property it inherits skipped.
        let mut engine = ExtractEngine::new(None).unwrap();
        let files = serde_json::json!([
            { "path": "tokens.ts", "source": "export const pad = { padding: 4 };\n" },
            { "path": "mutate.ts", "source": "import { pad } from './tokens';\npad.padding = 9;\n" },
            {
                "path": "kit.tsx",
                "source": "import { pad } from './tokens';\n\
                           export const Parent = ds.styles({ padding: pad.padding, display: 'flex' }).asElement('button');\n\
                           export const Child = Parent.extend().styles({ color: 'red' }).asElement('button');\n",
            },
            { "path": "app.tsx", "source": "import { Parent, Child } from './kit';\nexport const App = () => <><Parent /><Child /></>;\n" },
        ]);
        let out: serde_json::Value = serde_json::from_str(&engine.analyze_full(files.to_string(), None).unwrap()).unwrap();
        let child = out["component_fragments"]["kit.tsx::Child"]["base"].as_str().unwrap_or_default();
        let skips: Vec<(&str, &str)> = out["diagnostics"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|d| d["code"] == "animus.chain.skipped-value")
            .map(|d| (d["component"].as_str().unwrap_or_default(), d["dropped"].as_str().unwrap_or_default()))
            .collect();
        assert!(child.contains("display: flex") && child.contains("color: red") && !child.contains("padding"), "{child}");
        assert!(skips.contains(&("Child", "padding")), "{skips:?}: {}", out["diagnostics"]);
        // An unrelated extension cycle sets only its own members aside: an
        // extension whose id sorts before its parent's still follows it.
        let mut engine = ExtractEngine::new(None).unwrap();
        let files = serde_json::json!([
            {
                "path": "cycle.tsx",
                "source": "export const A = B.extend().styles({ margin: 1 }).asElement('div');\n\
                           export const B = A.extend().styles({ margin: 2 }).asElement('div');\n",
            },
            { "path": "z.tsx", "source": "export const Parent = ds.styles({ display: 'flex' }).asElement('button');\n" },
            {
                "path": "b.tsx",
                "source": "import { Parent } from './z';\nexport const Child = Parent.extend().styles({ color: 'red' }).asElement('button');\n",
            },
            { "path": "app.tsx", "source": "import { Child } from './b';\nexport const App = () => <Child />;\n" },
        ]);
        let out: serde_json::Value = serde_json::from_str(&engine.analyze_full(files.to_string(), None).unwrap()).unwrap();
        let child = out["component_fragments"]["b.tsx::Child"]["base"].as_str().unwrap_or_default();
        assert!(child.contains("display: flex") && child.contains("color: red"), "{child}: {}", out["diagnostics"]);
        // A type query of eval, or a schema builder's own `Function` member
        // (TypeBox's `Type.Function`), runs nothing, a type query of a
        // function's `arguments` reads none of them, and a direct `require`
        // of a literal path, or `typeof require`, loads only that path or
        // nothing: the static still extracts.
        for (row, module) in [
            ("type query", "export type Evaluate = typeof eval;\n"),
            ("a direct require of another module", "require('./typebox');\n"),
            ("typeof require", "export const loads = typeof require === 'function';\n"),
            ("module.exports", "module.exports = { loaded: module.loaded };\n"),
            (
                "a type query of arguments in a read-only callee",
                "import { pad } from './tokens';\nfunction read(o) { type Args = typeof arguments; return o.padding; }\nread(pad);\n",
            ),
            (
                "a namespace's Function member",
                "import * as Type from './typebox';\nexport const schema = Type.Function([], Type.String());\n",
            ),
        ] {
            let mut engine = ExtractEngine::new(None).unwrap();
            let files = serde_json::json!([
                { "path": "tokens.ts", "source": "export const pad = { padding: 4 };\n" },
                {
                    "path": "typebox.ts",
                    "source": "export function Function(parameters: unknown[], returns: unknown) { return { parameters, returns }; }\n\
                               export function String() { return { type: 'string' }; }\n",
                },
                { "path": "other.ts", "source": module },
                {
                    "path": "reader.tsx",
                    "source": "import './other';\nimport { pad } from './tokens';\n\
                               export const C = ds.styles({ ...pad }).asElement('div');\nexport const App = () => <C />;\n",
                },
            ]);
            let out: serde_json::Value = serde_json::from_str(&engine.analyze_full(files.to_string(), None).unwrap()).unwrap();
            assert!(out["css"].as_str().unwrap_or_default().contains("padding"), "{row}: {}", out["css"]);
        }
    }

    /// What an analysis emits, by the channel that carries it (spec §6.4
    /// F6): static components, their declarations by section, system-prop
    /// utilities and dynamic slots, each only where the stylesheet carries
    /// it; what it reports losing, whole chains apart from single
    /// properties; what it prunes; and the imports each transform removes
    /// from its file.
    #[derive(Debug, Default)]
    struct Emission {
        components: std::collections::BTreeSet<String>,
        declarations: BTreeMap<(String, String, String, String), String>,
        utilities: std::collections::BTreeSet<(String, String)>,
        dynamic_slots: std::collections::BTreeSet<String>,
        lost_chains: std::collections::BTreeSet<(String, String)>,
        lost_properties: std::collections::BTreeSet<(String, String, String)>,
        pruned: std::collections::BTreeSet<(String, String, String)>,
        removed_imports: std::collections::BTreeSet<(String, String)>,
        openings: std::collections::BTreeSet<(&'static str, crate::flow::ReasonId, String)>,
    }

    fn emission(files: &[(String, String)]) -> Emission {
        let mut engine = ExtractEngine::new(Some(EngineOptions {
            config_json: Some(r#"{"p":{"property":"padding","scale":"space"},"m":{"property":"margin","scale":"space"}}"#.to_string()),
            group_registry_json: Some(r#"{"space":["p","m"]}"#.to_string()),
            theme_json: Some(r#"{"space.4":"0.25rem","space.8":"0.5rem"}"#.to_string()),
            ..Default::default()
        }))
        .unwrap();
        let entries: Vec<serde_json::Value> =
            files.iter().map(|(path, source)| serde_json::json!({ "path": path, "source": source })).collect();
        let manifest: serde_json::Value =
            serde_json::from_str(&engine.analyze_full(serde_json::Value::Array(entries).to_string(), None).unwrap()).unwrap();
        let mut out = Emission::default();
        // What the stylesheets deliver: the CSS and every sheet.
        let mut stylesheet = manifest["css"].as_str().unwrap_or_default().to_string();
        for sheet in manifest["sheets"].as_object().into_iter().flatten().filter_map(|(_, sheet)| sheet.as_str()) {
            stylesheet.push_str(sheet);
        }
        let keys = |value: &serde_json::Value| value.as_object().map(|map| map.keys().cloned().collect::<Vec<_>>()).unwrap_or_default();
        out.components.extend(keys(&manifest["components"]));
        for (id, fragments) in manifest["component_fragments"].as_object().into_iter().flatten() {
            for (section, css) in fragments.as_object().into_iter().flatten() {
                let mut selector = String::new();
                for line in css.as_str().unwrap_or_default().lines().map(str::trim) {
                    if let Some(open) = line.strip_suffix('{') {
                        selector = open.trim().to_string();
                    } else if let Some((property, value)) = line.strip_suffix(';').and_then(|line| line.split_once(": ")) {
                        if stylesheet.contains(&selector) {
                            let key = (id.clone(), section.clone(), selector.clone(), property.to_string());
                            out.declarations.insert(key, value.to_string());
                        }
                    }
                }
            }
        }
        for (prop, values) in manifest["system_prop_map"].as_object().into_iter().flatten() {
            for (value, class) in values.as_object().into_iter().flatten() {
                if class.as_str().is_some_and(|class| stylesheet.contains(&format!(".{class}"))) {
                    out.utilities.insert((prop.clone(), value.clone()));
                }
            }
        }
        for (prop, slot) in manifest["dynamic_props"].as_object().into_iter().flatten() {
            if slot["slotClass"].as_str().is_some_and(|class| stylesheet.contains(&format!(".{class}"))) {
                out.dynamic_slots.insert(prop.clone());
            }
        }
        let whole = ["animus.chain.unextractable", "animus.chain.stage-evaluation-failed", "animus.extension.unresolved-parent"];
        for diagnostic in manifest["diagnostics"].as_array().into_iter().flatten() {
            let field = |key: &str| diagnostic[key].as_str().unwrap_or_default().to_string();
            let code = diagnostic["code"].as_str().unwrap_or_default();
            if whole.contains(&code) {
                out.lost_chains.insert((field("file"), field("component")));
            } else if code == "animus.chain.skipped-value" {
                // A skip names the key it dropped: `property 'padding'`.
                let message = field("message");
                if let Some(key) = message.split("property '").nth(1).and_then(|rest| rest.split('\'').next()) {
                    out.lost_properties.insert((field("file"), field("component"), key.to_string()));
                }
            }
        }
        for pruned in manifest["report"]["eliminated_details"].as_array().into_iter().flatten() {
            let field = |key: &str| pruned[key].as_str().unwrap_or_default().to_string();
            out.pruned.insert((field("component"), field("kind"), field("name")));
        }
        // The module each import line names, by its last quoted string.
        let specifiers = |code: &str| -> std::collections::BTreeSet<String> {
            code.lines()
                .filter(|line| line.trim_start().starts_with("import "))
                .filter_map(|line| line.rsplit(['\'', '"']).nth(1).map(str::to_string))
                .collect()
        };
        for (path, source) in files {
            let transformed: serde_json::Value = serde_json::from_str(&engine.transform_file(path.clone()).unwrap()).unwrap();
            let kept = specifiers(transformed["code"].as_str().unwrap_or(source));
            let removed = specifiers(source).into_iter().filter(|specifier| !kept.contains(specifier));
            out.removed_imports.extend(removed.map(|specifier| (path.clone(), specifier)));
        }
        out.openings = super::OPENINGS.with(|openings| openings.borrow().clone());
        out
    }

    /// Each way `head` emits less than `base` without reporting it.
    fn shrinkage(base: &Emission, head: &Emission) -> Vec<String> {
        let mut found = Vec::new();
        // A component id is `file::binding`; a whole-chain loss names its
        // file and binding.
        let split = |id: &str| id.rsplit_once("::").map(|(file, binding)| (file.to_string(), binding.to_string()));
        let chain_lost = |id: &str| split(id).is_some_and(|key| head.lost_chains.contains(&key));
        // A skip of a key covers its declaration (`fontSize` as
        // `font-size`), or its whole section (`variants`).
        let property_lost = |id: &str, section: &str, property: &str| {
            split(id).is_some_and(|(file, binding)| {
                head.lost_properties.iter().any(|(lost_file, lost_binding, key)| {
                    let kebab: String = key
                        .rsplit('.')
                        .next()
                        .unwrap_or(key)
                        .chars()
                        .flat_map(|c| if c.is_ascii_uppercase() { vec!['-', c.to_ascii_lowercase()] } else { vec![c] })
                        .collect();
                    *lost_file == file && *lost_binding == binding && (kebab == property || key == section)
                })
            })
        };
        found.extend(head.pruned.difference(&base.pruned).map(|pruned| format!("newly pruned {pruned:?}")));
        found.extend(
            base.components
                .iter()
                .filter(|id| !head.components.contains(*id) && !chain_lost(id))
                .map(|id| format!("component {id} lost unreported")),
        );
        for (key @ (id, section, selector, property), value) in &base.declarations {
            match head.declarations.get(key) {
                Some(now) if now != value => found.push(format!("{id} {selector} {property} changed from {value} to {now}")),
                None if !chain_lost(id) && !property_lost(id, section, property) => {
                    found.push(format!("{id} {selector} {property} lost unreported"))
                }
                _ => {}
            }
        }
        found.extend(
            base.utilities
                .iter()
                .filter(|(prop, value)| !head.utilities.contains(&(prop.clone(), value.clone())) && !head.dynamic_slots.contains(prop))
                .map(|utility| format!("utility {utility:?} lost with no dynamic slot")),
        );
        found.extend(base.dynamic_slots.difference(&head.dynamic_slots).map(|prop| format!("dynamic slot {prop} lost")));
        found.extend(head.components.difference(&base.components).map(|id| format!("component {id} newly static")));
        found.extend(
            head.removed_imports.difference(&base.removed_imports).map(|import| format!("import {import:?} newly removed")),
        );
        found.extend(base.openings.difference(&head.openings).map(|opening| format!("opening {opening:?} lost")));
        found
    }

    /// Contract (spec §6.4 F6, §6.9 FL-11): adding opacity never shrinks
    /// emission. One opaque module added to an analysis (code run from a
    /// string, a computed load, a hand-on of any module's namespace, a load
    /// of a module the analysis cannot find) may turn what it emitted into
    /// a reported loss, but never prunes more, drops a style or a component
    /// without a finding naming it, changes a static value, makes a
    /// component static, removes an import, or loses an opening from the
    /// style statics' or the member tables' relation of what may change
    /// (check 6, by relation, kind and site).
    #[test]
    fn adding_opacity_never_shrinks_emission() {
        let file = |path: &str, source: &str| (path.to_string(), source.to_string());
        let project = vec![
            file(
                "kit.tsx",
                "export const Box = ds.system({ space: true }).asElement('div');\n\
                 export const Base = ds.styles({ padding: 4 })\n\
                   .variant({ prop: 'size', defaultVariant: 'sm', variants: { sm: { margin: 1 }, lg: { margin: 9 } } })\n\
                   .states({ busy: { opacity: 0.5 } })\n\
                   .asElement('div');\n",
            ),
            file("tokens.ts", "export const pad = { padding: 2 };\n"),
            file(
                "held.tsx",
                "import { pad } from './tokens';\nexport const Held = ds.styles({ ...pad }).asElement('span');\n\
                 export const HeldChild = Held.extend().styles({ color: 'red' }).asElement('span');\n",
            ),
            file("fam.tsx", "import { Box } from './kit';\nexport const Fam = { Box };\n"),
            file("skip.tsx", "export const Skip = ds.styles({ color: globalThis.tone, padding: 3 }).asElement('p');\n"),
            file(
                "card.tsx",
                "import { compose } from '@animus-ui/system/compose';\nimport { pad } from './tokens';\n\
                 const Root = ds.styles({ ...pad }).asElement('div');\n\
                 export const Card = compose({ Root }, { name: 'Card', shared: {} });\n",
            ),
            // An opening of a module no style reads, for check 6 to keep.
            file("misc.ts", "export const other = { a: 1 };\n"),
            file("hand.ts", "import * as misc from './misc';\nglobalThis.keep?.(misc);\n"),
            file(
                "app.tsx",
                "import { Base, Box } from './kit';\nimport { Held, HeldChild } from './held';\nimport { Fam } from './fam';\n\
                 import { Skip } from './skip';\nimport { Card } from './card';\n\
                 export const App = () => <><Base size='sm' /><Box p={8} /><Box p={globalThis.gap} /><Fam.Box m={4} /><Held /><HeldChild /><Skip /><Card.Root /></>;\n",
            ),
        ];
        let modules: Vec<&str> = project.iter().map(|(path, _)| path.trim_end_matches(".tsx").trim_end_matches(".ts")).collect();
        let mut injections = vec![
            "globalThis.run?.(eval);\n".to_string(),
            "import(globalThis.name);\n".to_string(),
            "import './not-there.js';\n".to_string(),
        ];
        injections.extend(modules.iter().map(|module| format!("import * as ns from './{module}';\nglobalThis.keep?.(ns);\n")));
        let base = emission(&project);
        let channels = [
            base.components.len(),
            base.declarations.len(),
            base.utilities.len(),
            base.dynamic_slots.len(),
            base.pruned.len(),
            base.lost_properties.len(),
        ];
        // Each relation has an opening to keep, compared within that relation.
        let opens = |relation| base.openings.iter().any(|(of, ..)| *of == relation);
        assert!(
            channels.iter().all(|count| *count > 0)
                && !base.removed_imports.is_empty()
                && opens("style statics")
                && opens("member tables"),
            "{base:?}"
        );
        for injected in injections {
            let mut files = project.clone();
            files.push(file("opaque.ts", &injected));
            let shrunk = shrinkage(&base, &emission(&files));
            assert!(shrunk.is_empty(), "{injected}{shrunk:#?}");
        }
    }

    #[test]
    fn external_package_keyframes_collection_resolves_via_named_import() {
        let mut engine = ExtractEngine::new(Some(EngineOptions {
            keyframes_json: Some(
                r#"{"kitMotion":{"pulse":{"name":"animus-kf-abc123","frames":{"from":{"opacity":0.4},"to":{"opacity":1}}}}}"#
                    .to_string(),
            ),
            package_resolution_json: Some(r#"{"@kit/ds":"kit/index.ts"}"#.to_string()),
            ..Default::default()
        }))
        .unwrap();
        let manifest: serde_json::Value = serde_json::from_str(
            &engine
                .analyze(
                    serde_json::json!([
                        { "path": "kit/index.ts", "source": "export const kitMotion = createKeyframes({ pulse: { from: { opacity: 0.4 }, to: { opacity: 1 } } });\n" },
                        { "path": "a.tsx", "source": "import { kitMotion } from '@kit/ds';\nexport const Loading = ds.styles({ animationName: kitMotion.pulse }).asElement('span');\nexport const App = () => <Loading />;\n" }
                    ])
                    .to_string(),
                    None,
                )
                .unwrap(),
        )
        .unwrap();

        let css = manifest["css"].as_str().unwrap_or("");
        assert!(
            css.contains("animation-name:animus-kf-abc123")
                || css.contains("animation-name: animus-kf-abc123"),
            "{css}"
        );
        let global = manifest["sheets"]["global"].as_str().unwrap_or("");
        assert_eq!(
            global.matches("@keyframes animus-kf-abc123").count(),
            1,
            "{global}"
        );
        let diagnostics = manifest["diagnostics"].as_array().cloned().unwrap_or_default();
        let skips: Vec<_> = diagnostics
            .iter()
            .filter(|d| d["kind"] == "skip")
            .collect();
        assert!(skips.is_empty(), "{skips:?}");
    }

    /// An import of a registered keyframes collection takes the registration
    /// of the name its route reaches the collection by: never another alias
    /// of the same binding registered as a different collection, and a
    /// namespace exported as the collection too.
    #[test]
    fn an_imported_collection_takes_the_registration_its_route_names() {
        let frames = r#"{"from":{"opacity":0},"to":{"opacity":1}}"#;
        let registry = format!(
            r#"{{"motion":{{"pulse":{{"name":"animus-kf-motion","frames":{frames}}}}},"alternate":{{"pulse":{{"name":"animus-kf-alternate","frames":{frames}}}}}}}"#
        );
        let consumer = "import { motion } from './motion';\nexport const C = ds.styles({ animationName: motion.pulse }).asElement('span');\nexport const App = () => <C />;\n";
        let rows = [
            (
                "aliased binding",
                serde_json::json!([
                    { "path": "motion.ts", "source": "const original = createKeyframes({ pulse: { from: { opacity: 0 }, to: { opacity: 1 } } });\nexport { original as alternate, original as motion };\n" },
                    { "path": "other.ts", "source": "export const alternate = createKeyframes({ pulse: { from: { opacity: 1 }, to: { opacity: 0 } } });\n" },
                    { "path": "app.tsx", "source": consumer }
                ]),
            ),
            (
                "exported namespace",
                serde_json::json!([
                    { "path": "frames.ts", "source": "export const __brand = 'Keyframes';\nexport const __frames = { pulse: { from: { opacity: 0 }, to: { opacity: 1 } } };\nexport const pulse = 'pulse';\n" },
                    { "path": "motion.ts", "source": "import * as ns from './frames';\nexport { ns as motion };\n" },
                    { "path": "app.tsx", "source": consumer }
                ]),
            ),
        ];
        let mut wrong = Vec::new();
        for (row, files) in rows {
            let mut engine =
                ExtractEngine::new(Some(EngineOptions { keyframes_json: Some(registry.clone()), ..Default::default() }))
                    .unwrap();
            let manifest: serde_json::Value =
                serde_json::from_str(&engine.analyze(files.to_string(), None).unwrap()).unwrap();
            let css = manifest["css"].as_str().unwrap();
            if !css.contains("animation-name: animus-kf-motion") || !manifest["diagnostics"].as_array().unwrap().is_empty() {
                wrong.push((row, css.to_string(), manifest["diagnostics"].to_string()));
            }
        }
        assert!(wrong.is_empty(), "{wrong:#?}");
    }

    #[test]
    fn only_a_custom_runtime_import_keeps_variant_options() {
        // Contract: the code transformed for an official runtime carries no
        // variant options list; a custom `runtimeImport`'s does, and the
        // manifest's descriptor always keeps it for the tooling that reads it.
        let files = serde_json::json!([
            { "path": "a.tsx", "source": "export const C = ds.styles({ display: 'flex' }).variant({ prop: 'size', variants: { sm: {}, md: {} } }).asClass();\n" }
        ]);
        let run = |runtime_import: Option<&str>| -> (String, String) {
            let mut engine = ExtractEngine::new(Some(EngineOptions {
                runtime_import: runtime_import.map(str::to_string),
                ..Default::default()
            }))
            .unwrap();
            let manifest: serde_json::Value =
                serde_json::from_str(&engine.analyze(files.to_string(), None).unwrap()).unwrap();
            let transformed: serde_json::Value =
                serde_json::from_str(&engine.transform_file("a.tsx".to_string()).unwrap()).unwrap();
            (
                transformed["code"].as_str().unwrap().to_string(),
                manifest["components"]["a.tsx::C"]["replacement"].as_str().unwrap().to_string(),
            )
        };
        let listed = r#""variants":{"size":{"options":["sm","md"]}}"#;
        for official in [None, Some("@animus-ui/system"), Some("@animus-ui/system/runtime"), Some("@animus-ui/system/class-resolver")] {
            let (code, descriptor) = run(official);
            assert!(code.contains(r#""variants":{"size":{}}"#), "{official:?}: {code}");
            assert!(descriptor.contains(listed), "{official:?}: {descriptor}");
        }
        let (code, _) = run(Some("./my-runtime"));
        assert!(code.contains(listed), "{code}");
    }

    /// Contract (with assemble's): an emitted factory call carries a pure
    /// annotation only into a runtime Animus ships. A custom `runtimeImport`
    /// promises suitable exports, not effect-free ones, so neither the
    /// transformed code nor the manifest's descriptor marks its calls.
    #[test]
    fn a_custom_runtime_import_gets_no_pure_annotation() {
        let files = serde_json::json!([
            { "path": "a.tsx", "source": "export const live = ds.styles({ display: 'block' }).asClass();\nexport const dormant = ds.styles({ display: 'grid' }).asClass();\n" }
        ]);
        let run = |runtime_import: Option<&str>| -> (String, String) {
            let mut engine = ExtractEngine::new(Some(EngineOptions {
                runtime_import: runtime_import.map(str::to_string),
                ..Default::default()
            }))
            .unwrap();
            let manifest: serde_json::Value =
                serde_json::from_str(&engine.analyze(files.to_string(), None).unwrap()).unwrap();
            let transformed: serde_json::Value =
                serde_json::from_str(&engine.transform_file("a.tsx".to_string()).unwrap()).unwrap();
            (
                transformed["code"].as_str().unwrap().to_string(),
                manifest["components"]["a.tsx::dormant"]["replacement"].as_str().unwrap().to_string(),
            )
        };
        let (code, descriptor) = run(None);
        assert_eq!(code.matches("@__PURE__").count(), 2, "{code}");
        assert!(descriptor.starts_with("/* @__PURE__ */ "), "{descriptor}");
        let (code, descriptor) = run(Some("./runtime.js"));
        assert!(!code.contains("@__PURE__"), "{code}");
        assert!(!descriptor.contains("@__PURE__"), "{descriptor}");
    }

    #[test]
    fn imported_as_const_variant_map_matches_inline_manifest() {
        let source_binding = serde_json::json!([
            { "path": "kit.ts", "source": "export const sizes = { sm: { p: 8 }, md: { p: 16 } } as const;\n" },
            { "path": "a.tsx", "source": "import { sizes } from './kit';\nexport const Control = ds.styles({ display: 'flex' }).variant({ prop: 'size', variants: sizes, defaultVariant: 'md' }).asElement('button');\nexport const App = () => <><Control size='sm' /><Control size='md' /></>;\n" }
        ]);
        let source_inline = serde_json::json!([
            { "path": "a.tsx", "source": "export const Control = ds.styles({ display: 'flex' }).variant({ prop: 'size', variants: { sm: { p: 8 }, md: { p: 16 } }, defaultVariant: 'md' }).asElement('button');\nexport const App = () => <><Control size='sm' /><Control size='md' /></>;\n" }
        ]);
        let run = |files: serde_json::Value| -> serde_json::Value {
            let mut engine = ExtractEngine::new(None).unwrap();
            serde_json::from_str(&engine.analyze(files.to_string(), None).unwrap()).unwrap()
        };
        let bound = run(source_binding);
        let inline = run(source_inline);
        let opts = |m: &serde_json::Value| {
            m["components"]
                .as_object()
                .unwrap()
                .values()
                .find(|c| c["binding"] == "Control")
                .map(|c| c["replacement"].as_str().unwrap().to_string())
                .unwrap()
        };
        let bound_repl = opts(&bound);
        assert!(bound_repl.contains(r#""options":["md","sm"]"#) || bound_repl.contains(r#""options":["sm","md"]"#), "{bound_repl}");
        assert_eq!(bound_repl, opts(&inline));
        assert_eq!(bound["css"], inline["css"]);
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
                .analyze_full(
                    serde_json::json!([
                        { "path": "tokens.ts", "source": "export const GAP = 24;\nexport const WIDE = 32;\n" },
                        { "path": "barrel.ts", "source": "export { GAP as SPACING } from './tokens';\n" },
                        // A compiler's barrel: an import exported locally.
                        { "path": "compiled.js", "source": "import { WIDE as w } from './tokens';\nexport { w as WIDE_SPACING };\n" },
                        { "path": "a.tsx", "source": "import { SPACING } from './barrel';\nimport { WIDE_SPACING } from './compiled';\nexport const Box = ds.system({ space: true }).asElement('div');\nexport const App = () => <><Box p={SPACING} /><Box p={WIDE_SPACING} /></>;\n" }
                    ])
                    .to_string(),
                    None,
                )
                .unwrap(),
        )
        .unwrap();

        assert!(manifest["system_prop_map"]["p"]["24"].is_string());
        assert!(manifest["system_prop_map"]["p"]["32"].is_string());
        assert_eq!(manifest["usageResidue"], serde_json::json!([]));
    }

    /// A static is never read through `export *`: a read through a star
    /// stays dynamic. A namespace re-export of a module that stars it in
    /// still unsettles it for a direct reader.
    #[test]
    fn a_star_carries_no_static_read_but_still_unsettles_what_it_brings_in() {
        let mut engine = ExtractEngine::new(Some(EngineOptions {
            config_json: Some(r#"{"p":{"property":"padding"}}"#.to_string()),
            group_registry_json: Some(r#"{"space":["p"]}"#.to_string()),
            ..Default::default()
        }))
        .unwrap();
        let manifest: serde_json::Value = serde_json::from_str(
            &engine
                .analyze_full(
                    serde_json::json!([
                        { "path": "tokens.ts", "source": "export const GAP = 24;\nexport const pad = { margin: 4 };\n" },
                        { "path": "barrel.ts", "source": "export * from './tokens';\n" },
                        { "path": "all.ts", "source": "export * as all from './barrel';\n" },
                        { "path": "a.tsx", "source": "import { GAP } from './barrel';\nimport { pad } from './tokens';\nexport const Box = ds.system({ space: true }).asElement('div');\nexport const Card = ds.styles({ ...pad }).asElement('div');\nexport const App = () => <><Box p={GAP} /><Card /></>;\n" }
                    ])
                    .to_string(),
                    None,
                )
                .unwrap(),
        )
        .unwrap();

        assert!(manifest["system_prop_map"]["p"]["24"].is_null(), "{manifest}");
        assert_eq!(manifest["usageResidue"][0]["prop"], "p", "{manifest}");
        let dropped: Vec<&str> = manifest["diagnostics"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|d| d["component"] == "Card")
            .filter_map(|d| d["message"].as_str())
            .collect();
        assert_eq!(
            dropped,
            ["chain dropped: stage 'styles' evaluation failed — styles eval failed: spread of all.ts re-exports barrel.ts as the namespace all"],
            "{manifest}"
        );
    }

    /// A mutated object read through a spread is refused, never shipped
    /// with its declared value, whatever route its mutator imports it by:
    /// directly, through 31 or 32 re-export hops, through a star cycle, or
    /// through a star the analysis cannot open (a missing module or a
    /// package) or from a missing module itself, or as a member of a missing
    /// module's namespace, or loads its module through a parenthesized
    /// `require`. A reader through a star is refused whatever the
    /// mutator does: a load of a module with an open star, a computed
    /// `import()` or `require()`, a default alias, or a rename behind an
    /// open star.
    #[test]
    fn an_export_target_the_analysis_cannot_close_never_yields_stale_static_css() {
        let file = |path: &str, source: &str| (path.to_string(), source.to_string());
        let mutate = |from: &str| file("mutate.ts", &format!("import {{ pad }} from '{from}';\npad.padding = 9;\n"));
        let hops = |n: usize| -> Vec<(String, String)> {
            let mut files: Vec<(String, String)> = (0..n)
                .map(|i| {
                    let next = if i == n - 1 { "tokens".to_string() } else { format!("b{}", i + 1) };
                    file(&format!("b{i}.ts"), &format!("export {{ pad }} from './{next}';\n"))
                })
                .collect();
            files.push(mutate("./b0"));
            files
        };
        let open = || file("open.ts", "export * from './tokens';\nexport * from 'some-package';\n");
        let closed = || file("closed.ts", "export * from './tokens';\n");
        // Each row: its name, the module the reader imports `pad` from, and
        // the route's modules.
        type Row<'r> = (&'r str, &'r str, Vec<(String, String)>);
        let rows: Vec<Row<'_>> = vec![
            ("direct", "./tokens", vec![mutate("./tokens")]),
            ("31 hops", "./tokens", hops(31)),
            ("32 hops", "./tokens", hops(32)),
            (
                "star cycle",
                "./tokens",
                vec![
                    file("a.ts", "export * from './b';\nexport * from './tokens';\n"),
                    file("b.ts", "export * from './a';\n"),
                    mutate("./a"),
                ],
            ),
            ("missing module star", "./tokens", vec![file("a.ts", "export * from './external';\n"), mutate("./a")]),
            ("package star", "./tokens", vec![file("a.ts", "export * from 'some-package';\n"), mutate("./a")]),
            (
                "parenthesized require",
                "./tokens",
                vec![file("mutate.ts", "(require)('./tokens').pad.padding = 9;\n")],
            ),
            ("missing module import", "./tokens", vec![mutate("./missing")]),
            ("read through a closed star", "./closed", vec![closed(), open(), mutate("./open")]),
            ("import() of an open star", "./closed", vec![closed(), open(), file("mutate.ts", "import('./open');\n")]),
            ("require() of an open star", "./closed", vec![closed(), open(), file("mutate.ts", "require('./open');\n")]),
            (
                "computed import()",
                "./closed",
                vec![
                    closed(),
                    file("mutate.ts", "const source = './tokens';\nimport(source).then((tokens) => { tokens.pad.padding = 9; });\n"),
                ],
            ),
            (
                "computed require()",
                "./closed",
                vec![closed(), file("mutate.ts", "const source = './tokens';\nrequire(source).pad.padding = 9;\n")],
            ),
            (
                "default alias through a star",
                "./closed",
                vec![
                    closed(),
                    file("defaults.ts", "import { pad } from './tokens';\nexport default pad;\n"),
                    file("alias.ts", "export { default as pad } from './defaults';\n"),
                    file("star.ts", "export * from './alias';\n"),
                    mutate("./star"),
                ],
            ),
            (
                "renamed behind an open star",
                "./closed",
                vec![closed(), open(), file("mutate.ts", "import { different } from './open';\ndifferent.padding = 9;\n")],
            ),
            (
                "namespace of a missing module",
                "./tokens",
                vec![file("mutate.ts", "import * as ns from './missing';\nns.pad.padding = 9;\n")],
            ),
            // A module the analysis cannot find may re-export `pad` under any
            // name.
            (
                "renamed member of a missing module's namespace",
                "./tokens",
                vec![file("mutate.ts", "import * as ns from './missing';\nns.Tooltip.padding = 9;\n")],
            ),
            (
                "member of a missing module's namespace held by an alias",
                "./tokens",
                vec![file("mutate.ts", "import * as ns from './missing';\nconst tooltip = ns.Tooltip;\ntooltip.padding = 9;\n")],
            ),
            // The same through a barrel: a star of the missing module, or its
            // namespace re-exported and imported by name.
            (
                "renamed member through a star of a missing module",
                "./tokens",
                vec![
                    file("barrel.ts", "export * from './missing';\n"),
                    file("mutate.ts", "import * as ns from './barrel';\nns.Tooltip.padding = 9;\n"),
                ],
            ),
            (
                "renamed member through a star of a missing module, held by an alias",
                "./tokens",
                vec![
                    file("barrel.ts", "export * from './missing';\n"),
                    file("mutate.ts", "import * as ns from './barrel';\nconst tooltip = ns.Tooltip;\ntooltip.padding = 9;\n"),
                ],
            ),
            (
                "renamed member of a missing module's namespace imported by name",
                "./tokens",
                vec![
                    file("barrel.ts", "export * as ns from './missing';\n"),
                    file("mutate.ts", "import { ns } from './barrel';\nns.Tooltip.padding = 9;\n"),
                ],
            ),
        ];
        let mut stale = Vec::new();
        for (row, read_from, route) in rows {
            let mut files = vec![
                file("tokens.ts", "export const pad = { padding: 4 };\n"),
                file(
                    "reader.tsx",
                    &format!("import './mutate';\nimport {{ pad }} from '{read_from}';\nexport const C = ds.styles({{ ...pad }}).asElement('div');\nexport const App = () => <C />;\n"),
                ),
            ];
            files.extend(route);
            let entries: Vec<serde_json::Value> =
                files.iter().map(|(path, source)| serde_json::json!({ "path": path, "source": source })).collect();
            let mut engine = ExtractEngine::new(None).unwrap();
            let manifest: serde_json::Value =
                serde_json::from_str(&engine.analyze(serde_json::Value::Array(entries).to_string(), None).unwrap()).unwrap();
            let refused = manifest["diagnostics"]
                .as_array()
                .unwrap()
                .iter()
                .any(|d| d["component"] == "C" && d["code"] == "animus.chain.unextractable");
            let code = engine.transform_file("reader.tsx".to_string()).unwrap();
            if manifest["css"].as_str().unwrap().contains("padding: 4") || !refused || code.contains("createComponent") {
                stale.push(row);
            }
        }
        assert_eq!(stale, Vec::<&str>::new());
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
                .analyze_full(
                    serde_json::json!([
                        { "path": "tokens.ts", "source": "export const PARTIAL = { _: unknown, sm: 16 };\n" },
                        { "path": "a.tsx", "source": "import { PARTIAL } from './tokens';\nexport const Box = ds.system({ space: true }).asElement('div');\nexport const App = () => <Box mt={PARTIAL} />;\n" }
                    ])
                    .to_string(),
                    None,
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
                .analyze_full(
                    serde_json::json!([{
                        "path": "app.tsx",
                        "source": "export const Box = ds.system({ layout: true }).asElement('div');\nexport const App = ({ open }) => <Box display={open ? 'block' : 'none'} />;\n"
                    }])
                    .to_string(),
                    None,
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
        assert_eq!(manifest["usageResidue"], serde_json::json!([]));
    }

    fn unregistered_keyframe_diagnostics(manifest: &serde_json::Value) -> Vec<String> {
        manifest["diagnostics"]
            .as_array()
            .map(|ds| {
                ds.iter()
                    .filter(|d| d["code"] == crate::eval::KEYFRAMES_UNREGISTERED_REFERENCE)
                    .map(|d| d["message"].as_str().unwrap_or_default().to_string())
                    // The record carries its code; its message names none,
                    // so its line prints the code once, in brackets.
                    .inspect(|message| assert!(!message.contains("(animus."), "{message}"))
                    .collect()
            })
            .unwrap_or_default()
    }

    #[test]
    fn registration_key_equal_to_the_export_name_resolves_member_lookup() {
        let mut engine = ExtractEngine::new(Some(EngineOptions {
            keyframes_json: Some(
                r#"{"animations":{"pulse":{"name":"animus-kf-abc123","frames":{"from":{"opacity":0.4},"to":{"opacity":1}}}}}"#
                    .to_string(),
            ),
            ..Default::default()
        }))
        .unwrap();
        let manifest: serde_json::Value = serde_json::from_str(
            &engine
                .analyze(
                    serde_json::json!([
                        { "path": "system.ts", "source": "export const animations = createKeyframes({ pulse: { from: { opacity: 0.4 }, to: { opacity: 1 } } });\n" },
                        { "path": "a.tsx", "source": "import { animations } from './system';\nexport const Pulse = ds.styles({ animationName: animations.pulse }).asElement('span');\nexport const App = () => <Pulse />;\n" }
                    ])
                    .to_string(),
                    None,
                )
                .unwrap(),
        )
        .unwrap();

        let css = manifest["css"].as_str().unwrap_or("");
        assert!(
            css.contains("animation-name:animus-kf-abc123")
                || css.contains("animation-name: animus-kf-abc123"),
            "{css}"
        );
        let global = manifest["sheets"]["global"].as_str().unwrap_or("");
        assert_eq!(
            global.matches("@keyframes animus-kf-abc123").count(),
            1,
            "{global}"
        );
        assert!(
            unregistered_keyframe_diagnostics(&manifest).is_empty(),
            "{manifest}"
        );
    }

    /// Contract: a registered position try resolves by its collection's
    /// export name, in a template too, and its rule emits once, in
    /// `anm-global`.
    #[test]
    fn a_registered_position_try_resolves_by_export_name_and_emits_once_in_the_global_layer() {
        let mut engine = ExtractEngine::new(Some(EngineOptions {
            position_try_json: Some(
                r#"{"placements":{"above":{"name":"--animus-pt-abc123","descriptors":{"positionArea":"top","width":200}}}}"#
                    .to_string(),
            ),
            ..Default::default()
        }))
        .unwrap();
        let manifest: serde_json::Value = serde_json::from_str(
            &engine
                .analyze(
                    serde_json::json!([
                        { "path": "system.ts", "source": "export const placements = createPositionTry({ above: { positionArea: 'top', width: 200 } });\n" },
                        { "path": "a.tsx", "source": "import { placements } from './system';\nexport const Tip = ds.styles({ positionTryFallbacks: `${placements.above}, flip-block` }).asElement('div');\nexport const App = () => <Tip />;\n" }
                    ])
                    .to_string(),
                    None,
                )
                .unwrap(),
        )
        .unwrap();

        let css = manifest["css"].as_str().unwrap_or("");
        assert!(css.contains("position-try-fallbacks: --animus-pt-abc123, flip-block;"), "{css}");
        let global = manifest["sheets"]["global"].as_str().unwrap_or("");
        assert_eq!(global.matches("@position-try --animus-pt-abc123 {").count(), 1, "{global}");
        assert!(global.starts_with("@layer anm-global {"), "{global}");
        assert!(global.contains("  position-area: top;\n  width: 200px;"), "{global}");
    }

    /// Contract: a registered view transition resolves by its collection's
    /// export name to its class, and each slot's rule emits once, in
    /// `anm-global`, on its pseudo-element scoped to that class.
    #[test]
    fn a_registered_view_transition_resolves_by_export_name_and_emits_once_in_the_global_layer() {
        let mut engine = ExtractEngine::new(Some(EngineOptions {
            view_transitions_json: Some(
                r#"{"transitions":{"slide":{"name":"animus-vt-abc123","slots":{"group":{"animationDuration":"250ms"},"old":{"opacity":0}}}}}"#
                    .to_string(),
            ),
            ..Default::default()
        }))
        .unwrap();
        let manifest: serde_json::Value = serde_json::from_str(
            &engine
                .analyze(
                    serde_json::json!([
                        { "path": "system.ts", "source": "export const transitions = createViewTransitions({ slide: { group: { animationDuration: '250ms' }, old: { opacity: 0 } } });\n" },
                        { "path": "a.tsx", "source": "import { transitions } from './system';\nexport const Card = ds.styles({ viewTransitionClass: transitions.slide }).asElement('article');\nexport const App = () => <Card />;\n" }
                    ])
                    .to_string(),
                    None,
                )
                .unwrap(),
        )
        .unwrap();

        let css = manifest["css"].as_str().unwrap_or("");
        assert!(css.contains("view-transition-class: animus-vt-abc123;"), "{css}");
        let global = manifest["sheets"]["global"].as_str().unwrap_or("");
        assert!(global.starts_with("@layer anm-global {"), "{global}");
        for rule in [
            "::view-transition-group(*.animus-vt-abc123) {\n  animation-duration: 250ms;\n}",
            "::view-transition-old(*.animus-vt-abc123) {\n  opacity: 0;\n}",
        ] {
            assert_eq!(global.matches(rule).count(), 1, "{global}");
        }
    }

    #[test]
    fn registration_key_mismatched_with_the_export_name_skips_and_is_witnessed() {
        let mut engine = ExtractEngine::new(Some(EngineOptions {
            keyframes_json: Some(
                r#"{"motion":{"pulse":{"name":"animus-kf-abc123","frames":{"from":{"opacity":0.4},"to":{"opacity":1}}}}}"#
                    .to_string(),
            ),
            ..Default::default()
        }))
        .unwrap();
        let manifest: serde_json::Value = serde_json::from_str(
            &engine
                .analyze(
                    serde_json::json!([
                        { "path": "system.ts", "source": "export const animations = createKeyframes({ pulse: { from: { opacity: 0.4 }, to: { opacity: 1 } } });\n" },
                        { "path": "a.tsx", "source": "import { animations } from './system';\nexport const Pulse = ds.styles({ animationName: animations.pulse }).asElement('span');\nexport const App = () => <Pulse />;\n" }
                    ])
                    .to_string(),
                    None,
                )
                .unwrap(),
        )
        .unwrap();

        let css = manifest["css"].as_str().unwrap_or("");
        assert!(!css.contains("animation-name"), "{css}");
        let coded = unregistered_keyframe_diagnostics(&manifest);
        assert_eq!(coded.len(), 1, "{coded:?}");
        assert!(coded[0].contains("animationName"), "{}", coded[0]);
        assert!(coded[0].contains("animations.pulse"), "{}", coded[0]);
        assert!(!manifest["components"].as_object().unwrap().is_empty());
        let global_sheet = manifest["sheets"]["global"].as_str().unwrap_or("");
        assert!(
            global_sheet.contains("@keyframes animus-kf-abc123"),
            "registered-but-unreferenced collections currently emit dead CSS: {global_sheet}"
        );
    }

    /// A kit read from its compiled output can rename a collection's export,
    /// so its unregistered references name the kit's source condition; a
    /// project's own do not.
    /// Contract: the configured system file and the modules its load read
    /// are known wherever they sit. An app root in a subdirectory whose entry
    /// imports the system from the parent (gamut's probe shape) opens
    /// nothing: the kit's static stage inputs stay static, and pruning stays
    /// on. Without that knowledge the import is an unanalysed opening.
    #[test]
    fn an_import_of_the_system_from_outside_the_root_opens_nothing() {
        let files = serde_json::json!([
            { "path": "tokens.ts", "source": "export const pad = { padding: 4 };\n" },
            { "path": "card.tsx", "source": "import { pad } from './tokens';\nexport const Card = ds.styles({ ...pad }).asElement('div');\n" },
            { "path": "main.tsx", "source": "import { system } from '../src/ds';\nimport { Card } from './card';\nexport const App = () => <Card />;\n" },
        ])
        .to_string();
        let run_host = |system_modules: &str, host: &str| -> (bool, Vec<String>) {
            let mut engine = ExtractEngine::new(Some(EngineOptions {
                analysis_context_json: Some(format!(r#"{{"systemModules":{system_modules}}}"#)),
                ..Default::default()
            }))
            .unwrap();
            let prepared: serde_json::Value = serde_json::from_str(&engine.prepare(files.clone()).unwrap()).unwrap();
            let evidence = serde_json::json!({
                "generation": 1,
                "identity": prepared["identity"],
                "bases": { "../src/ds": { "candidate": host, "reading": "unanalysed" } },
            });
            let out: serde_json::Value =
                serde_json::from_str(&engine.analyze(files.clone(), Some(evidence.to_string())).unwrap()).unwrap();
            let codes = out["diagnostics"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|d| d["code"].as_str().map(str::to_string))
                .filter(|code| code == "animus.chain.stage-evaluation-failed" || code == "animus.resolve.unanalysed-import")
                .collect();
            (out["css"].as_str().unwrap_or_default().contains("padding"), codes)
        };
        let run = |system_modules: &str| run_host(system_modules, "../src/ds.ts");
        let (extracted, codes) = run("[]");
        assert!(!extracted && codes.contains(&"animus.resolve.unanalysed-import".to_string()), "{codes:?}");
        assert_eq!(run(r#"["../src/ds.ts","../src/theme.ts"]"#), (true, vec![]));
        // A host that opens another file than the loader read (a stale
        // compiled ds.js beside ds.ts) opens it as before.
        // A host that opens another file than the loader read opens it as
        // before: a stale compiled ds.js beside ds.ts, or ds.ts where the
        // load read ds/index.ts.
        for (system, host) in [(r#"["../src/ds.ts"]"#, "../src/ds.js"), (r#"["../src/ds/index.ts"]"#, "../src/ds.ts")] {
            let (extracted, codes) = run_host(system, host);
            assert!(!extracted && codes.contains(&"animus.resolve.unanalysed-import".to_string()), "{host}: {codes:?}");
        }
    }

    /// Contract: the host manifest `analyzePrepared` returns omits the
    /// sections no host reads (fileFacts, crossFile, usageResidue,
    /// component_fragments) and carries each file's chain bindings in their
    /// place; the full manifest holds every section and is otherwise the
    /// host manifest, and each section on its own is the full manifest's.
    #[test]
    fn the_host_manifest_omits_sections_and_the_full_manifest_holds_them() {
        let mut engine = ExtractEngine::new(None).unwrap();
        let files = serde_json::json!([
            { "path": "tokens.ts", "source": "export const pad = { padding: 4 };\n" },
            { "path": "a.tsx", "source": "import { pad } from './tokens';\nexport const Card = ds.styles({ ...pad }).asElement('div');\nexport const Badge = ds.styles({ margin: 2 }).asElement('span');\nexport const App = () => <><Card /><Badge /></>;\n" },
        ])
        .to_string();
        let host: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(&engine.analyze(files, None).unwrap()).unwrap();
        let mut full: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(&engine.full_manifest_json().unwrap()).unwrap();
        let omitted = ["fileFacts", "crossFile", "usageResidue", "component_fragments"];
        for name in omitted {
            assert!(!host.contains_key(name), "{name} in the host manifest");
            let section: serde_json::Value = serde_json::from_str(&engine.manifest_section(name.to_string()).unwrap()).unwrap();
            assert_eq!(full.get(name), Some(&section), "{name}");
        }
        let bindings: serde_json::Map<String, serde_json::Value> = full["fileFacts"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(file, facts)| {
                let names = facts["chains"].as_array().unwrap().iter().map(|chain| chain["descriptor"]["binding"].clone());
                (file.clone(), serde_json::Value::Array(names.collect()))
            })
            .collect();
        assert_eq!(host["chainBindings"], serde_json::Value::Object(bindings));
        assert_eq!(host["chainBindings"]["a.tsx"], serde_json::json!(["Card", "Badge"]));
        assert!(!full.contains_key("chainBindings"));
        for name in omitted {
            full.remove(name);
        }
        let mut host = host;
        host.remove("chainBindings");
        assert_eq!(host, full);
    }

    /// Contract: `analysisTimings` names each phase of the last analysis in
    /// order, CSS resolution as `cssResolution`, with its `prepare` first;
    /// the manifest's own timing is only its parse count, so its bytes stay
    /// the same run to run.
    #[test]
    fn analysis_timings_name_each_phase_and_stay_out_of_the_manifest() {
        let files = serde_json::json!([
            { "path": "card.tsx", "source": "export const Card = ds.styles({ padding: 4 }).asElement('div');\n" },
        ])
        .to_string();
        let phases = |engine: &ExtractEngine| -> Vec<String> {
            let timings: serde_json::Map<String, serde_json::Value> =
                serde_json::from_str(&engine.analysis_timings()).unwrap();
            assert!(timings.values().all(|ms| ms.as_f64().is_some_and(|ms| ms >= 0.0)), "{timings:?}");
            timings.keys().cloned().collect()
        };
        let analysed = [
            "input", "parse", "lowering", "links", "staticsAndUses", "flow", "enrich", "fileFacts", "pureBuilders",
            "cssResolution", "post", "serialize",
        ];
        let mut engine = ExtractEngine::new(None).unwrap();
        let manifest: serde_json::Value = serde_json::from_str(&engine.analyze(files, None).unwrap()).unwrap();
        assert_eq!(manifest["timing"], serde_json::json!({ "parseCount": 1 }));
        assert_eq!(phases(&engine), [&["prepareParse", "prepareProbes"][..], &analysed].concat());
    }

    /// Contract: a declaration an unread module's opening dropped leads its
    /// record with one cause (the module, how it is reached, and in words
    /// the warning that says what to do) and keeps its own code, kind and
    /// location, so a strict build fails on it as before and its line names
    /// no code but its own. Every opening that costs the declaration is
    /// named, openings costing the same declarations in one warning, and a
    /// reason is read whole, never inside another.
    #[test]
    fn a_declaration_an_unread_module_dropped_leads_with_that_cause() {
        let analyze = |workers: &[(&str, &str)]| -> Vec<serde_json::Value> {
            let mut engine = ExtractEngine::new(None).unwrap();
            let mut files = vec![
                serde_json::json!({ "path": "system.ts", "source": "import { createSystem } from '@animus-ui/system';\nexport const ds = createSystem().build().seal();\n" }),
                serde_json::json!({ "path": "tokens.ts", "source": "export const pad = { padding: 4 };\n" }),
                serde_json::json!({ "path": "card.tsx", "source": "import { ds } from './system';\nimport { pad } from './tokens';\nexport const Card = ds.styles({ ...pad }).asElement('div');\nexport const App = () => <Card />;\n" }),
            ];
            for (path, missing) in workers {
                files.push(serde_json::json!({
                    "path": path,
                    "source": format!("import manifest from '{missing}';\nexport default {{ fetch: () => new Response(JSON.stringify(manifest)) }};\n"),
                }));
            }
            let out: serde_json::Value =
                serde_json::from_str(&engine.analyze(serde_json::Value::Array(files).to_string(), None).unwrap()).unwrap();
            out["diagnostics"].as_array().cloned().unwrap_or_default()
        };
        let card = |diagnostics: &[serde_json::Value]| {
            let card = diagnostics.iter().find(|d| d["component"] == "Card" && d["kind"] == "bail").expect("Card's record").clone();
            assert_eq!(
                (&card["code"], &card["file"], &card["line"]),
                (&serde_json::json!("animus.chain.stage-evaluation-failed"), &serde_json::json!("card.tsx"), &serde_json::json!(3))
            );
            card["message"].as_str().unwrap().to_string()
        };
        let reaching = |diagnostics: &[serde_json::Value]| -> Vec<(String, String)> {
            diagnostics
                .iter()
                .filter(|d| d["code"] == "animus.load.missing-module-reach")
                .filter(|d| d["message"].as_str().unwrap().contains("Card (card.tsx:3)"))
                .map(|d| (d["file"].as_str().unwrap().to_string(), d["message"].as_str().unwrap().to_string()))
                .collect()
        };

        let one = analyze(&[("worker.js", "./asset-manifest.js")]);
        let message = card(&one);
        assert!(
            message.starts_with(
                "one cause: './asset-manifest.js' names no file the analysis holds, and worker.js imports it on \
                 line 1; see the animus.load.missing-module-reach warning — chain dropped: "
            ),
            "{message}"
        );
        // The line counts once: no other code in brackets or parentheses.
        assert!(!message.contains("[animus.") && !message.contains("(animus."), "{message}");
        let [(file, _)] = reaching(&one).try_into().expect("one warning");
        assert_eq!(file, "worker.js");

        // Two missing modules costing the same declaration: one leads, and
        // one warning names both, each with its own remedy.
        let two = analyze(&[("a-worker.js", "./aa.js"), ("z-worker.js", "./zz.js")]);
        assert!(card(&two).starts_with("one cause: './aa.js'"), "{}", card(&two));
        let [(file, message)] = reaching(&two).try_into().expect("one warning");
        assert_eq!(file, "a-worker.js");
        for said in [
            "2 modules the analysis does not read may change the objects analysed modules export: ",
            "(1) './aa.js' names no file the analysis holds, and a-worker.js imports it on line 1 — ",
            "(2) './zz.js' names no file the analysis holds, and z-worker.js imports it on line 1 — ",
            "so 1 declaration that read an exported object is not extracted, whole or in part: Card (card.tsx:3)",
        ] {
            assert!(message.contains(said), "{said}: {message}");
        }

        // A reason is read whole: `b/x.js imports …` within `a b/x.js
        // imports …` is no statement of its own.
        let spaced = "a b/x.js imports ./m.js on line 1, and a module the analysis cannot find may re-export any module";
        let inner = "b/x.js imports ./m.js on line 1, and a module the analysis cannot find may re-export any module";
        assert_eq!(
            crate::analyze_css::stated_reasons(&format!("stage failed — {spaced}"), &[spaced, inner]),
            std::collections::BTreeSet::from([spaced])
        );
    }

    /// Contract: an import analysis cannot follow names its importing file
    /// and suggests excluding it. A missing module that cost declarations
    /// is named once, where it is imported, with them; a file the host
    /// opens that analysis does not read says so beside its own remedy.
    /// Each remedy builds on the host's `exclude` list and names that file
    /// alone, and none is offered for a module another analysed module
    /// imports.
    #[test]
    fn an_import_analysis_cannot_follow_names_its_importing_file_and_suggests_excluding_it() {
        let base = [
            ("tokens.ts", "export const pad = { padding: 4 };\n"),
            (
                "card.tsx",
                "import { pad } from './tokens';\nexport const Card = ds.styles({ ...pad }).asElement('div');\nexport const App = () => <Card />;\n",
            ),
        ];
        let manifest_worker =
            "import manifest from './asset-manifest.js';\nexport default { fetch: () => new Response(JSON.stringify(manifest)) };\n";
        let helper_worker = "import { serve } from '../hosting/asset-worker.js';\nexport default serve();\n";
        let run = |more: &[(&str, &str)], exclude: Option<&str>, unanalysed: Option<&str>| -> Vec<String> {
            let mut engine = ExtractEngine::new(Some(EngineOptions {
                analysis_context_json: exclude.map(|list| format!(r#"{{"exclude":{list}}}"#)),
                ..Default::default()
            }))
            .unwrap();
            let files = serde_json::Value::Array(
                base.iter().chain(more).map(|(path, source)| serde_json::json!({ "path": path, "source": source })).collect(),
            )
            .to_string();
            let prepared: serde_json::Value = serde_json::from_str(&engine.prepare(files.clone()).unwrap()).unwrap();
            let evidence = unanalysed.map(|base| {
                serde_json::json!({
                    "generation": 1,
                    "identity": prepared["identity"],
                    "bases": { base: { "candidate": base, "reading": "unanalysed" } },
                })
                .to_string()
            });
            let out: serde_json::Value = serde_json::from_str(&engine.analyze(files, evidence).unwrap()).unwrap();
            out["diagnostics"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|d| d["code"] == "animus.load.missing-module-reach" || d["code"] == "animus.resolve.unanalysed-import")
                .map(|d| format!("{} {}:{} {}", d["code"].as_str().unwrap(), d["file"].as_str().unwrap(), d["line"], d["message"].as_str().unwrap()))
                .collect()
        };
        assert_eq!(run(&[], Some(r#"["dist","legacy"]"#), None), Vec::<String>::new());
        let missing = |named: &[String], remedy: &str| {
            let [named] = named else { panic!("{named:?}") };
            for said in [
                "animus.load.missing-module-reach worker.js:1 ",
                "'./asset-manifest.js' names no file the analysis holds",
                "worker.js imports it on line 1",
                "1 declaration that read an exported object is not extracted, whole or in part: Card (card.tsx:2)",
                &format!("if worker.js runs outside the app (a Worker, a script), exclude it: {remedy}"),
            ] {
                assert!(named.contains(said), "{said}: {named}");
            }
        };
        missing(&run(&[("worker.js", manifest_worker)], Some(r#"["dist","legacy"]"#), None), "exclude: ['dist', 'legacy', 'worker.js']");
        missing(&run(&[("worker.js", manifest_worker)], None, None), "add 'worker.js' to exclude");
        // A pattern another analysed path holds too would exclude it as well.
        missing(
            &run(&[("worker.js", manifest_worker), ("service-worker.js", "export {};\n")], Some("[]"), None),
            "exclude: ['worker*.js']",
        );
        // The remedy names the file alone as the host reads patterns: a
        // substring, else a glob where `*` and `?` stay in one segment and
        // brackets are themselves; none where no pattern is alone.
        let remedy = |named: &[String]| -> Option<String> {
            let found = named.iter().find(|named| named.starts_with("animus.load.missing-module-reach"))?;
            let at = found.find("exclude it: ")? + "exclude it: ".len();
            let said = found[at..].split(';').next().unwrap_or_default();
            Some(said.trim_end_matches(crate::analyze_css::EXCLUDE_LIST_REPLACES).to_string())
        };
        let lone = |files: &[(&str, &str)]| remedy(&run(files, Some("[]"), None));
        assert_eq!(
            lone(&[("worker.ts", manifest_worker), ("worker-env.ts", "export {};\n"), ("src/people/coworker.tsx", "export {};\n")]),
            Some("exclude: ['worker.t?']".to_string())
        );
        let page = "import data from './data.gen.js';\nexport const x = data;\n";
        assert_eq!(
            lone(&[("app/[slug]/page.tsx", page), ("x/app/[slug]/page.tsx", "export {};\n"), ("app/[slug]/page-client.tsx", "export {};\n")]),
            Some("exclude: ['app/[slug]/page.ts?']".to_string())
        );
        assert_eq!(
            lone(&[
                ("worker.ts", manifest_worker),
                ("worker-env.ts", "export {};\n"),
                ("worker.tx", "export {};\n"),
                ("src/people/coworker.tsx", "export {};\n"),
            ]),
            None
        );
        // An entry that renders keeps what it renders only while analysed.
        let entry = "import routes from './routeTree.gen.js';\nimport { Card } from './card';\nexport const App = () => <Card />;\nexport const r = routes;\n";
        let rendered = run(&[("main.tsx", entry)], Some("[]"), None);
        let [rendered] = rendered.as_slice() else { panic!("{rendered:?}") };
        assert!(rendered.contains("main.tsx imports it on line 1") && !rendered.contains("exclude it"), "{rendered}");
        // A module another analysed module imports runs with it: excluding it
        // is no remedy.
        let imported = run(&[("worker.js", manifest_worker), ("main.tsx", "import './worker.js';\n")], Some("[]"), None);
        let [imported] = imported.as_slice() else { panic!("{imported:?}") };
        assert!(imported.contains("worker.js imports it on line 1") && !imported.contains("exclude it"), "{imported}");
        let opened = run(&[("worker.js", helper_worker)], Some(r#"["dist"]"#), Some("../hosting/asset-worker.js"));
        let unanalysed: Vec<&String> = opened.iter().filter(|named| named.starts_with("animus.resolve.unanalysed-import")).collect();
        let [unanalysed] = unanalysed.as_slice() else { panic!("{opened:?}") };
        for said in [
            "animus.resolve.unanalysed-import worker.js:",
            "nothing is pruned",
            "if worker.js runs outside the app (a Worker, a script), exclude it: exclude: ['dist', 'worker.js']",
        ] {
            assert!(unanalysed.contains(said), "{said}: {unanalysed}");
        }
        // A file the host finds is no file generated later.
        let missing: Vec<&String> = opened.iter().filter(|named| named.starts_with("animus.load.missing-module-reach")).collect();
        let [missing] = missing.as_slice() else { panic!("{opened:?}") };
        assert!(
            missing.contains("the host finds ../hosting/asset-worker.js, which analysis does not read")
                && !missing.contains("generate it before the build"),
            "{missing}"
        );
    }

    /// Contract: a load of an unread package unsettles only the exported
    /// objects the host says it reaches, and a config-only module's load
    /// unsettles nothing; a load that still costs declarations is named
    /// once, where it is written, with them and the exclusion that removes
    /// server code.
    #[test]
    fn an_unread_package_load_unsettles_what_it_reaches_and_is_named_with_its_cost() {
        let base = [
            ("system.ts", "import { createSystem } from '@animus-ui/system';\nexport const ds = createSystem().build().seal();\n"),
            ("groups.ts", "export const groups = { space: true };\n"),
            (
                "box.tsx",
                "import { ds } from './system';\nimport { groups } from './groups';\nexport const Box = ds.styles({ display: 'block' }).system(groups).asElement('div');\nexport const App = () => <Box p={4} />;\n",
            ),
        ];
        let load = "require('@opaque/workspace');\n";
        let run = |more: &[(&str, &str)], reaches: Option<serde_json::Value>| {
            let mut engine = ExtractEngine::new(Some(EngineOptions {
                config_json: Some(r#"{"p":{"property":"padding"}}"#.to_string()),
                group_registry_json: Some(r#"{"space":["p"]}"#.to_string()),
                ..Default::default()
            }))
            .unwrap();
            let files = serde_json::Value::Array(
                base.iter()
                    .chain(more)
                    .map(|(path, source)| serde_json::json!({ "path": path, "source": source }))
                    .collect(),
            )
            .to_string();
            let prepared: serde_json::Value = serde_json::from_str(&engine.prepare(files.clone()).unwrap()).unwrap();
            let evidence = reaches.map(|reaches| {
                serde_json::json!({
                    "generation": 1,
                    "identity": prepared["identity"],
                    "bases": {},
                    "packages": [{ "identity": "@opaque/workspace", "reaches": reaches, "local": true }],
                })
                .to_string()
            });
            let out: serde_json::Value = serde_json::from_str(&engine.analyze(files, evidence).unwrap()).unwrap();
            let diagnostics = out["diagnostics"].as_array().cloned().unwrap_or_default();
            let failed = diagnostics
                .iter()
                .filter(|d| d["code"] == "animus.chain.stage-evaluation-failed")
                .map(|d| d["component"].as_str().unwrap().to_string())
                .collect::<Vec<_>>();
            let named = diagnostics
                .iter()
                .filter(|d| d["code"] == "animus.load.unread-package-reach")
                .map(|d| format!("{}:{} {}", d["file"].as_str().unwrap(), d["line"], d["message"].as_str().unwrap()))
                .collect::<Vec<_>>();
            (out["css"].as_str().unwrap_or_default().contains("display: block"), failed, named)
        };
        assert_eq!(run(&[], None), (true, vec![], vec![]));
        assert_eq!(run(&[("vite.config.ts", load)], None), (true, vec![], vec![]));
        assert_eq!(run(&[("api/server.ts", load)], Some(serde_json::json!([]))), (true, vec![], vec![]));
        for (reaches, package) in [
            (None, "'@opaque/workspace' is a package the analysis does not read, and the host could not locate it"),
            (Some(serde_json::json!(["groups.ts"])), "'@opaque/workspace' is a local package the analysis does not read"),
        ] {
            let (extracted, failed, named) = run(&[("api/server.ts", load)], reaches);
            assert!(!extracted && failed == ["Box"], "{failed:?}");
            let [named] = named.as_slice() else { panic!("{named:?}") };
            for said in [
                "api/server.ts:1 ",
                package,
                "api/server.ts loads it at runtime with require() on line 1",
                "1 declaration that read an exported object is not extracted, whole or in part: Box (box.tsx:3)",
                "exclude them from the analysis: add 'api/**' to exclude",
            ] {
                assert!(named.contains(said), "{said}: {named}");
            }
        }
    }

    /// Contract: a module a config imports is judged as app code. An app
    /// entry no analysed module imports (a prerendering config imports it)
    /// runs in the app, so a mutation it imports still unsettles what a
    /// style reads; only the config file itself runs in its tool alone.
    #[test]
    fn a_module_a_config_imports_is_judged_as_app_code() {
        let base = [
            ("system.ts", "import { createSystem } from '@animus-ui/system';\nexport const ds = createSystem().build().seal();\n"),
            ("tokens.ts", "export const pad = { padding: '8px' };\n"),
            ("mutate.ts", "import { pad } from './tokens';\npad.padding = '16px';\n"),
            (
                "src/main.tsx",
                "import '../mutate';\nimport { ds } from '../system';\nimport { pad } from '../tokens';\nexport const C = ds.styles({ ...pad }).asElement('div');\nexport const App = () => <C />;\n",
            ),
        ];
        let stale = |config: &str| {
            let mut engine = ExtractEngine::new(None).unwrap();
            let mut files = base.to_vec();
            files.push(("vite.config.ts", config));
            // Without the app's own mutation, only the config's remains.
            if !config.contains("src/main") {
                files.retain(|(path, _)| *path != "mutate.ts");
                files[2].1 = "import { ds } from '../system';\nimport { pad } from '../tokens';\nexport const C = ds.styles({ ...pad }).asElement('div');\nexport const App = () => <C />;\n";
            }
            let json = serde_json::Value::Array(
                files.iter().map(|(path, source)| serde_json::json!({ "path": path, "source": source })).collect(),
            )
            .to_string();
            engine.analyze(json, None).unwrap().contains("padding: 8px")
        };
        assert!(!stale("import { App } from './src/main';\nexport default { plugins: [{ name: 'prerender', buildEnd() { void App; } }] };\n"));
        // A mutation the config file itself makes runs in its tool.
        assert!(stale("import { pad } from './tokens';\npad.padding = '16px';\nexport default {};\n"));
    }

    #[test]
    fn an_unregistered_reference_into_a_kits_compiled_output_names_its_source_condition() {
        let mut engine = ExtractEngine::new(Some(EngineOptions {
            keyframes_json: Some(
                r#"{"feedbackMotion":{"loaderDot":{"name":"animus-kf-honfj9","frames":{"from":{"opacity":0},"to":{"opacity":1}}}}}"#
                    .to_string(),
            ),
            package_resolution_json: Some(r#"{"@kit/ds":"node_modules/@kit/ds/dist/index.js"}"#.to_string()),
            analysis_context_json: Some(
                r#"{"packageDirs":["node_modules/@kit/ds/dist"],"outputDirs":["node_modules/@kit/ds/dist"]}"#.to_string(),
            ),
            ..Default::default()
        }))
        .unwrap();
        let manifest: serde_json::Value = serde_json::from_str(
            &engine
                .analyze(
                    serde_json::json!([
                        { "path": "node_modules/@kit/ds/dist/chunk.js", "source": "const feedbackMotion = createKeyframes({ loaderDot: { from: { opacity: 0 }, to: { opacity: 1 } } });\nconst Spinner = ds.styles({ animationName: feedbackMotion.loaderDot }).asElement('i');\nexport { feedbackMotion as n, Spinner as s };\n" },
                        { "path": "node_modules/@kit/ds/dist/index.js", "source": "import { n as feedbackMotion, s as Spinner } from './chunk.js';\nexport { feedbackMotion, Spinner };\n" },
                        { "path": "motion.ts", "source": "export const localMotion = createKeyframes({ loaderDot: { from: { opacity: 0 }, to: { opacity: 1 } } });\n" },
                        { "path": "a.tsx", "source": "import { feedbackMotion, Spinner } from '@kit/ds';\nimport { localMotion } from './motion';\nexport const LoaderDot = ds.styles({ animationName: feedbackMotion.loaderDot }).asElement('span');\nexport const Local = ds.styles({ animationName: localMotion.loaderDot }).asElement('span');\nexport const App = () => <><LoaderDot /><Local /><Spinner /></>;\n" }
                    ])
                    .to_string(),
                    None,
                )
                .unwrap(),
        )
        .unwrap();
        let messages: std::collections::BTreeMap<&str, &str> = manifest["diagnostics"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|d| d["code"] == crate::eval::KEYFRAMES_UNREGISTERED_REFERENCE)
            .map(|d| (d["component"].as_str().unwrap(), d["message"].as_str().unwrap()))
            .collect();
        assert_eq!(messages.keys().copied().collect::<Vec<_>>(), ["LoaderDot", "Local", "Spinner"], "{manifest}");
        for component in ["LoaderDot", "Spinner"] {
            let message = messages[component];
            assert!(
                message.contains("'feedbackMotion' is declared in node_modules/@kit/ds/dist/chunk.js, a kit's compiled output"),
                "{message}"
            );
            assert!(
                message.contains(r#"publish the kit with an "animus" export condition naming its source"#),
                "{message}"
            );
        }
        assert!(!messages["Local"].contains("compiled output"), "{}", messages["Local"]);
    }

    #[test]
    fn record_entry_wins_over_a_same_named_static_export() {
        let mut engine = ExtractEngine::new(Some(EngineOptions {
            keyframes_json: Some(
                r#"{"motion":{"ember":{"name":"animus-kf-abc123","frames":{"from":{"opacity":0.4},"to":{"opacity":1}}}}}"#
                    .to_string(),
            ),
            ..Default::default()
        }))
        .unwrap();
        let manifest: serde_json::Value = serde_json::from_str(
            &engine
                .analyze(
                    serde_json::json!([
                        { "path": "system.ts", "source": "export const motion = { ember: 'placeholder' };\n" },
                        { "path": "a.tsx", "source": "import { motion } from './system';\nexport const Ember = ds.styles({ animationName: motion.ember }).asElement('span');\nexport const App = () => <Ember />;\n" }
                    ])
                    .to_string(),
                    None,
                )
                .unwrap(),
        )
        .unwrap();

        let css = manifest["css"].as_str().unwrap_or("");
        assert!(
            css.contains("animation-name:animus-kf-abc123")
                || css.contains("animation-name: animus-kf-abc123"),
            "the record entry must win: {css}"
        );
        assert!(
            !css.contains("placeholder"),
            "the static export must be shadowed by the record: {css}"
        );
    }

    #[test]
    fn global_blocks_populate_global_sheet() {
        let mut engine = ExtractEngine::new(Some(EngineOptions {
            global_style_blocks_json: Some(r#"{"reset": {"body": {"margin": 0}}}"#.to_string()),
            ..Default::default()
        }))
        .unwrap();
        let out = engine
            .analyze(r#"[{"path":"a.tsx","source":"const x = 1;"}]"#.to_string(), None)
            .unwrap();
        assert!(out.contains("anm-global"), "{out}");
        assert!(out.contains("margin"), "{out}");
    }

    #[test]
    fn multibyte_preamble_does_not_shear_spans() {
        // oxc spans are BYTE offsets, so a multibyte preamble shifts them
        // away from char counts; the splice must still land on the chain.
        let mut engine = ExtractEngine::new(None).unwrap();
        engine
            .analyze(
                r#"[{"path":"a.tsx","source":"const label = '日本語ラベル';\nconst x = '🔥頑張って';\nexport const C = ds.styles({ display: 'flex' }).asElement('div');\nexport const App = () => <C title={label} />;\n"}]"#
                    .to_string(),
                None,
            )
            .unwrap();
        let out = engine.transform_file("a.tsx".to_string()).unwrap();
        assert!(out.contains("createComponent('div'"), "{out}");
        assert!(out.contains("日本語ラベル"), "{out}");
        assert!(out.contains("🔥頑張って"), "{out}");
        assert!(!out.contains("ds.styles"), "{out}");
    }

    #[test]
    fn clear_cache_resets() {
        let mut engine = ExtractEngine::new(None).unwrap();
        engine
            .analyze(r#"[{"path":"a.tsx","source":"const x = 1;"}]"#.to_string(), None)
            .unwrap();
        engine.clear_cache();
        assert!(engine.facts.is_empty());
        assert_eq!(engine.parse_count, 0);
    }

    #[test]
    fn an_import_a_retained_builder_references_is_never_removed() {
        let import = "import { animus } from '@animus-ui/system';";
        // (case, a chain that bails beside the replaced one, import kept)
        let cases = [
            ("a bailed chain beside a replaced one", "export const B = animus.styles(dyn()).asElement('span');\n", true),
            ("every chain replaced", "", false),
        ];
        for (case, bailed, kept) in cases {
            let source = format!(
                "{import}\nconst dyn = () => ({{ color: 'red' }});\n\
                 export const A = animus.styles({{ display: 'flex' }}).asElement('div');\n\
                 {bailed}export const App = () => <A />;\n"
            );
            let mut engine = ExtractEngine::new(None).unwrap();
            engine
                .analyze(serde_json::json!([{ "path": "a.tsx", "source": source }]).to_string(), None)
                .unwrap();
            let out: serde_json::Value =
                serde_json::from_str(&engine.transform_file("a.tsx".to_string()).unwrap()).unwrap();
            let code = out["code"].as_str().unwrap();
            assert!(code.contains("createComponent('div'"), "{case}: {code}");
            assert_eq!(code.contains(import), kept, "{case}: {code}");
        }
    }

    #[test]
    fn a_pruned_imported_callback_keeps_its_module_imported_in_place() {
        let mut engine = ExtractEngine::new(None).unwrap();
        engine
            .analyze(
                serde_json::json!([
                    { "path": "poly.ts", "source": "globalThis.ready = true;\n" },
                    { "path": "cb.ts", "source": "export const shift = (v) => `${v}px`;\n" },
                    { "path": "kept.ts", "source": "export const kept = (v) => `${v}px`;\n" },
                    { "path": "kit.tsx", "source": "export const Kit = ds.props({ lift: { property: 'top', transform: (v) => `${v}px` } }).asElement('div');\n" },
                    {
                        "path": "a.tsx",
                        "source": "import './poly';\nimport { shift } from './cb'\nimport { kept } from './kept';\nimport { Kit } from './kit';\nconst Card = ds.props({ s: { property: 'minWidth', transform: shift } }).asElement('div');\nconst Kid = Kit.extend().asElement('i');\nexport const Live = ds.props({ k: { property: 'minHeight', transform: kept } }).asElement('div');\nexport const App = ({ n }) => <><Card s={10} /><Kid lift={10} /><Live k={n} /></>;\n",
                    },
                ])
                .to_string(),
                None,
            )
            .unwrap();
        let out: serde_json::Value =
            serde_json::from_str(&engine.transform_file("a.tsx".to_string()).unwrap()).unwrap();
        let code = out["code"].as_str().unwrap();
        // Each kept module stays where it was declared, so evaluation order holds.
        assert_eq!(code.matches("import \"./cb\";").count(), 1, "{code}");
        assert!(code.contains("import './poly';\nimport { shift } from './cb';import \"./cb\";\n"), "{code}");
        assert!(code.contains("import { Kit } from './kit';import \"./kit\";\n"), "{code}");
        assert!(!code.contains("import \"./kept\";"), "{code}");
    }

    #[test]
    fn chains_continue_from_staged_builders() {
        // A chain continued from a same-module staged builder carries the
        // builder's stages, and the builder's declaration leaves the module
        // once every reference to it is such a chain.
        let mut engine = ExtractEngine::new(None).unwrap();
        let source = "const base = ds.styles({ paddingLeft: '2px' });\n\
            export const Staged = base.variant({ prop: 'size', variants: { sm: { marginTop: '1px' } } }).asElement('div');\n\
            export const Twin = base.asElement('span');\n\
            export const Parent = ds.styles({ marginLeft: '4px' }).asElement('div');\n\
            const ext = Parent.extend().styles({ paddingTop: '3px' });\n\
            export const Extended = ext.asElement('p');\n\
            const kept = ds.styles({ paddingRight: '5px' });\n\
            export const FromKept = kept.asElement('i');\n\
            export const useKept = () => kept;\n\
            export const shared = ds.styles({ paddingBottom: '6px' });\n\
            export const FromShared = shared.asElement('b');\n\
            export const App = () => <><Staged size='sm' /><Twin /><Extended /><FromKept /><FromShared /></>;\n";
        let out = engine
            .analyze(serde_json::json!([{ "path": "a.tsx", "source": source }]).to_string(), None)
            .unwrap();
        let manifest: serde_json::Value = serde_json::from_str(&out).unwrap();
        let css = manifest["css"].as_str().unwrap();
        let rule = |binding: &str, suffix: &str| {
            let class = manifest["components"][format!("a.tsx::{binding}")]["class_name"]
                .as_str()
                .unwrap_or_else(|| panic!("{binding} is not extracted: {css}"));
            let open = format!(".{class}{suffix} {{");
            let start = css.find(&open).unwrap_or_else(|| panic!("no {open}: {css}"));
            css[start..start + css[start..].find('}').unwrap()].to_string()
        };
        assert!(rule("Staged", "").contains("padding-left: 2px"), "{css}");
        assert!(rule("Staged", "--size-sm").contains("margin-top: 1px"), "{css}");
        assert!(rule("Twin", "").contains("padding-left: 2px"), "{css}");
        let extended = rule("Extended", "");
        assert!(extended.contains("margin-left: 4px") && extended.contains("padding-top: 3px"), "{css}");
        assert!(rule("FromKept", "").contains("padding-right: 5px"), "{css}");
        // An exported builder is out of reach: another module may continue it.
        assert!(manifest["components"].get("a.tsx::FromShared").is_none(), "{css}");

        let code: serde_json::Value =
            serde_json::from_str(&engine.transform_file("a.tsx".to_string()).unwrap()).unwrap();
        let code = code["code"].as_str().unwrap();
        assert!(!code.contains("const base") && !code.contains("const ext"), "{code}");
        // An extracted parent cannot extend at runtime.
        assert!(!code.contains(".extend("), "{code}");
        assert!(code.contains("const kept = ds.styles"), "{code}");
        assert!(code.contains("export const shared = ds.styles"), "{code}");
    }

    /// Every spelling of one path is one analysis identity; case, a query, a
    /// parent above a relative start and each kind of root stay distinct,
    /// and no `..` climbs past a root (Node's `path.win32.normalize` cases).
    #[test]
    fn spellings_of_one_path_share_an_analysis_id() {
        for (path, id) in [
            ("a/b.tsx", "a/b.tsx"),
            ("a\\b.tsx", "a/b.tsx"),
            ("./a.tsx", "a.tsx"),
            ("dir/../a.tsx", "a.tsx"),
            ("a//b/./c.tsx", "a/b/c.tsx"),
            ("../../packages/ui/x.tsx", "../../packages/ui/x.tsx"),
            ("/root/../x.tsx", "/x.tsx"),
            ("/../x.tsx", "/x.tsx"),
            ("\\..\\x.tsx", "/x.tsx"),
            ("A.tsx", "A.tsx"),
            ("a.svelte?type=script&lang=../x", "a.svelte?type=script&lang=../x"),
            ("./a.svelte?raw", "a.svelte?raw"),
            ("C:/../a.tsx", "C:/a.tsx"),
            ("C:\\..\\a.tsx", "C:/a.tsx"),
            ("C:\\x\\..\\..\\y.tsx", "C:/y.tsx"),
            ("C:..\\a.tsx", "C:../a.tsx"),
            ("C:x\\..\\..\\y.tsx", "C:../y.tsx"),
            ("C:", "C:"),
            ("C:/", "C:/"),
            ("//host/share/../../a.tsx", "//host/share/a.tsx"),
            ("\\\\host\\share\\..\\..\\a.tsx", "//host/share/a.tsx"),
            ("//host/share/a.tsx", "//host/share/a.tsx"),
            ("/host/share/a.tsx", "/host/share/a.tsx"),
        ] {
            assert_eq!(canonical_analysis_id(path), id, "{path}");
        }
    }

    /// A path listed twice with the same source is analysed once; listed
    /// twice with different sources, or as two spellings of one file, it
    /// fails the analysis. A query names another input.
    #[test]
    fn a_file_listed_twice_is_one_input_or_a_failure() {
        let analyze = |entries: &[(&str, &str)]| {
            let mut engine = ExtractEngine::new(None).unwrap();
            let entries: Vec<_> =
                entries.iter().map(|(path, source)| serde_json::json!({ "path": path, "source": source })).collect();
            engine.analyze(serde_json::Value::from(entries).to_string(), None).map(|_| engine.parse_count).map_err(|e| e.reason)
        };
        let (one, two) = ("export const x = 1;", "export const x = 2;");
        assert_eq!(analyze(&[("a.tsx", one), ("a.tsx", one)]), Ok(1));
        let failure = analyze(&[("a.tsx", one), ("a.tsx", two)]).unwrap_err();
        assert!(failure.contains("'a.tsx' twice with different sources"), "{failure}");
        for (first, second) in [("a.tsx", "./a.tsx"), ("a.tsx", "dir/../a.tsx"), ("a/b.tsx", "a\\b.tsx")] {
            for source in [one, two] {
                let failure = analyze(&[(first, one), (second, source)]).unwrap_err();
                assert!(failure.contains("list one file as"), "{first} {second}: {failure}");
                assert!(failure.contains(first) && failure.contains(second), "{first} {second}: {failure}");
            }
        }
        assert_eq!(analyze(&[("a.tsx", one), ("a.tsx?raw", two)]), Ok(2));
    }

    /// Contract: a call to an admitted function that only returns its
    /// argument is not an escape (spec §6.6 F11, F11a). The call's result
    /// holds the argument, and a write or escape through it, or through a
    /// function's own `const` alias of one of its members, still reaches
    /// the argument. Each row: its name, the module that uses `pad`, and
    /// whether `pad` still extracts.
    #[test]
    fn a_call_to_an_admitted_function_that_only_returns_its_argument_is_not_an_escape() {
        const FACTORY: &str = "import { pad } from './tokens.js';\nconst define = () => (parts) => parts;\n\
                               export const c = define()({ Part: { element: 'div', admission: { props: pad } } });\n";
        const REFERENCE: &str = "const parts = { ...c };\n\
                                 function text(part) { return [part.element, Object.keys(part.admission.props).join(',')].join(' '); }\n\
                                 export function referenceText(name) { const part = parts[name]; if (part) return text(part); return ''; }\n";
        let rows: [(&str, String, bool); 15] = [
            ("a factory's closure returns its argument", FACTORY.to_string(), true),
            (
                "the factory writes its argument",
                FACTORY.replace("(parts) => parts", "(parts) => { parts.x = 1; return parts; }"),
                false,
            ),
            (
                "the factory hands on a member of its argument",
                FACTORY.replace("(parts) => parts", "(parts) => { register(parts.Part); return parts; }"),
                false,
            ),
            ("the result is written below the argument", format!("{FACTORY}c.Part.admission.props.padding = 9;\n"), false),
            (
                "the result's primitive is read, then written",
                format!("{FACTORY}export const n = c.Part.admission.props.padding;\nc.Part.admission.props.padding = 9;\n"),
                false,
            ),
            ("the result is handed on", format!("{FACTORY}register(c);\n"), false),
            (
                "a fresh result's member that holds the argument is handed on",
                "import { pad } from './tokens.js';\nconst id = (p) => ({ inner: p });\nexport const held = id(pad);\n\
                 function mutate(x) { x.padding = 9; }\nmutate(held.inner);\n"
                    .to_string(),
                false,
            ),
            (
                "a fresh result's other member is handed on",
                "import { pad } from './tokens.js';\nconst id = (p) => ({ inner: p, other: { q: 1 } });\nexport const held = id(pad);\n\
                 register(held.other);\n"
                    .to_string(),
                true,
            ),
            ("an uncalled function returns pad", "import { pad } from './tokens.js';\nconst get = () => pad;\n".to_string(), true),
            (
                "a member of a held call result that holds pad is handed on",
                "import { pad } from './tokens.js';\nconst get = () => ({ inner: pad });\nexport const g = get();\nregister(g.inner);\n".to_string(),
                false,
            ),
            (
                "a held call result is written",
                "import { pad } from './tokens.js';\nconst get = () => pad;\nexport const g = get();\ng.padding = 9;\n".to_string(),
                false,
            ),
            ("a function's own alias only reads the member", format!("{FACTORY}{REFERENCE}"), true),
            (
                "the alias writes the member",
                format!("{FACTORY}{}", REFERENCE.replace("const part = parts[name];", "const part = parts[name]; part.admission.props.padding = 9;")),
                false,
            ),
            // A closure's captured uses are its own body's, path by path: one
            // handed to unknown code still only reads a primitive member.
            (
                "a closure handed out captures the alias",
                format!("{FACTORY}{}", REFERENCE.replace("const part = parts[name];", "const part = parts[name]; external(() => { log(part.element); });")),
                true,
            ),
            (
                "a closure handed out hands on the held path",
                format!("{FACTORY}{}", REFERENCE.replace("const part = parts[name];", "const part = parts[name]; external(() => { log(part.admission); });")),
                false,
            ),
        ];
        for (row, contract, extracts) in rows {
            let mut engine = ExtractEngine::new(None).unwrap();
            let files = serde_json::json!([
                { "path": "tokens.js", "source": "export const pad = { padding: 4 };\n" },
                { "path": "contract.js", "source": contract },
                {
                    "path": "reader.tsx",
                    "source": "import './contract.js';\nimport { pad } from './tokens.js';\n\
                               export const C = ds.styles({ ...pad }).asElement('div');\nexport const App = () => <C />;\n",
                },
            ]);
            let out: serde_json::Value = serde_json::from_str(&engine.analyze(files.to_string(), None).unwrap()).unwrap();
            assert_eq!(out["css"].as_str().unwrap_or_default().contains("padding"), extracts, "{row}: {}", out["diagnostics"]);
        }
        // An object held deeper than Flow's path bound is held whole: a
        // change anywhere around it reaches it, however deep it sits.
        for depth in [8, 9, 12] {
            let keys: Vec<String> = (0..depth).map(|i| format!("k{i}")).collect();
            let nest = |inner: &str| keys.iter().rev().fold(inner.to_string(), |held, key| format!("{{ {key}: {held} }}"));
            let path = keys.join(".");
            let shapes = [
                format!("const id = (p) => ({});\nexport const held = id(pad);\n", nest("p")),
                format!("const id = () => ({});\nexport const held = id();\n", nest("pad")),
                format!("export const held = {};\n", nest("pad")),
            ];
            for shape in shapes {
                let contract = format!(
                    "import {{ pad }} from './tokens.js';\n{shape}function mutate(x) {{ x.padding = 9; }}\nmutate(held.{path});\n"
                );
                let mut engine = ExtractEngine::new(None).unwrap();
                let files = serde_json::json!([
                    { "path": "tokens.js", "source": "export const pad = { padding: 4 };\n" },
                    { "path": "contract.js", "source": contract },
                    {
                        "path": "reader.tsx",
                        "source": "import './contract.js';\nimport { pad } from './tokens.js';\n\
                                   export const C = ds.styles({ ...pad }).asElement('div');\nexport const App = () => <C />;\n",
                    },
                ]);
                let out: serde_json::Value = serde_json::from_str(&engine.analyze(files.to_string(), None).unwrap()).unwrap();
                assert!(!out["css"].as_str().unwrap_or_default().contains("padding"), "depth {depth}: {contract}");
            }
        }
    }

    /// Contract: proven read-only uses of a held stage input are reads (the
    /// owner's ruling for docs-style catalogs, refining spec §6.6 F10, F11a):
    /// a module-scope `const` alias is followed, not an escape; `Object.hasOwn`
    /// reads keys; a logical operand only tested is read; a closure's uses of
    /// a captured binding are judged one by one, so a closure handed out
    /// escapes only the paths its own body hands on; and `Object.entries`
    /// results through `filter`/`map` callbacks are followed per path. A
    /// write, a hand-on of the held path or of the whole binding, a value
    /// built from it that escapes, or code the extractor cannot read still
    /// refuses. Each row: its name, the docs module, and whether `pad`
    /// extracts.
    #[test]
    fn proven_read_only_uses_of_a_held_stage_input_are_reads() {
        const CONTRACT: &str = "import { pad } from './tokens.js';\n\
            export const catalog = { Part: { element: 'div', description: 'd', admission: { name: 'P', props: pad }, \
            props: { size: { kind: 'variant', description: 's' } } } };\n\
            export const admissions = { P: pad };\n";
        const ALIAS: &str = "import { catalog } from './contract.js';\nconst checked = catalog;\n\
            export function doc(name) { const part = checked[name]; return { name, element: part.element }; }\n";
        const HAS_OWN: &str = "import { admissions } from './contract.js';\n\
            export const isAdmission = (name) => Object.hasOwn(admissions, name);\n";
        const TESTED: &str = "import { catalog } from './contract.js';\n\
            export function doc(name) { const part = catalog[name]; return part.admission && part.admission.name ? { system: part.admission.name } : {}; }\n";
        const CLOSURE: &str = "import { catalog } from './contract.js';\n\
            export const Pilot = ({ name }) => { const part = catalog[name]; return <Table control={(key) => <Control fact={part.props[key]} />} />; };\n";
        const ENTRIES: &str = "import { catalog } from './contract.js';\n\
            export const List = ({ term }) => { const parts = Object.entries(catalog).filter(([name, part]) => \
            [name, part.description, ...Object.keys(part.props)].some((value) => value.includes(term))); \
            return parts.map(([name, part]) => <Row key={name} text={part.description} />); };\n";
        let closure = |body: &str| CLOSURE.replace("(key) => <Control fact={part.props[key]} />", body);
        let rows: Vec<(&str, String, bool)> = vec![
            ("a module-scope alias only read", ALIAS.to_string(), true),
            ("Object.hasOwn reads keys", HAS_OWN.to_string(), true),
            ("a logical operand only tested", TESTED.to_string(), true),
            ("a closure handed out reads a disjoint path", CLOSURE.to_string(), true),
            ("Object.entries results through filter and map", ENTRIES.to_string(), true),
            ("the whole chain", format!("{ALIAS}{}", [HAS_OWN, TESTED, CLOSURE, ENTRIES].map(|m| m.lines().skip(1).collect::<Vec<_>>().join("\n")).join("\n")).replace("import { catalog } from './contract.js';", "import { catalog, admissions } from './contract.js';"), true),
            ("the alias is written", format!("{ALIAS}checked.Part.admission.props.padding = 9;\n"), false),
            ("hasOwn is not the global one", format!("const Object = {{ hasOwn: (o) => {{ o.P.padding = 9; }} }};\n{HAS_OWN}"), false),
            ("the closure hands on the held path", closure("(key) => { log(part.admission); return null; }"), false),
            ("the closure writes the held path", closure("(key) => { part.admission.props.x = 1; return null; }"), false),
            ("the closure returns the binding", closure("() => part"), false),
            ("the closure passes the binding whole", closure("() => register(part)"), false),
            ("the closure returns a value holding the held path", closure("() => ({ held: part.admission })"), false),
            ("the closure stores the held path", closure("() => { store.held = part.admission; return null; }"), false),
            ("the closure calls through a computed member", closure("(key) => part[key]()"), false),
            ("the closure reads arguments", closure("function (key) { log(arguments); return <Control fact={part.props[key]} />; }"), false),
            (
                "a filter callback writes",
                ENTRIES.replace("[name, part.description, ...Object.keys(part.props)]", "(part.admission.props.padding = 9, [name])"),
                false,
            ),
            ("the filtered entries are handed on", format!("{}register(Object.entries(catalog).filter(() => true));\n", ENTRIES), false),
            (
                "a function callback reaches an element through arguments",
                format!("{ENTRIES}Object.values(catalog).forEach(function () {{ arguments[0].admission.props.padding = 9; }});\n"),
                false,
            ),
            (
                "a function callback with a parameter reaches it through arguments too",
                format!("{ENTRIES}Object.values(catalog).forEach(function (p) {{ if (p) arguments[0].admission.props.padding = 9; }});\n"),
                false,
            ),
            (
                "an entries callback reaches the pair through arguments",
                format!("{ENTRIES}Object.entries(catalog).forEach(function ([k, p]) {{ arguments[0][1].admission.props.padding = 9; }});\n"),
                false,
            ),
            (
                "a closure declared first hands the filtered entries on",
                ENTRIES.replace("const parts = ", "function leak() { register(parts); }\n leak();\n const parts = "),
                false,
            ),
        ];
        let mut wrong = Vec::new();
        for (row, docs, extracts) in rows {
            let mut engine = ExtractEngine::new(None).unwrap();
            let files = serde_json::json!([
                { "path": "tokens.js", "source": "export const pad = { padding: 4 };\n" },
                { "path": "contract.js", "source": CONTRACT },
                { "path": "docs.tsx", "source": docs },
                {
                    "path": "reader.tsx",
                    "source": "import './docs.tsx';\nimport { pad } from './tokens.js';\n\
                               export const C = ds.styles({ ...pad }).asElement('div');\nexport const App = () => <C />;\n",
                },
            ]);
            let out: serde_json::Value = serde_json::from_str(&engine.analyze(files.to_string(), None).unwrap()).unwrap();
            if out["css"].as_str().unwrap_or_default().contains("padding") != extracts {
                let why: Vec<String> = out["diagnostics"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|d| d["message"].as_str().map(str::to_string))
                    .collect();
                wrong.push(format!("{row} (extracts: {extracts}): {why:?}"));
            }
        }
        assert!(wrong.is_empty(), "{}", wrong.join("\n"));
    }

    /// Contract: analysis output is independent of the order the caller
    /// lists files in. Composed-family rules and the whole-component
    /// removal report's examples both once followed it.
    #[test]
    fn analysis_output_is_independent_of_caller_file_order() {
        let family = |name: &str, display: &str| {
            format!(
                "import {{ compose }} from '@animus-ui/system/compose';\nimport {{ ds }} from './ds';\n\
                 export const Root = ds.styles({{ display: '{display}' }})\
                 .variant({{ prop: 'density', variants: {{ compact: {{ gap: 4 }}, loose: {{ gap: 12 }} }} }}).asElement('div');\n\
                 export const Header = ds.styles({{}})\
                 .variant({{ prop: 'density', variants: {{ compact: {{ margin: 2 }}, loose: {{ margin: 8 }} }} }}).asElement('header');\n\
                 export const {name} = compose({{ Root, Header }}, {{ name: '{name}', shared: {{ density: true }} }});\n"
            )
        };
        let files = [
            ("ds.ts", "import { createSystem } from '@animus-ui/system';\nexport const ds = createSystem().build();\n".to_string()),
            ("one.tsx", family("FamOne", "flex")),
            ("two.tsx", family("FamTwo", "grid")),
            (
                "app.tsx",
                "import { FamOne } from './one';\nimport { FamTwo } from './two';\nimport { Outside } from 'elsewhere';\n\
                 export const App = () => <><FamOne.Root density=\"compact\"><FamOne.Header /></FamOne.Root>\
                 <FamTwo.Root density=\"loose\"><FamTwo.Header /></FamTwo.Root><Outside /></>;\n"
                    .to_string(),
            ),
            ("page.tsx", "import { Widget } from 'unknown-lib';\nexport const Page = () => <Widget />;\n".to_string()),
        ];
        let run = |order: [usize; 5]| {
            let mut engine = ExtractEngine::new(None).unwrap();
            let entries: Vec<_> =
                order.iter().map(|&i| serde_json::json!({ "path": files[i].0, "source": files[i].1 })).collect();
            let analysis = engine.analyze(serde_json::Value::from(entries).to_string(), None).unwrap();
            let transforms: Vec<String> =
                files.iter().map(|(path, _)| engine.transform_file(path.to_string()).unwrap()).collect();
            (analysis, transforms)
        };
        let given = run([0, 1, 2, 3, 4]);
        for order in [[4, 3, 2, 1, 0], [2, 4, 0, 3, 1]] {
            assert_eq!(run(order), given, "files in the order {order:?}");
        }
    }

    /// The `builderFiles` an analysis of `files` lists, and each file's
    /// transformed code.
    fn builder_marks(files: &[(&str, &str)]) -> (serde_json::Value, BTreeMap<String, String>) {
        let entries: Vec<serde_json::Value> =
            files.iter().map(|(path, source)| serde_json::json!({ "path": path, "source": source })).collect();
        let mut engine = ExtractEngine::new(None).unwrap();
        let manifest: serde_json::Value =
            serde_json::from_str(&engine.analyze(serde_json::Value::Array(entries).to_string(), None).unwrap()).unwrap();
        let code = files
            .iter()
            .map(|(path, _)| {
                let result: serde_json::Value =
                    serde_json::from_str(&engine.transform_file(path.to_string()).unwrap()).unwrap();
                (path.to_string(), result["code"].as_str().unwrap().to_string())
            })
            .collect();
        (manifest["builderFiles"].clone(), code)
    }

    /// Contract: an unread system drops its builder, and a mark never drops
    /// an effect. A top-level chain is marked `/* @__PURE__ */` where every
    /// step is a listed builder method on a proven receiver and every
    /// argument is passive data or a proven value, an import counting only
    /// where its own module proves it; a destructured factory becomes one
    /// annotated read per name, on the same lines, of the initializer as
    /// written; the manifest names each marked file in `builderFiles`.
    /// Each shape the cold review of 4eb5ff8d ran, and the earlier
    /// unmarked shapes, stays exactly as written.
    #[test]
    fn proven_builder_chains_are_annotated_pure() {
        use oxc::ast::ast::{Expression, Statement};
        let kit = "import { createSystem, createTheme, firstThatWorks } from '@animus-ui/system';\n\
            export const kitTheme = createTheme().addScale({ name: 'space', values: { 1: '4px' } }).build();\n\
            const bundle = createSystem().build();\n\
            export const {\n  createKeyframes,\n} = bundle;\n\
            export const motion = createKeyframes({ fade: { from: { opacity: 0 } } });\n\
            const faces = [{ family: 'Kit', src: [{ url: 'kit.woff2', format: 'woff2' }] }];\n\
            export const system = bundle.registerKeyframes({ motion, faces, w: firstThatWorks('1px', '2px') }).seal();\n\
            createSystem().build();\n";
        let app = "import { createSystem, createTheme } from '@animus-ui/system';\n\
            import { system, kitTheme } from './kit';\n\
            export const theme = createTheme().extend(kitTheme).build();\n\
            const asserted = createSystem().extend(system).build();\n\
            export const { createGlobalStyles } = asserted as typeof asserted;\n\
            export const ds = asserted.registerGlobalStyles({ reboot: createGlobalStyles({ body: { margin: 0 } }) }).seal();\n";
        let (builder_files, code) = builder_marks(&[("kit.ts", kit), ("app.ts", app)]);
        assert_eq!(builder_files, serde_json::json!(["app.ts", "kit.ts"]));
        assert_eq!(
            code["kit.ts"],
            "import { createSystem, createTheme, firstThatWorks } from '@animus-ui/system';\n\
            export const kitTheme = /* @__PURE__ */ createTheme().addScale({ name: 'space', values: { 1: '4px' } }).build();\n\
            const bundle = /* @__PURE__ */ createSystem().build();\n\
            export const createKeyframes = /* @__PURE__ */ (() => (bundle).createKeyframes)()\n\n;\n\
            export const motion = /* @__PURE__ */ createKeyframes({ fade: { from: { opacity: 0 } } });\n\
            const faces = [{ family: 'Kit', src: [{ url: 'kit.woff2', format: 'woff2' }] }];\n\
            export const system = /* @__PURE__ */ bundle.registerKeyframes({ motion, faces, w: firstThatWorks('1px', '2px') }).seal();\n\
            /* @__PURE__ */ createSystem().build();\n"
        );
        assert_eq!(
            code["app.ts"],
            "import { createSystem, createTheme } from '@animus-ui/system';\n\
            import { system, kitTheme } from './kit';\n\
            export const theme = /* @__PURE__ */ createTheme().extend(kitTheme).build();\n\
            const asserted = /* @__PURE__ */ createSystem().extend(system).build();\n\
            export const createGlobalStyles = /* @__PURE__ */ (() => (asserted as typeof asserted).createGlobalStyles)();\n\
            export const ds = /* @__PURE__ */ asserted.registerGlobalStyles({ reboot: createGlobalStyles({ body: { margin: 0 } }) }).seal();\n"
        );
        // Once types are erased the read is still of the factory: the IIFE
        // returns `(asserted as …).createGlobalStyles`.
        let allocator = oxc::allocator::Allocator::default();
        let parsed = oxc::parser::Parser::new(&allocator, &code["app.ts"], oxc::span::SourceType::ts()).parse();
        assert!(parsed.diagnostics.is_empty(), "{:?}", parsed.diagnostics);
        let read = parsed.program.body.iter().find_map(|statement| {
            let Statement::ExportDeclaration(export) = statement else { return None };
            let oxc::ast::ast::Declaration::VariableDeclaration(declaration) = &export.declaration else { return None };
            let declarator = &declaration.declarations[0];
            (declarator.id.get_identifier_name()? == "createGlobalStyles").then_some(declarator.init.as_ref()?)
        });
        let Some(Expression::CallExpression(call)) = read.map(Expression::get_inner_expression) else {
            panic!("no IIFE read in {}", code["app.ts"])
        };
        let Expression::ArrowFunctionExpression(arrow) = call.callee.get_inner_expression() else { panic!("no arrow") };
        let Some(Expression::StaticMemberExpression(member)) = arrow.body.as_expression() else {
            panic!("not a member read")
        };
        assert_eq!(member.property.name, "createGlobalStyles");
        assert!(matches!(member.object.get_inner_expression(), Expression::Identifier(object) if object.name == "asserted"));

        let i = "import { createSystem as cs, createTheme } from '@animus-ui/system';\n";
        let negatives: Vec<(&str, String)> = vec![
            // The cold review's shapes.
            ("callback.ts", format!("{i}createTheme().addScale({{ name: 'space', values: {{ sm: '4px' }} }}).extendScale('space', (t) => {{ globalThis.events.push(1); return t; }}).build();\n")),
            ("bare-seal.ts", format!("{i}const bundle = cs().build();\nbundle.seal();\nglobalThis.r = (() => {{ try {{ bundle.seal(); return 1; }} catch {{ return 2; }} }})();\n")),
            ("replaced.ts", format!("{i}const builder = cs();\nbuilder.addSelectors = function () {{ return this; }};\nbuilder.addSelectors({{ _hover: '&:hover' }}).build();\n")),
            ("getter.ts", format!("{i}const config = {{ get _hover() {{ globalThis.events.push(1); return '&:hover'; }} }};\ncs().addSelectors(config).build();\n")),
            ("member.ts", format!("{i}const holder = {{ config: {{ _hover: '&:hover' }} }};\ncs().addSelectors(holder.config).build();\n")),
            ("spread.ts", format!("{i}const config = {{ get _hover() {{ globalThis.events.push(1); return '&:hover'; }} }};\ncs().addSelectors({{ ...config }}).build();\n")),
            ("coerce.ts", format!("{i}const key = {{ [Symbol.toPrimitive]() {{ return '&:hover'; }} }};\ncs().addSelectors({{ _hover: `${{key}}` }}).build();\n")),
            ("computed.ts", format!("{i}const key = '_hover';\ncs().addSelectors({{ [key]: '&:hover' }}).build();\n")),
            ("iterator.ts", format!("{i}const steps = ['4px'];\ncreateTheme().addScale({{ name: 'space', values: [...steps] }}).build();\n")),
            ("tdz.ts", format!("{i}cs().addSelectors(config).build();\nconst config = {{ _hover: '&:hover' }};\n")),
            ("written.ts", format!("{i}const config = {{ _hover: '&:hover' }};\nObject.defineProperty(config, '_focus', {{ get() {{ return '&:focus'; }} }});\ncs().addSelectors(config).build();\n")),
            ("proto.ts", format!("{i}cs().addSelectors({{ __proto__: null, _hover: '&:hover' }}).build();\n")),
            ("twice.ts", format!("{i}const bundle = cs().build();\nexport const a = bundle.seal();\nexport const b = bundle.seal();\n")),
            ("escaped.ts", format!("{i}export const bundle = cs().build();\nexport const a = bundle.seal();\n")),
            // Earlier unmarked shapes: aliased, reassigned, namespaced,
            // passed through, an effectful or unbound argument, a chain in a
            // function.
            ("earlier.ts", format!("{i}import * as s from '@animus-ui/system';\nimport {{ make }} from './maker';\nconst alias = cs;\nexport const a = alias().build();\nlet reassigned = cs().build();\nexport const b = s.createSystem().build();\nexport const c = make(cs()).build();\nexport const d = cs().addProps({{ x: {{ property: track() }} }}).build();\nexport const e = cs().addProps(window.config).build();\nexport const f = cs().extend(new Kit()).build();\nfunction inner() {{ return cs().build(); }}\n")),
        ];
        for (path, source) in &negatives {
            let (builder_files, code) = builder_marks(&[(path, source.as_str())]);
            assert!(builder_files.is_null(), "{path} listed: {builder_files}");
            assert_eq!(&code[*path], source, "{path} changed");
        }

        // An import counts only where its module proves it, no importer can
        // change it, and no cycle can read it early.
        let plain = ("plain.ts", "export const notChain = { system: 1 };\n");
        let reads_plain = ("reads-plain.ts", "import { createSystem } from '@animus-ui/system';\nimport { notChain } from './plain';\nexport const ds = createSystem().extend(notChain).build().seal();\n");
        let changes = ("changes.ts", "import { system } from './kit';\nsystem.extra = 1;\n");
        let cycle = ("cycle.ts", "import { createSystem } from '@animus-ui/system';\nimport { back } from './cycle-back';\nexport const sealed = createSystem().build().seal();\nexport const ds = createSystem().extend(back).build().seal();\n");
        let back = ("cycle-back.ts", "import { createSystem } from '@animus-ui/system';\nimport { sealed } from './cycle';\nexport const back = createSystem().extend(sealed).build().seal();\n");
        let extends_marked = "/* @__PURE__ */ createSystem().extend(";
        let (_, code) = builder_marks(&[plain, reads_plain]);
        assert_eq!(code["reads-plain.ts"], reads_plain.1);
        let (_, code) = builder_marks(&[("kit.ts", kit), ("app.ts", app), changes]);
        assert!(!code["app.ts"].contains(extends_marked), "{}", code["app.ts"]);
        let (_, code) = builder_marks(&[cycle, back]);
        assert!(!code["cycle.ts"].contains(extends_marked), "{}", code["cycle.ts"]);
        assert!(!code["cycle-back.ts"].contains(extends_marked), "{}", code["cycle-back.ts"]);
    }

    /// Contract: a compound needing a pruned option is dropped. A compound one
    /// of whose conditions names only variant options usage pruned can never
    /// match, so its rule goes; every other compound keeps its index, class
    /// and bytes, an axis usage cannot close (one with no default) prunes
    /// nothing, and neither does a state.
    #[test]
    fn a_compound_needing_a_pruned_option_is_dropped() {
        let source = |extra: &str| {
            format!(
                "export const Tag = ds.styles({{ padding: 1 }})\n\
                   .variant({{ prop: 'size', defaultVariant: 'sm', variants: {{ sm: {{ margin: 1 }}, md: {{ margin: 2 }}, lg: {{ margin: 3 }} }} }})\n\
                   .variant({{ prop: 'tone', variants: {{ calm: {{ color: 'blue' }}, loud: {{ color: 'red' }} }} }})\n\
                   .states({{ busy: {{ opacity: 0.5 }}, quiet: {{ opacity: 0.9 }} }})\n\
                   .compound({{ size: 'lg' }}, {{ order: 1 }})\n\
                   .compound({{ size: 'sm' }}, {{ order: 2 }})\n\
                   .compound({{ busy: true }}, {{ order: 3 }})\n\
                   .compound({{ size: ['md', 'lg'] }}, {{ order: 4 }})\n\
                   .compound({{ tone: 'loud' }}, {{ order: 5 }})\n\
                   .compound({{ size: ['sm', 'lg'] }}, {{ order: 6 }})\n\
                   .asElement('span');\n\
                 export const App = () => <><Tag size='sm' tone='calm' quiet />{extra}</>;\n"
            )
        };
        let css = |source: String| {
            let mut engine =
                ExtractEngine::new(Some(EngineOptions { dev_mode: Some(false), ..Default::default() })).unwrap();
            let manifest: serde_json::Value = serde_json::from_str(
                &engine.analyze(serde_json::json!([{ "path": "tag.tsx", "source": source }]).to_string(), None).unwrap(),
            )
            .unwrap();
            manifest["css"].as_str().unwrap().to_string()
        };
        let pruned = css(source(""));
        let rule = |css: &str, index: usize| {
            let at = css.find(&format!("--compound-{index}"))?;
            let end = css[at..].find('}')? + at + 1;
            Some(css[at..end].to_string())
        };
        // lg and md are pruned.
        for gone in [0, 3] {
            assert_eq!(rule(&pruned, gone), None, "compound {gone} kept:\n{pruned}");
        }
        // sm stays, so does a state's (busy is pruned, but no compound
        // condition records a state), tone has no default and stays whole, and
        // [sm, lg] needs sm.
        let all = css(source("<Tag size='lg' busy /><Tag size='md' tone='loud' />"));
        for kept in [1, 2, 4, 5] {
            let kept_rule = rule(&pruned, kept);
            assert!(kept_rule.is_some(), "compound {kept} dropped:\n{pruned}");
            assert_eq!(kept_rule, rule(&all, kept), "compound {kept} changed");
        }
        // With every option used, nothing goes.
        for index in 0..6 {
            assert!(rule(&all, index).is_some(), "compound {index} dropped with every option used:\n{all}");
        }
    }
}


