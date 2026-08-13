import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { evalPredicate, referencedDimensions } from '../src/core/predicate';
import {
  effectiveGuard,
  isCandidateSelector,
  specificityOf,
} from '../src/engines/cascade';
import { MODE_DIMENSION } from '../src/host/animus/conditions';
import { createAnimusHost } from '../src/host/animus/host';
import { loadAnimusArtifacts } from '../src/host/animus/loader';
import { analyzeSelector, ancestorGuardsOf } from '../src/host/animus/selector';

import type { StyleRuleRecord } from '../src/providers/style-universe';

const FIXTURE = join(__dirname, 'fixtures/rollup-app');

const host = createAnimusHost(loadAnimusArtifacts(FIXTURE));
const universe = host.universe.universe();

const GROUP_ITEM = 'animus-GroupItem-32b2d32f';

const ruleBySelector = (raw: string): StyleRuleRecord => {
  const matches = universe.rules.filter((rule) => rule.selector.raw === raw);
  expect(matches).toHaveLength(1);
  return matches[0];
};

// PLACES.md §3: relational selectors stop being silently-active (or silently
// absent) cascade candidates. The ancestor prefix becomes a decidable guard —
// the mode attribute on the mode axis, everything else on an `ancestor:*`
// axis only a place binding can decide.
describe('ancestor axes on relational selectors', () => {
  it('guards a [data-color-mode] ancestor on the mode axis', () => {
    const rule = ruleBySelector(`[data-color-mode="dark"] .${GROUP_ITEM}`);

    expect(referencedDimensions(rule.condition)).toContain(MODE_DIMENSION);
    expect(evalPredicate(rule.condition, { mode: 'dark' })).toBe(true);
    // Bug (h) of the cold review: this rule used to win at mode=light with
    // static-proof authority.
    expect(evalPredicate(rule.condition, { mode: 'light' })).toBe(false);
  });

  it('guards a generic ancestor prefix on an ancestor:* axis', () => {
    // The manifest sheet quotes the attribute value; the axis name does not —
    // canonicalization is what lets a place binding built from structure name
    // the same axis the sheet-derived guard references.
    const rule = ruleBySelector(`[data-active="true"] .${GROUP_ITEM}`);

    expect(referencedDimensions(rule.condition)).toEqual([
      'ancestor:[data-active=true]',
    ]);
    expect(
      evalPredicate(rule.condition, { 'ancestor:[data-active=true]': true })
    ).toBe(true);
    // An unbound ancestor axis evaluates false — never a silent match. The
    // conditional channel, not the winner table, is where it surfaces.
    expect(evalPredicate(rule.condition, {})).toBe(false);
  });

  it('keeps a stateful ancestor prefix whole, out of subject pseudo conjuncts', () => {
    const rule = ruleBySelector(`.group:hover .${GROUP_ITEM}`);

    expect(referencedDimensions(rule.condition)).toEqual([
      'ancestor:.group:hover',
    ]);
    // The ancestor's :hover must NOT leak into a `pseudo:hover` conjunct —
    // that would attribute the ancestor's interaction state to the subject.
    expect(referencedDimensions(effectiveGuard(rule))).toEqual([
      'ancestor:.group:hover',
    ]);
  });

  it('takes candidacy from the subject compound, not the flat class list', () => {
    const rule = ruleBySelector(`.group:hover .${GROUP_ITEM}`);

    // Previously NOT a candidate at all: flat candidacy required `group` on
    // the target itself, so this rule silently vanished from every cascade.
    expect(isCandidateSelector(rule, new Set([GROUP_ITEM]))).toBe(true);
    expect(isCandidateSelector(rule, new Set(['group']))).toBe(false);
  });

  it('keeps specificity computed over the full selector', () => {
    expect(
      specificityOf(
        ruleBySelector(`[data-active="true"] .${GROUP_ITEM}`).selector
      )
    ).toEqual({ b: 2, c: 0 });
    expect(
      specificityOf(ruleBySelector(`.group:hover .${GROUP_ITEM}`).selector)
    ).toEqual({ b: 3, c: 0 });
  });

  it('derives mode + canonicalized remainder guards from a mixed prefix', () => {
    const guards = ancestorGuardsOf(
      analyzeSelector('[data-color-mode="dark"] [data-active="true"] .x')
    );

    expect(guards).toEqual([
      { kind: 'mode', value: 'dark' },
      // Quoted attribute values canonicalize when they are ident-safe, so the
      // axis name is the same whether the sheet quoted them or not.
      { kind: 'axis', dimension: 'ancestor:[data-active=true]' },
    ]);
  });

  it('keeps non-descendant relations distinct in the axis name', () => {
    const guards = ancestorGuardsOf(analyzeSelector('.x + .x'));

    expect(guards).toEqual([{ kind: 'axis', dimension: 'ancestor:.x +' }]);
  });

  it('derives no guards for non-relational selectors', () => {
    expect(ancestorGuardsOf(analyzeSelector('.x:hover'))).toEqual([]);
  });
});
