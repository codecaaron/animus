//! Stateful NAPI handle owning per-build facts and sources. State is
//! per-instance; malformed input and out-of-order calls are loud errors.

use std::collections::BTreeMap;

use crate::identity::LocalId;
use crate::link::ProjectLinks;
use crate::{analyze_css, assemble, ast_store, cross_file, emit, facts};
use animus_system_loader::module_table::{ExportLookup, ImportName, ModuleIndex, Request, Terminal};

const SYSTEM_PROPS_MODULE_ID: &str = "virtual:animus/system-props";

fn derive_compose_context_import(runtime_import: &str) -> String {
    if runtime_import.starts_with('@') {
        let parts: Vec<&str> = runtime_import.splitn(3, '/').collect();
        if parts.len() >= 2 {
            return format!("{}/{}/compose-with-context", parts[0], parts[1]);
        }
    }
    format!("{}/compose-with-context", runtime_import)
}

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
    report: &'a serde_json::Value,
    system_prop_map:
        &'a std::collections::BTreeMap<String, std::collections::BTreeMap<String, String>>,
    dynamic_props: &'a std::collections::BTreeMap<String, crate::dynamic_meta::DynamicPropMeta>,
    admitted_transforms: &'a std::collections::BTreeMap<String, String>,
    typed_system_props: &'a [String],
    component_fragments: &'a std::collections::BTreeMap<String, crate::css::PerComponentSheets>,
    system_fingerprint: &'a str,
    reverse_provenance: &'a std::collections::BTreeMap<String, Vec<String>>,
    components: &'a std::collections::BTreeMap<String, analyze_css::ComponentDescriptor>,
    files: &'a std::collections::BTreeMap<String, Vec<String>>,
    timing: serde_json::Value,
}

#[napi(object)]
#[derive(Default)]
pub struct EngineOptions {
    pub prefix: Option<String>,
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
}

struct ResolvedOptions {
    prefix: String,
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
    let Some(advice) = diagnostic.message.strip_suffix(&format!(" ({code})")) else {
        return;
    };
    diagnostic.message = format!(
        "{advice}; '{base}' is declared in {declared_in}, a kit's compiled output, where a bundler can rename a collection's export — publish the kit with an \"animus\" export condition naming its source, through which its keyframes resolve ({code})"
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
        needs.system_prop_groups |= !payload.system_group_names.is_empty();
        needs.typed_system_props |= has_system_props && payload.reads_typed_system_props;
        needs.dynamic_prop_config |= has_system_props && payload.has_dynamic_props;

        needs.transforms |= needs.dynamic_prop_config
            || payload
                .custom_dynamic_config
                .as_ref()
                .is_some_and(|config| {
                    config.values().filter_map(crate::dynamic_meta::DynamicPropMeta::value).any(|meta| {
                        meta.transform_id.is_some()
                    })
                });

        // A chain-stage reference or extended parent resolves at module
        // scope, where an import and a local cannot share a name.
        let import_of = |local: &str| file_facts.imports.iter().find(|import| import.local == local);
        if payload.drops_parent_reference {
            let parent = chain.descriptor.extends_from.as_deref().and_then(import_of);
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
    /// Computed once per analyze(); recomputing per transform is O(files²).
    cross: Option<cross_file::CrossFileFacts>,
    sources: BTreeMap<String, String>,
    /// The files of the last analyze(), by path: the canonical order every
    /// order-sensitive choice reads (registration collisions, first-wins
    /// utility dedup, composed-family rules, report examples), never the
    /// caller's.
    order: Vec<String>,
    css: Option<analyze_css::CssOutput>,
    parse_count: usize,
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
/// knows and every binding the open route may reach.
fn possible_bindings(links: &ProjectLinks, lookup: ExportLookup<LocalId>) -> Vec<(ModuleIndex, LocalId)> {
    let (terminals, openings) = match lookup {
        ExportLookup::Resolved(terminal) => (vec![terminal], Vec::new()),
        ExportLookup::Incomplete { known, openings } => (known, openings),
        ExportLookup::Absent | ExportLookup::Ambiguous(_) => return Vec::new(),
    };
    let mut found: Vec<(ModuleIndex, LocalId)> = local_bindings(terminals).collect();
    for opening in openings {
        found.extend(exposed_bindings(links, opening.name.as_deref()));
    }
    found.sort();
    found.dedup();
    found
}

/// The modules a file loads at runtime by a literal specifier:
/// `import('./x')` and `require('./x')`.
fn literal_module_loads(program: &oxc::ast::ast::Program<'_>) -> Vec<String> {
    use oxc::ast::ast::{Argument, CallExpression, Expression, ImportExpression};
    use oxc::ast_visit::Visit;
    struct Loads(Vec<String>);
    impl<'a> Visit<'a> for Loads {
        fn visit_import_expression(&mut self, import: &ImportExpression<'a>) {
            if let Expression::StringLiteral(literal) = &import.source {
                self.0.push(literal.value.to_string());
            }
            oxc::ast_visit::walk::walk_import_expression(self, import);
        }
        fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
            if call.callee.is_specific_id("require") {
                if let Some(Argument::StringLiteral(literal)) = call.arguments.first() {
                    self.0.push(literal.value.to_string());
                }
            }
            oxc::ast_visit::walk::walk_call_expression(self, call);
        }
    }
    let mut loads = Loads(Vec::new());
    loads.visit_program(program);
    loads.0
}

/// How a module runs code from a string, which can load any module: it
/// reads the unbound `eval` or `Function` as a value, so any call, alias or
/// `Reflect.construct` of it counts, or reads either as a member of the
/// unbound global object (`globalThis.eval`, `window.Function`). A type
/// query, and the bare name as a `typeof` operand or the right side of
/// `instanceof`, run nothing. Not followed: a computed member
/// (`globalThis['ev' + 'al']`) and an alias of the global object.
fn dynamic_code(program: &oxc::ast::ast::Program<'_>, scoping: &oxc::semantic::Scoping) -> Option<&'static str> {
    use oxc::ast::ast::{BinaryExpression, Expression, IdentifierReference, StaticMemberExpression, UnaryExpression};
    use oxc::ast_visit::Visit;
    use oxc::syntax::operator::{BinaryOperator, UnaryOperator};
    const RUNNERS: [&str; 2] = ["eval", "Function"];
    const GLOBAL_OBJECTS: [&str; 4] = ["globalThis", "window", "self", "global"];
    struct Reads<'s> {
        scoping: &'s oxc::semantic::Scoping,
        found: Option<&'static str>,
    }
    impl Reads<'_> {
        fn unbound(&self, id: &IdentifierReference<'_>) -> bool {
            id.reference_id.get().is_some_and(|id| self.scoping.get_reference(id).symbol_id().is_none())
        }
        /// The bare unbound `eval` or `Function`, which `typeof` and
        /// `instanceof` only inspect.
        fn bare_runner(&self, expr: &Expression<'_>) -> bool {
            matches!(expr.get_inner_expression(), Expression::Identifier(id)
                if RUNNERS.contains(&id.name.as_str()) && self.unbound(id))
        }
        fn record(&mut self, name: &str) {
            self.found.get_or_insert(if name == "eval" { "reads eval" } else { "reads Function" });
        }
    }
    impl<'a> Visit<'a> for Reads<'_> {
        fn visit_identifier_reference(&mut self, id: &IdentifierReference<'a>) {
            let value = id.reference_id.get().is_some_and(|id| self.scoping.get_reference(id).is_value());
            if value && RUNNERS.contains(&id.name.as_str()) && self.unbound(id) {
                self.record(&id.name);
            }
        }
        fn visit_static_member_expression(&mut self, member: &StaticMemberExpression<'a>) {
            let global = matches!(member.object.get_inner_expression(), Expression::Identifier(object)
                if GLOBAL_OBJECTS.contains(&object.name.as_str()) && self.unbound(object));
            if global && RUNNERS.contains(&member.property.name.as_str()) {
                self.record(&member.property.name);
            }
            oxc::ast_visit::walk::walk_static_member_expression(self, member);
        }
        fn visit_unary_expression(&mut self, unary: &UnaryExpression<'a>) {
            if unary.operator == UnaryOperator::Typeof && self.bare_runner(&unary.argument) {
                return;
            }
            oxc::ast_visit::walk::walk_unary_expression(self, unary);
        }
        fn visit_binary_expression(&mut self, binary: &BinaryExpression<'a>) {
            if binary.operator == BinaryOperator::Instanceof && self.bare_runner(&binary.right) {
                self.visit_expression(&binary.left);
                return;
            }
            oxc::ast_visit::walk::walk_binary_expression(self, binary);
        }
    }
    let mut reads = Reads { scoping, found: None };
    reads.visit_program(program);
    reads.found
}

/// One module's functions, each with how its parameters treat an object.
type FunctionReadings = std::rc::Rc<BTreeMap<String, Vec<crate::usage_facts::ParamReading>>>;
/// A module's function readings, scanned on first request.
type ReadingsOf<'r> = dyn FnMut(&str) -> FunctionReadings + 'r;
/// The declaring module and local name a module's binding names.
type Declared<'d> = dyn Fn(&str, &str) -> Option<(String, String)> + 'd;

/// One module's inputs to `unstable_style_statics`.
struct StyleModule {
    facts: crate::usage_facts::StyleObjectFacts,
    namespace_exports: BTreeMap<String, String>,
    loads: Vec<String>,
    /// How it runs code from a string, which can load any module.
    dynamic_code: Option<&'static str>,
}

/// Each module-scope static that a use anywhere in the analysis may change
/// before a style reads it, keyed by its module and local name, with the
/// first such use said as a clause: `preset is passed to decorate() in
/// a.tsx on line 4`. A namespace re-export or a runtime load of a module
/// unsettles every static it exports. Statics stored in an unstable object,
/// or read from an unstable binding, are unstable too.
fn unstable_style_statics(
    style: &BTreeMap<String, StyleModule>,
    modules: &ModuleFacts,
    links: &ProjectLinks,
    lowered: &BTreeMap<String, crate::link::Lowered>,
    files: &BTreeMap<String, rustc_hash::FxHashMap<String, serde_json::Value>>,
    inputs: &analyze_css::CssInputs,
    readings_of: &mut ReadingsOf<'_>,
) -> BTreeMap<(String, String), String> {
    let declaration = |(module, binding): (ModuleIndex, LocalId)| -> (String, String) {
        let path = &links.paths[module];
        (path.clone(), lowered[path].bindings.binding(binding).name.clone())
    };
    // The declarations a module's binding may name: itself, or each binding
    // what it imports may be.
    let possible = |file: &str, name: &str| -> Vec<(String, String)> {
        let imported = links.module(file).and_then(|module| {
            let local = lowered[file].bindings.module_binding(name)?;
            let import = links.table.record(module).imports.iter().find(|import| import.local == local)?;
            Some(links.table.resolve_request(module, import.request, &import.name))
        });
        match imported {
            Some(lookup) => possible_bindings(links, lookup).into_iter().map(declaration).collect(),
            None => vec![(file.to_string(), name.to_string())],
        }
    };
    // What a module's namespace import names, by the record's request.
    let namespace_of = |file: &str, name: &str| -> Option<&Request> {
        let module = links.module(file)?;
        let local = lowered[file].bindings.module_binding(name)?;
        let record = links.table.record(module);
        let import =
            record.imports.iter().find(|import| import.local == local && import.name == ImportName::Namespace)?;
        Some(&record.requests[import.request])
    };
    let exported = |target: &str, name: &str| -> Vec<(ModuleIndex, LocalId)> {
        links.module(target).map(|module| possible_bindings(links, links.table.resolve_export(module, name))).unwrap_or_default()
    };
    // The declaration a module's binding names: itself, or what it imports.
    let declared = |file: &str, name: &str| -> Option<(String, String)> {
        let (imports, _) = modules.get(file)?;
        match imports.iter().find(|import| import.local == name) {
            Some(import) => {
                import_binding(file, &import.source, &import.imported, links, files, inputs).map(declaration)
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
        found.into_iter().map(declaration).collect()
    };
    // Whether the function `function` of `file` only reads the object passed
    // as its parameter `index`, through the read-only callees it passes the
    // object to, at most four calls deep.
    fn reads_only(
        file: &str,
        function: &str,
        index: usize,
        depth: usize,
        declared: &Declared<'_>,
        readings_of: &mut ReadingsOf<'_>,
    ) -> bool {
        use crate::usage_facts::ParamReading;
        if depth > 4 {
            return false;
        }
        let readings = readings_of(file);
        let Some(ParamReading::ReadOnly(passes)) = readings.get(function).and_then(|params| params.get(index)) else {
            return false;
        };
        passes.iter().all(|(callee, at)| match declared(file, callee) {
            Some((callee_file, callee_name)) => {
                reads_only(&callee_file, &callee_name, *at, depth + 1, declared, readings_of)
            }
            None => false,
        })
    }
    // Whether a declaration's static is an object or array: no use can
    // change a primitive.
    let mutable = |(file, local): &(String, String)| {
        files
            .get(file)
            .and_then(|statics| statics.get(local))
            .is_some_and(|value| value.is_object() || value.is_array())
    };
    // Whether a declaration's static holds an object among its values.
    let nested = |(file, local): &(String, String)| {
        files.get(file).and_then(|statics| statics.get(local)).and_then(serde_json::Value::as_object).is_some_and(
            |object| object.values().any(|value| value.is_object() || value.is_array()),
        )
    };
    let said = |file: &str, name: &str, used: &crate::usage_facts::ObjectUse| {
        let line = used.line.map_or(String::new(), |line| format!(" on line {line}"));
        format!("{name} {} in {file}{line}", used.what)
    };
    let mut unstable: BTreeMap<(String, String), String> = BTreeMap::new();
    for (file, module) in style {
        // The declarations a use's name stands for that hold an object: a
        // namespace's member, every export of a namespace used whole, or
        // the binding's own.
        let targets_of = |name: &str| -> Vec<(String, String)> {
            let exposed = |name: Option<&str>| exposed_bindings(links, name).into_iter().map(declaration).collect();
            let targets: Vec<(String, String)> = match name.split_once('.') {
                Some((namespace, member)) => match namespace_of(file, namespace) {
                    Some(Request::Module(target)) => {
                        exported(&links.paths[*target], member).into_iter().map(declaration).collect()
                    }
                    Some(Request::Unresolved(_)) => exposed(Some(member)),
                    Some(Request::Outside(_)) | None => Vec::new(),
                },
                None => match namespace_of(file, name) {
                    Some(Request::Module(target)) => every_export(&links.paths[*target]),
                    Some(Request::Unresolved(_)) => exposed(None),
                    Some(Request::Outside(_)) => Vec::new(),
                    None => possible(file, name),
                },
            };
            targets.into_iter().filter(|target| mutable(target)).collect()
        };
        // A function hands a nested object on to whatever it hands
        // members to, so only an object of primitives passes as a read.
        for handoff in &module.facts.handoffs {
            for target in possible(file, &handoff.binding).into_iter().filter(|target| mutable(target)) {
                let read = !nested(&target)
                    && declared(file, &handoff.callee).is_some_and(|(callee_file, callee_name)| {
                        reads_only(&callee_file, &callee_name, handoff.index, 0, &declared, readings_of)
                    });
                if !read {
                    unstable.entry(target).or_insert_with(|| said(file, &handoff.binding, &handoff.used));
                }
            }
        }
        for (name, used) in &module.facts.uses {
            for target in targets_of(name) {
                unstable.entry(target).or_insert_with(|| said(file, name, used));
            }
        }
        for (name, used) in &module.facts.flat_reads {
            for target in targets_of(name).into_iter().filter(|target| nested(target)) {
                let reason = format!("{}, and it holds a nested object", said(file, name, used));
                unstable.entry(target).or_insert(reason);
            }
        }
        let reexports = module
            .namespace_exports
            .iter()
            .map(|(name, spec)| (spec, format!("as the namespace {name}")));
        let loads = module.loads.iter().map(|spec| (spec, "at runtime".to_string()));
        for (spec, how) in reexports.chain(loads) {
            let Some(target) = analyze_css::resolve_import_source(file, spec, files, inputs) else {
                continue;
            };
            let reason = format!("{file} hands on {target} {how}");
            for export in every_export(&target) {
                unstable.entry(export).or_insert_with(|| reason.clone());
            }
        }
        // Code from a string can `import()` any module and change what it
        // exports.
        if let Some(how) = module.dynamic_code {
            let reason = format!("{file} {how}, so code from a string can load and change any module");
            for target in style.keys() {
                for export in every_export(target) {
                    unstable.entry(export).or_insert_with(|| reason.clone());
                }
            }
        }
    }
    loop {
        let mut changed = false;
        for (file, module) in style {
            let edges = module
                .facts
                .stored
                .iter()
                .map(|(stored, container)| (stored, container, "is stored in"))
                .chain(module.facts.derives.iter().map(|(derived, read)| (derived, read, "reads")));
            for (dependent, on, how) in edges {
                let Some(reason) = possible(file, on).iter().find_map(|on_at| unstable.get(on_at)).cloned() else {
                    continue;
                };
                for dependent_at in possible(file, dependent) {
                    if let std::collections::btree_map::Entry::Vacant(entry) = unstable.entry(dependent_at) {
                        entry.insert(format!("{dependent} {how} {on}, and {reason}"));
                        changed = true;
                    }
                }
            }
        }
        if !changed {
            break;
        }
    }
    unstable
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

    #[napi]
    pub fn analyze(&mut self, file_entries_json: String) -> napi::Result<String> {
        #[derive(serde::Deserialize)]
        struct InputEntry {
            path: String,
            source: String,
        }
        let entries: Vec<InputEntry> = serde_json::from_str(&file_entries_json)
            .map_err(|e| napi::Error::from_reason(format!("invalid file entries JSON: {e}")))?;
        // Analysis sees the files in canonical order, so its output does not
        // depend on the order a host lists them in, or on how it spells a path.
        let mut keyed: Vec<(String, InputEntry)> =
            entries.into_iter().map(|entry| (canonical_analysis_id(&entry.path), entry)).collect();
        keyed.sort_by(|(a, x), (b, y)| a.cmp(b).then_with(|| x.path.cmp(&y.path)));
        // A path listed twice with the same source is one file. Listed twice
        // with different sources, or spelled two ways (`a.tsx`, `./a.tsx`),
        // it names no single input, so the analysis fails rather than pick
        // one: lookups keep the spelling the host passed.
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

        use crate::usage_facts::{collect_export_facts, collect_import_facts};
        let mut statics_by_file: std::collections::BTreeMap<
            String,
            rustc_hash::FxHashMap<String, serde_json::Value>,
        > = std::collections::BTreeMap::new();
        let mut complete_statics_by_file: std::collections::BTreeMap<
            String,
            rustc_hash::FxHashMap<String, serde_json::Value>,
        > = std::collections::BTreeMap::new();
        let mut imports_by_file: ModuleFacts = std::collections::BTreeMap::new();
        let mut style_modules: BTreeMap<String, StyleModule> = BTreeMap::new();
        // Each file's Lower output, before anything reads across files.
        let mut lowered_by_file: BTreeMap<String, crate::link::Lowered> =
            store.iter().map(|ast| (ast.path.clone(), crate::link::Lowered::of(ast))).collect();
        let links = ProjectLinks::of_records(&lowered_by_file, |lowered| &lowered.record, &self.opts.css_inputs);
        // Static reads follow explicit exports only, never `export *`, until
        // mutation tracking can bound every source a star exposes a binding
        // to; mutation tracking follows stars.
        let explicit: BTreeMap<String, crate::link::OwnedModuleRecord> = lowered_by_file
            .iter()
            .map(|(path, lowered)| {
                (path.clone(), crate::link::OwnedModuleRecord { star_exports: Vec::new(), ..lowered.record.clone() })
            })
            .collect();
        let read_links = ProjectLinks::of_records(&explicit, |record| record, &self.opts.css_inputs);
        for ast in store.iter() {
            let program = ast.program();
            let statics = if crate::analyze_css::is_external_file(&ast.path, &self.opts.css_inputs.external_dirs) {
                crate::eval::collect_package_static_values(program)
            } else {
                crate::eval::collect_static_values(program)
            };
            let complete_statics = crate::eval::collect_complete_static_values(program);
            let exports = collect_export_facts(program);
            let imports = collect_import_facts(ast.module_record());
            statics_by_file.insert(ast.path.clone(), statics);
            complete_statics_by_file.insert(ast.path.clone(), complete_statics);
            imports_by_file.insert(ast.path.clone(), (imports, exports));
        }

        // Names some module exports an object static under, by name alone:
        // a module that imports none of them and declares no object static
        // has no use to scan.
        let object_exports: rustc_hash::FxHashSet<&str> = imports_by_file
            .iter()
            .flat_map(|(path, (_, exports))| {
                let statics = &statics_by_file[path];
                exports.iter().filter(move |export| {
                    export.source.is_some()
                        || export.local.as_ref().is_some_and(|local| {
                            statics.get(local).is_some_and(serde_json::Value::is_object)
                        })
                })
            })
            .map(|export| export.exported.as_str())
            .collect();
        for ast in store.iter() {
            let program = ast.program();
            let module = ast.module_record();
            let statics = &statics_by_file[&ast.path];
            let (imports, _) = &imports_by_file[&ast.path];
            let namespace_imports = crate::usage_facts::collect_namespace_imports(module);
            let facts = if statics.values().any(serde_json::Value::is_object)
                || !namespace_imports.is_empty()
                || imports.iter().any(|import| object_exports.contains(import.imported.as_str()))
            {
                crate::usage_facts::style_object_uses(program, &lowered_by_file[&ast.path].scoping, statics)
            } else {
                crate::usage_facts::StyleObjectFacts::default()
            };
            style_modules.insert(
                ast.path.clone(),
                StyleModule {
                    facts,
                    namespace_exports: crate::usage_facts::collect_namespace_exports(module),
                    loads: literal_module_loads(program),
                    dynamic_code: dynamic_code(program, &lowered_by_file[&ast.path].scoping),
                },
            );
        }

        // A static that some use may change before a style reads it stands
        // as a marker naming that use, so every reader refuses it.
        // A function's parameter readings, scanned only for the modules a
        // handed-on object's callee resolves to.
        let programs: BTreeMap<&str, &oxc::ast::ast::Program<'_>> =
            store.iter().map(|ast| (ast.path.as_str(), ast.program())).collect();
        let mut readings_cache: BTreeMap<String, FunctionReadings> = BTreeMap::new();
        let mut readings_of = |file: &str| {
            std::rc::Rc::clone(readings_cache.entry(file.to_string()).or_insert_with(|| {
                std::rc::Rc::new(
                    programs
                        .get(file)
                        .map(|program| {
                            crate::usage_facts::function_param_readings(program, &lowered_by_file[file].scoping)
                        })
                        .unwrap_or_default(),
                )
            }))
        };
        for ((file, local), reason) in unstable_style_statics(
            &style_modules,
            &imports_by_file,
            &links,
            &lowered_by_file,
            &statics_by_file,
            &self.opts.css_inputs,
            &mut readings_of,
        ) {
            if let Some(value) = statics_by_file.get_mut(&file).and_then(|statics| statics.get_mut(&local)) {
                // Only a value the binding had before const initializers read
                // other consts stays held; one derived from them refuses.
                let in_package = crate::analyze_css::is_external_file(&file, &self.opts.css_inputs.external_dirs);
                *value = match programs.get(file.as_str()).and_then(|program| {
                    crate::eval::pre_read_static(program, &local, in_package)
                }) {
                    Some(held) => crate::eval::held_marker(reason, held),
                    None => crate::eval::lost_marker(reason),
                };
            }
        }

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

        let mut enriched_by_file: std::collections::BTreeMap<
            String,
            rustc_hash::FxHashMap<String, serde_json::Value>,
        > = std::collections::BTreeMap::new();
        let mut usage_enriched_by_file: std::collections::BTreeMap<
            String,
            rustc_hash::FxHashMap<String, serde_json::Value>,
        > = std::collections::BTreeMap::new();
        let output_dirs = &self.opts.css_inputs.analysis_context.output_dirs;
        // Each unregistered import, by file and local, whose declaration is
        // in a kit's compiled output: the file declaring it.
        let mut compiled_declarations: rustc_hash::FxHashMap<(String, String), String> =
            rustc_hash::FxHashMap::default();
        for (path, (imports, exports)) in &imports_by_file {
            let mut extra = rustc_hash::FxHashMap::default();
            let mut usage_extra = rustc_hash::FxHashMap::default();
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
                let mut registered = spelled.iter().filter_map(|(_, name)| keyframes_registry.get(name));
                let first = registered.next();
                if let Some(kf) = first.filter(|kf| registered.all(|other| other == *kf)) {
                    extra.insert(imp.local.clone(), kf.clone());
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
                &self.opts.prefix,
                local_statics,
                local_usage_statics,
                extra,
                usage_extra,
                &references,
                lowered_by_file.remove(&ast.path),
            );
            if let Some(names) = global_declarations.get(ast.path.as_str()) {
                file_facts.global_keys = facts::declaration_keys(ast.program(), ast.source(), names);
            }
            self.facts.insert(ast.path.clone(), file_facts);
            self.sources
                .insert(ast.path.clone(), ast.source().to_string());
        }

        // Facts own every resolved reference; release the modules' scopings.
        drop(references);
        let mut css = analyze_css::run(
            &self.facts,
            &self.order,
            &self.opts.css_inputs,
            &self.opts.prefix,
        );
        // Only the engine holds the sources a diagnostic's line and column
        // are read from.
        for diagnostic in &mut css.diagnostics {
            if let Some(source) = self.sources.get(&diagnostic.file) {
                diagnostic.locate(source);
            }
            name_compiled_kit_fix(diagnostic, &compiled_declarations, output_dirs);
        }
        let cross = cross_file::resolve_cross_file(&self.facts, css.member_bindings.clone());
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
            admitted_transforms: &css.admitted_transforms,
            typed_system_props: &css.typed_system_props,
            component_fragments: &css.component_fragments,
            system_fingerprint: &css.system_fingerprint,
            reverse_provenance: &css.reverse_provenance,
            components: &css.components,
            files: &css.files_map,
            timing: serde_json::json!({ "parseCount": self.parse_count }),
        });
        self.cross = Some(cross);
        self.css = Some(css);
        out.map_err(|e| napi::Error::from_reason(format!("serialize failed: {e}")))
    }

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
        if import_needs.typed_system_props {
            virtual_imports.push("typedSystemProps");
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
        if has_compose_replacements {
            system_imports.push("createComposedFamily");
        }
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
                "import {{ createComposedFamilyWithContext }} from '{}';\n",
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
            let binding_loop = if import_needs.dynamic_prop_config {
                "for (const [k, v] of Object.entries(dynamicPropConfig)) { if (v.transformId) v.transform = transforms[v.transformId]; }\n"
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
            r#"import { Box } from "./a"; export const B = () => <><Box p={ok ? 4 : 8} /><Box p={gap} /></>;"#;
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
        assert!(!out.contains("@animus-ui/system/compose'"), "{out}");
        assert!(out.contains("createComposedFamily }"), "{out}");
    }

    #[test]
    fn manifest_lists_each_files_family_member_tags() {
        let mut engine = ExtractEngine::new(None).unwrap();
        let manifest = engine
            .analyze(
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
            .analyze(
                r#"[{"path":"tokens.ts","source":"export const pad = { p: 4 };\n"},
                    {"path":"a.tsx","source":"import { pad } from './tokens';\nexport const C = ds.styles(pad).asElement('div');\nexport const App = () => <C />;\n"}]"#
                    .to_string(),
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
        for (row, mutation, read) in rows {
            let mut engine = ExtractEngine::new(None).unwrap();
            let files = serde_json::json!([
                { "path": "tokens.js", "source": "export const pad = { padding: 4 };\n" },
                { "path": "mutate.js", "source": format!("{mutation}\n") },
                {
                    "path": "reader.tsx",
                    "source": format!(
                        "import './mutate.js';\nimport {{ pad }} from './tokens.js';\n\
                         export const C = ds.styles({read}).asElement('div');\nexport const App = () => <C />;\n"
                    ),
                },
            ]);
            let out: serde_json::Value = serde_json::from_str(&engine.analyze(files.to_string()).unwrap()).unwrap();
            assert!(!out["css"].as_str().unwrap_or_default().contains("padding"), "{row}: {}", out["css"]);
        }
        // A type query of eval, or a schema builder's own `Function` member
        // (TypeBox's `Type.Function`), runs nothing: the static still
        // extracts.
        for (row, module) in [
            ("type query", "export type Evaluate = typeof eval;\n"),
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
            let out: serde_json::Value = serde_json::from_str(&engine.analyze(files.to_string()).unwrap()).unwrap();
            assert!(out["css"].as_str().unwrap_or_default().contains("padding"), "{row}: {}", out["css"]);
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
                serde_json::from_str(&engine.analyze(files.to_string()).unwrap()).unwrap();
            let css = manifest["css"].as_str().unwrap();
            if !css.contains("animation-name: animus-kf-motion") || !manifest["diagnostics"].as_array().unwrap().is_empty() {
                wrong.push((row, css.to_string(), manifest["diagnostics"].to_string()));
            }
        }
        assert!(wrong.is_empty(), "{wrong:#?}");
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
            serde_json::from_str(&engine.analyze(files.to_string()).unwrap()).unwrap()
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
                .analyze(
                    serde_json::json!([
                        { "path": "tokens.ts", "source": "export const GAP = 24;\nexport const WIDE = 32;\n" },
                        { "path": "barrel.ts", "source": "export { GAP as SPACING } from './tokens';\n" },
                        // A compiler's barrel: an import exported locally.
                        { "path": "compiled.js", "source": "import { WIDE as w } from './tokens';\nexport { w as WIDE_SPACING };\n" },
                        { "path": "a.tsx", "source": "import { SPACING } from './barrel';\nimport { WIDE_SPACING } from './compiled';\nexport const Box = ds.system({ space: true }).asElement('div');\nexport const App = () => <><Box p={SPACING} /><Box p={WIDE_SPACING} /></>;\n" }
                    ])
                    .to_string(),
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
                .analyze(
                    serde_json::json!([
                        { "path": "tokens.ts", "source": "export const GAP = 24;\nexport const pad = { margin: 4 };\n" },
                        { "path": "barrel.ts", "source": "export * from './tokens';\n" },
                        { "path": "all.ts", "source": "export * as all from './barrel';\n" },
                        { "path": "a.tsx", "source": "import { GAP } from './barrel';\nimport { pad } from './tokens';\nexport const Box = ds.system({ space: true }).asElement('div');\nexport const Card = ds.styles({ ...pad }).asElement('div');\nexport const App = () => <><Box p={GAP} /><Card /></>;\n" }
                    ])
                    .to_string(),
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
            ["chain dropped: stage 'styles' evaluation failed — styles eval failed: spread of all.ts hands on barrel.ts as the namespace all"],
            "{manifest}"
        );
    }

    /// A mutated object read through a spread is refused, never shipped
    /// with its declared value, whatever route its mutator imports it by:
    /// directly, through 31 or 32 re-export hops, through a star cycle, or
    /// through a star the analysis cannot open (a missing module or a
    /// package) or from a missing module itself, or as a member of a missing
    /// module's namespace. A reader through a star is refused whatever the
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
                serde_json::from_str(&engine.analyze(serde_json::Value::Array(entries).to_string()).unwrap()).unwrap();
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
        assert_eq!(manifest["usageResidue"], serde_json::json!([]));
    }

    fn unregistered_keyframe_diagnostics(manifest: &serde_json::Value) -> Vec<String> {
        manifest["diagnostics"]
            .as_array()
            .map(|ds| {
                ds.iter()
                    .filter(|d| d["code"] == crate::eval::KEYFRAMES_UNREGISTERED_REFERENCE)
                    .map(|d| d["message"].as_str().unwrap_or_default().to_string())
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
            .analyze(r#"[{"path":"a.tsx","source":"const x = 1;"}]"#.to_string())
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
            .analyze(r#"[{"path":"a.tsx","source":"const x = 1;"}]"#.to_string())
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
                .analyze(serde_json::json!([{ "path": "a.tsx", "source": source }]).to_string())
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
            .analyze(serde_json::json!([{ "path": "a.tsx", "source": source }]).to_string())
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
            engine.analyze(serde_json::Value::from(entries).to_string()).map(|_| engine.parse_count).map_err(|e| e.reason)
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
            let analysis = engine.analyze(serde_json::Value::from(entries).to_string()).unwrap();
            let transforms: Vec<String> =
                files.iter().map(|(path, _)| engine.transform_file(path.to_string()).unwrap()).collect();
            (analysis, transforms)
        };
        let given = run([0, 1, 2, 3, 4]);
        for order in [[4, 3, 2, 1, 0], [2, 4, 0, 3, 1]] {
            assert_eq!(run(order), given, "files in the order {order:?}");
        }
    }
}
