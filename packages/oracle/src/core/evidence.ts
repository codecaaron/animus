import { subjectKey } from './fact';
import { asEvidenceId, stableHash } from './identity';

import type { RenderSubject } from './fact';
import type { DependencyId, EvidenceId } from './identity';
import type { Predicate } from './predicate';
import type { AbstractValue } from './value';

export interface RenderEvidence<T = unknown> {
  id: EvidenceId;
  subject: RenderSubject;
  fact: AbstractValue<T>;
  property: string;
  scenarioGuard: Predicate;
  environment: string;
  kind:
    | 'static-proof'
    | 'abstract-bound'
    | 'declared-contract'
    | 'counterfactual-witness'
    | 'browser-measurement';
  dependencies: readonly DependencyId[];
  dependencyFingerprint: string;
  modelVersion: string;
}

export class EvidenceLedger {
  #evidence = new Map<EvidenceId, RenderEvidence>();

  assimilate(e: Omit<RenderEvidence, 'id'>): RenderEvidence {
    const id = asEvidenceId(stableHash(e));
    const existing = this.#evidence.get(id);
    if (existing !== undefined) return existing;

    const stored: RenderEvidence = { ...e, id };
    this.#evidence.set(id, stored);
    return stored;
  }

  validFor(subject: RenderSubject, property?: string): RenderEvidence[] {
    const key = subjectKey(subject);
    return this.all().filter(
      (evidence) =>
        subjectKey(evidence.subject) === key &&
        (property === undefined || evidence.property === property)
    );
  }

  invalidate(changed: ReadonlySet<DependencyId>): RenderEvidence[] {
    const removed: RenderEvidence[] = [];
    for (const evidence of this.all()) {
      if (evidence.dependencies.some((dependency) => changed.has(dependency))) {
        removed.push(evidence);
        this.#evidence.delete(evidence.id);
      }
    }
    return removed;
  }

  revision(): string {
    return stableHash(Array.from(this.#evidence.keys()).sort());
  }

  all(): RenderEvidence[] {
    return Array.from(this.#evidence.values());
  }
}
