import { subjectKey } from './fact';
import { asObligationId, stableHash } from './identity';

import type { RenderSubject, SourceRef } from './fact';
import type { DependencyId, ObligationId } from './identity';
import type { Predicate } from './predicate';
import type { AbstractValue } from './value';

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
