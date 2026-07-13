//! Replacement assembly (row 06 Task 06.3, facts-derivable subset):
//! per-component `createComponent`/`createClassResolver` call text from
//! FACTS — v1-exact template shapes and the inc-01-sorted config JSON.
//!
//! Config-dependent payloads (systemPropNames/groups, customPropMap,
//! customDynamicConfig) require prop-config/theme inputs and ride with
//! row 07; components that need them FAIL LOUD at transform time rather
//! than emitting a wrong template (G5 — never a silently wrong shape).
//!
//! v1 references: transform_emitter::generate_replacement (template
//! shapes), css_generator::{content_hash, make_class_name} (FNV-1a class
//! identity over "{filename}::{binding}" — stable across style edits,
//! the HMR-critical property), lib.rs process_chain (stable_id).

use std::collections::{BTreeMap, HashMap};

use rustc_hash::FxHashMap;

use serde_json::{json, Map, Value};

use crate::chain_walk::TerminalKind;
use crate::dynamic_meta::DynamicPropMeta;
use crate::facts::{ChainFacts, FileFacts};

pub use crate::ids::{class_name_for, content_hash, make_class_name};

#[derive(Debug)]
pub enum AssembleError {
    /// Component requires config-dependent payloads (row 07 inputs).
    NeedsConfig(String),
}

/// Config-dependent replacement payloads, computed by analyze_css (v1
/// Phase 5c/6 equivalents) and injected at transform time. A payload
/// entry exists for every pipeline SURVIVOR; chains without one are not
/// replaced (v1 silently skips non-manifest components).
#[derive(Debug, Clone, Default)]
pub struct ReplacementPayload {
    /// Sorted, deduped union of active system props + custom prop names
    /// (v1 Phase 5c 1462-1474).
    pub system_prop_names: Vec<String>,
    /// Sorted active group names (v1 system-stage group expansion).
    pub system_group_names: Vec<String>,
    /// v1 Phase 6 1617-1620: any system prop name is dynamically used.
    pub has_dynamic_props: bool,
    /// prop → value_key → utility class (v1 custom_prop_class_map).
    pub custom_prop_class_map: Option<HashMap<String, HashMap<String, String>>>,
    /// prop → dynamic meta (v1 custom_dynamic_config).
    pub custom_dynamic_config: Option<HashMap<String, DynamicPropMeta>>,
    /// POST-MERGE chain config for extension children (v1 908-929 merges
    /// parent variant/state/compound configs into the child replacement).
    /// None for non-extension chains — facts-derived config is used.
    pub merged_config: Option<MergedChainConfig>,
}

/// v1 ComponentReplacement config trio, post-extension-merge.
#[derive(Debug, Clone, Default)]
pub struct MergedChainConfig {
    /// (prop, options, default) in v1 variant_config order.
    pub variant_config: Vec<(String, Vec<String>, Option<String>)>,
    /// Compound (sorted conditions, class_name) — parent-first.
    pub compound_configs: Vec<(BTreeMap<String, Value>, String)>,
    /// State names, parent-appended-after-child per v1 925-928.
    pub state_names: Vec<String>,
}

/// Build the runtime-config JSON string for the facts-derivable subset —
/// key order matches v1's inc-01-patched serialization exactly (sorted
/// compound conditions; insertion order variants→compounds→states).
fn build_config(
    filename: &str,
    binding: &str,
    chain: &ChainFacts,
    prefix: &str,
    payload: Option<&ReplacementPayload>,
    group_registry: &FxHashMap<String, Vec<String>>,
) -> Result<String, AssembleError> {
    let mut config = Map::new();

    // Variants (v1: {prop: {options[, default]}} keyed per variant stage)
    let mut variants = Map::new();
    let mut compounds: Vec<Value> = Vec::new();
    let mut states: Vec<String> = Vec::new();
    let mut compound_index = 0usize;
    let class_name = class_name_for(filename, binding, prefix);
    let use_merged = payload.and_then(|p| p.merged_config.as_ref());

    for stage in &chain.stages {
        if use_merged.is_some() && matches!(stage.method.as_str(), "variant" | "compound" | "states")
        {
            // Extension child: the merged trio below is authoritative.
            continue;
        }
        match stage.method.as_str() {
            "variant" => {
                if let Some(v) = &stage.value {
                    let prop = v["prop"].as_str().unwrap_or("variant").to_string();
                    let mut entry = Map::new();
                    let options: Vec<String> = v["variants"]
                        .as_object()
                        .map(|m| m.keys().cloned().collect())
                        .unwrap_or_default();
                    entry.insert("options".into(), json!(options));
                    if let Some(d) = v["defaultVariant"].as_str() {
                        entry.insert("default".into(), json!(d));
                    }
                    variants.insert(prop, Value::Object(entry));
                }
            }
            "compound" => {
                // v1 lib.rs 536-554: a CompoundConfig exists ONLY when the
                // second (styles) argument does — one-arg .compound(cond)
                // contributes neither config nor CSS, and the positional
                // class index counts styled compounds only.
                if stage.second_value.is_some() {
                    if let Some(cond) = &stage.value {
                        // Sorted conditions (v1 inc-01 determinism patch).
                        let sorted: BTreeMap<String, Value> = cond
                            .as_object()
                            .map(|m| {
                                m.iter()
                                    .filter(|(_, v)| v.is_string() || v.is_array())
                                    .map(|(k, v)| (k.clone(), v.clone()))
                                    .collect()
                            })
                            .unwrap_or_default();
                        compounds.push(json!({
                            "conditions": sorted,
                            "className": format!("{class_name}--compound-{compound_index}"),
                        }));
                        compound_index += 1;
                    }
                }
            }
            "states" => {
                if let Some(v) = &stage.value {
                    if let Some(m) = v.as_object() {
                        states.extend(m.keys().cloned());
                    }
                }
            }
            "system" | "props" => {
                // Payload-fed when analyze ran with config inputs; a bare
                // call without payloads still fails loud (never a wrong
                // template).
                if payload.is_none() {
                    return Err(AssembleError::NeedsConfig(format!(
                        "{binding}: '{}' stage payloads require prop config (row 07)",
                        stage.method
                    )));
                }
            }
            _ => {}
        }
    }

    if let Some(merged) = use_merged {
        // v1 build_runtime_config 195-227 over the POST-MERGE config.
        for (prop, options, default) in &merged.variant_config {
            let mut entry = Map::new();
            entry.insert("options".into(), json!(options));
            if let Some(d) = default {
                entry.insert("default".into(), json!(d));
            }
            variants.insert(prop.clone(), Value::Object(entry));
        }
        for (conditions, cname) in &merged.compound_configs {
            compounds.push(json!({
                "conditions": conditions,
                "className": cname,
            }));
        }
        states = merged.state_names.clone();
    }
    if !variants.is_empty() {
        config.insert("variants".into(), Value::Object(variants));
    }
    if !compounds.is_empty() {
        config.insert("compounds".into(), json!(compounds));
    }
    if !states.is_empty() {
        config.insert("states".into(), json!(states));
    }

    let base_json =
        serde_json::to_string(&Value::Object(config)).unwrap_or_else(|_| "{}".into());
    let Some(p) = payload else {
        return Ok(base_json);
    };

    // v1 build_runtime_config tail (transform_emitter 232-338), verbatim
    // string-splice semantics.
    let mut result = if !p.system_group_names.is_empty() {
        let mut concat_parts: Vec<String> = p
            .system_group_names
            .iter()
            .map(|g| format!("systemPropGroups.{}", g))
            .collect();
        {
            let mut extra_names: rustc_hash::FxHashSet<String> = rustc_hash::FxHashSet::default();
            if !p.system_prop_names.is_empty() {
                let group_covered: rustc_hash::FxHashSet<String> = p
                    .system_group_names
                    .iter()
                    .filter_map(|g| group_registry.get(g))
                    .flat_map(|props| props.iter().cloned())
                    .collect();
                for prop in &p.system_prop_names {
                    if !group_covered.contains(prop) {
                        extra_names.insert(prop.clone());
                    }
                }
            }
            if let Some(ref cpm) = p.custom_prop_class_map {
                extra_names.extend(cpm.keys().cloned());
            }
            if let Some(ref cdc) = p.custom_dynamic_config {
                extra_names.extend(cdc.keys().cloned());
            }
            if !extra_names.is_empty() {
                let mut sorted: Vec<String> = extra_names.into_iter().collect();
                sorted.sort();
                concat_parts
                    .push(serde_json::to_string(&sorted).unwrap_or_else(|_| "[]".to_string()));
            }
        }
        let concat_expr = concat_parts.join(",");
        let spn_field = format!("\"systemPropNames\":[].concat({})", concat_expr);
        if base_json == "{}" {
            format!("{{{}}}", spn_field)
        } else {
            format!("{},{}}}", &base_json[..base_json.len() - 1], spn_field)
        }
    } else if !p.system_prop_names.is_empty() {
        let mut config_map: Map<String, Value> =
            serde_json::from_str(&base_json).unwrap_or_default();
        config_map.insert("systemPropNames".to_string(), json!(p.system_prop_names));
        serde_json::to_string(&Value::Object(config_map)).unwrap_or(base_json)
    } else {
        base_json
    };

    if let Some(ref cpm) = p.custom_prop_class_map {
        let sorted_cpm: BTreeMap<&String, BTreeMap<&String, &String>> =
            cpm.iter().map(|(k, v)| (k, v.iter().collect())).collect();
        let cpm_json = serde_json::to_string(&sorted_cpm).unwrap_or_else(|_| "{}".to_string());
        if result == "{}" {
            result = format!("{{\"customPropMap\":{}}}", cpm_json);
        } else {
            result = format!("{},\"customPropMap\":{}}}", &result[..result.len() - 1], cpm_json);
        }
    }

    if let Some(ref cdc) = p.custom_dynamic_config {
        let mut entries: Vec<String> = Vec::new();
        let mut sorted_keys: Vec<&String> = cdc.keys().collect();
        sorted_keys.sort();
        for prop_name in sorted_keys {
            let meta = &cdc[prop_name];
            let mut fields: Vec<String> = Vec::new();
            fields.push(format!("\"varName\":\"{}\"", meta.var_name));
            fields.push(format!("\"slotClass\":\"{}\"", meta.slot_class));
            fields.push(format!("\"property\":\"{}\"", meta.property));
            if !meta.properties.is_empty() {
                let props_json =
                    serde_json::to_string(&meta.properties).unwrap_or_else(|_| "[]".to_string());
                fields.push(format!("\"properties\":{}", props_json));
            }
            if let Some(ref fn_src) = meta.transform_fn_source {
                fields.push(format!("\"transform\":{}", fn_src));
            } else if let Some(ref tn) = meta.transform_name {
                fields.push(format!("\"transformName\":\"{}\"", tn));
                fields.push(format!("\"transform\":transforms.{}", tn));
            }
            if !meta.scale_values.is_empty() {
                let sorted_sv: BTreeMap<&String, &String> = meta.scale_values.iter().collect();
                let sv_json =
                    serde_json::to_string(&sorted_sv).unwrap_or_else(|_| "{}".to_string());
                fields.push(format!("\"scaleValues\":{}", sv_json));
            }
            entries.push(format!("\"{}\":{{{}}}", prop_name, fields.join(",")));
        }
        let cdc_str = format!("{{{}}}", entries.join(","));
        if result == "{}" {
            result = format!("{{\"customDynamicConfig\":{}}}", cdc_str);
        } else {
            result = format!(
                "{},\"customDynamicConfig\":{}}}",
                &result[..result.len() - 1],
                cdc_str
            );
        }
    }

    Ok(result)
}

/// v1 generate_replacement template shapes (no-system-props forms; the
/// system/dynamic forms require config and are row-07-gated upstream).
pub fn generate_replacement(
    filename: &str,
    chain: &ChainFacts,
    prefix: &str,
    payload: Option<&ReplacementPayload>,
    group_registry: &FxHashMap<String, Vec<String>>,
) -> Result<String, AssembleError> {
    let d = &chain.descriptor;
    let class_name = class_name_for(filename, &d.binding, prefix);
    let config = build_config(filename, &d.binding, chain, prefix, payload, group_registry)?;
    let has_system_props = payload.is_some_and(|p| !p.system_prop_names.is_empty());
    let has_dynamic_props = payload.is_some_and(|p| p.has_dynamic_props);

    Ok(if d.terminal == TerminalKind::AsClass {
        if has_system_props && has_dynamic_props {
            format!(
                "createClassResolver('{}', {}, systemPropMap, dynamicPropConfig)",
                class_name, config
            )
        } else if has_system_props {
            format!("createClassResolver('{}', {}, systemPropMap)", class_name, config)
        } else {
            format!("createClassResolver('{}', {})", class_name, config)
        }
    } else {
        let tag = if d.terminal == TerminalKind::AsComponent {
            d.tag.clone()
        } else {
            format!("'{}'", d.tag)
        };
        if has_system_props && has_dynamic_props {
            format!(
                "createComponent({}, '{}', {}, systemPropMap, dynamicPropConfig)",
                tag, class_name, config
            )
        } else if has_system_props {
            format!("createComponent({}, '{}', {}, systemPropMap)", tag, class_name, config)
        } else {
            format!("createComponent({}, '{}', {})", tag, class_name, config)
        }
    })
}

/// Assemble replacement plan entries for one file's extractable,
/// non-fatal chains.
pub fn assemble_replacements(
    filename: &str,
    facts: &FileFacts,
    prefix: &str,
    payloads: Option<&HashMap<String, ReplacementPayload>>,
    group_registry: &FxHashMap<String, Vec<String>>,
) -> Result<Vec<(u32, u32, String)>, AssembleError> {
    let mut out = Vec::new();
    for chain in &facts.chains {
        if !chain.descriptor.extractable || chain.fatal_error.is_some() {
            continue;
        }
        // v1 replaces only manifest SURVIVORS: when payloads are supplied
        // (analyze ran), a chain absent from them was dropped by the
        // pipeline (silent eval failure) — mirror by not replacing it.
        let payload = match payloads {
            Some(map) => match map.get(&chain.descriptor.binding) {
                Some(p) => Some(p),
                None => continue,
            },
            None => None,
        };
        let text = generate_replacement(filename, chain, prefix, payload, group_registry)?;
        out.push((chain.descriptor.span.0, chain.descriptor.span.1, text));
    }
    Ok(out)
}


/// v1 strip_consumed_imports VERBATIM (transform_emitter 497-535): the
/// split/rebuild loop IS the trailing-newline quirk's origin — porting the
/// loop, not a replay of its observed behavior (inc-07 review F7: the
/// replay diverged at EOF-consumed-import corners).
pub fn strip_consumed_imports(
    source: &str,
    consumed_sources: &[&str],
    extracted_bindings: &[&str],
) -> String {
    let mut result = String::with_capacity(source.len());

    for line in source.split('\n') {
        let trimmed = line.trim();

        if trimmed.starts_with("import") && trimmed.contains('{') && trimmed.contains("from") {
            if let Some((bindings, source_str)) = parse_named_import(trimmed) {
                if consumed_sources.contains(&source_str.as_str()) {
                    let all_extracted =
                        bindings.iter().all(|b| extracted_bindings.contains(&b.as_str()));
                    if all_extracted {
                        continue;
                    }
                }
            }
        }

        result.push_str(line);
        result.push('\n');
    }

    if !source.ends_with('\n') && result.ends_with('\n') {
        result.pop();
    }

    result
}

/// Result of scanning an ECMAScript directive prologue.
struct DirectivePrologue {
    /// Byte offset just past the LAST directive (including its trailing
    /// semicolon when present).
    end: usize,
    /// True when any directive in the prologue is exactly `use client`.
    has_use_client: bool,
}

/// Scan the ECMAScript directive prologue at the start of `source`.
/// Whitespace and comments (line + block) may precede and separate
/// directives; a directive is a string-literal expression statement
/// terminated by `;`, a line break (ASI), or EOF. Returns `None` when no
/// directive exists in prologue position.
///
/// Shed 2026-07-13 (extract-quirk-shed inc 03): v1 detects `'use client'`
/// only at byte offset 0 (transform_emitter directive check), so leading
/// trivia defeats detection and imports land ABOVE the directive,
/// breaking Next. v2 honors the prologue per ECMAScript semantics —
/// licensed intentional-correctness divergence
/// (`parity/use-client-comment.tsx`).
fn scan_directive_prologue(source: &str) -> Option<DirectivePrologue> {
    let bytes = source.as_bytes();
    let len = bytes.len();
    let mut i = 0usize;
    let mut end: Option<usize> = None;
    let mut has_use_client = false;
    loop {
        // Skip whitespace (ASCII is sufficient for real-world prologues;
        // exotic Unicode whitespace conservatively ends the scan).
        while i < len && matches!(bytes[i], b' ' | b'\t' | b'\r' | b'\n' | 0x0b | 0x0c) {
            i += 1;
        }
        if i >= len {
            break;
        }
        // Skip comments.
        if bytes[i] == b'/' && i + 1 < len && bytes[i + 1] == b'/' {
            while i < len && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        if bytes[i] == b'/' && i + 1 < len && bytes[i + 1] == b'*' {
            match source[i + 2..].find("*/") {
                Some(off) => {
                    i += 2 + off + 2;
                    continue;
                }
                None => break, // unterminated block comment — no directive beyond
            }
        }
        // A directive is a string-literal expression statement.
        let quote = bytes[i];
        if quote != b'\'' && quote != b'"' {
            break;
        }
        // Find the closing quote, honoring escapes; a raw line break
        // means the literal did not close (not a directive).
        let mut j = i + 1;
        let closing = loop {
            if j >= len {
                break None;
            }
            match bytes[j] {
                b'\\' => j += 2,
                b'\n' => break None,
                b if b == quote => break Some(j),
                _ => j += 1,
            }
        };
        let Some(close) = closing else { break };
        let mut stmt_end = close + 1;
        // Optional horizontal whitespace, then `;` / line break / EOF
        // terminates the statement. Anything else (e.g. `.length`) makes
        // this an expression, not a directive.
        let mut k = stmt_end;
        while k < len && matches!(bytes[k], b' ' | b'\t') {
            k += 1;
        }
        if k < len && bytes[k] == b';' {
            stmt_end = k + 1;
        } else if k < len && bytes[k] != b'\n' && bytes[k] != b'\r' {
            break;
        }
        if &source[i + 1..close] == "use client" {
            has_use_client = true;
        }
        end = Some(stmt_end);
        i = stmt_end;
    }
    end.map(|end| DirectivePrologue { end, has_use_client })
}

/// v1 apply_replacements directive tail (transform_emitter 471-490),
/// operating on the POST-STRIP string (inc-07 review F6), with the
/// offset-0 quirk shed (inc 03): the directive prologue is recognized
/// past leading whitespace/comments per ECMAScript semantics, and the
/// whole prologue (trivia included) stays ABOVE the injected imports.
/// v1's single-blank-line strip after the prologue is retained.
pub fn directive_prefix_and_body(
    result: String,
    needs_use_client: bool,
) -> (String, String) {
    match scan_directive_prologue(&result) {
        Some(prologue) => {
            let mut rest_start = prologue.end;
            // Consume the line terminator ending the directive line.
            if result[rest_start..].starts_with("\r\n") {
                rest_start += 2;
            } else if result[rest_start..].starts_with('\n') {
                rest_start += 1;
            }
            // v1 quirk parity: strip ONE blank line following the directive.
            if result[rest_start..].starts_with('\n') {
                rest_start += 1;
            }
            let mut prefix = result[..prologue.end].to_string();
            prefix.push('\n');
            if needs_use_client && !prologue.has_use_client {
                prefix.push_str("'use client';\n");
            }
            let rest = result[rest_start..].to_string();
            (prefix, rest)
        }
        None if needs_use_client => ("'use client';\n".to_string(), result),
        None => (String::new(), result),
    }
}

/// v1 parse_named_import, ported: single-line `import { a, b as c } from 's'`
/// ONLY (the line-based quirk is the contract — multi-line imports are NOT
/// stripped; anticipated register entry). Returns IMPORTED names (left of
/// `as`) and the source specifier.
fn parse_named_import(line: &str) -> Option<(Vec<String>, String)> {
    let rest = line.strip_prefix("import")?.trim_start();
    let brace_start = rest.find('{')?;
    let brace_end = rest.find('}')?;
    if brace_end <= brace_start {
        return None;
    }
    let names_str = &rest[brace_start + 1..brace_end];
    let bindings: Vec<String> = names_str
        .split(',')
        .map(|s| s.trim().split_whitespace().next().unwrap_or("").to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let after = &rest[brace_end + 1..];
    let from_idx = after.find("from")?;
    let spec = after[from_idx + 4..].trim();
    let quote = spec.chars().next()?;
    if quote != '\'' && quote != '"' {
        return None;
    }
    let end = spec[1..].find(quote)? + 1;
    Some((bindings, spec[1..end].to_string()))
}

/// Consumed-import removal SPANS over the ORIGINAL source — v1's
/// line-based strip semantics (transform_emitter::strip_consumed_imports)
/// mapped to the span model: a line is removed iff it single-line-parses
/// as a named import, its source is consumed, and ALL its imported names
/// were extracted.
pub fn consumed_import_removals(
    source: &str,
    consumed_sources: &[&str],
    extracted_bindings: &[&str],
) -> Vec<(u32, u32)> {
    let mut out = Vec::new();
    let mut offset = 0usize;
    for line in source.split('\n') {
        let line_len = line.len();
        let trimmed = line.trim();
        if trimmed.starts_with("import") && trimmed.contains('{') && trimmed.contains("from") {
            if let Some((bindings, src)) = parse_named_import(trimmed) {
                if consumed_sources.contains(&src.as_str())
                    && bindings
                        .iter()
                        .all(|b| extracted_bindings.contains(&b.as_str()))
                {
                    // Remove the line INCLUDING its newline when present.
                    let end = if offset + line_len < source.len() {
                        offset + line_len + 1
                    } else {
                        offset + line_len
                    };
                    out.push((offset as u32, end as u32));
                }
            }
        }
        offset += line_len + 1;
    }
    out
}

/// Directive + import prepend (v1 apply_replacements tail, span form),
/// offset-0 quirk shed (inc 03): an EXISTING directive prologue —
/// including leading comments/blank lines — is kept ABOVE the injected
/// imports; `needs_use_client` injects one when absent. v1's
/// single-blank-line strip after the prologue is retained.
/// Returns (prepend_text, extra_removals).
pub fn directive_and_imports(
    source: &str,
    import_lines: &str,
    needs_use_client: bool,
) -> (String, Vec<(u32, u32)>) {
    match scan_directive_prologue(source) {
        Some(prologue) => {
            let mut consumed_end = prologue.end;
            // Consume the line terminator ending the directive line.
            if source[consumed_end..].starts_with("\r\n") {
                consumed_end += 2;
            } else if source[consumed_end..].starts_with('\n') {
                consumed_end += 1;
            }
            // v1 quirk parity: strip ONE blank line following the directive
            // (transform_emitter: `if result.starts_with('\n')` after removal).
            if source[consumed_end..].starts_with('\n') {
                consumed_end += 1;
            }
            let mut prefix = source[..prologue.end].to_string();
            prefix.push('\n');
            if needs_use_client && !prologue.has_use_client {
                prefix.push_str("'use client';\n");
            }
            (
                format!("{prefix}{import_lines}"),
                vec![(0, consumed_end as u32)],
            )
        }
        None if needs_use_client => (format!("'use client';\n{import_lines}"), Vec::new()),
        None => (import_lines.to_string(), Vec::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::facts::extract_file_facts;
    use crate::owned_ast::{OwnedAst, ParseCounter};

    fn facts_for(path: &str, source: &str) -> FileFacts {
        let counter = ParseCounter::new(0);
        let ast = OwnedAst::parse(path.to_string(), source.to_string(), &counter);
        extract_file_facts(&ast)
    }

    #[test]
    fn class_name_shape() {
        // The true FNV vector pin is cross-engine: the corpus oracle
        // compares v2 class names against v1 manifest class names.
        let name = make_class_name("Box", "a.tsx::Box", "animus");
        assert!(name.starts_with("animus-Box-"));
        assert_eq!(name.len(), "animus-Box-".len() + 8);
        assert_eq!(content_hash("a"), content_hash("a"));
        assert_ne!(content_hash("a"), content_hash("b"));
    }

    #[test]
    fn simple_element_replacement_matches_v1_shape() {
        let facts = facts_for(
            "a.tsx",
            "export const Box = ds.styles({ p: 4 }).asElement('div');",
        );
        let text = generate_replacement("a.tsx", &facts.chains[0], "animus", None, &FxHashMap::default()).unwrap();
        let class = class_name_for("a.tsx", "Box", "animus");
        assert_eq!(text, format!("createComponent('div', '{class}', {{}})"));
    }

    #[test]
    fn variants_compounds_states_config_is_sorted_and_shaped() {
        let facts = facts_for(
            "b.tsx",
            r#"export const Btn = ds
                .variant({ prop: 'size', variants: { sm: {}, lg: {} }, defaultVariant: 'sm' })
                .compound({ variant: 'ghost', size: 'sm' }, { p: 1 })
                .states({ loading: {} })
                .asElement('button');"#,
        );
        let text = generate_replacement("b.tsx", &facts.chains[0], "animus", None, &FxHashMap::default()).unwrap();
        // Sorted compound conditions (size before variant) — the inc-01
        // determinism contract.
        assert!(text.contains(r#""conditions":{"size":"sm","variant":"ghost"}"#), "got {text}");
        assert!(text.contains(r#""variants":{"size":{"options":["sm","lg"],"default":"sm"}}"#) || text.contains(r#""variants":{"size":{"default":"sm","options":["sm","lg"]}}"#), "got {text}");
        assert!(text.contains(r#""states":["loading"]"#));
        assert!(text.contains("--compound-0"));
    }

    #[test]
    fn system_stage_fails_loud_pending_config() {
        let facts = facts_for(
            "c.tsx",
            "export const Box = ds.system({ space: true }).asElement('div');",
        );
        let err = generate_replacement("c.tsx", &facts.chains[0], "animus", None, &FxHashMap::default()).unwrap_err();
        match err {
            AssembleError::NeedsConfig(msg) => assert!(msg.contains("row 07")),
        }
    }


    #[test]
    fn strip_semantics_match_v1_line_quirks() {
        let src = "import { A, B } from './x';\nimport {\n  C,\n} from './y';\nimport { D, E } from './x';\nconst k = 1;\n";
        let removals =
            consumed_import_removals(src, &["./x", "./y"], &["A", "B", "D"]);
        // Line 1: all extracted → removed. Multi-line ./y import: NOT
        // stripped (quirk). Line with D,E: E not extracted → kept.
        assert_eq!(removals.len(), 1);
        assert_eq!(removals[0].0, 0);
        let out = crate::emit::apply_plan(
            src,
            &crate::emit::EmissionPlan { removals, ..Default::default() },
        )
        .unwrap();
        assert!(!out.code.contains("{ A, B }"));
        assert!(out.code.contains("C,"));
        assert!(out.code.contains("{ D, E }"));
    }

    #[test]
    fn directive_at_offset_zero_moves_above_imports() {
        let src = "'use client';\nconst x = 1;\n";
        let (prepend, removals) = directive_and_imports(src, "import Z from 'z';\n", false);
        let out = crate::emit::apply_plan(
            src,
            &crate::emit::EmissionPlan { prepend, removals, ..Default::default() },
        )
        .unwrap();
        assert!(out.code.starts_with("'use client';\nimport Z from 'z';\nconst x = 1;"));
    }

    #[test]
    fn comment_preceded_directive_keeps_prologue_above_imports() {
        let src = "// note\n'use client';\nconst x = 1;\n";
        let (prepend, removals) = directive_and_imports(src, "import Z from 'z';\n", false);
        let out = crate::emit::apply_plan(
            src,
            &crate::emit::EmissionPlan { prepend, removals, ..Default::default() },
        )
        .unwrap();
        // Shed (inc 03): the whole prologue — comment included — stays
        // above the injected imports (v1's offset-0 quirk put them above
        // the directive; licensed register entry
        // parity/use-client-comment.tsx).
        assert!(
            out.code
                .starts_with("// note\n'use client';\nimport Z from 'z';\nconst x = 1;"),
            "got {}",
            out.code
        );
    }

    #[test]
    fn prologue_prefix_comment_then_directive() {
        let (prefix, rest) = directive_prefix_and_body(
            "// note\n'use client';\nconst x = 1;\n".to_string(),
            false,
        );
        assert_eq!(prefix, "// note\n'use client';\n");
        assert_eq!(rest, "const x = 1;\n");
    }

    #[test]
    fn prologue_prefix_blank_line_then_directive() {
        // Leading blank lines are trivia; the directive is still in
        // prologue position and stays above the imports.
        let (prefix, rest) = directive_prefix_and_body(
            "\n\n'use client';\nconst x = 1;\n".to_string(),
            false,
        );
        assert_eq!(prefix, "\n\n'use client';\n");
        assert_eq!(rest, "const x = 1;\n");
    }

    #[test]
    fn prologue_prefix_directive_then_blank_line_strips_one_blank() {
        // v1 parity: exactly one blank line after the prologue is eaten
        // (keeps use-client-blank-line.tsx byte-identical across engines).
        let (prefix, rest) = directive_prefix_and_body(
            "'use client';\n\nimport { ds } from './x';\n".to_string(),
            false,
        );
        assert_eq!(prefix, "'use client';\n");
        assert_eq!(rest, "import { ds } from './x';\n");
    }

    #[test]
    fn prologue_recognizes_multiple_directives_and_block_comments() {
        let (prefix, rest) = directive_prefix_and_body(
            "/* header */\n'use strict';\n// mid\n\"use client\"\nconst x = 1;\n".to_string(),
            false,
        );
        assert_eq!(prefix, "/* header */\n'use strict';\n// mid\n\"use client\"\n");
        assert_eq!(rest, "const x = 1;\n");
    }

    #[test]
    fn non_directive_string_is_not_a_prologue() {
        // A string literal in expression (non-statement) position is not
        // a directive; neither is one consumed by a member expression.
        let (prefix, rest) =
            directive_prefix_and_body("const s = 'use client';\n".to_string(), false);
        assert_eq!(prefix, "");
        assert_eq!(rest, "const s = 'use client';\n");
        let (prefix, _) =
            directive_prefix_and_body("'use client'.length;\nconst x = 1;\n".to_string(), false);
        assert_eq!(prefix, "");
    }

    #[test]
    fn needs_use_client_appends_below_existing_prologue() {
        let (prefix, rest) = directive_prefix_and_body(
            "'use strict';\nconst x = 1;\n".to_string(),
            true,
        );
        assert_eq!(prefix, "'use strict';\n'use client';\n");
        assert_eq!(rest, "const x = 1;\n");
    }

    #[test]
    fn class_resolver_shape() {
        let facts = facts_for("d.tsx", "export const card = ds.styles({ p: 8 }).asClass();");
        let text = generate_replacement("d.tsx", &facts.chains[0], "animus", None, &FxHashMap::default()).unwrap();
        assert!(text.starts_with("createClassResolver('animus-card-"), "got {text}");
    }
}
