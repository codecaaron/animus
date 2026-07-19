use rustc_hash::FxHashMap;

use oxc_ast::ast::{
    BindingPattern, Declaration, ExportDefaultDeclaration, ExportDefaultDeclarationKind,
    ExportNamedDeclaration, ImportDeclaration, ImportDeclarationSpecifier, ModuleExportName,
    Program, Statement,
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
                collect_imports(import_decl, &mut imports);
            }

            // ---------------------------------------------------------------
            // export { X } from '...'          (re-export with specifiers)
            // export { X as Y } from '...'     (renamed re-export)
            // export const X = ...             (local export via declaration)
            // export function foo() {}         (local export via declaration)
            // export class Foo {}              (local export via declaration)
            // ---------------------------------------------------------------
            Statement::ExportNamedDeclaration(export_decl) => {
                collect_named_exports(export_decl, &mut exports);
            }

            // ---------------------------------------------------------------
            // export default <expr-or-decl>
            // ---------------------------------------------------------------
            Statement::ExportDefaultDeclaration(export_decl) => {
                collect_default_export(export_decl, &mut exports);
            }

            _ => {}
        }
    }

    FileModuleInfo { imports, exports }
}

fn collect_imports(import_decl: &ImportDeclaration<'_>, imports: &mut Vec<ImportInfo>) {
    let source = import_decl.source.value.to_string();

    let specifiers = match &import_decl.specifiers {
        Some(s) => s,
        None => return, // bare `import 'foo'`
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

fn collect_default_export(
    export_decl: &ExportDefaultDeclaration<'_>,
    exports: &mut Vec<ExportInfo>,
) {
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

fn collect_named_exports(export_decl: &ExportNamedDeclaration<'_>, exports: &mut Vec<ExportInfo>) {
    if export_decl.specifiers.is_empty() {
        if let Some(decl) = &export_decl.declaration {
            collect_declaration_exports(decl, exports);
        }
        return;
    }

    let source = export_decl
        .source
        .as_ref()
        .map(|value| value.value.to_string());
    for spec in &export_decl.specifiers {
        exports.push(ExportInfo {
            exported_name: module_export_name_str(&spec.exported),
            local_name: Some(module_export_name_str(&spec.local)),
            source: source.clone(),
            is_default: false,
        });
    }
}

fn local_export(name: String) -> ExportInfo {
    ExportInfo {
        exported_name: name.clone(),
        local_name: Some(name),
        source: None,
        is_default: false,
    }
}

/// Walk a `Declaration` and record one `ExportInfo` per binding it introduces.
fn collect_declaration_exports(decl: &Declaration<'_>, exports: &mut Vec<ExportInfo>) {
    match decl {
        Declaration::VariableDeclaration(var_decl) => exports.extend(
            var_decl
                .declarations
                .iter()
                .filter_map(|declarator| binding_pattern_name(&declarator.id))
                .map(local_export),
        ),
        Declaration::FunctionDeclaration(func) => {
            exports.extend(func.id.as_ref().map(|id| local_export(id.name.to_string())))
        }
        Declaration::ClassDeclaration(class) => exports.extend(
            class
                .id
                .as_ref()
                .map(|id| local_export(id.name.to_string())),
        ),
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
    fn imports_and_default_exports_preserve_existing_matrix() {
        let cases = vec![
            (
                "ordered mixed imports",
                "import Default, { First, Second as Alias } from './values';",
                vec![
                    ("Default", "default", "./values", true),
                    ("First", "First", "./values", false),
                    ("Alias", "Second", "./values", false),
                ],
                vec![],
            ),
            (
                "bare import is ignored",
                "import './side-effect';",
                vec![],
                vec![],
            ),
            (
                "namespace import is ignored",
                "import * as Values from './values';",
                vec![],
                vec![],
            ),
            (
                "named default function",
                "export default function greet() {}",
                vec![],
                vec![("default", Some("greet"), None, true)],
            ),
            (
                "anonymous default function",
                "export default function() {}",
                vec![],
                vec![("default", None, None, true)],
            ),
            (
                "named default class",
                "export default class Widget {}",
                vec![],
                vec![("default", Some("Widget"), None, true)],
            ),
            (
                "anonymous default class",
                "export default class {}",
                vec![],
                vec![("default", None, None, true)],
            ),
            (
                "default expression",
                "export default createThing();",
                vec![],
                vec![("default", None, None, true)],
            ),
        ];

        for (name, source, expected_imports, expected_exports) in cases {
            let info = parse_info(source);
            let actual_imports = info
                .imports
                .iter()
                .map(|import| {
                    (
                        import.local_name.as_str(),
                        import.imported_name.as_str(),
                        import.source.as_str(),
                        import.is_default,
                    )
                })
                .collect::<Vec<_>>();
            let actual_exports = info
                .exports
                .iter()
                .map(|export| {
                    (
                        export.exported_name.as_str(),
                        export.local_name.as_deref(),
                        export.source.as_deref(),
                        export.is_default,
                    )
                })
                .collect::<Vec<_>>();
            assert_eq!(actual_imports, expected_imports, "{name} imports");
            assert_eq!(actual_exports, expected_exports, "{name} exports");
        }
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
    fn named_exports_preserve_existing_matrix() {
        let cases = vec![
            (
                "local specifier",
                "const Box = 1; export { Box };",
                vec![("Box", Some("Box"), None, false)],
            ),
            (
                "renamed local specifier",
                "const Anchor = 1; export { Anchor as Link };",
                vec![("Link", Some("Anchor"), None, false)],
            ),
            (
                "direct re-export",
                "export { Box } from './Box';",
                vec![("Box", Some("Box"), Some("./Box"), false)],
            ),
            (
                "renamed re-export",
                "export { Anchor as Link } from './Anchor';",
                vec![("Link", Some("Anchor"), Some("./Anchor"), false)],
            ),
            (
                "ordered multiple re-export specifiers",
                "export { First, Second as Alias } from './values';",
                vec![
                    ("First", Some("First"), Some("./values"), false),
                    ("Alias", Some("Second"), Some("./values"), false),
                ],
            ),
            (
                "variable declaration",
                "export const First = 1, Second = 2;",
                vec![
                    ("First", Some("First"), None, false),
                    ("Second", Some("Second"), None, false),
                ],
            ),
            (
                "function declaration",
                "export function greet() {}",
                vec![("greet", Some("greet"), None, false)],
            ),
            (
                "class declaration",
                "export class Widget {}",
                vec![("Widget", Some("Widget"), None, false)],
            ),
        ];

        for (name, source, expected) in cases {
            let info = parse_info(source);
            let actual = info
                .exports
                .iter()
                .map(|export| {
                    (
                        export.exported_name.as_str(),
                        export.local_name.as_deref(),
                        export.source.as_deref(),
                        export.is_default,
                    )
                })
                .collect::<Vec<_>>();
            assert_eq!(actual, expected, "{name}");
        }
    }

    #[test]
    fn declaration_exports_preserve_supported_and_ignored_bindings() {
        let cases = vec![
            (
                "ordered variable declarations",
                "export const First = 1, Second = 2;",
                vec![
                    ("First", Some("First"), None, false),
                    ("Second", Some("Second"), None, false),
                ],
            ),
            (
                "named function declaration",
                "export function greet() {}",
                vec![("greet", Some("greet"), None, false)],
            ),
            (
                "named class declaration",
                "export class Widget {}",
                vec![("Widget", Some("Widget"), None, false)],
            ),
            (
                "destructured variable declaration is ignored",
                "export const { first, second } = source;",
                vec![],
            ),
            (
                "interface declaration is ignored",
                "export interface Props { value: string }",
                vec![],
            ),
            (
                "type declaration is ignored",
                "export type Alias = string;",
                vec![],
            ),
        ];

        for (name, source, expected) in cases {
            let info = parse_info(source);
            let actual = info
                .exports
                .iter()
                .map(|export| {
                    (
                        export.exported_name.as_str(),
                        export.local_name.as_deref(),
                        export.source.as_deref(),
                        export.is_default,
                    )
                })
                .collect::<Vec<_>>();
            assert_eq!(actual, expected, "{name}");
        }
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
