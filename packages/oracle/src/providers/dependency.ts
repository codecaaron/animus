import type { DependencyId, RuleId } from '../core/identity';

export interface DependencyProvider {
  dependenciesOfRule(rule: RuleId): readonly DependencyId[];
  rulesOfSource(file: string): readonly RuleId[];
}
