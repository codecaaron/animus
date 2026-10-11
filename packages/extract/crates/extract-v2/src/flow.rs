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
    /// What Lower's evaluation could not settle in a static value: a
    /// computed key, a call or spread in a const, a captured `transform`.
    Unevaluated(crate::static_value::UnevaluatedKind),
    /// A change Flow saw: a write, a write under an unknown key, an escape
    /// or a rebind of the object at a path.
    Changed(ChangeKind),
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

/// How a change touches an object at its path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum ChangeKind {
    /// A write, delete or `defineProperty` of the member at the path.
    Write,
    /// A write under a key the analysis cannot read, to the container at
    /// the path.
    UnknownKeyWrite,
    /// The value at the path reaches code the analysis does not follow,
    /// which may change anything in or below it.
    Escape,
    /// The binding that holds the object is assigned again.
    Rebind,
}

/// A change the analysis sees to an object at a member path (empty for the
/// object itself), with the clause that says where: `preset is passed to
/// decorate() in a.tsx on line 4`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Change {
    pub object: ObjectId,
    pub path: Vec<String>,
    pub kind: ChangeKind,
    pub cause: String,
    /// When it was recorded, among changes and openings alike.
    order: usize,
}

/// Something the analysis cannot close, with what it may reach.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Opening {
    pub reason: ReasonId,
    pub exposure: Region,
    /// The clause that says where: `a.tsx loads './missing' at runtime`.
    pub site: String,
    order: usize,
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
    /// Nothing rebinds the member at the path: no write of it or of a
    /// container on the way to it, no write under an unknown key and no
    /// escape of a container on the way, and no reassignment of the
    /// binding. A change strictly below the member leaves it.
    SlotNotWritten(ObjectId, Vec<String>),
    /// No member slot of the object is rebound: what would rebind some
    /// slot `SlotNotWritten` asks of, whichever member it is.
    SlotsNotWritten(ObjectId),
}

/// Why a subject is exposed: a change the analysis sees, or an opening.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Exposure<'e> {
    Changed(&'e Change),
    Opened(&'e Opening),
}

impl Exposure<'_> {
    /// What the exposure makes uncertain (spec §6.2 F1a): an opening's
    /// reason and region, or a seen change at its object's path.
    pub fn uncertainty(&self) -> Uncertainty {
        match self {
            Exposure::Opened(opening) => Uncertainty::new(opening.reason, opening.exposure.clone()),
            Exposure::Changed(change) => Uncertainty::new(
                ReasonId::Changed(change.kind),
                Region::of(RegionAtom::Path(change.object.clone(), change.path.clone())),
            ),
        }
    }

    /// The clause that says what may reach the subject.
    pub fn cause(&self) -> &str {
        match self {
            Exposure::Changed(change) => &change.cause,
            Exposure::Opened(opening) => &opening.site,
        }
    }

    fn order(&self) -> usize {
        match self {
            Exposure::Changed(change) => change.order,
            Exposure::Opened(opening) => opening.order,
        }
    }
}

/// The answer to an absence query.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Coverage<'e> {
    /// The subject lies outside every change and every opening.
    Disjoint,
    /// What may reach it, in the order recorded.
    Exposed(Vec<Exposure<'e>>),
}

/// Objects that hold what other objects hold, or read from them: a change
/// that may reach any of `from` may reach each of `to`, said as `prefix`
/// followed by the first such change's clause.
#[derive(Debug, Clone)]
struct Flow {
    to: Vec<ObjectId>,
    from: Vec<ObjectId>,
    prefix: String,
}

/// The facts of one analysis as they are found. It only grows; it answers
/// nothing until it is closed.
#[derive(Debug, Default)]
pub struct FlowBuilder {
    changes: Vec<Change>,
    openings: Vec<Opening>,
    flows: Vec<Flow>,
    exports: BTreeMap<ObjectId, BTreeSet<(String, String)>>,
    recorded: usize,
}

impl FlowBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    /// `module` exports `object` under `name`, itself or through re-exports.
    pub fn export(&mut self, object: ObjectId, module: &str, name: &str) {
        self.exports.entry(object).or_default().insert((module.to_string(), name.to_string()));
    }

    pub fn change(&mut self, object: ObjectId, path: Vec<String>, kind: ChangeKind, cause: String) {
        self.changes.push(Change { object, path, kind, cause, order: self.recorded });
        self.recorded += 1;
    }

    pub fn open(&mut self, reason: ReasonId, exposure: Region, site: String) {
        self.openings.push(Opening { reason, exposure, site, order: self.recorded });
        self.recorded += 1;
    }

    /// Whatever may change any of `from` may change each of `to`: `to`
    /// holds or reads what `from` holds. Its change is said as `prefix`
    /// followed by the clause of the first change that reaches `from`.
    pub fn flow(&mut self, to: Vec<ObjectId>, from: Vec<ObjectId>, prefix: String) {
        self.flows.push(Flow { to, from, prefix });
    }

    /// The closed facts, with changes carried along every flow until none
    /// adds one: each pass takes the flows in the order recorded, and an
    /// object one flow changes is changed for the flows after it.
    pub fn close(self) -> ValueEffects {
        let mut effects = ValueEffects {
            changes: Vec::new(),
            changed: BTreeMap::new(),
            exports: self.exports,
            closure: SemanticClosure { openings: self.openings },
            recorded: self.recorded,
        };
        for change in self.changes {
            effects.add(change);
        }
        loop {
            let mut grew = false;
            for flow in &self.flows {
                let Some(cause) = flow.from.iter().find_map(|object| effects.first_cause(object)) else { continue };
                for object in &flow.to {
                    // An exposure of only part of the object leaves room for
                    // the whole-object change the flow carries.
                    if !effects.wholly_exposed(object) {
                        let order = effects.recorded;
                        effects.recorded += 1;
                        let cause = format!("{}{cause}", flow.prefix);
                        let kind = ChangeKind::Escape;
                        effects.add(Change { object: object.clone(), path: Vec::new(), kind, cause, order });
                        grew = true;
                    }
                }
            }
            if !grew {
                return effects;
            }
        }
    }
}

/// Whether `prefix` is `path` or a path above it.
fn prefix_of(prefix: &[String], path: &[String]) -> bool {
    prefix.len() <= path.len() && prefix.iter().zip(path).all(|(a, b)| a == b)
}

/// The closed facts of one analysis.
#[derive(Debug)]
pub struct ValueEffects {
    changes: Vec<Change>,
    changed: BTreeMap<ObjectId, Vec<usize>>,
    exports: BTreeMap<ObjectId, BTreeSet<(String, String)>>,
    closure: SemanticClosure,
    recorded: usize,
}

impl ValueEffects {
    pub fn closure(&self) -> &SemanticClosure {
        &self.closure
    }

    fn add(&mut self, change: Change) {
        self.changed.entry(change.object.clone()).or_default().push(self.changes.len());
        self.changes.push(change);
    }

    /// Whether a change of the object itself, or an opening that reaches
    /// all of it, is already recorded.
    fn wholly_exposed(&self, object: &ObjectId) -> bool {
        let changed = self
            .changed
            .get(object)
            .into_iter()
            .flatten()
            .any(|&index| self.changes[index].path.is_empty());
        changed
            || self.closure.openings.iter().any(|opening| match opening.exposure.as_atoms() {
                None => true,
                Some(atoms) => atoms.iter().any(|atom| match atom {
                    RegionAtom::Path(target, at) => target == object && at.is_empty(),
                    atom => self.reaches(&Region::of(atom.clone()), object, &[], false),
                }),
            })
    }

    fn first_cause(&self, object: &ObjectId) -> Option<String> {
        match self.covers(&AbsenceQuery::Stable(object.clone(), Vec::new())) {
            Coverage::Disjoint => None,
            Coverage::Exposed(exposures) => Some(exposures[0].cause().to_string()),
        }
    }

    /// Whether a subject is provably untouched, or what may reach it.
    pub fn covers(&self, query: &AbsenceQuery) -> Coverage<'_> {
        // Every slot is a one-member path; asking of all of them asks of the
        // member each change or opening names, or of any member when it
        // names none.
        let (object, path, slot, any_member) = match query {
            AbsenceQuery::Stable(object, path) => (object, path.as_slice(), false, false),
            AbsenceQuery::SlotNotWritten(object, path) => (object, path.as_slice(), true, false),
            AbsenceQuery::SlotsNotWritten(object) => (object, &[][..], true, true),
        };
        let slot_of = |at: &[String]| -> Vec<String> {
            match (any_member, at.first()) {
                (true, Some(member)) => vec![member.clone()],
                (true, None) => vec![String::new()],
                (false, _) => path.to_vec(),
            }
        };
        let counts = |change: &Change| {
            if !slot {
                // A change at a path reaches every path it is a prefix of,
                // and the paths that are prefixes of it.
                return change.path.iter().zip(path).all(|(a, b)| a == b);
            }
            let path = slot_of(&change.path);
            match change.kind {
                ChangeKind::Rebind => true,
                ChangeKind::Write => prefix_of(&change.path, &path),
                ChangeKind::UnknownKeyWrite | ChangeKind::Escape => {
                    change.path.len() < path.len() && prefix_of(&change.path, &path)
                }
            }
        };
        let changed = self
            .changed
            .get(object)
            .into_iter()
            .flatten()
            .map(|&index| &self.changes[index])
            .filter(|change| counts(change))
            .map(Exposure::Changed);
        let opened = self
            .closure
            .openings
            .iter()
            .filter(|opening| match any_member {
                // A region of part of the object reaches a slot when it is
                // the whole object or one member.
                true => match opening.exposure.as_atoms() {
                    None => true,
                    Some(atoms) => atoms.iter().any(|atom| match atom {
                        RegionAtom::Path(target, at) => target == object && at.len() <= 1,
                        atom => self.reaches(&Region::of(atom.clone()), object, &[], false),
                    }),
                },
                false => self.reaches(&opening.exposure, object, path, slot),
            })
            .map(Exposure::Opened);
        let mut exposed: Vec<Exposure<'_>> = changed.chain(opened).collect();
        exposed.sort_by_key(Exposure::order);
        if exposed.is_empty() { Coverage::Disjoint } else { Coverage::Exposed(exposed) }
    }

    /// Whether an opening's region reaches the object at the path: for a
    /// slot, a region of part of the object reaches it only at or above
    /// the slot.
    fn reaches(&self, region: &Region, object: &ObjectId, path: &[String], slot: bool) -> bool {
        let Some(atoms) = region.as_atoms() else { return true };
        let exports = self.exports.get(object);
        atoms.iter().any(|atom| match atom {
            RegionAtom::Object(target) => target == object,
            RegionAtom::Path(target, at) if slot => target == object && prefix_of(at, path),
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

    /// Contract (spec §6.2 F1a): what an exposure makes uncertain. A seen
    /// change is `Changed(kind)` at its object's path; an opening keeps its
    /// own reason and region.
    #[test]
    fn an_exposure_is_uncertain_as_its_change_or_opening() {
        let o = ObjectId::new("m.ts", "preset");
        let mut flow = FlowBuilder::new();
        flow.export(o.clone(), "m.ts", "preset");
        flow.change(o.clone(), vec!["a".to_string()], ChangeKind::Write, "preset.a is written".to_string());
        flow.open(ReasonId::DynamicCode, Region::of(RegionAtom::AllExports), "m.ts runs code".to_string());
        let effects = flow.close();
        let Coverage::Exposed(exposures) = effects.covers(&AbsenceQuery::Stable(o.clone(), Vec::new())) else {
            panic!("a written object is exposed");
        };
        let uncertainties: Vec<Uncertainty> = exposures.iter().map(Exposure::uncertainty).collect();

        assert_eq!(
            uncertainties,
            [
                Uncertainty::new(
                    ReasonId::Changed(ChangeKind::Write),
                    Region::of(RegionAtom::Path(o, vec!["a".to_string()])),
                ),
                Uncertainty::new(ReasonId::DynamicCode, Region::of(RegionAtom::AllExports)),
            ]
        );
    }

    /// A slot is exposed only by what can rebind it: a write of it or of a
    /// container above it, a write under an unknown key or an escape of a
    /// container above it, a reassignment of the binding, or an opening
    /// that reaches the object at or above it. Anything strictly below the
    /// slot leaves it, while `Stable` counts that too. Every slot of the
    /// object together (`SlotsNotWritten`) is exposed by what exposes any
    /// one-member slot, a member the table does not list included.
    #[test]
    fn a_slot_counts_only_what_can_rebind_it() {
        let o = ObjectId::new("m.ts", "o");
        let path = |members: &[&str]| members.iter().map(|member| member.to_string()).collect::<Vec<_>>();
        let slot = AbsenceQuery::SlotNotWritten(o.clone(), path(&["Root"]));
        let slots = AbsenceQuery::SlotsNotWritten(o.clone());
        let stable = AbsenceQuery::Stable(o.clone(), path(&["Root"]));
        let changes: [(ChangeKind, &[&str], bool, bool, bool); 12] = [
            // (kind, at, slot exposed, every slot exposed, stable exposed)
            (ChangeKind::Write, &["Root"], true, true, true),
            (ChangeKind::Write, &[], true, true, true),
            (ChangeKind::Write, &["Root", "x"], false, false, true),
            (ChangeKind::Write, &["Other"], false, true, false),
            (ChangeKind::UnknownKeyWrite, &[], true, true, true),
            (ChangeKind::UnknownKeyWrite, &["Root"], false, false, true),
            (ChangeKind::Escape, &[], true, true, true),
            (ChangeKind::Escape, &["Root"], false, false, true),
            (ChangeKind::Escape, &["Other"], false, false, false),
            (ChangeKind::Escape, &["Root", "x"], false, false, true),
            (ChangeKind::Rebind, &[], true, true, true),
            (ChangeKind::Rebind, &["Root"], true, true, true),
        ];
        let exposed = |effects: &ValueEffects, query: &AbsenceQuery| matches!(effects.covers(query), Coverage::Exposed(_));
        for (kind, at, slot_exposed, slots_exposed, stable_exposed) in changes {
            let mut builder = FlowBuilder::new();
            builder.change(o.clone(), path(at), kind, "changed".to_string());
            let effects = builder.close();
            assert_eq!(exposed(&effects, &slot), slot_exposed, "{kind:?} at {at:?}");
            assert_eq!(exposed(&effects, &slots), slots_exposed, "{kind:?} at {at:?}, every slot");
            assert_eq!(exposed(&effects, &stable), stable_exposed, "{kind:?} at {at:?}");
        }
        let openings: [(RegionAtom, bool, bool); 7] = [
            // (region, slot exposed, every slot exposed)
            (RegionAtom::Object(o.clone()), true, true),
            (RegionAtom::Path(o.clone(), path(&[])), true, true),
            (RegionAtom::Path(o.clone(), path(&["Root"])), true, true),
            (RegionAtom::Path(o.clone(), path(&["Other"])), false, true),
            (RegionAtom::Path(o.clone(), path(&["Root", "x"])), false, false),
            (RegionAtom::ExportsOf("m.ts".to_string()), true, true),
            (RegionAtom::ExportedAs("elsewhere".to_string()), false, false),
        ];
        for (atom, slot_exposed, slots_exposed) in openings {
            let mut builder = FlowBuilder::new();
            builder.export(o.clone(), "m.ts", "o");
            builder.open(ReasonId::OpaqueEffect, Region::of(atom.clone()), "opened".to_string());
            let effects = builder.close();
            assert_eq!(exposed(&effects, &slot), slot_exposed, "{atom:?}");
            assert_eq!(exposed(&effects, &slots), slots_exposed, "{atom:?}, every slot");
        }
    }

    /// Adding an opening never takes coverage away: a narrow opening on an
    /// object a flow reaches leaves the flow's whole-object change in place.
    #[test]
    fn a_narrow_opening_keeps_what_a_flow_carries() {
        let (x, y) = (ObjectId::new("m.ts", "x"), ObjectId::new("m.ts", "y"));
        let build = |narrow: bool| {
            let mut builder = FlowBuilder::new();
            builder.change(y.clone(), Vec::new(), ChangeKind::Escape, "y changes".to_string());
            if narrow {
                let region = Region::of(RegionAtom::Path(x.clone(), vec!["a".to_string()]));
                builder.open(ReasonId::OpaqueEffect, region, "x.a may change".to_string());
            }
            builder.flow(vec![x.clone()], vec![y.clone()], "x reads y, and ".to_string());
            builder.close()
        };
        let member_b = AbsenceQuery::Stable(x.clone(), vec!["b".to_string()]);
        for narrow in [false, true] {
            assert!(matches!(build(narrow).covers(&member_b), Coverage::Exposed(_)), "narrow opening: {narrow}");
        }
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
