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
mod transform_evaluator;
mod transform_extractor;

use std::collections::HashMap;

use napi_derive::napi;
use rustc_hash::{FxHashMap, FxHashSet};
use oxc_allocator::Allocator;
use oxc_ast::ast::Expression;
use oxc_parser::Parser;
use oxc_span::SourceType;
use serde_json::Value;

use chain_walker::{walk_chains, ChainDescriptor, ChainStage, TerminalKind};
use css_generator::{
    generate_css, generate_custom_prop_css, generate_utility_css, make_class_name, BreakpointMap,
    ComponentCss, UtilityInput, VariantCss,
};
use jsx_scanner::scan_jsx;
use style_evaluator::{eval_object_expr_with_statics, parse_variant_arg, SkippedProperty};
use theme_resolver::{
    resolve_styles, ContextualVarsMap, FlatTheme, PropConfig, PropConfigMap, ResolveContext,
    ResolvedStyles, SelectorAliasesMap, VariableMap,
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

fn source_type_for_filename(filename: &str) -> SourceType {
    if filename.ends_with(".tsx") {
        SourceType::tsx()
    } else if filename.ends_with(".ts") {
        SourceType::ts()
    } else if filename.ends_with(".jsx") {
        SourceType::jsx()
    } else {
        SourceType::mjs()
    }
}

#[napi]
// N-API exposes this positional boundary; changing it would break consumers.
#[allow(clippy::too_many_arguments)]
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
    let theme: FlatTheme = match serde_json::from_str::<HashMap<String, String>>(&theme_json) {
        Ok(t) => t.into_iter().collect(),
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

    let variable_map: VariableMap = serde_json::from_str::<HashMap<String, String>>(&variable_map_json)
        .map(|v| v.into_iter().collect())
        .unwrap_or_default();

    let config: PropConfigMap = match serde_json::from_str::<HashMap<String, PropConfig>>(&config_json) {
        Ok(c) => c.into_iter().collect(),
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
        .and_then(|json| serde_json::from_str::<HashMap<String, String>>(json).ok())
        .map(|m| m.into_iter().collect())
        .unwrap_or_default();

    let _selector_order: Vec<String> = selector_order_json
        .as_deref()
        .and_then(|json| serde_json::from_str(json).ok())
        .unwrap_or_default();

    // Parse breakpoints from theme (convention: "breakpoints.xs" → "480", etc.)
    let breakpoints = extract_breakpoints(&theme);
    let empty_ctx_vars = ContextualVarsMap::default();

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
    let mut chain_results: Vec<(ComponentReplacement, Option<FxHashSet<String>>, Option<PropConfigMap>)> =
        Vec::new();
    let mut replacements: Vec<SourceReplacement> = Vec::new();
    let mut any_extracted = false;

    // Construct shared contexts once for the entire extraction run
    let bp_keys: FxHashSet<String> = breakpoints.breakpoints.keys().cloned().collect();
    let resolve_ctx = ResolveContext {
        config: &config,
        theme: &theme,
        variable_map: &variable_map,
        contextual_vars: &empty_ctx_vars,
        breakpoint_keys: &bp_keys,
        selector_aliases: &selector_aliases,
        transform_evaluator: None,
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

        match process_chain(chain, &source, &filename, &proc_ctx, None) {
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
    let mut component_props: FxHashMap<String, FxHashSet<String>> = FxHashMap::default();
    for (comp_replacement, active_props, _) in &chain_results {
        if let Some(props) = active_props {
            if !props.is_empty() {
                component_props.insert(comp_replacement.binding.clone(), props.clone());
            }
        }
    }

    // Collect all custom prop usages for .props() chains
    let mut all_custom_configs: PropConfigMap = FxHashMap::default();
    let mut has_custom_props = false;
    for (_, _, custom_configs) in &chain_results {
        if let Some(cc) = custom_configs {
            all_custom_configs.extend(cc.clone());
            has_custom_props = true;
        }
    }

    let (utility_output, custom_output) = if component_props.is_empty() && !has_custom_props {
        (None, None)
    } else {
        let scan_allocator = Allocator::default();
        let jsx_parse = Parser::new(
            &scan_allocator,
            &source,
            source_type_for_filename(&filename),
        )
        .parse();
        let empty_member_bindings: FxHashMap<String, String> = FxHashMap::default();

        // Scan utility props when any chain activates system props.
        let utility_output = if component_props.is_empty() {
            None
        } else {
            let jsx_scan = scan_jsx(
                &jsx_parse.program,
                &component_props,
                &empty_member_bindings,
            );
            let utility_inputs: Vec<UtilityInput> = jsx_scan.static_usages
                .iter()
                .map(|u| UtilityInput {
                    prop_name: u.prop_name.clone(),
                    value: u.value.clone(),
                })
                .collect();

            Some(generate_utility_css(
                &utility_inputs,
                &resolve_ctx,
                &breakpoints,
                None,
                "animus",
            ))
        };

        // Custom prop utility CSS (from .props()).
        let custom_output = if has_custom_props {
            let mut custom_component_props: FxHashMap<String, FxHashSet<String>> =
                FxHashMap::default();
            for (comp_replacement, _, custom_configs) in &chain_results {
                if let Some(cc) = custom_configs {
                    if !cc.is_empty() {
                        let prop_names: FxHashSet<String> = cc.keys().cloned().collect();
                        custom_component_props.insert(comp_replacement.binding.clone(), prop_names);
                    }
                }
            }

            let custom_scan = scan_jsx(
                &jsx_parse.program,
                &custom_component_props,
                &empty_member_bindings,
            );
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
                ))
            }
        } else {
            None
        };

        (utility_output, custom_output)
    };

    // Build final ComponentReplacements with system_prop_names populated
    // and fill in the SourceReplacement text.
    // system_props moved to shared map — only prop names stay per-component.
    for (replacement_idx, (mut comp_replacement, active_props, custom_prop_configs)) in
        chain_results.into_iter().enumerate()
    {
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
type ProcessedChain = (
    ComponentCss,
    ComponentReplacement,
    Option<FxHashSet<String>>,
    Option<PropConfigMap>,
    Vec<String>,
);

struct ChainAccumulator {
    class_name: String,
    base_styles: Option<ResolvedStyles>,
    variant_css_list: Vec<VariantCss>,
    compound_css_list: Vec<ResolvedStyles>,
    compound_configs: Vec<CompoundConfig>,
    state_css_list: Vec<(String, ResolvedStyles)>,
    variant_prop_configs: Vec<VariantPropConfig>,
    state_names: Vec<String>,
    active_prop_names: Option<FxHashSet<String>>,
    active_group_names: Vec<String>,
    custom_prop_configs: Option<PropConfigMap>,
    skip_warnings: Vec<String>,
}

impl ChainAccumulator {
    fn new(class_name: String) -> Self {
        Self {
            class_name,
            base_styles: None,
            variant_css_list: Vec::new(),
            compound_css_list: Vec::new(),
            compound_configs: Vec::new(),
            state_css_list: Vec::new(),
            variant_prop_configs: Vec::new(),
            state_names: Vec::new(),
            active_prop_names: None,
            active_group_names: Vec::new(),
            custom_prop_configs: None,
            skip_warnings: Vec::new(),
        }
    }

    fn record_skips(&mut self, binding: &str, skips: &[SkippedProperty]) {
        self.skip_warnings.extend(skips.iter().map(|skip| {
            format!(
                "[skip] {}: property '{}' — {}",
                binding, skip.key, skip.reason
            )
        }));
    }

    fn process_stage(
        &mut self,
        stage: &ChainStage,
        source: &str,
        chain: &ChainDescriptor,
        ctx: &ProcessingContext,
        static_values: Option<&FxHashMap<String, Value>>,
    ) -> Result<(), String> {
        let arg_source = &source[stage.arg_span.start as usize..stage.arg_span.end as usize];

        match stage.method.as_str() {
            "styles" => self.process_styles(arg_source, &chain.binding, ctx, static_values),
            "variant" => self.process_variant(arg_source, &chain.binding, ctx),
            "compound" => self.process_compound(
                stage,
                arg_source,
                source,
                &chain.binding,
                ctx,
                static_values,
            ),
            "states" => self.process_states(arg_source, &chain.binding, ctx, static_values),
            "system" => self.process_system(arg_source, ctx, static_values),
            "props" => self.process_props(arg_source, static_values),
            _ => Ok(()),
        }
    }

    fn process_styles(
        &mut self,
        arg_source: &str,
        binding: &str,
        ctx: &ProcessingContext,
        static_values: Option<&FxHashMap<String, Value>>,
    ) -> Result<(), String> {
        let (styles_value, skips, _captures) =
            parse_object_from_source_with_statics(arg_source, static_values)
                .map_err(|e| format!("styles eval failed: {}", e))?;
        self.record_skips(binding, &skips);
        self.base_styles = Some(resolve_styles(&styles_value, ctx.resolve, true));
        Ok(())
    }

    fn process_variant(
        &mut self,
        arg_source: &str,
        binding: &str,
        ctx: &ProcessingContext,
    ) -> Result<(), String> {
        let (variant_config, skips) = parse_variant_from_source(arg_source)
            .map_err(|e| format!("variant eval failed: {}", e))?;
        self.record_skips(binding, &skips);

        let base_resolved = variant_config
            .base
            .as_ref()
            .map(|base| resolve_styles(base, ctx.resolve, false));
        let mut options_css = Vec::new();
        let mut option_names = Vec::new();

        for (option_name, option_styles) in &variant_config.variants {
            option_names.push(option_name.clone());
            let mut resolved = resolve_styles(option_styles, ctx.resolve, false);

            if let Some(base) = &base_resolved {
                let mut merged_decls = base.declarations.clone();
                merged_decls.extend(resolved.declarations);
                resolved.declarations = merged_decls;

                for (selector, declarations) in &base.pseudo_selectors {
                    theme_resolver::merge_pseudo_selectors(
                        &mut resolved.pseudo_selectors,
                        selector.clone(),
                        declarations.clone(),
                    );
                }

                for (breakpoint, declarations) in &base.responsive {
                    if let Some((_, existing)) = resolved
                        .responsive
                        .iter_mut()
                        .find(|(key, _)| key == breakpoint)
                    {
                        let mut merged = declarations.clone();
                        merged.append(existing);
                        *existing = merged;
                    } else {
                        resolved
                            .responsive
                            .push((breakpoint.clone(), declarations.clone()));
                    }
                }
            }

            options_css.push((option_name.clone(), resolved));
        }

        self.variant_css_list.push(VariantCss {
            prop: variant_config.prop.clone(),
            options: options_css,
            default_option: variant_config.default_variant.clone(),
        });
        self.variant_prop_configs.push(VariantPropConfig {
            prop: variant_config.prop,
            options: option_names,
            default: variant_config.default_variant,
        });
        Ok(())
    }

    fn process_compound(
        &mut self,
        stage: &ChainStage,
        arg_source: &str,
        source: &str,
        binding: &str,
        ctx: &ProcessingContext,
        static_values: Option<&FxHashMap<String, Value>>,
    ) -> Result<(), String> {
        let (condition_value, _skips, _captures) =
            parse_object_from_source_with_statics(arg_source, static_values)
                .map_err(|e| format!("compound condition eval failed: {}", e))?;
        let mut conditions: HashMap<String, Value> = HashMap::new();
        if let Value::Object(condition_map) = &condition_value {
            for (key, value) in condition_map {
                if matches!(value, Value::String(_) | Value::Array(_)) {
                    conditions.insert(key.clone(), value.clone());
                }
            }
        }

        let Some(second_span) = &stage.second_arg_span else {
            return Ok(());
        };
        let styles_source = &source[second_span.start as usize..second_span.end as usize];
        let (styles_value, skips, _captures) = parse_object_from_source(styles_source)
            .map_err(|e| format!("compound styles eval failed: {}", e))?;
        self.record_skips(binding, &skips);

        let resolved = resolve_styles(&styles_value, ctx.resolve, false);
        let compound_index = self.compound_css_list.len();
        let compound_class = format!("{}--compound-{}", self.class_name, compound_index);
        self.compound_css_list.push(resolved);
        self.compound_configs.push(CompoundConfig {
            conditions,
            class_name: compound_class,
        });
        Ok(())
    }

    fn process_states(
        &mut self,
        arg_source: &str,
        binding: &str,
        ctx: &ProcessingContext,
        static_values: Option<&FxHashMap<String, Value>>,
    ) -> Result<(), String> {
        let (states_value, skips, _captures) =
            parse_object_from_source_with_statics(arg_source, static_values)
                .map_err(|e| format!("states eval failed: {}", e))?;
        self.record_skips(binding, &skips);

        if let Value::Object(states_map) = &states_value {
            for (state_name, state_styles) in states_map {
                self.state_names.push(state_name.clone());
                self.state_css_list.push((
                    state_name.clone(),
                    resolve_styles(state_styles, ctx.resolve, false),
                ));
            }
        }
        Ok(())
    }

    fn process_system(
        &mut self,
        arg_source: &str,
        ctx: &ProcessingContext,
        static_values: Option<&FxHashMap<String, Value>>,
    ) -> Result<(), String> {
        let (system_value, _skips, _captures) =
            parse_object_from_source_with_statics(arg_source, static_values)
                .map_err(|e| format!("system eval failed: {}", e))?;

        if let Value::Object(system_map) = &system_value {
            let mut props: FxHashSet<String> = FxHashSet::default();
            let mut group_names: Vec<String> = Vec::new();
            for key in system_map.keys() {
                if let Some(group_props) = ctx.group_registry.get(key) {
                    group_names.push(key.clone());
                    props.extend(group_props.iter().cloned());
                } else if ctx.resolve.config.contains_key(key) {
                    props.insert(key.clone());
                }
            }
            group_names.sort();
            if !props.is_empty() {
                self.active_prop_names = Some(props);
            }
            self.active_group_names = group_names;
        }
        Ok(())
    }

    fn process_props(
        &mut self,
        arg_source: &str,
        static_values: Option<&FxHashMap<String, Value>>,
    ) -> Result<(), String> {
        let (props_value, _skips, transform_captures) =
            parse_object_from_source_with_statics(arg_source, static_values)
                .map_err(|e| format!("props eval failed: {}", e))?;
        let mut parsed: PropConfigMap = serde_json::from_value(props_value)
            .map_err(|e| format!("props config parse failed: {}", e))?;

        for capture in &transform_captures {
            if let Some(prop_name) = capture.key.split('.').next() {
                if let Some(config) = parsed.get_mut(prop_name) {
                    config.transform_fn_source = Some(capture.fn_source.clone());
                }
            }
        }

        if !parsed.is_empty() {
            self.custom_prop_configs = Some(parsed);
        }
        Ok(())
    }

    fn into_processed(self, chain: &ChainDescriptor) -> ProcessedChain {
        let component_css = ComponentCss {
            class_name: self.class_name.clone(),
            base: self.base_styles,
            variants: self.variant_css_list,
            compounds: self.compound_css_list,
            states: self.state_css_list,
        };
        let comp_replacement = ComponentReplacement {
            binding: chain.binding.clone(),
            tag: chain.tag.clone(),
            class_name: self.class_name,
            variant_config: self.variant_prop_configs,
            compound_configs: self.compound_configs,
            state_names: self.state_names,
            system_prop_names: vec![],
            system_group_names: self.active_group_names,
            span: chain.span,
            is_component_element: chain.terminal == TerminalKind::AsComponent,
            is_class_resolver: chain.terminal == TerminalKind::AsClass,
            has_dynamic_props: false,
            custom_prop_class_map: None,
            custom_dynamic_config: None,
        };

        (
            component_css,
            comp_replacement,
            self.active_prop_names,
            self.custom_prop_configs,
            self.skip_warnings,
        )
    }
}

pub(crate) fn process_chain(
    chain: &ChainDescriptor,
    source: &str,
    filename: &str,
    ctx: &ProcessingContext,
    static_values: Option<&FxHashMap<String, Value>>,
) -> Result<ProcessedChain, String> {
    // Build a stable hash input from filename + binding name.
    // This ensures class names don't change when style values are edited,
    // which is critical for HMR — CSS and JS updates must reference the same class.
    let stable_id = format!("{}::{}", filename, chain.binding);
    let class_name = make_class_name(&chain.binding, &stable_id, ctx.class_prefix);
    let mut accumulator = ChainAccumulator::new(class_name);

    for stage in &chain.stages {
        accumulator.process_stage(stage, source, chain, ctx, static_values)?;
    }

    Ok(accumulator.into_processed(chain))
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
    parse_object_from_source_with_statics(source, None)
}

pub(crate) fn parse_object_from_source_with_statics(
    source: &str,
    static_values: Option<&FxHashMap<String, Value>>,
) -> Result<(Value, Vec<SkippedProperty>, Vec<ResolvedCapture>), String> {
    let allocator = Allocator::default();
    // Wrap in parens to make it a valid expression statement
    let wrapped = format!("({})", source);
    crate::project_analyzer::count_parse();
    let result = Parser::new(&allocator, &wrapped, SourceType::ts()).parse();
    let program = &result.program;

    let Some(oxc_ast::ast::Statement::ExpressionStatement(expr_stmt)) = program.body.first() else {
        return Err("failed to parse object expression".to_string());
    };
    let Expression::ParenthesizedExpression(paren) = &expr_stmt.expression else {
        return Err("failed to parse object expression".to_string());
    };

    match &paren.expression {
        Expression::ObjectExpression(obj) => {
            let (value, skips, captures) =
                eval_object_expr_with_statics(obj, static_values).map_err(|e| e.reason)?;
            // Convert captured spans to source text using the wrapped string
            let resolved = captures
                .into_iter()
                .map(|cap| ResolvedCapture {
                    key: cap.key,
                    fn_source: wrapped[cap.span.start as usize..cap.span.end as usize].to_string(),
                })
                .collect();
            Ok((value, skips, resolved))
        }
        Expression::Identifier(ident) => {
            let Some(value) = static_values
                .and_then(|values| values.get(ident.name.as_str()))
                .filter(|value| value.is_object())
            else {
                return Err(format!(
                    "identifier '{}' not resolvable to static object",
                    ident.name
                ));
            };
            Ok((value.clone(), Vec::new(), Vec::new()))
        }
        _ => Err("failed to parse object expression".to_string()),
    }
}

/// Parse a variant config source snippet.
/// Returns the config and any per-property skip warnings.
pub(crate) fn parse_variant_from_source(
    source: &str,
) -> Result<(style_evaluator::VariantStageConfig, Vec<SkippedProperty>), String> {
    let allocator = Allocator::default();
    let wrapped = format!("({})", source);
    crate::project_analyzer::count_parse();
    let result = Parser::new(&allocator, &wrapped, SourceType::ts()).parse();
    let program = &result.program;

    if let Some(oxc_ast::ast::Statement::ExpressionStatement(expr_stmt)) = program.body.first() {
        if let Expression::ParenthesizedExpression(paren) = &expr_stmt.expression {
            if let Expression::ObjectExpression(obj) = &paren.expression {
                return parse_variant_arg(obj).map_err(|e| e.reason);
            }
        }
    }

    Err("failed to parse variant config".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn object_source_routing_preserves_values_captures_and_errors() {
        let (value, skips, captures) = parse_object_from_source_with_statics(
            r#"{
                color: 'red',
                animation: dynamicValue,
                display: 'flex',
                background: buildBackground(),
                sizing: { property: 'width', transform: (v) => v * 2 },
            }"#,
            None,
        )
        .expect("literal object should evaluate partially");

        assert_eq!(
            value,
            serde_json::json!({
                "color": "red",
                "display": "flex",
                "sizing": { "property": "width" },
            })
        );
        let ordered_skips: Vec<(&str, &str)> = skips
            .iter()
            .map(|skip| (skip.key.as_str(), skip.reason.as_str()))
            .collect();
        assert_eq!(
            ordered_skips,
            vec![
                ("animation", "variable reference (non-static)"),
                ("background", "function call (non-static)"),
            ]
        );
        assert_eq!(captures.len(), 1);
        assert_eq!(captures[0].key, "sizing.transform");
        assert_eq!(captures[0].fn_source, "(v) => v * 2");

        let mut static_values: FxHashMap<String, Value> = FxHashMap::default();
        static_values.insert(
            "STATIC_OBJECT".to_string(),
            serde_json::json!({ "display": "flex" }),
        );
        static_values.insert("SCALAR".to_string(), serde_json::json!(7));

        let (value, skips, captures) =
            parse_object_from_source_with_statics("STATIC_OBJECT", Some(&static_values))
                .expect("object-valued identifier should resolve");
        assert_eq!(value, serde_json::json!({ "display": "flex" }));
        assert!(skips.is_empty());
        assert!(captures.is_empty());

        assert_eq!(
            parse_object_from_source_with_statics("MISSING", Some(&static_values))
                .err()
                .as_deref(),
            Some("identifier 'MISSING' not resolvable to static object")
        );
        assert_eq!(
            parse_object_from_source_with_statics("SCALAR", Some(&static_values))
                .err()
                .as_deref(),
            Some("identifier 'SCALAR' not resolvable to static object")
        );
        assert_eq!(
            parse_object_from_source_with_statics("UNBOUND", None)
                .err()
                .as_deref(),
            Some("identifier 'UNBOUND' not resolvable to static object")
        );
        assert_eq!(
            parse_object_from_source_with_statics("42", None)
                .err()
                .as_deref(),
            Some("failed to parse object expression")
        );
    }

    #[test]
    fn process_chain_preserves_stage_aggregation_and_output_order() {
        let source = r#"
            const Widget = animus
                .styles({ display: 'flex', skippedStyle: dynamicStyle })
                .variant({
                    prop: 'size',
                    base: { color: 'black' },
                    variants: {
                        sm: { opacity: 0.5 },
                        lg: { opacity: 1 },
                    },
                    defaultVariant: 'sm',
                })
                .compound(
                    { size: ['sm', 'lg'] },
                    { color: 'red', skippedCompound: buildColor() },
                )
                .states({
                    loading: { opacity: 0 },
                    ready: { opacity: 1 },
                })
                .system({ layout: true, opacity: true, unknown: true })
                .props({
                    tone: { property: 'color', scale: 'colors' },
                    width: { property: 'width', transform: (value) => value * 2 },
                })
                .asComponent(Link);
        "#;
        let filename = "src/widget.tsx";
        let allocator = Allocator::default();
        let chains = walk_chains(source, filename, &allocator);
        assert_eq!(chains.len(), 1);
        assert_eq!(
            chains[0]
                .stages
                .iter()
                .map(|stage| stage.method.as_str())
                .collect::<Vec<_>>(),
            vec!["styles", "variant", "compound", "states", "system", "props"]
        );

        let config: PropConfigMap = [
            ("display", "display"),
            ("color", "color"),
            ("opacity", "opacity"),
        ]
        .into_iter()
        .map(|(name, property)| {
            (
                name.to_string(),
                PropConfig {
                    property: property.to_string(),
                    properties: vec![],
                    scale: None,
                    transform: None,
                    current_var: None,
                    transform_fn_source: None,
                },
            )
        })
        .collect();
        let theme = FlatTheme::default();
        let variable_map = VariableMap::default();
        let contextual_vars = ContextualVarsMap::default();
        let breakpoint_keys = FxHashSet::default();
        let selector_aliases = SelectorAliasesMap::default();
        let resolve_ctx = ResolveContext {
            config: &config,
            theme: &theme,
            variable_map: &variable_map,
            contextual_vars: &contextual_vars,
            breakpoint_keys: &breakpoint_keys,
            selector_aliases: &selector_aliases,
            transform_evaluator: None,
        };
        let group_registry = HashMap::from([(
            "layout".to_string(),
            vec!["display".to_string(), "color".to_string()],
        )]);
        let process_ctx = ProcessingContext {
            resolve: &resolve_ctx,
            group_registry: &group_registry,
            class_prefix: "test",
        };

        let (component, replacement, active_props, custom_configs, warnings) =
            process_chain(&chains[0], source, filename, &process_ctx, None).unwrap();

        assert_eq!(component.class_name, replacement.class_name);
        assert_eq!(
            component.class_name,
            make_class_name("Widget", "src/widget.tsx::Widget", "test")
        );
        assert_eq!(
            component
                .base
                .as_ref()
                .unwrap()
                .declarations
                .iter()
                .map(|decl| (decl.property.as_str(), decl.value.as_str()))
                .collect::<Vec<_>>(),
            vec![("display", "flex")]
        );
        assert_eq!(component.variants.len(), 1);
        assert_eq!(component.variants[0].prop, "size");
        assert_eq!(
            component.variants[0]
                .options
                .iter()
                .map(|(name, _)| name.as_str())
                .collect::<Vec<_>>(),
            vec!["sm", "lg"]
        );
        assert_eq!(component.variants[0].default_option.as_deref(), Some("sm"));
        assert_eq!(component.compounds.len(), 1);
        assert_eq!(
            component
                .states
                .iter()
                .map(|(name, _)| name.as_str())
                .collect::<Vec<_>>(),
            vec!["loading", "ready"]
        );

        assert_eq!(replacement.binding, "Widget");
        assert_eq!(replacement.tag, "Link");
        assert!(replacement.is_component_element);
        assert!(!replacement.is_class_resolver);
        assert_eq!(replacement.variant_config.len(), 1);
        assert_eq!(replacement.variant_config[0].options, vec!["sm", "lg"]);
        assert_eq!(replacement.state_names, vec!["loading", "ready"]);
        assert_eq!(replacement.system_group_names, vec!["layout"]);
        assert_eq!(replacement.compound_configs.len(), 1);
        assert_eq!(
            replacement.compound_configs[0].conditions.get("size"),
            Some(&serde_json::json!(["sm", "lg"]))
        );
        assert_eq!(
            replacement.compound_configs[0].class_name,
            format!("{}--compound-0", component.class_name)
        );

        let active_props = active_props.unwrap();
        assert_eq!(active_props.len(), 3);
        assert!(active_props.contains("display"));
        assert!(active_props.contains("color"));
        assert!(active_props.contains("opacity"));

        let custom_configs = custom_configs.unwrap();
        assert_eq!(custom_configs.len(), 2);
        assert_eq!(
            custom_configs.get("tone").unwrap().scale,
            Some(serde_json::json!("colors"))
        );
        assert_eq!(
            custom_configs
                .get("width")
                .unwrap()
                .transform_fn_source
                .as_deref(),
            Some("(value) => value * 2")
        );

        assert_eq!(
            warnings,
            vec![
                "[skip] Widget: property 'skippedStyle' — variable reference (non-static)",
                "[skip] Widget: property 'skippedCompound' — function call (non-static)",
            ]
        );

        let css = generate_css(
            std::slice::from_ref(&component),
            &BreakpointMap::new(FxHashMap::default()),
        );
        let base_pos = css.find(&format!(".{} {{", component.class_name)).unwrap();
        let variant_pos = css.find(&format!(".{}--size-sm", component.class_name)).unwrap();
        let compound_pos = css
            .find(&format!(".{}--compound-0", component.class_name))
            .unwrap();
        let state_pos = css
            .find(&format!(".{}--loading", component.class_name))
            .unwrap();
        assert!(base_pos < variant_pos);
        assert!(variant_pos < compound_pos);
        assert!(compound_pos < state_pos);
    }

    #[test]
    fn source_type_routing_preserves_supported_extensions_and_fallback() {
        let cases = [
            ("component.tsx", SourceType::tsx()),
            ("module.ts", SourceType::ts()),
            ("component.jsx", SourceType::jsx()),
            ("module.js", SourceType::mjs()),
            ("unknown.mjs", SourceType::mjs()),
        ];

        for (filename, expected) in cases {
            assert_eq!(source_type_for_filename(filename), expected, "{filename}");
        }
    }
}

/// Extract breakpoint values from the flattened theme.
pub(crate) fn extract_breakpoints(theme: &FlatTheme) -> BreakpointMap {
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
// N-API exposes this positional boundary; changing it would break consumers.
#[allow(clippy::too_many_arguments)]
pub fn analyze_project(
    file_entries_json: String,
    theme_json: String,
    variable_map_json: String,
    contextual_vars_json: Option<String>,
    config_json: String,
    group_registry_json: String,
    package_resolution_json: String,
    dev_mode: Option<bool>,
    emitter_config_json: Option<String>,
    selector_aliases_json: Option<String>,
    selector_order_json: Option<String>,
    global_style_blocks_json: Option<String>,
    path_aliases_json: Option<String>,
    keyframes_blocks_json: Option<String>,
) -> String {
    use project_analyzer::{analyze, AliasEntry, AnalyzeInput, FileEntry};

    let files: Vec<FileEntry> = match serde_json::from_str(&file_entries_json) {
        Ok(f) => f,
        Err(e) => {
            return serde_json::json!({ "error": format!("Failed to parse file entries: {}", e) })
                .to_string()
        }
    };

    let theme: FlatTheme = match serde_json::from_str::<HashMap<String, String>>(&theme_json) {
        Ok(t) => t.into_iter().collect(),
        Err(e) => {
            return serde_json::json!({ "error": format!("Failed to parse theme: {}", e) })
                .to_string()
        }
    };

    let variable_map: VariableMap = serde_json::from_str::<HashMap<String, String>>(&variable_map_json)
        .map(|v| v.into_iter().collect())
        .unwrap_or_default();

    let contextual_vars: ContextualVarsMap = contextual_vars_json
        .as_deref()
        .and_then(|json| serde_json::from_str::<HashMap<String, Vec<String>>>(json).ok())
        .map(|m| m.into_iter().collect())
        .unwrap_or_default();

    let config: PropConfigMap = match serde_json::from_str::<HashMap<String, PropConfig>>(&config_json) {
        Ok(c) => c.into_iter().collect(),
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
        serde_json::from_str(&package_resolution_json).unwrap_or_default();

    let resolve_package_path = |source: &str| -> Option<String> {
        package_map.get(source).cloned()
    };

    let selector_aliases: SelectorAliasesMap = selector_aliases_json
        .as_deref()
        .and_then(|json| serde_json::from_str::<HashMap<String, String>>(json).ok())
        .map(|m| m.into_iter().collect())
        .unwrap_or_default();

    let _selector_order: Vec<String> = selector_order_json
        .as_deref()
        .and_then(|json| serde_json::from_str(json).ok())
        .unwrap_or_default();

    let emitter_config: transform_emitter::EmitterConfig = emitter_config_json
        .as_deref()
        .and_then(|json| serde_json::from_str(json).ok())
        .unwrap_or_default();

    let global_style_blocks: Option<Value> = global_style_blocks_json
        .as_deref()
        .and_then(|json| serde_json::from_str(json).ok());

    let keyframes_blocks: Option<Value> = keyframes_blocks_json
        .as_deref()
        .and_then(|json| serde_json::from_str(json).ok());

    let path_aliases: Vec<AliasEntry> = path_aliases_json
        .as_deref()
        .and_then(|json| {
            #[derive(serde::Deserialize)]
            struct AliasWrapper {
                aliases: Vec<AliasEntry>,
            }
            serde_json::from_str::<AliasWrapper>(json)
                .ok()
                .map(|w| w.aliases)
        })
        .unwrap_or_default();

    let manifest = analyze(AnalyzeInput {
        files: &files,
        theme: &theme,
        variable_map: &variable_map,
        contextual_vars: &contextual_vars,
        config: &config,
        group_registry: &group_registry,
        resolve_package_path: &resolve_package_path,
        dev_mode: dev_mode.unwrap_or(false),
        class_prefix: "animus",
        emitter_config,
        selector_aliases: &selector_aliases,
        global_style_blocks: global_style_blocks.as_ref(),
        path_aliases: &path_aliases,
        keyframes_blocks: keyframes_blocks.as_ref(),
    });

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

    // Check for compose()/composeWithContext() replacements in this file.
    let file_compose_replacements: Vec<&project_analyzer::ComposeReplacementDescriptor> =
        manifest.compose_replacements.iter()
            .filter(|cr| cr.file_path == filename)
            .collect();
    let has_any_compose = !file_compose_replacements.is_empty();
    let has_compose_replacements = file_compose_replacements.iter().any(|cr| !cr.context);
    let has_compose_context_replacements = file_compose_replacements.iter().any(|cr| cr.context);

    if replacements.is_empty() && !has_any_compose {
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

    // If compose replacements exist, re-scan for compose call spans and add replacements.
    if has_any_compose {
        let compose_alloc = oxc_allocator::Allocator::default();
        let compose_source_type = source_type_for_filename(&filename);
        let compose_parsed = Parser::new(&compose_alloc, &source, compose_source_type).parse();
        let compose_families = jsx_scanner::scan_compose_calls(&compose_parsed.program);
        for cr in &file_compose_replacements {
            // Match by slot structure (slots list should be identical)
            if let Some(family) = compose_families.iter().find(|f| f.slots == cr.slots) {
                let replacement_text = transform_emitter::generate_compose_replacement(cr);
                replacements.push(transform_emitter::SourceReplacement {
                    span: oxc_span::Span::new(family.span.0, family.span.1),
                    replacement: replacement_text,
                });
            }
        }
    }

    let runtime_import = &manifest.emitter_config.runtime_import;
    let mut consumed_sources: Vec<&str> = Vec::new();
    if has_primary_extracted || has_any_compose {
        consumed_sources.push(runtime_import.as_str());
    }
    // compose() may be imported from the barrel or the dedicated subpath.
    if has_compose_replacements {
        consumed_sources.push("@animus-ui/system");
        consumed_sources.push("@animus-ui/system/compose");
    }
    // composeWithContext() is imported from the compose-with-context subpath.
    if has_compose_context_replacements {
        consumed_sources.push("@animus-ui/system/compose-with-context");
        consumed_sources.push("@animus-ui/system");
    }

    // Strip builder/compose/composeWithContext imports when their calls are replaced.
    let mut bindings_to_strip: Vec<&str> = Vec::new();
    if has_primary_extracted { bindings_to_strip.push("animus"); }
    if has_compose_replacements { bindings_to_strip.push("compose"); }
    if has_compose_context_replacements { bindings_to_strip.push("composeWithContext"); }

    // Files with composeWithContext need 'use client' (context uses hooks).
    let needs_use_client = manifest.use_client_files.contains(&filename) || has_compose_context_replacements;
    let transformed_code = transform_emitter::apply_replacements(
        &source,
        &mut replacements,
        &manifest.emitter_config.css_module_id,
        &manifest.emitter_config.system_props_module_id,
        &consumed_sources,
        &bindings_to_strip,
        Some(manifest.emitter_config.runtime_import.as_str()),
        needs_use_client,
    );

    TransformResult {
        code: transformed_code,
        has_components: true,
    }
}

// ---------------------------------------------------------------------------
// System module loading — internalized via rquickjs bundled eval
// ---------------------------------------------------------------------------

#[napi(object)]
pub struct NapiSystemConfig {
    pub prop_config: String,
    pub group_registry: String,
    pub scales_json: String,
    pub variable_map_json: String,
    pub variable_css: String,
    pub contextual_vars_json: String,
    pub selector_aliases: Option<String>,
    pub selector_order: Option<String>,
    pub global_style_blocks: Option<String>,
    pub keyframes_blocks: Option<String>,
}

#[napi]
pub fn load_system_module(
    system_path: String,
    root_dir: String,
    export_name: Option<String>,
) -> napi::Result<NapiSystemConfig> {
    let config = animus_system_loader::load_system_module(
        &system_path,
        &root_dir,
        export_name.as_deref(),
    )
    .map_err(napi::Error::from_reason)?;

    Ok(NapiSystemConfig {
        prop_config: config.prop_config,
        group_registry: config.group_registry,
        scales_json: config.scales_json,
        variable_map_json: config.variable_map_json,
        variable_css: config.variable_css,
        contextual_vars_json: config.contextual_vars_json,
        selector_aliases: config.selector_aliases,
        selector_order: config.selector_order,
        global_style_blocks: config.global_style_blocks,
        keyframes_blocks: config.keyframes_blocks,
    })
}
