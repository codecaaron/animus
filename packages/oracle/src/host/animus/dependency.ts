import { asDependencyId } from '../../core/identity';

import type { DependencyId, RuleId } from '../../core/identity';
import type { DependencyProvider } from '../../providers/dependency';
import type { AnimusTokens } from './tokens';
import type { UniverseRule } from './universe';

export const fileDependency = (file: string): DependencyId =>
  asDependencyId(`file:${file}`);

export const componentDependency = (id: string): DependencyId =>
  asDependencyId(`component:${id}`);

export const ruleDependency = (rule: RuleId): DependencyId =>
  asDependencyId(`rule:${rule}`);

export const tokenDependency = (variable: string): DependencyId =>
  asDependencyId(`token:${variable}`);

export const manifestDependency = (hash: string): DependencyId =>
  asDependencyId(`manifest:${hash}`);

export interface AnimusDependencyInput {
  rules: readonly UniverseRule[];
  componentFiles: ReadonlyMap<string, string>;
  tokens?: AnimusTokens;
  programHash: string;
}

export const tokenClosure = (
  seeds: readonly string[],
  tokens: AnimusTokens | undefined
): string[] => {
  const seen = new Set<string>();
  const queue = [...seeds];

  for (let index = 0; index < queue.length; index += 1) {
    const variable = queue[index];
    if (seen.has(variable)) continue;
    seen.add(variable);

    for (const reference of tokens?.token(variable)?.references ?? []) {
      if (!seen.has(reference)) queue.push(reference);
    }
  }

  return Array.from(seen).sort();
};

export const dependenciesOf = (
  rule: UniverseRule,
  input: AnimusDependencyInput
): DependencyId[] => {
  const dependencies: DependencyId[] = [];

  if (rule.componentId !== undefined) {
    const file = input.componentFiles.get(rule.componentId);
    if (file !== undefined) dependencies.push(fileDependency(file));
    dependencies.push(componentDependency(rule.componentId));
  }

  const seeds: string[] = [];
  for (const declaration of rule.record.declarations) {
    for (const reference of declaration.tokenRefs ?? []) {
      if (!seeds.includes(reference)) seeds.push(reference);
    }
  }
  for (const variable of tokenClosure(seeds, input.tokens)) {
    dependencies.push(tokenDependency(variable));
  }

  dependencies.push(manifestDependency(input.programHash));

  return Array.from(new Set(dependencies));
};

export const createAnimusDependencies = (
  input: AnimusDependencyInput
): DependencyProvider => {
  const byRule = new Map<string, DependencyId[]>();
  const byFile = new Map<string, RuleId[]>();

  for (const rule of input.rules) {
    const dependencies = dependenciesOf(rule, input);
    byRule.set(rule.record.id, dependencies);

    for (const dependency of dependencies) {
      if (!dependency.startsWith('file:')) continue;
      const file = dependency.slice('file:'.length);
      byFile.set(file, [...(byFile.get(file) ?? []), rule.record.id]);
    }
  }

  return {
    dependenciesOfRule: (rule: RuleId) => byRule.get(rule) ?? [],
    rulesOfSource: (file: string) => byFile.get(file) ?? [],
  };
};
