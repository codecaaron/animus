mod chain_merger;
mod chain_walker;
mod css_generator;
mod import_resolver;
mod jsx_scanner;
mod project_analyzer;
mod style_evaluator;
mod theme_resolver;
mod transform_emitter;
mod transforms;

use std::collections::{HashMap, HashSet};

use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_ast::ast::Expression;
use oxc_parser::Parser;
use oxc_span::SourceType;
use serde_json::Value;

use chain_walker::{walk_chains, ChainDescriptor, TerminalKind};
use css_generator::{
    generate_css, generate_custom_prop_css, generate_utility_css, make_class_name, BreakpointMap,
    ComponentCss, UtilityInput, VariantCss,
};
use jsx_scanner::scan_jsx;
use style_evaluator::{eval_object_expr, parse_states_arg, parse_variant_arg};
use theme_resolver::{resolve_styles, FlatTheme, PropConfigMap, ResolvedStyles};
use transform_emitter::{
    apply_replacements, generate_replacement, ComponentReplacement, SourceReplacement,
    VariantPropConfig,
};

#[napi(object)]
pub struct ExtractionResult {
    pub css: String,
    pub code: String,
    pub source_map: String,
    pub extractable: bool,
    pub errors: Vec<String>,
}

#[napi]
pub fn extract(
    source: String,
    filename: String,
    theme_json: String,
    config_json: String,
    group_registry_json: String,
) -> ExtractionResult {
    // Parse theme and config
    let theme: FlatTheme = match serde_json::from_str(&theme_json) {
        Ok(t) => t,
        Err(e) => {
            return ExtractionResult {
                css: String::new(),
                code: source,
                source_map: String::new(),
                extractable: false,
                errors: vec![format!("Failed to parse theme JSON: {}", e)],
            }
        }
    };

    let config: PropConfigMap = match serde_json::from_str(&config_json) {
        Ok(c) => c,
        Err(e) => {
            return ExtractionResult {
                css: String::new(),
                code: source,
                source_map: String::new(),
                extractable: false,
                errors: vec![format!("Failed to parse config JSON: {}", e)],
            }
        }
    };

    // group_registry: { "space": ["p", "px", "py", ...], "layout": ["display", "width", ...] }
    let group_registry: HashMap<String, Vec<String>> = match serde_json::from_str(&group_registry_json) {
        Ok(g) => g,
        Err(e) => {
            return ExtractionResult {
                css: String::new(),
                code: source,
                source_map: String::new(),
                extractable: false,
                errors: vec![format!("Failed to parse group registry JSON: {}", e)],
            }
        }
    };

    // Parse breakpoints from theme (convention: "breakpoints.xs" → "480", etc.)
    let breakpoints = extract_breakpoints(&theme);

    // Walk chains
    let allocator = Allocator::default();
    let chains = walk_chains(&source, &filename, &allocator);

    if chains.is_empty() {
        return ExtractionResult {
            css: String::new(),
            code: source,
            source_map: String::new(),
            extractable: false,
            errors: vec![],
        };
    }

    let mut errors = Vec::new();
    let mut component_css_list = Vec::new();
    // Carries the processed replacement alongside optional active-props and custom-props data.
    // Layout: (comp_replacement, active_prop_names, custom_prop_configs)
    let mut chain_results: Vec<(ComponentReplacement, Option<HashSet<String>>, Option<PropConfigMap>)> =
        Vec::new();
    let mut replacements: Vec<SourceReplacement> = Vec::new();
    let mut any_extracted = false;

    for chain in &chains {
        if !chain.extractable {
            // Skip non-extractable chains (they stay as Emotion)
            if let Some(reason) = &chain.bail_reason {
                errors.push(format!("{}: {}", chain.binding, reason));
            }
            continue;
        }

        // Evaluate chain stages
        match process_chain(chain, &source, &config, &theme, &group_registry) {
            Ok((component_css, comp_replacement, active_props, custom_configs)) => {
                replacements.push(SourceReplacement {
                    span: chain.span,
                    replacement: String::new(), // filled in after utility CSS generation
                });
                component_css_list.push(component_css);
                chain_results.push((comp_replacement, active_props, custom_configs));
                any_extracted = true;
            }
            Err(e) => {
                errors.push(format!("{}: {}", chain.binding, e));
            }
        }
    }

    if !any_extracted {
        return ExtractionResult {
            css: String::new(),
            code: source,
            source_map: String::new(),
            extractable: false,
            errors,
        };
    }

    // --- JSX scanning and utility CSS generation ---

    // Build component_props map: binding → active system prop names
    let mut component_props: HashMap<String, HashSet<String>> = HashMap::new();
    for (comp_replacement, active_props, _) in &chain_results {
        if let Some(props) = active_props {
            if !props.is_empty() {
                component_props.insert(comp_replacement.binding.clone(), props.clone());
            }
        }
    }

    // Collect all custom prop usages for .props() chains
    let mut all_custom_configs: PropConfigMap = HashMap::new();
    let mut has_custom_props = false;
    for (_, _, custom_configs) in &chain_results {
        if let Some(cc) = custom_configs {
            all_custom_configs.extend(cc.clone());
            has_custom_props = true;
        }
    }

    // Re-parse the source for JSX scanning (needed when any chain has groups)
    let utility_output = if !component_props.is_empty() {
        let scan_allocator = Allocator::default();
        let source_type = if filename.ends_with(".tsx") {
            SourceType::tsx()
        } else if filename.ends_with(".ts") {
            SourceType::ts()
        } else if filename.ends_with(".jsx") {
            SourceType::jsx()
        } else {
            SourceType::mjs()
        };
        let parse_result = Parser::new(&scan_allocator, &source, source_type).parse();
        let jsx_usages = scan_jsx(&parse_result.program, &component_props);

        let utility_inputs: Vec<UtilityInput> = jsx_usages
            .iter()
            .map(|u| UtilityInput {
                prop_name: u.prop_name.clone(),
                value: u.value.clone(),
            })
            .collect();

        Some(generate_utility_css(&utility_inputs, &config, &theme, &breakpoints))
    } else {
        None
    };

    // Custom prop utility CSS (from .props())
    let custom_output = if has_custom_props {
        let scan_allocator = Allocator::default();
        let source_type = if filename.ends_with(".tsx") {
            SourceType::tsx()
        } else if filename.ends_with(".ts") {
            SourceType::ts()
        } else if filename.ends_with(".jsx") {
            SourceType::jsx()
        } else {
            SourceType::mjs()
        };
        let parse_result = Parser::new(&scan_allocator, &source, source_type).parse();

        // Build component_props for custom prop scanning
        let mut custom_component_props: HashMap<String, HashSet<String>> = HashMap::new();
        for (comp_replacement, _, custom_configs) in &chain_results {
            if let Some(cc) = custom_configs {
                if !cc.is_empty() {
                    let prop_names: HashSet<String> = cc.keys().cloned().collect();
                    custom_component_props.insert(comp_replacement.binding.clone(), prop_names);
                }
            }
        }

        let jsx_usages = scan_jsx(&parse_result.program, &custom_component_props);
        let custom_inputs: Vec<UtilityInput> = jsx_usages
            .iter()
            .map(|u| UtilityInput {
                prop_name: u.prop_name.clone(),
                value: u.value.clone(),
            })
            .collect();

        if custom_inputs.is_empty() {
            None
        } else {
            Some(generate_custom_prop_css(
                &custom_inputs,
                &all_custom_configs,
                &theme,
                &breakpoints,
            ))
        }
    } else {
        None
    };

    // Build final ComponentReplacements with system_props/system_prop_names populated
    // and fill in the SourceReplacement text.
    let mut replacement_idx = 0;
    for (mut comp_replacement, active_props, custom_prop_configs) in chain_results {
        // Populate system_props from utility_output.class_map, filtered to this component's props
        if let Some(props) = &active_props {
            if !props.is_empty() {
                let mut all_prop_names: Vec<String> = props.iter().cloned().collect();
                // Also include custom prop names from .props() for DOM filtering
                if let Some(custom_configs) = &custom_prop_configs {
                    all_prop_names.extend(custom_configs.keys().cloned());
                }
                all_prop_names.sort();
                all_prop_names.dedup();
                comp_replacement.system_prop_names = all_prop_names;

                if let Some(util_out) = &utility_output {
                    // Filter class_map to only the props active for this component
                    let filtered: HashMap<String, HashMap<String, String>> = util_out
                        .class_map
                        .iter()
                        .filter(|(prop, _)| props.contains(*prop))
                        .map(|(k, v)| (k.clone(), v.clone()))
                        .collect();
                    if !filtered.is_empty() {
                        comp_replacement.system_props = Some(filtered);
                    }
                }
            }
        } else if let Some(custom_configs) = &custom_prop_configs {
            // No groups but has custom props — still need to filter custom prop names from DOM
            if !custom_configs.is_empty() {
                let mut custom_names: Vec<String> = custom_configs.keys().cloned().collect();
                custom_names.sort();
                comp_replacement.system_prop_names = custom_names;
            }
        }

        let replacement_text = generate_replacement(&comp_replacement);
        if replacement_idx < replacements.len() {
            replacements[replacement_idx].replacement = replacement_text;
        }
        replacement_idx += 1;
    }

    // Generate component CSS
    let mut css = generate_css(&component_css_list, &breakpoints);

    // Append utility CSS (@layer system)
    if let Some(util_out) = &utility_output {
        if !util_out.css.is_empty() {
            css.push('\n');
            css.push_str(&util_out.css);
        }
    }

    // Append custom prop CSS (@layer custom)
    if let Some(custom_out) = &custom_output {
        if !custom_out.css.is_empty() {
            css.push('\n');
            css.push_str(&custom_out.css);
        }
    }

    // Apply source replacements
    let css_module_id = format!("virtual:animus/{}", filename.replace('/', "__"));
    let transformed_code = apply_replacements(&source, &mut replacements, &css_module_id);

    ExtractionResult {
        css,
        code: transformed_code,
        source_map: String::new(),
        extractable: true,
        errors,
    }
}

/// Process a single extractable chain into CSS, replacement info, and optional system prop data.
///
/// Returns `(ComponentCss, ComponentReplacement, active_prop_names, custom_prop_configs)`.
/// - `active_prop_names`: populated when the chain has a `.groups()` stage.
/// - `custom_prop_configs`: populated when the chain has a `.props()` stage.
pub(crate) fn process_chain(
    chain: &ChainDescriptor,
    source: &str,
    config: &PropConfigMap,
    theme: &FlatTheme,
    group_registry: &HashMap<String, Vec<String>>,
) -> Result<
    (
        ComponentCss,
        ComponentReplacement,
        Option<HashSet<String>>,
        Option<PropConfigMap>,
    ),
    String,
> {
    let mut base_styles: Option<ResolvedStyles> = None;
    let mut variant_css_list: Vec<VariantCss> = Vec::new();
    let mut state_css_list: Vec<(String, ResolvedStyles)> = Vec::new();
    let mut variant_prop_configs: Vec<VariantPropConfig> = Vec::new();
    let mut state_names: Vec<String> = Vec::new();
    let mut active_prop_names: Option<HashSet<String>> = None;
    let mut custom_prop_configs: Option<PropConfigMap> = None;

    // Build a hash input from the chain's source text for deterministic class names
    let chain_source = &source[chain.span.start as usize..chain.span.end as usize];
    let class_name = make_class_name(&chain.binding, chain_source);

    // We need to re-parse to access the AST nodes at the stage spans.
    // Since we have the program, find the chain's variable declarator and walk it again.
    // For now, we re-parse each stage's argument span as a standalone expression.
    for stage in &chain.stages {
        let arg_source = &source[stage.arg_span.start as usize..stage.arg_span.end as usize];

        match stage.method.as_str() {
            "styles" => {
                let styles_value = parse_object_from_source(arg_source)
                    .map_err(|e| format!("styles eval failed: {}", e))?;
                base_styles = Some(resolve_styles(&styles_value, config, theme));
            }
            "variant" => {
                let variant_config = parse_variant_from_source(arg_source)
                    .map_err(|e| format!("variant eval failed: {}", e))?;

                // Resolve variant base styles (shared across all options)
                let base_resolved = variant_config
                    .base
                    .as_ref()
                    .map(|b| resolve_styles(b, config, theme));

                let mut options_css = Vec::new();
                let mut option_names = Vec::new();

                for (option_name, option_styles) in &variant_config.variants {
                    option_names.push(option_name.clone());
                    let mut resolved = resolve_styles(option_styles, config, theme);

                    // Merge base declarations into each option
                    if let Some(base) = &base_resolved {
                        let mut merged = base.declarations.clone();
                        merged.extend(resolved.declarations);
                        resolved.declarations = merged;
                    }

                    options_css.push((option_name.clone(), resolved));
                }

                variant_css_list.push(VariantCss {
                    prop: variant_config.prop.clone(),
                    options: options_css,
                });

                variant_prop_configs.push(VariantPropConfig {
                    prop: variant_config.prop,
                    options: option_names,
                    default: variant_config.default_variant,
                });
            }
            "states" => {
                let states_value = parse_object_from_source(arg_source)
                    .map_err(|e| format!("states eval failed: {}", e))?;

                if let Value::Object(states_map) = &states_value {
                    for (state_name, state_styles) in states_map {
                        state_names.push(state_name.clone());
                        let resolved = resolve_styles(state_styles, config, theme);
                        state_css_list.push((state_name.clone(), resolved));
                    }
                }
            }
            "groups" => {
                // Parse the groups argument: { "space": true, "layout": true, ... }
                // Keys are active group names; values are ignored (presence = active).
                let groups_value = parse_object_from_source(arg_source)
                    .map_err(|e| format!("groups eval failed: {}", e))?;

                if let Value::Object(groups_map) = &groups_value {
                    let mut props: HashSet<String> = HashSet::new();
                    for group_name in groups_map.keys() {
                        if let Some(group_props) = group_registry.get(group_name) {
                            for prop in group_props {
                                props.insert(prop.clone());
                            }
                        }
                    }
                    if !props.is_empty() {
                        active_prop_names = Some(props);
                    }
                }
            }
            "props" => {
                // Parse the props argument: { propName: { property, scale, transform }, ... }
                // Each key is a custom prop name; the value is a PropConfig-like object.
                let props_value = parse_object_from_source(arg_source)
                    .map_err(|e| format!("props eval failed: {}", e))?;

                let parsed: PropConfigMap = serde_json::from_value(props_value)
                    .map_err(|e| format!("props config parse failed: {}", e))?;

                if !parsed.is_empty() {
                    custom_prop_configs = Some(parsed);
                }
            }
            _ => {}
        }
    }

    let component_css = ComponentCss {
        class_name: class_name.clone(),
        base: base_styles,
        variants: variant_css_list,
        states: state_css_list,
    };

    let comp_replacement = ComponentReplacement {
        binding: chain.binding.clone(),
        tag: chain.tag.clone(),
        class_name,
        variant_config: variant_prop_configs,
        state_names,
        system_props: None, // populated in extract() after JSX scanning
        system_prop_names: vec![], // populated in extract() after JSX scanning
        span: chain.span,
        is_component_element: chain.terminal == TerminalKind::AsComponent,
    };

    Ok((component_css, comp_replacement, active_prop_names, custom_prop_configs))
}

/// Parse a source snippet as an object expression and evaluate to JSON.
pub(crate) fn parse_object_from_source(source: &str) -> Result<Value, String> {
    let allocator = Allocator::default();
    // Wrap in parens to make it a valid expression statement
    let wrapped = format!("({})", source);
    let result = Parser::new(&allocator, &wrapped, SourceType::ts()).parse();
    let program = &result.program;

    if let Some(stmt) = program.body.first() {
        if let oxc_ast::ast::Statement::ExpressionStatement(expr_stmt) = stmt {
            if let Expression::ParenthesizedExpression(paren) = &expr_stmt.expression {
                if let Expression::ObjectExpression(obj) = &paren.expression {
                    return eval_object_expr(obj).map_err(|e| e.reason);
                }
            }
        }
    }

    Err("failed to parse object expression".to_string())
}

/// Parse a variant config source snippet.
pub(crate) fn parse_variant_from_source(
    source: &str,
) -> Result<style_evaluator::VariantStageConfig, String> {
    let allocator = Allocator::default();
    let wrapped = format!("({})", source);
    let result = Parser::new(&allocator, &wrapped, SourceType::ts()).parse();
    let program = &result.program;

    if let Some(stmt) = program.body.first() {
        if let oxc_ast::ast::Statement::ExpressionStatement(expr_stmt) = stmt {
            if let Expression::ParenthesizedExpression(paren) = &expr_stmt.expression {
                if let Expression::ObjectExpression(obj) = &paren.expression {
                    return parse_variant_arg(obj).map_err(|e| e.reason);
                }
            }
        }
    }

    Err("failed to parse variant config".to_string())
}

/// Extract breakpoint values from the flattened theme.
pub(crate) fn extract_breakpoints(theme: &FlatTheme) -> BreakpointMap {
    let mut bps = HashMap::new();
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

// ---------------------------------------------------------------------------
// New NAPI entry points (Arc 3 project-level analysis pipeline)
// ---------------------------------------------------------------------------

/// Analyse an entire project and return a serialised `UniverseManifest` as JSON.
///
/// Arguments:
/// - `file_entries_json`: JSON array of `{ path, source }` objects.
/// - `theme_json`: flattened theme map JSON.
/// - `config_json`: prop config map JSON.
/// - `group_registry_json`: group registry JSON (`{ "space": ["p", "px", ...], ... }`).
#[napi]
pub fn analyze_project(
    file_entries_json: String,
    theme_json: String,
    config_json: String,
    group_registry_json: String,
) -> String {
    use project_analyzer::{analyze, FileEntry};

    let files: Vec<FileEntry> = match serde_json::from_str(&file_entries_json) {
        Ok(f) => f,
        Err(e) => {
            return serde_json::json!({ "error": format!("Failed to parse file entries: {}", e) })
                .to_string()
        }
    };

    let theme: FlatTheme = match serde_json::from_str(&theme_json) {
        Ok(t) => t,
        Err(e) => {
            return serde_json::json!({ "error": format!("Failed to parse theme: {}", e) })
                .to_string()
        }
    };

    let config: PropConfigMap = match serde_json::from_str(&config_json) {
        Ok(c) => c,
        Err(e) => {
            return serde_json::json!({ "error": format!("Failed to parse config: {}", e) })
                .to_string()
        }
    };

    let group_registry: HashMap<String, Vec<String>> =
        match serde_json::from_str(&group_registry_json) {
            Ok(g) => g,
            Err(e) => {
                return serde_json::json!({
                    "error": format!("Failed to parse group registry: {}", e)
                })
                .to_string()
            }
        };

    // resolve_package_path: no filesystem access in Rust — always returns None.
    // The Vite plugin is responsible for providing a pre-resolved file list.
    let resolve_package_path = |_source: &str| -> Option<String> { None };

    let manifest = analyze(
        &files,
        &theme,
        &config,
        &group_registry,
        &resolve_package_path,
    );

    serde_json::to_string(&manifest).unwrap_or_else(|e| {
        serde_json::json!({ "error": format!("Failed to serialise manifest: {}", e) }).to_string()
    })
}

/// Result of a single-file transform using a pre-built `UniverseManifest`.
#[napi(object)]
pub struct TransformResult {
    pub code: String,
    pub has_components: bool,
}

/// Transform a single source file using a pre-built `UniverseManifest`.
///
/// Looks up the file in the manifest, applies the pre-computed `createComponent`
/// replacements, and prepends the necessary runtime + CSS imports.
#[napi]
pub fn transform_file(
    source: String,
    filename: String,
    manifest_json: String,
) -> TransformResult {
    use project_analyzer::UniverseManifest;

    let manifest: UniverseManifest = match serde_json::from_str(&manifest_json) {
        Ok(m) => m,
        Err(_) => {
            return TransformResult {
                code: source,
                has_components: false,
            }
        }
    };

    // Look up component_ids for this file
    let component_ids = match manifest.files.get(&filename) {
        Some(ids) if !ids.is_empty() => ids,
        _ => {
            return TransformResult {
                code: source,
                has_components: false,
            }
        }
    };

    // Build replacements from the manifest
    // We need the span (byte range) of each chain in the source to replace it.
    // Re-walk chains for this file to get spans, then match by class_name.
    let allocator = oxc_allocator::Allocator::default();
    let chains = chain_walker::walk_chains(&source, &filename, &allocator);

    let mut replacements: Vec<transform_emitter::SourceReplacement> = Vec::new();

    for chain in &chains {
        if !chain.extractable {
            continue;
        }

        let component_id = format!("{}::{}", filename, chain.binding);

        if !component_ids.contains(&component_id) {
            continue;
        }

        let descriptor = match manifest.components.get(&component_id) {
            Some(d) => d,
            None => continue,
        };

        replacements.push(transform_emitter::SourceReplacement {
            span: chain.span,
            replacement: descriptor.replacement.clone(),
        });
    }

    if replacements.is_empty() {
        return TransformResult {
            code: source,
            has_components: false,
        };
    }

    let css_module_id = "virtual:animus/styles.css";
    let transformed_code =
        transform_emitter::apply_replacements(&source, &mut replacements, css_module_id);

    TransformResult {
        code: transformed_code,
        has_components: true,
    }
}
