//! Owned-AST store: every source file is parsed exactly once, in parallel,
//! then read for the rest of the build.

use rayon::prelude::*;

use crate::owned_ast::{OwnedAst, ParseCounter};

pub struct FileEntry {
    pub path: String,
    pub source: String,
}

pub struct AstStore {
    asts: Vec<OwnedAst>,
    /// Parses performed by this build, counted at the parser rather than
    /// derived from input length, so an accidental extra parse shows up.
    parse_count: usize,
}

impl AstStore {
    /// Parallel parse fan-out: one arena per task.
    pub fn build(entries: Vec<FileEntry>) -> Self {
        Self::build_with(entries, |_| ()).0
    }

    /// `build`, with `step` run on each module in the task that parsed it,
    /// straight after its parse; its results come back in store order.
    pub(crate) fn build_with<R: Send>(
        entries: Vec<FileEntry>,
        step: impl Fn(&OwnedAst) -> R + Sync + Send,
    ) -> (Self, Vec<R>) {
        let counter = ParseCounter::new(0);
        let (asts, results): (Vec<OwnedAst>, Vec<R>) = entries
            .into_par_iter()
            .map(|e| {
                let ast = OwnedAst::parse(e.path, e.source, &counter);
                let result = step(&ast);
                (ast, result)
            })
            .unzip();
        let parse_count = counter.into_inner();
        (AstStore { asts, parse_count }, results)
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
        // Reading every program re-parses nothing.
        let total: usize = store.iter().map(|a| a.program().body.len()).sum();
        assert_eq!(total, 8);
        assert_eq!(store.parse_count(), 8);
    }
}
