import { asFactId, canonicalJson, stableHash } from './identity';

import type { FactAuthority } from './authority';
import type {
  DependencyId,
  FactId,
  RuleId,
  TargetId,
  WorldId,
} from './identity';
import type { Predicate } from './predicate';
import type { AbstractValue } from './value';

export interface SourceRef {
  file: string;
  span?: readonly [number, number];
  note?: string;
}

/** What a fact is *about*. */
export type RenderSubject =
  | { kind: 'style-target'; target: TargetId }
  | { kind: 'rule'; rule: RuleId }
  | { kind: 'declaration'; rule: RuleId; property: string }
  | { kind: 'component'; component: string }
  | { kind: 'world' };

/** Canonical string form of a subject — the grouping key inside ledgers. */
export const subjectKey = (subject: RenderSubject): string =>
  canonicalJson(subject);

/**
 * One edge of the derivation graph. `ref` names a `FactId` when the edge points
 * at another fact, otherwise a `RuleId` or a symbolic name (a token, a
 * contract, an environment axiom) that has no fact of its own — `explain`
 * renders both, `backwardSlice` follows only the ones that resolve to facts.
 */
export type DerivationEdge = {
  kind:
    | 'derived-from'
    | 'defeats'
    | 'defeated-by'
    | 'guarded-by'
    | 'inherited-from'
    | 'origin';
  ref: string;
  note?: string;
};

export interface RenderFact<T = unknown> {
  id: FactId;
  subject: RenderSubject;
  property: string;
  value: AbstractValue<T>;
  guard: Predicate;
  authority: FactAuthority;
  derivation: readonly DerivationEdge[];
  dependencies: readonly DependencyId[];
  provenance: readonly SourceRef[];
}

/**
 * The edge naming the rule a fact's value came from — its own winner
 * (`origin`) or the ancestor it inherited from (`inherited-from`). One
 * definition, because every consumer that resolves "which rule set this"
 * must agree on it.
 */
export const originEdge = (fact: RenderFact): DerivationEdge | undefined =>
  fact.derivation.find(
    (edge) => edge.kind === 'origin' || edge.kind === 'inherited-from'
  );

/**
 * The fact store for one world.
 *
 * Identity is content-addressed over (world, subject, property, guard, value) —
 * deliberately *not* over authority, derivation or provenance. Two independent
 * derivations that reach the same guarded value for the same subject are the
 * same fact, so re-deriving is idempotent and caches stay sound; the first
 * insertion's authority and derivation are kept (later identical adds return
 * the stored fact unchanged) so a fact's recorded provenance is stable for the
 * lifetime of a world.
 */
export class FactGraph {
  readonly worldId: WorldId;

  #facts = new Map<FactId, RenderFact>();

  constructor(worldId: WorldId) {
    this.worldId = worldId;
  }

  add(fact: Omit<RenderFact, 'id'>): RenderFact {
    const id = asFactId(
      stableHash({
        world: this.worldId,
        subject: fact.subject,
        property: fact.property,
        guard: fact.guard,
        value: fact.value,
      })
    );

    const existing = this.#facts.get(id);
    if (existing !== undefined) return existing;

    const stored: RenderFact = { ...fact, id };
    this.#facts.set(id, stored);
    return stored;
  }

  get(id: FactId): RenderFact | undefined {
    return this.#facts.get(id);
  }

  factsFor(subject: RenderSubject, property?: string): RenderFact[] {
    const key = subjectKey(subject);
    return this.all().filter(
      (fact) =>
        subjectKey(fact.subject) === key &&
        (property === undefined || fact.property === property)
    );
  }

  /**
   * The facts this fact rests on, breadth-first and without repeats. The start
   * fact is not part of its own slice; `maxDepth` counts edges, so a depth of 1
   * yields only the immediate predecessors and a depth of 0 yields nothing.
   */
  backwardSlice(id: FactId, maxDepth = Number.POSITIVE_INFINITY): RenderFact[] {
    const start = this.#facts.get(id);
    if (start === undefined) return [];

    const visited = new Set<FactId>([id]);
    const slice: RenderFact[] = [];
    let frontier: RenderFact[] = [start];
    let depth = 0;

    while (frontier.length > 0 && depth < maxDepth) {
      const next: RenderFact[] = [];
      for (const fact of frontier) {
        for (const edge of fact.derivation) {
          const refId = asFactId(edge.ref);
          if (visited.has(refId)) continue;
          const referenced = this.#facts.get(refId);
          if (referenced === undefined) continue;
          visited.add(refId);
          slice.push(referenced);
          next.push(referenced);
        }
      }
      frontier = next;
      depth += 1;
    }

    return slice;
  }

  get size(): number {
    return this.#facts.size;
  }

  all(): RenderFact[] {
    return Array.from(this.#facts.values());
  }
}
