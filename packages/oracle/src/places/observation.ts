import { MODE_DIMENSION } from '../host/animus/conditions';
import { MODE_SELECTOR } from '../host/animus/tokens';
import { parseAttributeRequirement, requirementOf } from './axes';

import type { DimensionDomain, ScenarioPoint } from '../core/scenario';
import type { ComponentRecord, TargetResolution } from '../providers/identity';
import type { AxisRequirement, MatchVerdict } from './axes';
import type { AxisBinding, ObservationSource, Place } from './model';

export interface ObservedElement {
  tag?: string;
  classes?: readonly string[];
  attributes?: Readonly<Record<string, string>>;
}

export interface Observation {
  source: ObservationSource;
  subject?: ObservedElement;
  ancestors?: readonly ObservedElement[];
  completeToRoot?: boolean;
}

export interface LocateCandidate {
  place: Place;
  verdict: 'consistent' | 'conditional' | 'contradicted';
  notes: readonly string[];
}

export interface LocateMatch {
  component: ComponentRecord;
  impliedPoint: ScenarioPoint;
  conflicts: readonly string[];
  candidates: readonly LocateCandidate[];
}

export interface LocateResult {
  matches: readonly LocateMatch[];
  unmatchedClasses: readonly string[];
}

export interface ObserveResult {
  place: Place;
  discharged: readonly AxisBinding[];
  contradictions: readonly string[];
}

const observedSatisfies = (
  element: ObservedElement,
  requirement: AxisRequirement
): MatchVerdict => {
  let unknown = false;

  for (const raw of requirement.attributes) {
    const attribute = parseAttributeRequirement(raw);
    if (attribute === undefined) {
      unknown = true;
      continue;
    }
    if (element.attributes === undefined) {
      unknown = true;
      continue;
    }
    const actual = element.attributes[attribute.name];
    if (actual === undefined) return 'no';
    if (attribute.value !== undefined && actual !== attribute.value) {
      return 'no';
    }
  }
  if (requirement.classNames.length > 0) {
    const classes = element.classes;
    if (classes === undefined) unknown = true;
    else if (!requirement.classNames.every((name) => classes.includes(name))) {
      return 'no';
    }
  }
  return unknown ? 'unknown' : 'yes';
};

type ChainVerdict =
  | { state: 'established'; index: number; element: ObservedElement }
  | { state: 'refuted' }
  | { state: 'open' };

const chainVerdict = (
  observation: Observation,
  requirement: AxisRequirement
): ChainVerdict => {
  let unknown = false;
  const ancestors = observation.ancestors ?? [];
  for (let index = 0; index < ancestors.length; index++) {
    const verdict = observedSatisfies(ancestors[index], requirement);
    if (verdict === 'yes') {
      return { state: 'established', index, element: ancestors[index] };
    }
    if (verdict === 'unknown') unknown = true;
  }
  if (observation.completeToRoot === true && !unknown) {
    return { state: 'refuted' };
  }
  return { state: 'open' };
};

const describeWitness = (verdict: ChainVerdict): string =>
  verdict.state === 'established'
    ? `observed ancestor ${verdict.index}` +
      (verdict.element.tag === undefined ? '' : ` <${verdict.element.tag}>`)
    : '';

export interface DischargeResult {
  bindings: readonly AxisBinding[];
  discharged: readonly AxisBinding[];
  contradictions: readonly string[];
  assumptions: readonly string[];
}

export const dischargeObservation = (
  bindings: readonly AxisBinding[],
  observation: Observation
): DischargeResult => {
  const next: AxisBinding[] = [];
  const discharged: AxisBinding[] = [];
  const contradictions: string[] = [];
  const assumptions: string[] = [];
  const source = observation.source;

  for (const binding of bindings) {
    const requirement = requirementOf(binding.axis);
    if (!requirement.modeled) {
      next.push(binding);
      continue;
    }
    const verdict = chainVerdict(observation, requirement);

    if (binding.state === 'established') {
      if (verdict.state === 'refuted') {
        contradictions.push(
          `the complete observed chain has no ancestor satisfying ` +
            `'${binding.axis}', but static structure establishes it` +
            (binding.witness === undefined
              ? ''
              : ` at <${binding.witness.tag}>`) +
            ' — the observation cannot be a render of this place'
        );
      }
      next.push(binding);
      continue;
    }

    if (binding.state === 'refuted') {
      if (verdict.state === 'established' && !requirement.stateful) {
        const rebound: AxisBinding = {
          axis: binding.axis,
          state: 'established',
          evidence: { source, note: describeWitness(verdict) },
        };
        next.push(rebound);
        discharged.push(rebound);
        assumptions.push(
          `'${binding.axis}' was refuted within the file's shown structure; ` +
            `the ${source} observation establishes it beyond that scope — ` +
            'the beyond-file-root assumption is discharged false for this ' +
            'render'
        );
        continue;
      }
      if (verdict.state === 'established' && requirement.stateful) {
        next.push({
          axis: binding.axis,
          state: 'open',
          reason: 'stateful-pseudo',
          evidence: { source, note: describeWitness(verdict) },
        });
        continue;
      }
      next.push(binding);
      continue;
    }

    if (verdict.state === 'established') {
      if (requirement.stateful) {
        next.push({
          axis: binding.axis,
          state: 'open',
          reason: 'stateful-pseudo',
          evidence: {
            source,
            note:
              `${describeWitness(verdict)} carries the structure; ` +
              'the interaction state is unobservable in a snapshot',
          },
        });
        continue;
      }
      const established: AxisBinding = {
        axis: binding.axis,
        state: 'established',
        evidence: { source, note: describeWitness(verdict) },
      };
      next.push(established);
      discharged.push(established);
      assumptions.push(
        `'${binding.axis}' established by the ${source} observation — ` +
          'evidence from a rendered chain, not static structure'
      );
      continue;
    }
    if (verdict.state === 'refuted') {
      const refuted: AxisBinding = {
        axis: binding.axis,
        state: 'refuted',
        evidence: { source },
      };
      next.push(refuted);
      discharged.push(refuted);
      assumptions.push(
        `'${binding.axis}' refuted by the ${source} observation — no ` +
          'element of the complete observed chain satisfies it; the ' +
          'refutation is scoped to the observed chain'
      );
      continue;
    }
    next.push(binding);
  }

  if (contradictions.length > 0) {
    return { bindings, discharged: [], contradictions, assumptions: [] };
  }
  return { bindings: next, discharged, contradictions: [], assumptions };
};

export interface CandidateScore {
  verdict: LocateCandidate['verdict'];
  notes: readonly string[];
}

export const scorePlace = (
  place: Place,
  observation: Observation
): CandidateScore => {
  const notes: string[] = [];
  let conditional = false;
  let contradicted = false;

  for (const binding of place.bindings) {
    const requirement = requirementOf(binding.axis);
    if (!requirement.modeled) continue;
    const verdict = chainVerdict(observation, requirement);

    if (binding.state === 'established' && verdict.state === 'refuted') {
      contradicted = true;
      notes.push(
        `the place establishes '${binding.axis}' but the complete observed ` +
          'chain lacks it'
      );
    }
    if (binding.state === 'refuted' && verdict.state === 'established') {
      conditional = true;
      notes.push(
        `the place refutes '${binding.axis}' within the file's JSX root — ` +
          'the observed establishment is possible only if that scoped ' +
          'assumption fails beyond the file'
      );
    }
  }

  return {
    verdict: contradicted
      ? 'contradicted'
      : conditional
        ? 'conditional'
        : 'consistent',
    notes,
  };
};

export interface ModeImplication {
  point: ScenarioPoint;
  conflicts: readonly string[];
}

export const impliedModeOf = (
  observation: Observation,
  modeDomain: DimensionDomain | undefined
): ModeImplication => {
  const seen = new Set<string>();
  for (const element of observation.ancestors ?? []) {
    for (const [name, value] of Object.entries(element.attributes ?? {})) {
      const match = MODE_SELECTOR.exec(`[${name}=${value}]`);
      if (match !== null) seen.add(match[1]);
    }
  }
  if (seen.size === 0) return { point: {}, conflicts: [] };
  if (seen.size > 1) {
    return {
      point: {},
      conflicts: [
        `the observed chain carries more than one data-color-mode value ` +
          `(${Array.from(seen).join(', ')}) — no single mode is implied`,
      ],
    };
  }
  const value = Array.from(seen)[0];
  const declared =
    modeDomain?.kind === 'finite' &&
    modeDomain.values.some((mode) => mode === value);
  if (!declared) {
    return {
      point: {},
      conflicts: [
        `observed data-color-mode '${value}' is not a declared mode of ` +
          'this snapshot',
      ],
    };
  }
  return { point: { [MODE_DIMENSION]: value }, conflicts: [] };
};

export interface ClassInversion {
  point: ScenarioPoint;
  conflicts: readonly string[];
  matched: readonly string[];
}

export const invertObservedClasses = (
  resolution: TargetResolution,
  observed: readonly string[]
): ClassInversion => {
  const base = resolution.component.className;
  const family = observed.filter(
    (name) => name === base || name.startsWith(`${base}--`)
  );
  const baseline = new Set(resolution.classes({}));
  const conflicts: string[] = [];
  const point: Record<string, ScenarioPoint[string]> = {};

  for (const [dimension, domain] of Object.entries(resolution.dimensions)) {
    if (domain.kind !== 'finite') continue;
    const implied = domain.values.filter((value) => {
      const delta = resolution
        .classes({ [dimension]: value })
        .filter((name) => !baseline.has(name));
      return delta.length > 0 && delta.every((name) => family.includes(name));
    });
    if (implied.length === 1) point[dimension] = implied[0];
    else if (implied.length > 1) {
      conflicts.push(
        `the observed classes imply more than one value for '${dimension}': ` +
          implied.map(String).join(', ')
      );
    }
  }

  const replay = new Set(resolution.classes(point));
  const missing = Array.from(replay).filter((name) => !family.includes(name));
  const unexplained = family.filter((name) => !replay.has(name));
  if (missing.length > 0 || unexplained.length > 0) {
    conflicts.push(
      'the observed classes do not replay from any single scenario point' +
        (missing.length > 0 ? ` — missing: ${missing.join(', ')}` : '') +
        (unexplained.length > 0
          ? ` — unexplained: ${unexplained.join(', ')}`
          : '')
    );
    return { point: {}, conflicts, matched: family };
  }
  return { point, conflicts, matched: family };
};
