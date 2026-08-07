//! Source-text surgery: consumed-import stripping and directive-prologue
//! placement.
//!
//! Split out of `assemble.rs` unchanged. This half is pure text
//! manipulation — its only type dependency is `DirectivePrologueFact` — and
//! it shares no private helper with the config/replacement half, which is
//! what made the seam mechanical.
//!
//! Every function here is a verbatim port of a v1 routine whose *quirks* are
//! the contract (the line-based strip, the trailing-newline behaviour, the
//! single-blank-line eat after a prologue). Registered parity entries depend
//! on those quirks, so resist tidying them.

use crate::facts::DirectivePrologueFact;

/// v1 strip_consumed_imports VERBATIM (transform_emitter 497-535): the
/// split/rebuild loop IS the trailing-newline quirk's origin — porting the
/// loop, not a replay of its observed behavior (inc-07 review F7: the
/// replay diverged at EOF-consumed-import corners).
pub fn strip_consumed_imports(
    source: &str,
    consumed_sources: &[&str],
    extracted_bindings: &[&str],
) -> String {
    strip_consumed_imports_with_removals(source, consumed_sources, extracted_bindings).0
}

/// The verbatim v1 strip plus byte ranges removed from its input. The ranges
/// are observation-only metadata: output construction remains the exact loop
/// used by `strip_consumed_imports`.
pub fn strip_consumed_imports_with_removals(
    source: &str,
    consumed_sources: &[&str],
    extracted_bindings: &[&str],
) -> (String, Vec<(usize, usize)>) {
    let mut result = String::with_capacity(source.len());
    let mut removals = Vec::new();
    let mut line_start = 0usize;

    for line in source.split('\n') {
        let line_end = line_start + line.len();
        let next_line_start = if line_end < source.len() {
            line_end + 1
        } else {
            line_end
        };
        let trimmed = line.trim();
        let mut remove = false;

        if trimmed.starts_with("import") && trimmed.contains('{') && trimmed.contains("from") {
            if let Some((bindings, source_str)) = parse_named_import(trimmed) {
                if consumed_sources.contains(&source_str.as_str()) {
                    let all_extracted =
                        bindings.iter().all(|b| extracted_bindings.contains(&b.as_str()));
                    if all_extracted {
                        remove = true;
                    }
                }
            }
        }

        if remove {
            removals.push((line_start, next_line_start));
        } else {
            result.push_str(line);
            result.push('\n');
        }
        line_start = next_line_start;
    }

    if !source.ends_with('\n') && result.ends_with('\n') {
        result.pop();
    }

    (result, removals)
}

fn leading_line_terminator_len(source: &str) -> usize {
    if source.starts_with("\r\n") {
        2
    } else if source.starts_with('\r') || source.starts_with('\n') {
        1
    } else if source.starts_with('\u{2028}') || source.starts_with('\u{2029}') {
        3
    } else {
        0
    }
}

/// v1 apply_replacements directive tail (transform_emitter 471-490),
/// operating on the POST-STRIP string (inc-07 review F6), with the
/// offset-0 quirk shed (inc 03): OXC's parsed directive list supplies the
/// authoritative prologue boundary (including ECMAScript trivia + ASI),
/// and the whole prologue stays ABOVE the injected imports.
/// v1's single-blank-line strip after the prologue is retained.
pub fn directive_prefix_and_body(
    result: String,
    needs_use_client: bool,
    prologue: Option<&DirectivePrologueFact>,
) -> (String, String) {
    match prologue {
        Some(prologue) => {
            let end = prologue.end as usize;
            let mut rest_start = end;
            // Consume the line terminator ending the directive line.
            rest_start += leading_line_terminator_len(&result[rest_start..]);
            // v1 quirk parity: strip ONE blank line following the directive.
            if result[rest_start..].starts_with('\n') {
                rest_start += 1;
            }
            let mut prefix = result[..end].to_string();
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
        .map(|s| s.split_whitespace().next().unwrap_or("").to_string())
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
    prologue: Option<&DirectivePrologueFact>,
) -> (String, Vec<(u32, u32)>) {
    match prologue {
        Some(prologue) => {
            let end = prologue.end as usize;
            let mut consumed_end = end;
            // Consume the line terminator ending the directive line.
            consumed_end += leading_line_terminator_len(&source[consumed_end..]);
            // v1 quirk parity: strip ONE blank line following the directive
            // (transform_emitter: `if result.starts_with('\n')` after removal).
            if source[consumed_end..].starts_with('\n') {
                consumed_end += 1;
            }
            let mut prefix = source[..end].to_string();
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
    use crate::assemble::test_support::facts_for;

    fn directive_and_imports_for(
        source: &str,
        import_lines: &str,
        needs_use_client: bool,
    ) -> (String, Vec<(u32, u32)>) {
        let facts = facts_for("directive.tsx", source);
        directive_and_imports(
            source,
            import_lines,
            needs_use_client,
            facts.directive_prologue.as_ref(),
        )
    }

    fn directive_prefix_and_body_for(
        source: String,
        needs_use_client: bool,
    ) -> (String, String) {
        let facts = facts_for("directive.tsx", &source);
        directive_prefix_and_body(
            source,
            needs_use_client,
            facts.directive_prologue.as_ref(),
        )
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
        let (prepend, removals) =
            directive_and_imports_for(src, "import Z from 'z';\n", false);
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
        let (prepend, removals) =
            directive_and_imports_for(src, "import Z from 'z';\n", false);
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
        let (prefix, rest) = directive_prefix_and_body_for(
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
        let (prefix, rest) = directive_prefix_and_body_for(
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
        let (prefix, rest) = directive_prefix_and_body_for(
            "'use client';\n\nimport { ds } from './x';\n".to_string(),
            false,
        );
        assert_eq!(prefix, "'use client';\n");
        assert_eq!(rest, "import { ds } from './x';\n");
    }

    #[test]
    fn prologue_recognizes_multiple_directives_and_block_comments() {
        let (prefix, rest) = directive_prefix_and_body_for(
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
            directive_prefix_and_body_for("const s = 'use client';\n".to_string(), false);
        assert_eq!(prefix, "");
        assert_eq!(rest, "const s = 'use client';\n");
        let (prefix, _) =
            directive_prefix_and_body_for(
                "'use client'.length;\nconst x = 1;\n".to_string(),
                false,
            );
        assert_eq!(prefix, "");
    }

    #[test]
    fn needs_use_client_appends_below_existing_prologue() {
        let (prefix, rest) = directive_prefix_and_body_for(
            "'use strict';\nconst x = 1;\n".to_string(),
            true,
        );
        assert_eq!(prefix, "'use strict';\n'use client';\n");
        assert_eq!(rest, "const x = 1;\n");
    }
}
