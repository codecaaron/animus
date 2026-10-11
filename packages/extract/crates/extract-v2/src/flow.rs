//! What the analysis knows of a value, and the certificate that a subject
//! lies outside everything it cannot see.
//!
//! A value is `Exact`, one of a finite set, or `Uncertain` with the reasons
//! and the region they may reach; no in-band sentinel stands in for either.
//! A `FlowBuilder` only grows: it records each change the analysis sees,
//! each opening it cannot close, and the names modules export objects
//! under. `close()` turns it into `ValueEffects`, whose `covers()` answers
//! whether a subject is provably untouched.

use std::collections::{BTreeMap, BTreeSet};

/// The most atoms a region holds before it widens to `Top`.
pub const REGION_ATOMS: usize = 64;

/// A module-scope binding's object, by its module and binding.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ObjectId {
    pub module: String,
    pub binding: String,
}

impl ObjectId {
    pub fn new(module: &str, binding: &str) -> Self {
        Self { module: module.to_string(), binding: binding.to_string() }
    }
}

/// Why an answer is uncertain. The list is closed: adding a reason is a
/// change to the analysis contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum ReasonId {
    /// A source the analysis skipped or could not read.
    SkippedSource,
    /// A specifier that resolved to nothing.
    UnresolvedSpecifier,
    /// A runtime load whose modules the host did not expand.
    UnexpandedHostLoad,
    /// An `export *` of a module the analysis cannot open.
    OpaqueStar,
    /// A link bound the analysis reached.
    LinkBound,
    /// A direct `eval`.
    DirectEval,
    /// Code run from a string: indirect `eval`, `Function`, string timers.
    DynamicCode,
    /// An operation the analysis does not model.
    OpaqueEffect,
    /// A call of a function with no summary.
    UnsummarizedCallee,
    /// A summary whose precondition the call does not meet.
    PreconditionUnmet,
    /// A call the language makes implicitly.
    ImplicitInvocation,
    /// A bound of the analysis itself, such as the region size.
    FlowBound,
    /// A function the analysis does not admit.
    UnadmittedFunction,
}

/// One part of what an opening may reach.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum RegionAtom {
    /// One object.
    Object(ObjectId),
    /// One object at and below a member path.
    Path(ObjectId, Vec<String>),
    /// Every binding of one module's top-level scope.
    ScopeRegion(String),
    /// Every object one module exports.
    ExportsOf(String),
    /// Every object any module exports under one name.
    ExportedAs(String),
    /// Every object any module exports.
    AllExports,
}

/// What an opening may reach: a non-empty set of at most `REGION_ATOMS`
/// atoms, or everything. Only the constructors make one, so neither an
/// empty set nor an over-bound one exists.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Region(Option<BTreeSet<RegionAtom>>);

impl Region {
    pub fn of(atom: RegionAtom) -> Self {
        Region(Some(BTreeSet::from([atom])))
    }

    /// The region of `atoms`, or everything past `REGION_ATOMS` of them;
    /// `None` when there is none.
    pub fn atoms(atoms: impl IntoIterator<Item = RegionAtom>) -> Option<Self> {
        let atoms: BTreeSet<RegionAtom> = atoms.into_iter().collect();
        match atoms.len() {
            0 => None,
            len if len > REGION_ATOMS => Some(Region(None)),
            _ => Some(Region(Some(atoms))),
        }
    }

    /// Everything: the region a bound of the analysis widens to.
    pub fn top() -> Self {
        Region(None)
    }

    pub fn is_top(&self) -> bool {
        self.0.is_none()
    }

    /// The atoms, or `None` for everything.
    pub fn as_atoms(&self) -> Option<&BTreeSet<RegionAtom>> {
        self.0.as_ref()
    }

    fn union(self, other: Region) -> Region {
        match (self.0, other.0) {
            (Some(mut atoms), Some(more)) => {
                atoms.extend(more);
                Region::atoms(atoms).expect("a union of non-empty regions is non-empty")
            }
            _ => Region::top(),
        }
    }
}

/// The reasons an answer is uncertain and the region they may reach. A
/// reason always travels with its region, and a region that is everything
/// always carries `FlowBound`, however it came to be everything.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Uncertainty {
    reasons: BTreeSet<ReasonId>,
    region: Region,
}

impl Uncertainty {
    pub fn new(reason: ReasonId, region: Region) -> Self {
        Self::canonical(BTreeSet::from([reason]), region)
    }

    fn canonical(mut reasons: BTreeSet<ReasonId>, region: Region) -> Self {
        if region.is_top() {
            reasons.insert(ReasonId::FlowBound);
        }
        Self { reasons, region }
    }

    pub fn reasons(&self) -> &BTreeSet<ReasonId> {
        &self.reasons
    }

    pub fn region(&self) -> &Region {
        &self.region
    }

    /// The union of two uncertainties: associative, commutative and
    /// idempotent.
    pub fn join(mut self, other: Uncertainty) -> Self {
        self.reasons.extend(other.reasons);
        Self::canonical(self.reasons, self.region.union(other.region))
    }
}

/// What the analysis knows of a value. It has no default and converts to
/// nothing: every reader says what it does with each case.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Known<T: Ord> {
    Exact(T),
    Finite(BTreeSet<T>),
    Uncertain(Uncertainty),
}

/// A change the analysis sees to an object at a member path (empty for the
/// object itself), with the clause that says where: `preset is passed to
/// decorate() in a.tsx on line 4`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Change {
    pub object: ObjectId,
    pub path: Vec<String>,
    pub cause: String,
}

/// Something the analysis cannot close, with what it may reach.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Opening {
    pub reason: ReasonId,
    pub exposure: Region,
    /// The clause that says where: `a.tsx loads './missing' at runtime`.
    pub site: String,
}

/// Every opening of one analysis, in the order they were recorded.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SemanticClosure {
    pub openings: Vec<Opening>,
}

/// A subject whose absence of effects a reader asks to rely on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AbsenceQuery {
    /// Nothing changes the object at or below the member path.
    Stable(ObjectId, Vec<String>),
}

/// Why a subject is exposed: a change the analysis sees, or an opening.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Exposure<'e> {
    Changed(&'e Change),
    Opened(&'e Opening),
}

/// The answer to an absence query.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Coverage<'e> {
    /// The subject lies outside every change and every opening.
    Disjoint,
    /// What may reach it, changes first, each in the order recorded.
    Exposed(Vec<Exposure<'e>>),
}

/// The facts of one analysis as they are found. It only grows; it answers
/// nothing until it is closed.
#[derive(Debug, Default)]
pub struct FlowBuilder {
    changes: Vec<Change>,
    openings: Vec<Opening>,
    exports: BTreeMap<ObjectId, BTreeSet<(String, String)>>,
}

impl FlowBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    /// `module` exports `object` under `name`, itself or through re-exports.
    pub fn export(&mut self, object: ObjectId, module: &str, name: &str) {
        self.exports.entry(object).or_default().insert((module.to_string(), name.to_string()));
    }

    pub fn change(&mut self, object: ObjectId, path: Vec<String>, cause: String) {
        self.changes.push(Change { object, path, cause });
    }

    pub fn open(&mut self, reason: ReasonId, exposure: Region, site: String) {
        self.openings.push(Opening { reason, exposure, site });
    }

    pub fn close(self) -> ValueEffects {
        let mut changed: BTreeMap<ObjectId, Vec<usize>> = BTreeMap::new();
        for (index, change) in self.changes.iter().enumerate() {
            changed.entry(change.object.clone()).or_default().push(index);
        }
        ValueEffects {
            changes: self.changes,
            changed,
            exports: self.exports,
            closure: SemanticClosure { openings: self.openings },
        }
    }
}

/// The closed facts of one analysis.
#[derive(Debug)]
pub struct ValueEffects {
    changes: Vec<Change>,
    changed: BTreeMap<ObjectId, Vec<usize>>,
    exports: BTreeMap<ObjectId, BTreeSet<(String, String)>>,
    closure: SemanticClosure,
}

impl ValueEffects {
    pub fn closure(&self) -> &SemanticClosure {
        &self.closure
    }

    /// Whether a subject is provably untouched, or what may reach it.
    pub fn covers(&self, query: &AbsenceQuery) -> Coverage<'_> {
        let AbsenceQuery::Stable(object, path) = query;
        // A change at a path reaches every path it is a prefix of, and the
        // paths that are prefixes of it.
        let overlaps = |at: &[String]| at.iter().zip(path).all(|(a, b)| a == b);
        let changed = self
            .changed
            .get(object)
            .into_iter()
            .flatten()
            .map(|&index| &self.changes[index])
            .filter(|change| overlaps(&change.path))
            .map(Exposure::Changed);
        let opened = self
            .closure
            .openings
            .iter()
            .filter(|opening| self.reaches(&opening.exposure, object, path))
            .map(Exposure::Opened);
        let exposed: Vec<Exposure<'_>> = changed.chain(opened).collect();
        if exposed.is_empty() { Coverage::Disjoint } else { Coverage::Exposed(exposed) }
    }

    fn reaches(&self, region: &Region, object: &ObjectId, path: &[String]) -> bool {
        let Some(atoms) = region.as_atoms() else { return true };
        let exports = self.exports.get(object);
        atoms.iter().any(|atom| match atom {
            RegionAtom::Object(target) => target == object,
            RegionAtom::Path(target, at) => target == object && at.iter().zip(path).all(|(a, b)| a == b),
            RegionAtom::ScopeRegion(module) => object.module == *module,
            RegionAtom::ExportsOf(module) => exports.is_some_and(|names| names.iter().any(|(m, _)| m == module)),
            RegionAtom::ExportedAs(name) => exports.is_some_and(|names| names.iter().any(|(_, n)| n == name)),
            RegionAtom::AllExports => exports.is_some(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Uncertainties around the region bound: regions of 1, 2, 63, 64 and
    /// 65 atoms, over shared and distinct atoms, with two reasons, and
    /// everything.
    fn bounded_inputs() -> Vec<Uncertainty> {
        let mut inputs = Vec::new();
        for reason in [ReasonId::OpaqueStar, ReasonId::DirectEval] {
            for size in [1, 2, 63, 64, 65] {
                for family in ["shared", "own"] {
                    let atoms = (0..size).map(|i| RegionAtom::ExportedAs(format!("{family}{i}")));
                    inputs.push(Uncertainty::new(reason, Region::atoms(atoms).expect("non-empty")));
                }
            }
            inputs.push(Uncertainty::new(reason, Region::top()));
        }
        inputs
    }

    #[test]
    fn uncertainty_join_is_associative() {
        let inputs = bounded_inputs();
        for a in &inputs {
            for b in &inputs {
                for c in &inputs {
                    let left = a.clone().join(b.clone()).join(c.clone());
                    let right = a.clone().join(b.clone().join(c.clone()));
                    assert_eq!(left, right, "({a:?} ⊔ {b:?}) ⊔ {c:?}");
                }
            }
        }
    }

    #[test]
    fn uncertainty_join_is_idempotent() {
        for u in bounded_inputs() {
            assert_eq!(u.clone().join(u.clone()), u);
        }
    }
}
