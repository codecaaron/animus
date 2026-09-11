//! Span-preserving edits over the original source: replace chain spans,
//! prepend import lines, remove consumed-import spans. No AST, no re-parse.

use string_wizard::{MagicString, UpdateOptions};

/// One file's emission plan.
#[derive(Debug, Default)]
pub struct EmissionPlan {
    /// (start, end, replacement) — chain spans to generated calls.
    pub replacements: Vec<(u32, u32, String)>,
    /// Import lines and directives prepended verbatim.
    pub prepend: String,
    /// (start, end) spans to delete (consumed imports).
    pub removals: Vec<(u32, u32)>,
}

#[derive(Debug)]
pub struct EmissionOutput {
    pub code: String,
    pub map_json: String,
}

/// Spans are byte offsets into `source` on char boundaries; replacements
/// must not overlap each other or removals. Violations error, never drop.
pub fn apply_plan(source: &str, plan: &EmissionPlan) -> Result<EmissionOutput, String> {
    let mut ms = MagicString::new(source);
    for (start, end, replacement) in &plan.replacements {
        ms.update_with(
            *start,
            *end,
            replacement.clone(),
            UpdateOptions {
                keep_original: false,
                overwrite: true,
            },
        )
        .map_err(|e| format!("emission replacement [{start},{end}) failed: {e:?}"))?;
    }
    for (start, end) in &plan.removals {
        ms.remove(*start, *end)
            .map_err(|e| format!("emission removal [{start},{end}) failed: {e:?}"))?;
    }
    if !plan.prepend.is_empty() {
        ms.prepend(plan.prepend.clone());
    }
    let map = ms.source_map(string_wizard::SourceMapOptions {
        include_content: false,
        ..Default::default()
    });
    Ok(EmissionOutput {
        code: ms.to_string(),
        map_json: map.to_json_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn try_apply(source: &str, plan: &EmissionPlan) -> EmissionOutput {
        apply_plan(source, plan).expect("plan should apply")
    }

    const SRC: &str = "import { ds } from './sys';\nexport const Box = ds.styles({ p: 4 }).asElement('div');\nexport const App = () => <Box />;\n";

    #[test]
    fn replaces_chain_span() {
        let start = SRC.find("ds.styles").unwrap() as u32;
        let end = (SRC.find(".asElement('div')").unwrap() + ".asElement('div')".len()) as u32;
        let out = try_apply(
            SRC,
            &EmissionPlan {
                replacements: vec![(start, end, "createComponent('div', 'animus-Box-1234')".into())],
                ..Default::default()
            },
        );
        assert!(out.code.contains("export const Box = createComponent('div', 'animus-Box-1234');"));
        assert!(out.code.contains("export const App = () => <Box />;"));
    }

    #[test]
    fn prepends_imports_and_removes_consumed_ones() {
        let import_span = (0u32, "import { ds } from './sys';\n".len() as u32);
        let out = try_apply(
            SRC,
            &EmissionPlan {
                prepend: "import { createComponent } from '@animus-ui/system';\nimport 'virtual:animus/styles.css';\n".into(),
                removals: vec![import_span],
                ..Default::default()
            },
        );
        assert!(out.code.starts_with("import { createComponent } from '@animus-ui/system';\n"));
        assert!(!out.code.contains("from './sys'"));
        assert!(out.code.contains("export const Box = ds.styles"));
    }

    #[test]
    fn edits_compose_and_map_is_produced() {
        let start = SRC.find("ds.styles").unwrap() as u32;
        let end = (SRC.find(".asElement('div')").unwrap() + ".asElement('div')".len()) as u32;
        let out = try_apply(
            SRC,
            &EmissionPlan {
                replacements: vec![(start, end, "X()".into())],
                prepend: "'use client';\n".into(),
                removals: vec![(0, "import { ds } from './sys';\n".len() as u32)],
            },
        );
        assert!(out.code.starts_with("'use client';\n"));
        assert!(out.code.contains("export const Box = X();"));
        assert!(out.map_json.contains("\"mappings\""));
        assert!(!out.map_json.contains("\"mappings\":\"\""));
    }

    #[test]
    fn overlapping_edits_error_loudly() {
        let start = SRC.find("ds.styles").unwrap() as u32;
        let end = (SRC.find(".asElement('div')").unwrap() + ".asElement('div')".len()) as u32;
        let result = apply_plan(
            SRC,
            &EmissionPlan {
                replacements: vec![(start, end, "X()".into())],
                removals: vec![(start + 2, end + 2)],
                ..Default::default()
            },
        );
        assert!(result.is_err(), "overlap must error, got: {result:?}");
    }

    #[test]
    fn multibyte_source_before_edit_span() {
        // oxc spans are UTF-8 byte offsets; string_wizard indexes bytes too.
        let src = "const label = '日本語ラベル';
const x = old();
";
        let start = src.find("old()").unwrap() as u32;
        let out = try_apply(
            src,
            &EmissionPlan {
                replacements: vec![(start, start + "old()".len() as u32, "new_()".into())],
                ..Default::default()
            },
        );
        assert!(out.code.contains("const x = new_();"));
        assert!(out.code.contains("日本語ラベル"));
    }

    #[test]
    fn untouched_bytes_are_preserved_exactly() {
        let out = try_apply(
            SRC,
            &EmissionPlan {
                removals: vec![(0, 5)],
                ..Default::default()
            },
        );
        assert_eq!(out.code, &SRC[5..]);
    }
}
