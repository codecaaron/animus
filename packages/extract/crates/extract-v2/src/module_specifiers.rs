//! The module specifiers a file needs at run time, for the kit publication
//! check: every import, re-export and literal `import()` (a string, or a
//! template with no expressions) that survives type stripping. A type-only
//! import or export, or one whose every named specifier is a type, is erased
//! before anything loads, so it needs nothing.

use oxc::ast::ast::Program;

use crate::loads::{LoadKind, Spelling};

/// The run-time specifiers of `program`, in source order, without repeats:
/// its declarations first, then its literal `import()`s.
pub fn runtime_specifiers(program: &Program<'_>) -> Vec<String> {
    let loads = crate::loads::collect(program);
    let declared = loads.iter().filter(|load| {
        matches!(load.kind, LoadKind::Import { runtime: true, .. } | LoadKind::Reexport { runtime: true })
    });
    let dynamic = loads
        .iter()
        .filter(|load| load.kind == LoadKind::DynamicImport && load.spelling != Spelling::Other);
    let mut seen = std::collections::BTreeSet::new();
    declared
        .chain(dynamic)
        .filter_map(|load| load.specifier())
        .filter(|specifier| seen.insert(specifier.to_string()))
        .map(str::to_string)
        .collect()
}
