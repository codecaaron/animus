mod chain_merger;
mod chain_walker;
mod css_generator;
mod import_resolver;
mod jsx_scanner;
mod project_analyzer;
mod reconciler;
mod style_evaluator;
mod theme_resolver;
mod transform_emitter;

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
use style_evaluator::{eval_object_expr, parse_variant_arg, SkippedProperty};
use theme_resolver::{
    resolve_styles, ContextualVarsMap, FlatTheme, PropConfigMap, ResolveContext, ResolvedStyles,
    SelectorAliasesMap, VariableMap,
};
use transform_emitter::{
    apply_replacements, generate_replacement, CompoundConfig, ComponentReplacement, SourceReplacement,
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
    variable_map_json: String,
    config_json: String,
    group_registry_json: String,
    selector_aliases_json: Option<String>,
    selector_order_json: Option<String>,
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

    let variable_map: VariableMap = match serde_json::from_str(&variable_map_json) {
        Ok(v) => v,
        Err(_) => HashMap::new(), // Graceful fallback: empty map means no variable-backed tokens
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

    // Parse selector aliases: "_hover" → "&:hover", "_disabled" → "&:disabled, ..."
    let selector_aliases: SelectorAliasesMap = selector_aliases_json
        .as_deref()
        .and_then(|json| serde_json::from_str(json).ok())
        .unwrap_or_default();

    let selector_order: Vec<String> = selector_order_json
        .as_deref()
        .and_then(|json| serde_json::from_str(json).ok())
        .unwrap_or_default();

    // Parse breakpoints from theme (convention: "breakpoints.xs" → "480", etc.)
    let breakpoints = extract_breakpoints(&theme);
    let empty_ctx_vars = ContextualVarsMap::new();

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

    // Construct shared contexts once for the entire extraction run
    let bp_keys: HashSet<String> = breakpoints.breakpoints.keys().cloned().collect();
    let resolve_ctx = ResolveContext {
        config: &config,
        theme: &theme,
        variable_map: &variable_map,
        contextual_vars: &empty_ctx_vars,
        breakpoint_keys: &bp_keys,
        selector_aliases: &selector_aliases,
    };
    let proc_ctx = ProcessingContext {
        resolve: &resolve_ctx,
        group_registry: &group_registry,
        class_prefix: "animus",
    };

    for chain in &chains {
        if !chain.extractable {
            // Skip non-extractable chains (they stay as Emotion)
            if let Some(reason) = &chain.bail_reason {
                errors.push(format!("{}: {}", chain.binding, reason));
            }
            continue;
        }

        match process_chain(chain, &source, &filename, &proc_ctx) {
            Ok((component_css, comp_replacement, active_props, custom_configs, skip_warns)) => {
                replacements.push(SourceReplacement {
                    span: chain.span,
                    replacement: String::new(), // filled in after utility CSS generation
                });
                component_css_list.push(component_css);
                chain_results.push((comp_replacement, active_props, custom_configs));
                // Push skip warnings into errors vec (prefixed with [skip])
                errors.extend(skip_warns);
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
        let empty_member_bindings: HashMap<String, String> = HashMap::new();
        let jsx_scan = scan_jsx(&parse_result.program, &component_props, &empty_member_bindings);

        let utility_inputs: Vec<UtilityInput> = jsx_scan.static_usages
            .iter()
            .map(|u| UtilityInput {
                prop_name: u.prop_name.clone(),
                value: u.value.clone(),
            })
            .collect();

        Some(generate_utility_css(&utility_inputs, &resolve_ctx, &breakpoints, None, "animus", None))
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

        let empty_member_bindings: HashMap<String, String> = HashMap::new();
        let custom_scan = scan_jsx(&parse_result.program, &custom_component_props, &empty_member_bindings);
        let custom_inputs: Vec<UtilityInput> = custom_scan.static_usages
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
                &resolve_ctx,
                &breakpoints,
                None,
                "animus",
                None,
            ))
        }
    } else {
        None
    };

    // Build final ComponentReplacements with system_prop_names populated
    // and fill in the SourceReplacement text.
    // system_props moved to shared map — only prop names stay per-component.
    let mut replacement_idx = 0;
    for (mut comp_replacement, active_props, custom_prop_configs) in chain_results {
        // Populate system_prop_names for DOM filtering
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
            }
        } else if let Some(custom_configs) = &custom_prop_configs {
            // No groups but has custom props — still need to filter custom prop names from DOM
            if !custom_configs.is_empty() {
                let mut custom_names: Vec<String> = custom_configs.keys().cloned().collect();
                custom_names.sort();
                comp_replacement.system_prop_names = custom_names;
            }
        }

        let replacement_text = generate_replacement(&comp_replacement, &group_registry);
        if replacement_idx < replacements.len() {
            replacements[replacement_idx].replacement = replacement_text;
        }
        replacement_idx += 1;
    }

    // Generate component CSS
    let mut css = generate_css(&component_css_list, &breakpoints, None);

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

    // Collect root binding names used by extracted primary chains.
    // Primary chains are rooted at a binding imported from `@animus-ui/system`.
    // If any primary chain was successfully extracted, that import source is now dead.
    let has_primary_chain = chains.iter().any(|c| c.extractable && c.extends_from.is_none());
    let consumed_sources: &[&str] = if has_primary_chain {
        &["@animus-ui/system"]
    } else {
        &[]
    };
    let extracted_bindings: &[&str] = if has_primary_chain { &["animus"] } else { &[] };

    // Apply source replacements
    let css_module_id = format!("virtual:animus/{}", filename.replace('/', "__"));
    let transformed_code = apply_replacements(
        &source,
        &mut replacements,
        &css_module_id,
        "virtual:animus/system-props",
        consumed_sources,
        extracted_bindings,
        None,
        false,
    );

    ExtractionResult {
        css,
        code: transformed_code,
        source_map: String::new(),
        extractable: true,
        errors,
    }
}

/// Shared processing context for chain evaluation. Wraps `ResolveContext` with
/// pipeline-level config needed by `process_chain` but not by `resolve_styles`.
pub(crate) struct ProcessingContext<'a> {
    pub resolve: &'a ResolveContext<'a>,
    pub group_registry: &'a HashMap<String, Vec<String>>,
    pub class_prefix: &'a str,
}

/// Process a single extractable chain into CSS, replacement info, and optional system prop data.
///
/// Returns `(ComponentCss, ComponentReplacement, active_prop_names, custom_prop_configs, skip_warnings)`.
/// - `active_prop_names`: populated when the chain has a `.system()` stage.
/// - `custom_prop_configs`: populated when the chain has a `.props()` stage.
/// - `skip_warnings`: formatted diagnostic strings for properties that were skipped.
pub(crate) fn process_chain(
    chain: &ChainDescriptor,
    source: &str,
    filename: &str,
    ctx: &ProcessingContext,
) -> Result<
    (
        ComponentCss,
        ComponentReplacement,
        Option<HashSet<String>>,
        Option<PropConfigMap>,
        Vec<String>,
    ),
    String,
> {
    let mut base_styles: Option<ResolvedStyles> = None;
    let mut variant_css_list: Vec<VariantCss> = Vec::new();
    let mut compound_css_list: Vec<ResolvedStyles> = Vec::new();
    let mut compound_configs: Vec<CompoundConfig> = Vec::new();
    let mut state_css_list: Vec<(String, ResolvedStyles)> = Vec::new();
    let mut variant_prop_configs: Vec<VariantPropConfig> = Vec::new();
    let mut state_names: Vec<String> = Vec::new();
    let mut active_prop_names: Option<HashSet<String>> = None;
    let mut active_group_names: Vec<String> = Vec::new();
    let mut custom_prop_configs: Option<PropConfigMap> = None;
    let mut skip_warnings: Vec<String> = Vec::new();

    // Build a stable hash input from filename + binding name.
    // This ensures class names don't change when style values are edited,
    // which is critical for HMR — CSS and JS updates must reference the same class.
    let stable_id = format!("{}::{}", filename, chain.binding);
    let class_name = make_class_name(&chain.binding, &stable_id, ctx.class_prefix);

    // We need to re-parse to access the AST nodes at the stage spans.
    // Since we have the program, find the chain's variable declarator and walk it again.
    // For now, we re-parse each stage's argument span as a standalone expression.
    for stage in &chain.stages {
        let arg_source = &source[stage.arg_span.start as usize..stage.arg_span.end as usize];

        match stage.method.as_str() {
            "styles" => {
                let (styles_value, skips, _captures) = parse_object_from_source(arg_source)
                    .map_err(|e| format!("styles eval failed: {}", e))?;
                for skip in &skips {
                    skip_warnings.push(format!(
                        "[skip] {}: property '{}' — {}",
                        chain.binding, skip.key, skip.reason
                    ));
                }
                base_styles = Some(resolve_styles(&styles_value, ctx.resolve, true));
            }
            "variant" => {
                let (variant_config, skips) = parse_variant_from_source(arg_source)
                    .map_err(|e| format!("variant eval failed: {}", e))?;
                for skip in &skips {
                    skip_warnings.push(format!(
                        "[skip] {}: property '{}' — {}",
                        chain.binding, skip.key, skip.reason
                    ));
                }

                // Resolve variant base styles (shared across all options)
                let base_resolved = variant_config
                    .base
                    .as_ref()
                    .map(|b| resolve_styles(b, ctx.resolve, false));

                let mut options_css = Vec::new();
                let mut option_names = Vec::new();

                for (option_name, option_styles) in &variant_config.variants {
                    option_names.push(option_name.clone());
                    let mut resolved = resolve_styles(option_styles, ctx.resolve, false);

                    // Merge base styles into each option (declarations + pseudo + responsive)
                    if let Some(base) = &base_resolved {
                        let mut merged_decls = base.declarations.clone();
                        merged_decls.extend(resolved.declarations);
                        resolved.declarations = merged_decls;

                        // Merge pseudo selectors: base first, option overrides via merge
                        for (sel, decls) in &base.pseudo_selectors {
                            theme_resolver::merge_pseudo_selectors(
                                &mut resolved.pseudo_selectors,
                                sel.clone(),
                                decls.clone(),
                            );
                        }

                        // Merge responsive: base breakpoints first, option extends
                        for (bp, decls) in &base.responsive {
                            let existing = resolved.responsive.iter_mut().find(|(k, _)| k == bp);
                            if let Some((_, existing_decls)) = existing {
                                let mut merged = decls.clone();
                                merged.extend(existing_decls.drain(..));
                                *existing_decls = merged;
                            } else {
                                resolved.responsive.push((bp.clone(), decls.clone()));
                            }
                        }
                    }

                    options_css.push((option_name.clone(), resolved));
                }

                variant_css_list.push(VariantCss {
                    prop: variant_config.prop.clone(),
                    options: options_css,
                    default_option: variant_config.default_variant.clone(),
                });

                variant_prop_configs.push(VariantPropConfig {
                    prop: variant_config.prop,
                    options: option_names,
                    default: variant_config.default_variant,
                });
            }
            "compound" => {
                // First arg: condition object (variant prop → option key)
                let (condition_value, _skips, _captures) = parse_object_from_source(arg_source)
                    .map_err(|e| format!("compound condition eval failed: {}", e))?;

                let mut conditions: HashMap<String, Value> = HashMap::new();
                if let Value::Object(cond_map) = &condition_value {
                    for (key, val) in cond_map {
                        match val {
                            Value::String(_) | Value::Array(_) => {
                                conditions.insert(key.clone(), val.clone());
                            }
                            _ => {}
                        }
                    }
                }

                // Second arg: styles object
                if let Some(second_span) = &stage.second_arg_span {
                    let styles_source = &source[second_span.start as usize..second_span.end as usize];
                    let (styles_value, skips, _captures) = parse_object_from_source(styles_source)
                        .map_err(|e| format!("compound styles eval failed: {}", e))?;
                    for skip in &skips {
                        skip_warnings.push(format!(
                            "[skip] {}: property '{}' — {}",
                            chain.binding, skip.key, skip.reason
                        ));
                    }
                    let resolved = resolve_styles(&styles_value, ctx.resolve, false);
                    let compound_index = compound_css_list.len();
                    let compound_class = format!("{}--compound-{}", class_name, compound_index);
                    compound_css_list.push(resolved);
                    compound_configs.push(CompoundConfig {
                        conditions,
                        class_name: compound_class,
                    });
                }
            }
            "states" => {
                let (states_value, skips, _captures) = parse_object_from_source(arg_source)
                    .map_err(|e| format!("states eval failed: {}", e))?;
                for skip in &skips {
                    skip_warnings.push(format!(
                        "[skip] {}: property '{}' — {}",
                        chain.binding, skip.key, skip.reason
                    ));
                }

                if let Value::Object(states_map) = &states_value {
                    for (state_name, state_styles) in states_map {
                        state_names.push(state_name.clone());
                        let resolved = resolve_styles(state_styles, ctx.resolve, false);
                        state_css_list.push((state_name.clone(), resolved));
                    }
                }
            }
            "system" => {
                // Parse the system argument: { "space": true, "ratio": true, ... }
                // Keys are group names OR individual prop names; values are ignored (presence = active).
                let (system_value, _skips, _captures) = parse_object_from_source(arg_source)
                    .map_err(|e| format!("system eval failed: {}", e))?;

                if let Value::Object(system_map) = &system_value {
                    let mut props: HashSet<String> = HashSet::new();
                    let mut group_names: Vec<String> = Vec::new();
                    for key in system_map.keys() {
                        if let Some(group_props) = ctx.group_registry.get(key) {
                            // Key is a group name — activate all props in the group
                            group_names.push(key.clone());
                            for prop in group_props {
                                props.insert(prop.clone());
                            }
                        } else if ctx.resolve.config.contains_key(key) {
                            // Key is an individual prop name — activate just that prop
                            props.insert(key.clone());
                        }
                    }
                    group_names.sort();
                    if !props.is_empty() {
                        active_prop_names = Some(props);
                    }
                    active_group_names = group_names;
                }
            }
            "props" => {
                // Parse the props argument: { propName: { property, scale, transform }, ... }
                // Each key is a custom prop name; the value is a PropConfig-like object.
                let (props_value, _skips, transform_captures) = parse_object_from_source(arg_source)
                    .map_err(|e| format!("props eval failed: {}", e))?;

                let mut parsed: PropConfigMap = serde_json::from_value(props_value)
                    .map_err(|e| format!("props config parse failed: {}", e))?;

                // Inject captured inline transform function sources into PropConfigs.
                // Captured keys are dotted paths like "sizing.transform" — extract the
                // prop name (first segment) and set transform_fn_source on that config.
                for capture in &transform_captures {
                    if let Some(prop_name) = capture.key.split('.').next() {
                        if let Some(config) = parsed.get_mut(prop_name) {
                            config.transform_fn_source = Some(capture.fn_source.clone());
                        }
                    }
                }

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
        compounds: compound_css_list,
        states: state_css_list,
    };

    let comp_replacement = ComponentReplacement {
        binding: chain.binding.clone(),
        tag: chain.tag.clone(),
        class_name,
        variant_config: variant_prop_configs,
        compound_configs,
        state_names,
        system_prop_names: vec![], // populated in extract() after JSX scanning
        system_group_names: active_group_names,
        span: chain.span,
        is_component_element: chain.terminal == TerminalKind::AsComponent,
        is_class_resolver: chain.terminal == TerminalKind::AsClass,
        has_dynamic_props: false, // populated in analyze_project after JSX scanning
        custom_prop_class_map: None, // populated in analyze_project after custom prop scanning
        custom_dynamic_config: None, // populated in analyze_project after custom prop scanning
    };

    Ok((component_css, comp_replacement, active_prop_names, custom_prop_configs, skip_warnings))
}

/// A captured transform function resolved to source text.
pub(crate) struct ResolvedCapture {
    /// Dotted key path (e.g., "sizing.transform").
    pub key: String,
    /// The function source text extracted from the span.
    pub fn_source: String,
}

/// Parse a source snippet as an object expression and evaluate to JSON.
/// Returns the partial value, skip warnings, and captured transform function sources.
/// Captured spans are resolved to source text internally to avoid offset issues
/// from the wrapping parentheses added during parsing.
pub(crate) fn parse_object_from_source(
    source: &str,
) -> Result<(Value, Vec<SkippedProperty>, Vec<ResolvedCapture>), String> {
    let allocator = Allocator::default();
    // Wrap in parens to make it a valid expression statement
    let wrapped = format!("({})", source);
    let result = Parser::new(&allocator, &wrapped, SourceType::ts()).parse();
    let program = &result.program;

    if let Some(stmt) = program.body.first() {
        if let oxc_ast::ast::Statement::ExpressionStatement(expr_stmt) = stmt {
            if let Expression::ParenthesizedExpression(paren) = &expr_stmt.expression {
                if let Expression::ObjectExpression(obj) = &paren.expression {
                    let (value, skips, captures) =
                        eval_object_expr(obj).map_err(|e| e.reason)?;
                    // Convert captured spans to source text using the wrapped string
                    let resolved = captures
                        .into_iter()
                        .map(|cap| ResolvedCapture {
                            key: cap.key,
                            fn_source: wrapped[cap.span.start as usize..cap.span.end as usize]
                                .to_string(),
                        })
                        .collect();
                    return Ok((value, skips, resolved));
                }
            }
        }
    }

    Err("failed to parse object expression".to_string())
}

/// Parse a variant config source snippet.
/// Returns the config and any per-property skip warnings.
pub(crate) fn parse_variant_from_source(
    source: &str,
) -> Result<(style_evaluator::VariantStageConfig, Vec<SkippedProperty>), String> {
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
/// - `package_resolution_json`: JSON object mapping package specifiers to entry-point paths,
///   e.g. `{ "@my-ui/components": "pkg-barrel/index.ts" }`. Pass `"{}"` when not needed.
/// - `prefix`: optional namespace prefix for class names and CSS custom properties.
///   When set, `animus-` is replaced with `{prefix}-` in all generated identifiers.
/// - `emitter_config_json`: optional JSON `{ "runtime_import": "...", "css_module_id": "..." }`.
///   Overrides hardcoded import paths in generated source. When `None`, defaults to
///   `@animus-ui/system` and `virtual:animus/styles.css`.
#[napi]
pub fn analyze_project(
    file_entries_json: String,
    theme_json: String,
    variable_map_json: String,
    contextual_vars_json: Option<String>,
    config_json: String,
    group_registry_json: String,
    package_resolution_json: String,
    dev_mode: Option<bool>,
    prefix: Option<String>,
    emitter_config_json: Option<String>,
    selector_aliases_json: Option<String>,
    selector_order_json: Option<String>,
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

    let variable_map: VariableMap = match serde_json::from_str(&variable_map_json) {
        Ok(v) => v,
        Err(_) => HashMap::new(),
    };

    let contextual_vars: ContextualVarsMap = contextual_vars_json
        .as_deref()
        .and_then(|json| serde_json::from_str(json).ok())
        .unwrap_or_default();

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

    let package_map: HashMap<String, String> =
        match serde_json::from_str(&package_resolution_json) {
            Ok(m) => m,
            Err(_) => HashMap::new(),
        };

    let resolve_package_path = |source: &str| -> Option<String> {
        package_map.get(source).cloned()
    };

    let selector_aliases: SelectorAliasesMap = selector_aliases_json
        .as_deref()
        .and_then(|json| serde_json::from_str(json).ok())
        .unwrap_or_default();

    let _selector_order: Vec<String> = selector_order_json
        .as_deref()
        .and_then(|json| serde_json::from_str(json).ok())
        .unwrap_or_default();

    let class_prefix = prefix.as_deref().unwrap_or("animus");
    // Layer prefix is only active when a non-default prefix is set.
    // "animus" is the default class prefix — no layer namespacing in that case.
    let layer_prefix = prefix.as_deref();

    let emitter_config: transform_emitter::EmitterConfig = emitter_config_json
        .as_deref()
        .and_then(|json| serde_json::from_str(json).ok())
        .unwrap_or_default();

    let manifest = analyze(
        &files,
        &theme,
        &variable_map,
        &contextual_vars,
        &config,
        &group_registry,
        &resolve_package_path,
        dev_mode.unwrap_or(false),
        class_prefix,
        layer_prefix,
        emitter_config,
        &selector_aliases,
    );

    serde_json::to_string(&manifest).unwrap_or_else(|e| {
        serde_json::json!({ "error": format!("Failed to serialise manifest: {}", e) }).to_string()
    })
}

/// Clear the per-file extraction cache used by `analyze_project()`.
/// Call this on geological resets (theme/config/system file change) to force
/// full re-analysis on the next `analyze_project()` call.
#[napi]
pub fn clear_analysis_cache() {
    project_analyzer::clear_file_cache();
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

    // Determine if any extracted primary chains exist (rooted at builder from @animus-ui/system).
    let has_primary_extracted = chains.iter().any(|c| {
        c.extractable
            && c.extends_from.is_none()
            && {
                let component_id = format!("{}::{}", filename, c.binding);
                component_ids.contains(&component_id)
            }
    });
    let runtime_import = &manifest.emitter_config.runtime_import;
    let consumed_sources: Vec<&str> = if has_primary_extracted {
        vec![runtime_import.as_str()]
    } else {
        vec![]
    };
    let extracted_bindings: &[&str] = if has_primary_extracted { &["animus"] } else { &[] };

    let needs_use_client = manifest.use_client_files.contains(&filename);
    let transformed_code = transform_emitter::apply_replacements(
        &source,
        &mut replacements,
        &manifest.emitter_config.css_module_id,
        &manifest.emitter_config.system_props_module_id,
        &consumed_sources,
        extracted_bindings,
        Some(manifest.emitter_config.runtime_import.as_str()),
        needs_use_client,
    );

    TransformResult {
        code: transformed_code,
        has_components: true,
    }
}
