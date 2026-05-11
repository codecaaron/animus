use rustc_hash::FxHashMap;

use oxc_ast::ast::{
    BindingPattern, Declaration, ExportDefaultDeclarationKind, ImportDeclarationSpecifier,
    ModuleExportName, Program, Statement,
};

/// Where a binding was originally defined.
#[derive(Debug, Clone)]
pub struct ResolvedBinding {
    pub file: String,
    pub export_name: String,
}

/// An import found in a file.
#[derive(Debug, Clone)]
pub struct ImportInfo {
    /// Name used in this file (may be aliased).
    pub local_name: String,
    /// Name exported from the source module (original name).
    pub imported_name: String,
    /// Import source path (e.g., `"./Button"` or `"@animus-ui/components"`).
    pub source: String,
    /// `true` for default imports. Retained for future re-export analysis.
    #[allow(dead_code)]
    pub is_default: bool,
}

/// An export found in a file.
#[derive(Debug, Clone)]
pub struct ExportInfo {
    /// Name exported from this file.
    pub exported_name: String,
    /// Local binding name. `None` for pure re-exports that have no local binding.
    pub local_name: Option<String>,
    /// Re-export source path. `None` for locally-defined exports.
    pub source: Option<String>,
    /// `true` for `export default`. Retained for future re-export analysis.
    #[allow(dead_code)]
    pub is_default: bool,
}

/// A file's import and export information.
#[derive(Debug, Clone)]
pub struct FileModuleInfo {
    pub imports: Vec<ImportInfo>,
    pub exports: Vec<ExportInfo>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Extract the string name from any `ModuleExportName` variant.
fn module_export_name_str(name: &ModuleExportName<'_>) -> String {
    match name {
        ModuleExportName::IdentifierName(id) => id.name.to_string(),
        ModuleExportName::IdentifierReference(id) => id.name.to_string(),
        ModuleExportName::StringLiteral(lit) => lit.value.to_string(),
    }
}

// ---------------------------------------------------------------------------
// parse_module_info
// ---------------------------------------------------------------------------

/// Parse a single file's import and export statements from an OXC AST `Program`.
pub fn parse_module_info(program: &Program<'_>) -> FileModuleInfo {
    let mut imports: Vec<ImportInfo> = Vec::new();
    let mut exports: Vec<ExportInfo> = Vec::new();

    for stmt in &program.body {
        match stmt {
            // ---------------------------------------------------------------
            // import { X } from '...'
            // import X from '...'
            // import * as X from '...'  (skipped)
            // ---------------------------------------------------------------
            Statement::ImportDeclaration(import_decl) => {
                let source = import_decl.source.value.to_string();

                let specifiers = match &import_decl.specifiers {
                    Some(s) => s,
                    None => continue, // bare `import 'foo'`
                };

                for spec in specifiers {
                    match spec {
                        ImportDeclarationSpecifier::ImportSpecifier(s) => {
                            imports.push(ImportInfo {
                                local_name: s.local.name.to_string(),
                                imported_name: module_export_name_str(&s.imported),
                                source: source.clone(),
                                is_default: false,
                            });
                        }
                        ImportDeclarationSpecifier::ImportDefaultSpecifier(s) => {
                            imports.push(ImportInfo {
                                local_name: s.local.name.to_string(),
                                imported_name: "default".to_string(),
                                source: source.clone(),
                                is_default: true,
                            });
                        }
                        // Namespace imports (import * as X) — skip
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(_) => {}
                    }
                }
            }

            // ---------------------------------------------------------------
            // export { X } from '...'          (re-export with specifiers)
            // export { X as Y } from '...'     (renamed re-export)
            // export const X = ...             (local export via declaration)
            // export function foo() {}         (local export via declaration)
            // export class Foo {}              (local export via declaration)
            // ---------------------------------------------------------------
            Statement::ExportNamedDeclaration(export_decl) => {
                let source_opt = export_decl.source.as_ref().map(|s| s.value.to_string());

                if !export_decl.specifiers.is_empty() {
                    // Specifier-based: `export { X }` or `export { X } from '...'`
                    for spec in &export_decl.specifiers {
                        let local_str = module_export_name_str(&spec.local);
                        let exported_str = module_export_name_str(&spec.exported);

                        exports.push(ExportInfo {
                            exported_name: exported_str,
                            local_name: Some(local_str),
                            source: source_opt.clone(),
                            is_default: false,
                        });
                    }
                } else if let Some(decl) = &export_decl.declaration {
                    // Declaration-based: `export const X = ...` etc.
                    collect_declaration_exports(decl, &mut exports);
                }
            }

            // ---------------------------------------------------------------
            // export default <expr-or-decl>
            // ---------------------------------------------------------------
            Statement::ExportDefaultDeclaration(export_decl) => {
                // Extract a hint at the local name when it's a named function/class.
                let local_hint = match &export_decl.declaration {
                    ExportDefaultDeclarationKind::FunctionDeclaration(f) => {
                        f.id.as_ref().map(|id| id.name.to_string())
                    }
                    ExportDefaultDeclarationKind::ClassDeclaration(c) => {
                        c.id.as_ref().map(|id| id.name.to_string())
                    }
                    _ => None,
                };

                exports.push(ExportInfo {
                    exported_name: "default".to_string(),
                    local_name: local_hint,
                    source: None,
                    is_default: true,
                });
            }

            _ => {}
        }
    }

    FileModuleInfo { imports, exports }
}

/// Walk a `Declaration` and record one `ExportInfo` per binding it introduces.
fn collect_declaration_exports(decl: &Declaration<'_>, exports: &mut Vec<ExportInfo>) {
    match decl {
        Declaration::VariableDeclaration(var_decl) => {
            for declarator in &var_decl.declarations {
                if let Some(name) = binding_pattern_name(&declarator.id) {
                    exports.push(ExportInfo {
                        exported_name: name.clone(),
                        local_name: Some(name),
                        source: None,
                        is_default: false,
                    });
                }
            }
        }
        Declaration::FunctionDeclaration(func) => {
            if let Some(id) = &func.id {
                let name = id.name.to_string();
                exports.push(ExportInfo {
                    exported_name: name.clone(),
                    local_name: Some(name),
                    source: None,
                    is_default: false,
                });
            }
        }
        Declaration::ClassDeclaration(class) => {
            if let Some(id) = &class.id {
                let name = id.name.to_string();
                exports.push(ExportInfo {
                    exported_name: name.clone(),
                    local_name: Some(name),
                    source: None,
                    is_default: false,
                });
            }
        }
        // TS type-only declarations don't produce runtime bindings we care about.
        _ => {}
    }
}

/// Return the simple identifier name from a `BindingPattern` if it is a plain identifier.
fn binding_pattern_name(pat: &BindingPattern<'_>) -> Option<String> {
    match pat {
        BindingPattern::BindingIdentifier(id) => Some(id.name.to_string()),
        // Destructuring patterns are not handled — they're not used for Animus components.
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// resolve_bindings
// ---------------------------------------------------------------------------

/// Build a global binding resolver from all files' module info.
///
/// `file_modules` maps `file_path → FileModuleInfo`.
/// `resolve_path(current_file, import_source)` resolves a (possibly relative or package)
/// import source to an absolute file path, or `None` if unresolvable (e.g. node_modules
/// that are not mapped).
///
/// Returns a map `(file_path, local_binding_name) → ResolvedBinding` where
/// `ResolvedBinding.file` is the file that *defines* the binding and
/// `ResolvedBinding.export_name` is its name there.
pub fn resolve_bindings(
    file_modules: &FxHashMap<String, FileModuleInfo>,
    resolve_path: &dyn Fn(&str, &str) -> Option<String>,
) -> FxHashMap<(String, String), ResolvedBinding> {
    let mut result: FxHashMap<(String, String), ResolvedBinding> = FxHashMap::default();

    for (file_path, module_info) in file_modules {
        for import in &module_info.imports {
            // Resolve the source path to an absolute file path.
            let resolved_source = match resolve_path(file_path, &import.source) {
                Some(p) => p,
                None => continue, // unresolvable (e.g. bare npm package)
            };

            // Follow the export chain transitively until we reach a local definition.
            if let Some(binding) = follow_export_chain(
                &resolved_source,
                &import.imported_name,
                file_modules,
                resolve_path,
                0,
            ) {
                result.insert((file_path.clone(), import.local_name.clone()), binding);
            }
        }
    }

    result
}

/// The maximum number of hops when following a re-export chain.
/// Prevents infinite loops from circular re-exports.
const MAX_CHAIN_DEPTH: usize = 32;

/// Recursively follow a re-export chain starting from `file` exporting `export_name`.
///
/// Returns `Some(ResolvedBinding)` when the chain terminates at a local definition,
/// or `None` if the definition cannot be found.
fn follow_export_chain(
    file: &str,
    export_name: &str,
    file_modules: &FxHashMap<String, FileModuleInfo>,
    resolve_path: &dyn Fn(&str, &str) -> Option<String>,
    depth: usize,
) -> Option<ResolvedBinding> {
    if depth > MAX_CHAIN_DEPTH {
        return None;
    }

    let module_info = file_modules.get(file)?;

    // Find the export entry for `export_name` in this file.
    let export_info = module_info
        .exports
        .iter()
        .find(|e| e.exported_name == export_name)?;

    match &export_info.source {
        None => {
            // This is a local export — the chain terminates here.
            Some(ResolvedBinding {
                file: file.to_string(),
                export_name: export_name.to_string(),
            })
        }
        Some(re_export_source) => {
            // This is a re-export: `export { X } from './X'`.
            // `export_info.local_name` holds the name as it appears in the source module.
            let next_export_name = export_info
                .local_name
                .as_deref()
                .unwrap_or(export_name);

            let next_file = resolve_path(file, re_export_source)?;
            follow_export_chain(
                &next_file,
                next_export_name,
                file_modules,
                resolve_path,
                depth + 1,
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    fn parse_info(source: &str) -> FileModuleInfo {
        let allocator = Allocator::default();
        let result = Parser::new(&allocator, source, SourceType::tsx()).parse();
        parse_module_info(&result.program)
    }

    // -----------------------------------------------------------------------
    // parse_module_info tests
    // -----------------------------------------------------------------------

    #[test]
    fn parses_named_import() {
        let info = parse_info("import { Box } from './Box';");
        assert_eq!(info.imports.len(), 1);
        let imp = &info.imports[0];
        assert_eq!(imp.local_name, "Box");
        assert_eq!(imp.imported_name, "Box");
        assert_eq!(imp.source, "./Box");
        assert!(!imp.is_default);
    }

    #[test]
    fn parses_renamed_import() {
        let info = parse_info("import { Anchor as Link } from './Anchor';");
        assert_eq!(info.imports.len(), 1);
        let imp = &info.imports[0];
        assert_eq!(imp.local_name, "Link");
        assert_eq!(imp.imported_name, "Anchor");
        assert_eq!(imp.source, "./Anchor");
        assert!(!imp.is_default);
    }

    #[test]
    fn parses_default_import() {
        let info = parse_info("import Button from './Button';");
        assert_eq!(info.imports.len(), 1);
        let imp = &info.imports[0];
        assert!(imp.is_default);
        assert_eq!(imp.local_name, "Button");
        assert_eq!(imp.imported_name, "default");
        assert_eq!(imp.source, "./Button");
    }

    #[test]
    fn parses_named_export() {
        let info = parse_info("export const Box = 1;");
        assert_eq!(info.exports.len(), 1);
        let exp = &info.exports[0];
        assert_eq!(exp.exported_name, "Box");
        assert_eq!(exp.local_name, Some("Box".to_string()));
        assert!(exp.source.is_none());
        assert!(!exp.is_default);
    }

    #[test]
    fn parses_reexport() {
        let info = parse_info("export { Box } from './Box';");
        assert_eq!(info.exports.len(), 1);
        let exp = &info.exports[0];
        assert_eq!(exp.exported_name, "Box");
        assert_eq!(exp.source, Some("./Box".to_string()));
    }

    #[test]
    fn parses_renamed_reexport() {
        let info = parse_info("export { Anchor as Link } from './Anchor';");
        assert_eq!(info.exports.len(), 1);
        let exp = &info.exports[0];
        assert_eq!(exp.exported_name, "Link");
        // local_name holds what name is used inside the source module (Anchor)
        assert_eq!(exp.local_name, Some("Anchor".to_string()));
        assert_eq!(exp.source, Some("./Anchor".to_string()));
    }

    #[test]
    fn parses_multiple_imports() {
        let info = parse_info(
            r#"
            import { Box } from './Box';
            import { Stack } from './Stack';
            import Button from './Button';
            "#,
        );
        assert_eq!(info.imports.len(), 3);
        assert_eq!(info.imports[0].local_name, "Box");
        assert_eq!(info.imports[1].local_name, "Stack");
        assert_eq!(info.imports[2].local_name, "Button");
        assert!(info.imports[2].is_default);
    }

    #[test]
    fn skips_namespace_imports() {
        let info = parse_info("import * as UI from './ui';");
        assert_eq!(info.imports.len(), 0);
    }

    #[test]
    fn parses_export_function() {
        let info = parse_info("export function greet() {}");
        assert_eq!(info.exports.len(), 1);
        assert_eq!(info.exports[0].exported_name, "greet");
        assert!(info.exports[0].source.is_none());
    }

    #[test]
    fn parses_export_class() {
        let info = parse_info("export class MyComponent {}");
        assert_eq!(info.exports.len(), 1);
        assert_eq!(info.exports[0].exported_name, "MyComponent");
        assert!(info.exports[0].source.is_none());
    }

    #[test]
    fn parses_export_default() {
        let info = parse_info("export default function Foo() {}");
        let default_exports: Vec<_> = info.exports.iter().filter(|e| e.is_default).collect();
        assert_eq!(default_exports.len(), 1);
        assert_eq!(default_exports[0].exported_name, "default");
    }

    // -----------------------------------------------------------------------
    // resolve_bindings tests
    // -----------------------------------------------------------------------

    /// Build a simple `resolve_path` closure that maps `(current, source)` → absolute path.
    /// `mappings` is a list of `(from_file, import_source) → resolved_path`.
    fn make_resolver(
        mappings: Vec<(&'static str, &'static str, &'static str)>,
    ) -> impl Fn(&str, &str) -> Option<String> {
        move |current: &str, source: &str| {
            for (from, src, to) in &mappings {
                if *from == current && *src == source {
                    return Some(to.to_string());
                }
            }
            None
        }
    }

    #[test]
    fn resolves_direct_import() {
        // File A imports Box from file B; file B exports Box locally.
        let mut file_modules: FxHashMap<String, FileModuleInfo> = FxHashMap::default();

        // file_b.tsx: export const Box = 1;
        file_modules.insert(
            "file_b.tsx".to_string(),
            FileModuleInfo {
                imports: vec![],
                exports: vec![ExportInfo {
                    exported_name: "Box".to_string(),
                    local_name: Some("Box".to_string()),
                    source: None,
                    is_default: false,
                }],
            },
        );

        // file_a.tsx: import { Box } from './file_b';
        file_modules.insert(
            "file_a.tsx".to_string(),
            FileModuleInfo {
                imports: vec![ImportInfo {
                    local_name: "Box".to_string(),
                    imported_name: "Box".to_string(),
                    source: "./file_b".to_string(),
                    is_default: false,
                }],
                exports: vec![],
            },
        );

        let resolver = make_resolver(vec![("file_a.tsx", "./file_b", "file_b.tsx")]);
        let bindings = resolve_bindings(&file_modules, &resolver);

        let key = ("file_a.tsx".to_string(), "Box".to_string());
        assert!(bindings.contains_key(&key));
        let resolved = &bindings[&key];
        assert_eq!(resolved.file, "file_b.tsx");
        assert_eq!(resolved.export_name, "Box");
    }

    #[test]
    fn resolves_through_barrel() {
        // file_a.tsx imports Box from index.ts
        // index.ts re-exports Box from ./Box.tsx
        // Box.tsx exports Box locally
        let mut file_modules: FxHashMap<String, FileModuleInfo> = FxHashMap::default();

        file_modules.insert(
            "Box.tsx".to_string(),
            FileModuleInfo {
                imports: vec![],
                exports: vec![ExportInfo {
                    exported_name: "Box".to_string(),
                    local_name: Some("Box".to_string()),
                    source: None,
                    is_default: false,
                }],
            },
        );

        file_modules.insert(
            "index.ts".to_string(),
            FileModuleInfo {
                imports: vec![],
                exports: vec![ExportInfo {
                    exported_name: "Box".to_string(),
                    local_name: Some("Box".to_string()),
                    source: Some("./Box".to_string()),
                    is_default: false,
                }],
            },
        );

        file_modules.insert(
            "file_a.tsx".to_string(),
            FileModuleInfo {
                imports: vec![ImportInfo {
                    local_name: "Box".to_string(),
                    imported_name: "Box".to_string(),
                    source: "./index".to_string(),
                    is_default: false,
                }],
                exports: vec![],
            },
        );

        let resolver = make_resolver(vec![
            ("file_a.tsx", "./index", "index.ts"),
            ("index.ts", "./Box", "Box.tsx"),
        ]);
        let bindings = resolve_bindings(&file_modules, &resolver);

        let key = ("file_a.tsx".to_string(), "Box".to_string());
        assert!(bindings.contains_key(&key));
        let resolved = &bindings[&key];
        assert_eq!(resolved.file, "Box.tsx");
        assert_eq!(resolved.export_name, "Box");
    }

    #[test]
    fn resolves_renamed_binding() {
        // Anchor.tsx exports Anchor locally.
        // file_a.tsx: import { Anchor as Link } from './Anchor';
        // → Link resolves to (Anchor.tsx, "Anchor")
        let mut file_modules: FxHashMap<String, FileModuleInfo> = FxHashMap::default();

        file_modules.insert(
            "Anchor.tsx".to_string(),
            FileModuleInfo {
                imports: vec![],
                exports: vec![ExportInfo {
                    exported_name: "Anchor".to_string(),
                    local_name: Some("Anchor".to_string()),
                    source: None,
                    is_default: false,
                }],
            },
        );

        file_modules.insert(
            "file_a.tsx".to_string(),
            FileModuleInfo {
                imports: vec![ImportInfo {
                    local_name: "Link".to_string(),
                    imported_name: "Anchor".to_string(),
                    source: "./Anchor".to_string(),
                    is_default: false,
                }],
                exports: vec![],
            },
        );

        let resolver = make_resolver(vec![("file_a.tsx", "./Anchor", "Anchor.tsx")]);
        let bindings = resolve_bindings(&file_modules, &resolver);

        let key = ("file_a.tsx".to_string(), "Link".to_string());
        assert!(bindings.contains_key(&key));
        let resolved = &bindings[&key];
        assert_eq!(resolved.file, "Anchor.tsx");
        assert_eq!(resolved.export_name, "Anchor");
    }

    #[test]
    fn unresolvable_source_is_skipped() {
        // If resolve_path returns None (e.g. node_modules), the entry should not appear.
        let mut file_modules: FxHashMap<String, FileModuleInfo> = FxHashMap::default();

        file_modules.insert(
            "app.tsx".to_string(),
            FileModuleInfo {
                imports: vec![ImportInfo {
                    local_name: "Button".to_string(),
                    imported_name: "Button".to_string(),
                    source: "@external/ui".to_string(),
                    is_default: false,
                }],
                exports: vec![],
            },
        );

        let resolver = make_resolver(vec![]); // no mappings → always None
        let bindings = resolve_bindings(&file_modules, &resolver);
        assert!(!bindings.contains_key(&("app.tsx".to_string(), "Button".to_string())));
    }
}
