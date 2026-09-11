//! createTransform() extraction: finds `createTransform('name', fn)`
//! declarations, validates self-containment, and strips TS annotations.

use rustc_hash::FxHashSet;
use std::path::Path;

use oxc::allocator::Allocator;
use oxc::ast::ast::{
    Argument, CallExpression, Declaration, Expression, Program, Statement, VariableDeclarator,
};
use oxc::codegen::Codegen;
use oxc::parser::{Parser, ParserReturn};
use oxc::semantic::{Scoping, SemanticBuilder};
use oxc::span::SourceType;
use oxc::transformer::{TransformOptions, Transformer};

mod self_contained;

use self_contained::validate_self_contained;

/// An extracted `createTransform('name', fn)` call.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedTransform {
    /// The transform name (first argument string literal).
    pub name: String,
    /// The callback source text; TypeScript-stripped unless validation failed.
    pub source: String,
    /// File path where the transform was found.
    pub file: String,
    pub diagnostics: Vec<String>,
    /// Whether the transform passed validation (no external refs).
    pub valid: bool,
}

/// Scan a parsed program for `createTransform('name', fn)` calls.
pub fn extract_transforms(
    program: &Program<'_>,
    source: &str,
    file_path: &str,
    known_create_transform_bindings: &FxHashSet<String>,
) -> Vec<ExtractedTransform> {
    let mut candidates = Vec::new();

    for stmt in &program.body {
        match stmt {
            Statement::VariableDeclaration(decl) => {
                for declarator in &decl.declarations {
                    if is_create_transform_declarator(declarator, known_create_transform_bindings) {
                        candidates.push(declarator);
                    }
                }
            }
            Statement::ExportNamedDeclaration(export) => {
                if let Some(Declaration::VariableDeclaration(decl)) = &export.declaration {
                    for declarator in &decl.declarations {
                        if is_create_transform_declarator(
                            declarator,
                            known_create_transform_bindings,
                        ) {
                            candidates.push(declarator);
                        }
                    }
                }
            }
            _ => {}
        }
    }

    if candidates.is_empty() {
        return Vec::new();
    }

    let scoping = SemanticBuilder::new()
        .build(program)
        .semantic
        .into_scoping();
    candidates
        .into_iter()
        .filter_map(|declarator| {
            try_extract_transform(
                declarator,
                source,
                file_path,
                known_create_transform_bindings,
                &scoping,
            )
        })
        .collect()
}

fn is_create_transform_declarator(
    declarator: &VariableDeclarator<'_>,
    known_bindings: &FxHashSet<String>,
) -> bool {
    let Some(Expression::CallExpression(call)) = declarator.init.as_ref() else {
        return false;
    };
    is_create_transform_call(call, known_bindings)
}

fn try_extract_transform(
    declarator: &VariableDeclarator<'_>,
    source: &str,
    file_path: &str,
    known_bindings: &FxHashSet<String>,
    scoping: &Scoping,
) -> Option<ExtractedTransform> {
    let init = declarator.init.as_ref()?;

    let call = match init {
        Expression::CallExpression(call) => call,
        _ => return None,
    };

    if !is_create_transform_call(call, known_bindings) {
        return None;
    }

    let name = match call.arguments.first() {
        Some(Argument::StringLiteral(lit)) => lit.value.to_string(),
        _ => {
            return Some(ExtractedTransform {
                name: String::new(),
                source: String::new(),
                file: file_path.to_string(),
                diagnostics: vec![
                    "[bail] createTransform requires a static string name as first argument"
                        .to_string(),
                ],
                valid: false,
            });
        }
    };

    let callback_arg = match call.arguments.get(1) {
        Some(arg) => arg,
        None => {
            return Some(ExtractedTransform {
                name: name.clone(),
                source: String::new(),
                file: file_path.to_string(),
                diagnostics: vec![
                    "[bail] createTransform requires a callback function as second argument"
                        .to_string(),
                ],
                valid: false,
            });
        }
    };

    let callback_span = match callback_arg {
        Argument::ArrowFunctionExpression(arrow) => arrow.span,
        Argument::FunctionExpression(func) => func.span,
        _ => {
            return Some(ExtractedTransform {
                name: name.clone(),
                source: String::new(),
                file: file_path.to_string(),
                diagnostics: vec![format!(
                    "[bail] Transform '{}': second argument must be a function expression",
                    name
                )],
                valid: false,
            });
        }
    };

    let callback_source = &source[callback_span.start as usize..callback_span.end as usize];

    let mut diagnostics = Vec::new();
    let valid = validate_self_contained(callback_arg, &name, &mut diagnostics, scoping);

    let js_source = if valid {
        match strip_typescript(callback_source) {
            Ok(js) => js,
            Err(err) => {
                diagnostics.push(format!(
                    "[warn] Transform '{}': TS stripping failed ({}), using raw source",
                    name, err
                ));
                callback_source.to_string()
            }
        }
    } else {
        callback_source.to_string()
    };

    Some(ExtractedTransform {
        name,
        source: js_source,
        file: file_path.to_string(),
        diagnostics,
        valid,
    })
}

fn is_create_transform_call(
    call: &CallExpression<'_>,
    known_bindings: &FxHashSet<String>,
) -> bool {
    match &call.callee {
        Expression::Identifier(ident) => {
            let name = ident.name.as_str();
            name == "createTransform" || known_bindings.contains(name)
        }
        _ => false,
    }
}

/// Strip TypeScript annotations from a callback source string.
fn strip_typescript(callback_source: &str) -> Result<String, String> {
    let wrapper = format!("const __x = {};", callback_source);
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(Path::new("callback.ts"))
        .unwrap_or_else(|_| SourceType::ts());

    let ParserReturn {
        mut program,
        diagnostics: parse_errors,
        ..
    } = Parser::new(&allocator, &wrapper, source_type).parse();

    if !parse_errors.is_empty() {
        return Err(format!("parse error: {}", parse_errors[0]));
    }

    let semantic_ret = SemanticBuilder::new().build(&program);
    let scoping = semantic_ret.semantic.into_scoping();

    let options = TransformOptions::default();
    let transformer = Transformer::new(&allocator, Path::new("callback.ts"), &options);
    let _transform_ret = transformer.build_with_scoping(scoping, &mut program);

    // Extract the init expression from `const __x = <expr>;`
    let expr = program
        .body
        .first()
        .and_then(|stmt| match stmt {
            Statement::VariableDeclaration(decl) => decl.declarations.first(),
            _ => None,
        })
        .and_then(|declarator| declarator.init.as_ref())
        .ok_or_else(|| "could not find expression after transform".to_string())?;

    let mut codegen = Codegen::new();
    codegen.print_expression(expr);
    Ok(codegen.into_source_text())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn extract_one(source: &str) -> ExtractedTransform {
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source, SourceType::tsx()).parse();
        assert!(
            parsed.diagnostics.is_empty(),
            "fixture must parse: {:?}",
            parsed.diagnostics
        );
        extract_transforms(&parsed.program, source, "inline.tsx", &FxHashSet::default())
            .into_iter()
            .next()
            .expect("fixture must contain one transform")
    }

    #[test]
    fn standard_for_loop_block_locals_are_self_contained() {
        let transform = extract_one(
            r#"const gridItemRatio = createTransform('gridItemRatio', (value) => {
  const parts = String(value).split('/');
  let result = '';
  for (let i = 0; i < parts.length; i++) {
    const delimiter = i === 0 ? '' : ' / ';
    const curr = parts[i];
    if (curr) {
      result = `${result}${delimiter}${curr}`;
    }
  }
  return result;
});"#,
        );

        assert!(transform.valid, "{:?}", transform.diagnostics);
        assert!(transform.diagnostics.is_empty());
    }

    #[test]
    fn standard_for_loop_still_rejects_real_external_symbol() {
        let transform = extract_one(
            r#"const externalPrefix = 'item:';
const transform = createTransform('external', (values) => {
  for (let i = 0; i < values.length; i++) {
    const curr = values[i];
    if (curr) return externalPrefix + curr;
  }
  return '';
});"#,
        );

        assert!(!transform.valid);
        assert!(
            transform
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.contains("external symbol 'externalPrefix'")),
            "{:?}",
            transform.diagnostics
        );
    }

    #[test]
    fn block_local_reference_after_block_is_rejected() {
        let transform = extract_one(
            r#"const transform = createTransform('blockScope', (value) => {
  {
    const curr = String(value);
    if (curr) return curr;
  }
  return curr;
});"#,
        );

        assert!(!transform.valid);
        assert!(
            transform
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.contains("external symbol 'curr'")),
            "{:?}",
            transform.diagnostics
        );
    }

    #[test]
    fn strip_ts_simple_arrow() {
        let input = "(v: number) => `${v}px`";
        let result = strip_typescript(input).unwrap();
        assert_eq!(result, "(v) => `${v}px`");
    }

    #[test]
    fn strip_ts_as_cast() {
        let input = "(value) => { const s = value as string; return s; }";
        let result = strip_typescript(input).unwrap();
        assert!(
            !result.contains("as string"),
            "should not contain 'as string', got: {}",
            result
        );
    }

    #[test]
    fn strip_ts_size_transform() {
        let input = r#"(value) => {
  const toSize = (n: number) => {
    if (n === 0) return n;
    if (n <= 1 && n >= -1) return `${n * 100}%`;
    return `${n}px`;
  };
  if (typeof value === 'number') { return toSize(value); }
  const strValue = value as string;
  if (strValue.includes('calc')) { return strValue; }
  const [match, number, unit] = /(-?\d*\.?\d+)(%|\w*)/.exec(strValue) || [];
  if (match === undefined) { return strValue; }
  const numericValue = parseFloat(number);
  return !unit ? toSize(numericValue) : `${numericValue}${unit}`;
}"#;
        let result = strip_typescript(input);
        match &result {
            Ok(js) => {
                assert!(!js.contains(": number"), "should not contain type annotations: {}", js);
                assert!(!js.contains("as string"), "should not contain 'as string': {}", js);
                let eval = crate::evaluator::TransformEvaluator::new();
                eval.register("size", js).unwrap();
                assert_eq!(eval.evaluate("size", &serde_json::Value::Number(28.into())).unwrap(), "28px");
            }
            Err(e) => panic!("strip_typescript failed: {}", e),
        }
    }
}
