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

export type RenderSubject =
  | { kind: 'style-target'; target: TargetId }
  | { kind: 'rule'; rule: RuleId }
  | { kind: 'declaration'; rule: RuleId; property: string }
  | { kind: 'component'; component: string }
  | { kind: 'world' };

export const subjectKey = (subject: RenderSubject): string =>
  canonicalJson(subject);

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

export const originEdge = (fact: RenderFact): DerivationEdge | undefined =>
  fact.derivation.find(
    (edge) => edge.kind === 'origin' || edge.kind === 'inherited-from'
  );

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
