import { subjectKey } from './fact';
import { asObligationId, stableHash } from './identity';

import type { RenderSubject, SourceRef } from './fact';
import type { DependencyId, ObligationId } from './identity';
import type { Predicate } from './predicate';
import type { AbstractValue } from './value';

/**
 * What kind of missing knowledge an obligation represents. The class picks the
 * discharge machinery: "JavaScript is involved" is not an answer, "the
 * intrinsic inline size of this node is not derivable from the closed style
 * universe" is (DESIGN §4).
 */
export type ObligationEffectClass =
  | 'tree-shape'
  | 'intrinsic-inline-size'
  | 'intrinsic-block-size'
  | 'containing-block'
  | 'scroll-position'
  | 'paint-order'
  | 'runtime-style-write'
  | 'geometry'
  | 'invocation-identity'
  | 'external-css'
  | 'dynamic-value';

export interface DischargeProcedure {
  kind:
    | 'branch-split'
    | 'fixture-lookup'
    | 'contract-application'
    | 'context-capsule-measurement'
    | 'manual-declaration'
    | 'partial-evaluation';
  description: string;
  automated: boolean;
}

export interface UnknownObligation {
  id: ObligationId;
  origin: SourceRef;
  guard: Predicate;
  effectClass: ObligationEffectClass;
  influenceScope: readonly RenderSubject[];
  currentBound?: AbstractValue<unknown>;
  reason: string;
  dischargeOptions: readonly DischargeProcedure[];
  dependencies: readonly DependencyId[];
}

/**
 * Obligations are content-addressed for the same reason facts are: the same
 * gap discovered twice (by two engines, or by the same engine over two
 * scenarios) is one obligation, so `refine` cannot be tricked into discharging
 * "another" copy of an unknown it has already resolved.
 */
export class ObligationRegistry {
  #obligations = new Map<ObligationId, UnknownObligation>();

  register(o: Omit<UnknownObligation, 'id'>): UnknownObligation {
    const id = asObligationId(stableHash(o));
    const existing = this.#obligations.get(id);
    if (existing !== undefined) return existing;

    const stored: UnknownObligation = { ...o, id };
    this.#obligations.set(id, stored);
    return stored;
  }

  get(id: ObligationId): UnknownObligation | undefined {
    return this.#obligations.get(id);
  }

  all(): UnknownObligation[] {
    return Array.from(this.#obligations.values());
  }

  forSubject(subject: RenderSubject): UnknownObligation[] {
    const key = subjectKey(subject);
    return this.all().filter((obligation) =>
      obligation.influenceScope.some((scope) => subjectKey(scope) === key)
    );
  }
}
