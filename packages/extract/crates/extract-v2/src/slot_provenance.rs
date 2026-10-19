//! What keeps each system slot open: the record verbose output prints, and
//! what a narrower proof is measured against. The proof records each reason
//! where it decides it; this module only holds and locates them.

use std::collections::{BTreeMap, BTreeSet};

use rustc_hash::FxHashMap;

/// One thing that keeps system slots open: a rule of the proof, or the
/// site where it applies.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotOpening {
    pub rule: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// The byte offset in `file`, which the engine locates as `line`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub at: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl SlotOpening {
    pub(crate) fn rule(rule: &'static str) -> Self {
        Self { rule, file: None, at: None, line: None, detail: None }
    }

    pub(crate) fn in_file(self, file: &str) -> Self {
        Self { file: Some(file.to_string()), ..self }
    }

    pub(crate) fn detail(self, detail: impl Into<String>) -> Self {
        Self { detail: Some(detail.into()), ..self }
    }
}

/// An owner that keeps a prop's slot, and how.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotKeeper {
    pub owner: String,
    #[serde(flatten)]
    pub opening: SlotOpening,
}

/// Why each system slot the floor keeps stays.
#[derive(Debug, Default, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotProvenance {
    /// Why usage is not proven project-wide, where it is not: an owner is
    /// then proven only where its own module confines it.
    pub usage: Vec<SlotOpening>,
    /// Every reason each owner whose uses are unproven is.
    pub owners: BTreeMap<String, Vec<SlotOpening>>,
    /// Each kept system slot, by prop: every owner that keeps it.
    pub props: BTreeMap<String, Vec<SlotKeeper>>,
}

impl SlotProvenance {
    /// Reads each opening's line from its file's source.
    pub fn locate<'a>(&mut self, source: impl Fn(&str) -> Option<&'a str>) {
        let openings = self
            .usage
            .iter_mut()
            .chain(self.owners.values_mut().flatten())
            .chain(self.props.values_mut().flatten().map(|keeper| &mut keeper.opening));
        let mut lines: FxHashMap<String, Option<crate::facts::LineStarts>> = FxHashMap::default();
        for opening in openings {
            let (Some(file), Some(at)) = (&opening.file, opening.at) else { continue };
            let starts = lines.entry(file.clone()).or_insert_with(|| source(file).map(crate::facts::LineStarts::of));
            opening.line = starts.as_ref().map(|starts| starts.line(at as usize));
        }
    }
}

/// Adds `new` to the escaped components, recording in `reasons`, where
/// provenance asks for them, each distinct reason each escapes for.
pub(crate) fn escape(
    ids: &mut BTreeSet<String>,
    reasons: Option<&mut FxHashMap<String, Vec<SlotOpening>>>,
    new: impl IntoIterator<Item = String>,
    opening: impl Fn() -> SlotOpening,
) {
    match reasons {
        Some(reasons) => {
            for id in new {
                let opening = opening();
                let known = reasons.entry(id.clone()).or_default();
                if !known.contains(&opening) {
                    known.push(opening);
                }
                ids.insert(id);
            }
        }
        None => ids.extend(new),
    }
}
