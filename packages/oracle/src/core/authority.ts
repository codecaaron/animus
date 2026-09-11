import type { EvidenceId } from './identity';

export type FactAuthority =
  | { kind: 'static-proof' }
  | { kind: 'declared-contract'; contract: string }
  | { kind: 'abstract-bound' }
  | { kind: 'measured-witness'; evidence: EvidenceId }
  | { kind: 'environment-assumption'; assumption: string }
  | { kind: 'heuristic'; note: string };

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
