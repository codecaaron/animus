//! Index-keyed owned-AST store: every source file parsed exactly once,
//! in parallel, then read for the rest of the build. Dropped by value after
//! the last reader (rolldown `IndexEcmaAst` pattern).

use rayon::prelude::*;

use crate::owned_ast::{OwnedAst, ParseCounter};

pub struct FileEntry {
    pub path: String,
    pub source: String,
}

pub struct AstStore {
    asts: Vec<OwnedAst>,
    /// Parses performed by THIS store build — counted by the parser
    /// invocations themselves (threaded counter), not derived from input
    /// length, so an accidental extra parse anywhere in the build closure
    /// is caught (inc-04 review F3).
    parse_count: usize,
}

impl AstStore {
    /// Parallel parse fan-out — one arena per task. DEF-4 resolved (inc 11):
    /// per-task `Allocator::default()` is adequate at measured scale;
    /// a pool is unjustified absent pressure.
    pub fn build(entries: Vec<FileEntry>) -> Self {
        let counter = ParseCounter::new(0);
        let asts: Vec<OwnedAst> = entries
            .into_par_iter()
            .map(|e| OwnedAst::parse(e.path, e.source, &counter))
            .collect();
        let parse_count = counter.into_inner();
        AstStore { asts, parse_count }
    }

    pub fn parse_count(&self) -> usize {
        self.parse_count
    }

    pub fn len(&self) -> usize {
        self.asts.len()
    }

    pub fn is_empty(&self) -> bool {
        self.asts.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = &OwnedAst> {
        self.asts.iter()
    }

    pub fn get(&self, idx: usize) -> Option<&OwnedAst> {
        self.asts.get(idx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn n_files_parse_exactly_n_times() {
        let entries: Vec<FileEntry> = (0..8)
            .map(|i| FileEntry {
                path: format!("f{i}.tsx"),
                source: format!("export const C{i} = <div/>;"),
            })
            .collect();
        let store = AstStore::build(entries);
        assert_eq!(store.len(), 8);
        assert_eq!(store.parse_count(), 8);
        // Reading every program re-parses nothing (count is fixed at build).
        let total: usize = store.iter().map(|a| a.program().body.len()).sum();
        assert_eq!(total, 8);
        assert_eq!(store.parse_count(), 8);
    }
}
