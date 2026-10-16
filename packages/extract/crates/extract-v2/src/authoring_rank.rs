//! The system props' authoring order the prop-order file publishes: of two
//! props whose rules can set one CSS property on an element, the one that
//! takes effect comes later. That is the prop superseding the other, which
//! the runtime applies in its place, else the one whose rule the system
//! layer emits later (`render_utility_layer`). Props whose order their
//! values decide, or whose rules a component admits in a cycle, share a
//! group, which the lint rule never reorders within.

use std::cmp::{Ordering, Reverse};
use std::collections::{BTreeMap, BTreeSet, BinaryHeap};

use rustc_hash::FxHashMap;

use crate::declarations::{reset_set, utility_rule_key};
use crate::property_names::ContextualVarsMap;
use crate::theme::PropConfigMap;

/// How one prop's rules apply relative to another's on one element.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Applies {
    Before,
    After,
    /// Their values decide.
    Either,
}

/// A utility rule a prop can emit: the properties it resets, and its place
/// among the system layer's rules. Where two places are equal, the rules'
/// conditions or class names, so their values, order them: a declaration's
/// consuming rule precedes the atomic rules of its condition but follows a
/// base one from a breakpoint.
struct Rule {
    resets: BTreeSet<String>,
    place: (usize, Reverse<usize>, String),
}

impl Rule {
    fn new(properties: &[&str]) -> Self {
        let resets = reset_set(properties.iter().copied()).into_iter().map(str::to_string).collect();
        Rule { resets, place: utility_rule_key(properties) }
    }
}

/// The rules a prop's values can emit: a declaration prop's consuming rule
/// per member, or a value prop's one rule, with its current variable and, for a value that reads
/// it (`writes_current_var`), without.
fn rules(name: &str, config: &PropConfigMap, contextual_vars: &ContextualVarsMap) -> Vec<Rule> {
    let Some(prop) = config.get(name) else {
        return Vec::new();
    };
    if let Some(binding) = prop.declaration_binding() {
        return binding.members.iter().map(|member| Rule::new(&[member.css_property.as_str()])).collect();
    }
    let properties = prop.emitted_properties(contextual_vars);
    let mut emitted: Vec<&str> = properties.iter().map(String::as_str).collect();
    let mut rules = vec![Rule::new(&emitted)];
    if let Some(current_var) = &prop.current_var {
        let current_var = contextual_vars.emitted_property(current_var);
        emitted.push(&current_var);
        rules.push(Rule::new(&emitted));
    }
    rules
}

/// How `a`'s rules apply relative to `b`'s where they share a property, if
/// they ever do.
fn applies(a: &[Rule], b: &[Rule]) -> Option<Applies> {
    let mut found = None;
    for (ra, rb) in a.iter().flat_map(|ra| b.iter().map(move |rb| (ra, rb))) {
        if ra.resets.is_disjoint(&rb.resets) {
            continue;
        }
        let outcome = match ra.place.cmp(&rb.place) {
            Ordering::Less => Applies::Before,
            Ordering::Greater => Applies::After,
            Ordering::Equal => Applies::Either,
        };
        found = Some(match found {
            Some(seen) if seen != outcome => Applies::Either,
            _ => outcome,
        });
    }
    found
}

/// How each system prop's rules apply relative to each other's, built once
/// per analysis; a component's order is drawn from the props it admits.
pub(crate) struct SystemPrecedence {
    /// System prop → its registration position.
    positions: FxHashMap<String, usize>,
    /// By registration position: whether the first prop's rules can apply
    /// before the second's, which is both ways where their values decide.
    before: Vec<Vec<bool>>,
    /// Admitted positions → their order (`order`).
    orders: FxHashMap<Vec<usize>, Vec<(usize, usize)>>,
}

impl SystemPrecedence {
    pub(crate) fn new(
        config: &PropConfigMap,
        prop_order: &FxHashMap<String, usize>,
        contextual_vars: &ContextualVarsMap,
        superseded: &BTreeMap<String, Vec<String>>,
    ) -> Self {
        let mut names: Vec<&String> = prop_order.keys().collect();
        names.sort_by_key(|name| prop_order[*name]);
        let rules: Vec<_> = names.iter().map(|name| self::rules(name, config, contextual_vars)).collect();
        let supersedes =
            |later: usize, earlier: usize| superseded.get(names[earlier]).is_some_and(|by| by.contains(names[later]));
        let mut before = vec![vec![false; names.len()]; names.len()];
        for a in 0..names.len() {
            for b in a + 1..names.len() {
                // The runtime skips a superseded prop, whatever the cascade.
                let outcome = if supersedes(b, a) { Some(Applies::Before) } else { applies(&rules[a], &rules[b]) };
                before[a][b] = matches!(outcome, Some(Applies::Before | Applies::Either));
                before[b][a] = matches!(outcome, Some(Applies::After | Applies::Either));
            }
        }
        let positions = names.iter().enumerate().map(|(position, name)| ((*name).clone(), position)).collect();
        SystemPrecedence { positions, before, orders: FxHashMap::default() }
    }

    /// The admitted system props in authoring order, each with its group:
    /// the first registered of the props nothing else must precede, then the
    /// rest. Props that apply in a cycle or in an order their values decide
    /// share a group, in registration order; a prop the system does not
    /// register comes last, by name.
    pub(crate) fn order<'a>(&mut self, admitted: &[&'a str]) -> Vec<(&'a str, usize)> {
        let (mut known, mut unknown): (Vec<(usize, &'a str)>, Vec<(usize, &'a str)>) = admitted
            .iter()
            .map(|name| (self.positions.get(*name).copied().unwrap_or(usize::MAX), *name))
            .partition(|(position, _)| *position != usize::MAX);
        known.sort_unstable();
        unknown.sort_unstable();
        let positions: Vec<usize> = known.iter().map(|(position, _)| *position).collect();
        let before = &self.before;
        let order = self.orders.entry(positions).or_insert_with_key(|positions| grouped_order(positions, before));
        let mut ordered: Vec<(&'a str, usize)> = order.iter().map(|&(node, group)| (known[node].1, group)).collect();
        let next = ordered.last().map_or(0, |(_, group)| group + 1);
        ordered.extend(unknown.into_iter().enumerate().map(|(offset, (_, name))| (name, next + offset)));
        ordered
    }
}

/// Nodes `0..positions.len()`, registered in that order, as (node, group):
/// each group a strongly connected set of the graph where a node points at
/// every node whose rules apply after its own and both ways where the
/// values decide, the groups in dependency order, the first registered
/// first among those free.
fn grouped_order(positions: &[usize], before: &[Vec<bool>]) -> Vec<(usize, usize)> {
    let len = positions.len();
    let edge = |a: usize, b: usize| before[positions[a]][positions[b]];
    let components = strongly_connected(len, &edge);
    let count = components.iter().max().map_or(0, |last| last + 1);
    // Each component's nodes, in registration order.
    let mut members: Vec<Vec<usize>> = vec![Vec::new(); count];
    for (node, component) in components.iter().enumerate() {
        members[*component].push(node);
    }
    let mut successors: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); count];
    let mut waiting = vec![0usize; count];
    for a in 0..len {
        for b in 0..len {
            let (from, to) = (components[a], components[b]);
            if from != to && edge(a, b) && successors[from].insert(to) {
                waiting[to] += 1;
            }
        }
    }
    let mut free: BinaryHeap<Reverse<(usize, usize)>> =
        (0..count).filter(|c| waiting[*c] == 0).map(|c| Reverse((members[c][0], c))).collect();
    let mut order = Vec::with_capacity(len);
    let mut group = 0;
    while let Some(Reverse((_, component))) = free.pop() {
        order.extend(members[component].iter().map(|node| (*node, group)));
        group += 1;
        for next in &successors[component] {
            waiting[*next] -= 1;
            if waiting[*next] == 0 {
                free.push(Reverse((members[*next][0], *next)));
            }
        }
    }
    order
}

/// Each node's strongly connected component (Tarjan).
fn strongly_connected(len: usize, edge: &impl Fn(usize, usize) -> bool) -> Vec<usize> {
    struct Walk<'e, E> {
        edge: &'e E,
        len: usize,
        index: Vec<Option<usize>>,
        low: Vec<usize>,
        stack: Vec<usize>,
        on_stack: Vec<bool>,
        component: Vec<usize>,
        next_index: usize,
        next_component: usize,
    }
    impl<E: Fn(usize, usize) -> bool> Walk<'_, E> {
        fn visit(&mut self, node: usize) {
            self.index[node] = Some(self.next_index);
            self.low[node] = self.next_index;
            self.next_index += 1;
            self.stack.push(node);
            self.on_stack[node] = true;
            for next in 0..self.len {
                if !(self.edge)(node, next) {
                    continue;
                }
                match self.index[next] {
                    None => {
                        self.visit(next);
                        self.low[node] = self.low[node].min(self.low[next]);
                    }
                    Some(index) if self.on_stack[next] => self.low[node] = self.low[node].min(index),
                    Some(_) => {}
                }
            }
            if Some(self.low[node]) == self.index[node] {
                while let Some(member) = self.stack.pop() {
                    self.on_stack[member] = false;
                    self.component[member] = self.next_component;
                    if member == node {
                        break;
                    }
                }
                self.next_component += 1;
            }
        }
    }
    let mut walk = Walk {
        edge,
        len,
        index: vec![None; len],
        low: vec![0; len],
        stack: Vec::new(),
        on_stack: vec![false; len],
        component: vec![0; len],
        next_index: 0,
        next_component: 0,
    };
    for node in 0..len {
        if walk.index[node].is_none() {
            walk.visit(node);
        }
    }
    walk.component
}
