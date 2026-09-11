//! Bundles the arena and source with the `Program` that borrows from them.
//! The only module that may use `self_cell!` or call `Parser::new`.

use std::sync::atomic::{AtomicUsize, Ordering};

use oxc::allocator::Allocator;
use oxc::ast::ast::Program;
use oxc::parser::Parser;
use oxc::span::SourceType;
use self_cell::self_cell;

/// Per-build parser-invocation counter: passed into every parse so
/// concurrent NAPI calls cannot race each other's counts.
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
// borrowing from them; the arena is mutated only during construction.
unsafe impl Send for AstCell {}

/// A parsed source file as an owned value: parsed once at construction.
pub struct OwnedAst {
    cell: AstCell,
    pub path: String,
    pub source_type: SourceType,
    /// Rendered parser diagnostics; the arena-bound originals never escape.
    pub diagnostics: Vec<String>,
    pub panicked: bool,
}

/// `.js` parses JSX-enabled: the ecosystem treats JSX in `.js` as ordinary
/// source, and plain-module parsing yields recovered diagnostics.
pub fn source_type_for(path: &str) -> SourceType {
    if path.ends_with(".tsx") {
        SourceType::tsx()
    } else if path.ends_with(".ts") {
        SourceType::ts()
    } else if path.ends_with(".jsx") || path.ends_with(".js") {
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

    #[test]
    fn js_parses_jsx_enabled_without_diagnostics() {
        let counter = ParseCounter::new(0);
        let ast = OwnedAst::parse(
            "app.js".into(),
            "export const App = () => <div className='x' />;".into(),
            &counter,
        );
        assert!(ast.diagnostics.is_empty(), "{:?}", ast.diagnostics);
        assert!(!ast.panicked);

        // JSX grammar activates only at expression start, so plain-JS
        // comparison chains still parse.
        let plain = OwnedAst::parse(
            "math.js".into(),
            "export const cmp = (a, b, c) => a < b > c;".into(),
            &counter,
        );
        assert!(plain.diagnostics.is_empty(), "{:?}", plain.diagnostics);
    }
}
