//! The module specifiers a file needs at run time, for the kit publication
//! check: every import, re-export and literal `import()` (a string, or a
//! template with no expressions) that survives type stripping. A type-only
//! import or export, or one whose every named specifier is a type, is erased
//! before anything loads, so it needs nothing.

use oxc::ast::ast::{
    ExportNamedDeclaration, Expression, ImportDeclarationSpecifier, ImportExpression,
    ImportOrExportKind, Program, Statement,
};
use oxc::ast_visit::Visit;

struct DynamicImports(Vec<String>);

impl<'a> Visit<'a> for DynamicImports {
    fn visit_import_expression(&mut self, import: &ImportExpression<'a>) {
        match &import.source {
            Expression::StringLiteral(literal) => self.0.push(literal.value.to_string()),
            // A template with no expressions names one module, as a string does.
            Expression::TemplateLiteral(template) if template.expressions.is_empty() => {
                if let Some(cooked) = template.quasis.first().and_then(|quasi| quasi.value.cooked) {
                    self.0.push(cooked.to_string());
                }
            }
            _ => {}
        }
        oxc::ast_visit::walk::walk_import_expression(self, import);
    }
}

fn reexport_needs_runtime(export: &ExportNamedDeclaration<'_>) -> bool {
    export.export_kind != ImportOrExportKind::Type
        && (export.specifiers.is_empty()
            || export.specifiers.iter().any(|spec| spec.export_kind != ImportOrExportKind::Type))
}

/// The run-time specifiers of `program`, in source order, without repeats.
pub fn runtime_specifiers(program: &Program<'_>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for stmt in &program.body {
        match stmt {
            Statement::ImportDeclaration(import) => {
                if import.import_kind == ImportOrExportKind::Type {
                    continue;
                }
                let runtime = match &import.specifiers {
                    // A side-effect import, or `import {} from`, still loads.
                    None => true,
                    Some(specifiers) if specifiers.is_empty() => true,
                    Some(specifiers) => specifiers.iter().any(|spec| match spec {
                        ImportDeclarationSpecifier::ImportSpecifier(named) => {
                            named.import_kind != ImportOrExportKind::Type
                        }
                        _ => true,
                    }),
                };
                if runtime {
                    out.push(import.source.value.to_string());
                }
            }
            Statement::ExportNamedDeclaration(export) if reexport_needs_runtime(export) => {
                if let Some(source) = &export.source {
                    out.push(source.value.to_string());
                }
            }
            Statement::ExportAllDeclaration(export) if export.export_kind != ImportOrExportKind::Type => {
                out.push(export.source.value.to_string());
            }
            _ => {}
        }
    }
    let mut dynamic = DynamicImports(Vec::new());
    dynamic.visit_program(program);
    out.extend(dynamic.0);
    let mut seen = std::collections::BTreeSet::new();
    out.retain(|specifier| seen.insert(specifier.clone()));
    out
}
