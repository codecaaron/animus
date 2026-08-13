import type { DependencyId, RuleId } from '../core/identity';

/**
 * Provider 6 (DESIGN §9): the edges that make invalidation exact. Coarse edges
 * cost recomputation; *missing* edges cost soundness, because evidence would
 * survive a change it actually depended on.
 */
export interface DependencyProvider {
  dependenciesOfRule(rule: RuleId): readonly DependencyId[];
  rulesOfSource(file: string): readonly RuleId[];
}
