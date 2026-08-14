import type { EvidenceId } from './identity';

/**
 * How a fact was established — the second axis of DESIGN §3, independent of
 * how precise the fact's value is.
 */
export type FactAuthority =
  | { kind: 'static-proof' }
  | { kind: 'declared-contract'; contract: string }
  | { kind: 'abstract-bound' }
  | { kind: 'measured-witness'; evidence: EvidenceId }
  | { kind: 'environment-assumption'; assumption: string }
  | { kind: 'heuristic'; note: string };

/**
 * Ordering for display only.
 *
 * The ranking runs proof → derived bound → declared contract → measurement →
 * environment assumption → heuristic: the first three are entailed by the
 * closed model, a measurement is a single observed point that may not
 * generalise, an environment assumption is an axiom the user could get wrong,
 * and a heuristic carries no entailment at all (DESIGN §8 keeps it in a
 * separate channel — it must never appear as a proof-bearing fact).
 *
 * Authority and precision must never be merged into one confidence number:
 * a proven interval over the whole domain (`abstract-bound`, precision 3) can
 * be a stronger claim than an exact browser measurement at one point
 * (`measured-witness`, precision 5). When both a general proof and a point
 * measurement exist, the substrate partitions the domain and keeps both — it
 * does not pick a winner by score.
 */
export const authorityStrength = (a: FactAuthority): number => {
  switch (a.kind) {
    case 'static-proof':
      return 5;
    case 'abstract-bound':
      return 4;
    case 'declared-contract':
      return 3;
    case 'measured-witness':
      return 2;
    case 'environment-assumption':
      return 1;
    case 'heuristic':
      return 0;
  }
};
