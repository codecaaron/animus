import { describe, expect, it } from 'vitest';

import { FactGraph, subjectKey } from '../src/core/fact';
import {
  asDependencyId,
  asFactId,
  asTargetId,
  asWorldId,
} from '../src/core/identity';
import { eq, TRUE } from '../src/core/predicate';
import { exact } from '../src/core/value';

import type { RenderFact, RenderSubject } from '../src/core/fact';

const target = asTargetId('src/Alert.tsx::Alert');
const subject: RenderSubject = { kind: 'style-target', target };
const other: RenderSubject = { kind: 'component', component: 'Alert' };

const factInput = (
  property: string,
  value: string,
  derivation: RenderFact['derivation'] = []
): Omit<RenderFact, 'id'> => ({
  subject,
  property,
  value: exact(value),
  guard: TRUE,
  authority: { kind: 'static-proof' },
  derivation,
  dependencies: [asDependencyId('src/Alert.tsx')],
  provenance: [{ file: 'src/Alert.tsx', span: [54, 899] }],
});

describe('subjectKey', () => {
  it('is canonical and discriminates the subject kinds', () => {
    expect(subjectKey(subject)).toBe(
      subjectKey({ kind: 'style-target', target })
    );
    expect(subjectKey(subject)).not.toBe(subjectKey(other));
  });
});

describe('FactGraph.add', () => {
  it('is content-addressed: an identical fact added twice is one fact', () => {
    const graph = new FactGraph(asWorldId('w1'));
    const first = graph.add(factInput('padding', '12px'));
    const second = graph.add(factInput('padding', '12px'));

    expect(second.id).toBe(first.id);
    expect(second).toBe(first);
    expect(graph.size).toBe(1);
  });

  it('keeps the first insertion when only the authority differs', () => {
    const graph = new FactGraph(asWorldId('w1'));
    const proof = graph.add(factInput('padding', '12px'));
    const heuristic = graph.add({
      ...factInput('padding', '12px'),
      authority: { kind: 'heuristic', note: 'guessed' },
    });

    expect(heuristic).toBe(proof);
    expect(heuristic.authority).toEqual({ kind: 'static-proof' });
    expect(graph.size).toBe(1);
  });

  it('separates facts by guard, value, property and world', () => {
    const graph = new FactGraph(asWorldId('w1'));
    const base = graph.add(factInput('padding', '12px'));

    expect(graph.add(factInput('padding', '8px')).id).not.toBe(base.id);
    expect(graph.add(factInput('margin', '12px')).id).not.toBe(base.id);
    expect(
      graph.add({ ...factInput('padding', '12px'), guard: eq('mode', 'dark') })
        .id
    ).not.toBe(base.id);

    const otherWorld = new FactGraph(asWorldId('w2'));
    expect(otherWorld.add(factInput('padding', '12px')).id).not.toBe(base.id);
  });
});

describe('FactGraph.factsFor', () => {
  it('filters by subject and optionally by property', () => {
    const graph = new FactGraph(asWorldId('w1'));
    graph.add(factInput('padding', '12px'));
    graph.add(factInput('margin', '0'));
    graph.add({ ...factInput('padding', '12px'), subject: other });

    expect(graph.factsFor(subject)).toHaveLength(2);
    expect(graph.factsFor(subject, 'padding')).toHaveLength(1);
    expect(graph.factsFor(other)).toHaveLength(1);
    expect(graph.factsFor({ kind: 'world' })).toEqual([]);
    expect(graph.all()).toHaveLength(3);
  });
});

describe('FactGraph.backwardSlice', () => {
  const build = () => {
    const graph = new FactGraph(asWorldId('w1'));
    const root = graph.add(factInput('token', 'space.4'));
    const middle = graph.add(
      factInput('authored', '12px', [
        { kind: 'derived-from', ref: root.id },
        { kind: 'origin', ref: 'styles()' },
      ])
    );
    const leaf = graph.add(
      factInput('padding', '12px', [
        { kind: 'derived-from', ref: middle.id },
        { kind: 'defeated-by', ref: 'rule-not-in-graph' },
      ])
    );
    return { graph, root, middle, leaf };
  };

  it('follows derivation edges transitively, breadth-first and unique', () => {
    const { graph, root, middle, leaf } = build();
    expect(graph.backwardSlice(leaf.id).map((fact) => fact.id)).toEqual([
      middle.id,
      root.id,
    ]);
  });

  it('honours the depth limit, counted in edges', () => {
    const { graph, middle, leaf } = build();
    expect(graph.backwardSlice(leaf.id, 1).map((fact) => fact.id)).toEqual([
      middle.id,
    ]);
    expect(graph.backwardSlice(leaf.id, 0)).toEqual([]);
  });

  it('ignores refs that do not resolve to facts, and unknown roots', () => {
    const { graph, root } = build();
    expect(graph.backwardSlice(root.id)).toEqual([]);
    expect(graph.backwardSlice(asFactId('not-a-fact'))).toEqual([]);
  });

  it('visits a shared ancestor once', () => {
    const graph = new FactGraph(asWorldId('w1'));
    const shared = graph.add(factInput('token', 'space.4'));
    const left = graph.add(
      factInput('left', '12px', [{ kind: 'derived-from', ref: shared.id }])
    );
    const right = graph.add(
      factInput('right', '12px', [{ kind: 'derived-from', ref: shared.id }])
    );
    const leaf = graph.add(
      factInput('padding', '12px', [
        { kind: 'derived-from', ref: left.id },
        { kind: 'derived-from', ref: right.id },
      ])
    );

    expect(graph.backwardSlice(leaf.id).map((fact) => fact.id)).toEqual([
      left.id,
      right.id,
      shared.id,
    ]);
  });
});
