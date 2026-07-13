//! THE ownership module: self-referential bundling of an arena + source with
//! the `Program` that borrows from them, making a parsed file an ordinary
//! owned, movable value. This is the ONLY module allowed to contain
//! `self_cell!` (arch-extract-v2-spine §Construction and ownership
//! containment).
//!
//! Pattern provenance: rolldown `EcmaAst`/`ProgramCell`, oxc type checker
//! `SourceFile`, oxc linter `ModuleContent` (brainstorm citations).

use std::sync::atomic::{AtomicUsize, Ordering};

use oxc::allocator::Allocator;
use oxc::ast::ast::Program;
use oxc::parser::Parser;
use oxc::span::SourceType;
use self_cell::self_cell;

/// Per-BUILD parser-invocation counter (NS1 budget): passed into every
/// parse so concurrent NAPI calls cannot race each other's counts —
/// a process-global here was rejected at the inc-04 review (F3).
/// `Parser::new` containment (this module only) is the structural leg.
pub type ParseCounter = AtomicUsize;

/// Backing storage the AST borrows from: the arena and the owned source.
pub struct AstOwner {
    allocator: Allocator,
    source: String,
}

pub struct DependentProgram<'a> {
    pub program: Program<'a>,
}

self_cell!(
    struct AstCell {
        owner: AstOwner,
        #[covariant]
        dependent: DependentProgram,
    }
);

// SAFETY: the cell owns the arena and source together with the `Program`
// that borrows from them; no outside borrows exist. Moving the cell moves
// the arena with its dependents, so references stay valid across threads.
// The arena is only mutated during construction (single-threaded, inside
// `new`); afterwards access is read-only. Mirrors rolldown's
// `unsafe impl Send for EcmaAst` invariant.
unsafe impl Send for AstCell {}

/// A parsed source file as an owned value: parse ONCE at construction,
/// read the `Program` for the rest of the build.
pub struct OwnedAst {
    cell: AstCell,
    pub path: String,
    pub source_type: SourceType,
    /// Rendered parser diagnostics (owned; the arena-bound originals do not
    /// escape).
    pub diagnostics: Vec<String>,
    pub panicked: bool,
}

/// Source-type selection replicating v1 `chain_walker::walk_chains`
/// (bug-compatibility: `.mjs` fallback for unknown extensions).
pub fn source_type_for(path: &str) -> SourceType {
    if path.ends_with(".tsx") {
        SourceType::tsx()
    } else if path.ends_with(".ts") {
        SourceType::ts()
    } else if path.ends_with(".jsx") {
        SourceType::jsx()
    } else {
        SourceType::mjs()
    }
}

impl OwnedAst {
    pub fn parse(path: String, source: String, counter: &ParseCounter) -> Self {
        counter.fetch_add(1, Ordering::SeqCst);
        let source_type = source_type_for(&path);
        let mut diagnostics = Vec::new();
        let mut panicked = false;
        let cell = AstCell::new(
            AstOwner {
                allocator: Allocator::default(),
                source,
            },
            |owner| {
                let ret = Parser::new(&owner.allocator, &owner.source, source_type).parse();
                for d in &ret.diagnostics {
                    diagnostics.push(d.to_string());
                }
                panicked = ret.panicked;
                DependentProgram {
                    program: ret.program,
                }
            },
        );
        OwnedAst {
            cell,
            path,
            source_type,
            diagnostics,
            panicked,
        }
    }

    pub fn program(&self) -> &Program<'_> {
        &self.cell.borrow_dependent().program
    }

    pub fn source(&self) -> &str {
        &self.cell.borrow_owner().source
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_once_and_moves_across_threads() {
        let counter = ParseCounter::new(0);
        let ast = OwnedAst::parse("a.tsx".into(), "export const x = <div/>;".into(), &counter);
        assert_eq!(counter.load(Ordering::SeqCst), 1);
        assert!(ast.diagnostics.is_empty());
        let handle = std::thread::spawn(move || ast.program().body.len());
        assert_eq!(handle.join().unwrap(), 1);
    }
}
