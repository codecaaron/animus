import { referencedDimensions } from '../core/predicate';
import { applyDeltas } from '../core/world';
import { pinDomain } from '../engines/cells';
import { readCascade } from '../engines/inspect';
import { createRuntime } from '../engines/runtime';
import { elementSatisfies, requirementOf } from './axes';
import {
  dischargeObservation,
  impliedModeOf,
  invertObservedClasses,
  scorePlace,
} from './observation';
import { resolveComponentTag } from './resolve';
import { ancestorsOf } from './source';

import type { ScenarioDomain, ScenarioPoint } from '../core/scenario';
import type { WorldDelta } from '../core/world';
import type { OracleRuntime } from '../engines/runtime';
import type { ComponentRecord } from '../providers/identity';
import type { StyleRuleRecord } from '../providers/style-universe';
import type {
  AxisBinding,
  InvocationRef,
  OpenReason,
  Place,
  UnresolvedInvocation,
} from './model';
import type {
  LocateCandidate,
  LocateMatch,
  LocateResult,
  Observation,
  ObserveResult,
} from './observation';
import type { Snapshot } from './snapshot';
import type { SourceElement, SourceRead } from './source';

/**
 * The many-place model (PLACES.md §2): invocations found in real source,
 * places built from their structural context, ancestor axes bound per place,
 * and outcomes carried across every place that matters.
 */

export type {
  AxisBinding,
  InvocationRef,
  OpenReason,
  Place,
  UnresolvedInvocation,
} from './model';

export interface PlaceExplanation {
  place: Place;
  point: ScenarioPoint;
  property: string;
  value: string | undefined;
  winner?: {
    selector: string;
    layer: string;
    value: string;
    origin?: StyleRuleRecord['origin'];
    source?: StyleRuleRecord['source'];
  };
  defeated: readonly {
    selector: string;
    value: string;
    reason: string;
  }[];
  /** Bindings whose axis gates a competing declaration of this property. */
  requiredAncestors: readonly AxisBinding[];
  assumptions: readonly string[];
}

export type OutcomeClass = 'changed' | 'stable' | 'ambiguous' | 'inaccessible';

export interface CarriedOutcome {
  place: Place;
  context: ScenarioPoint;
  outcome: OutcomeClass;
  from?: string;
  to?: string;
  reason?: string;
}

export interface PlaceAnalysis {
  snapshot: Snapshot;
  /** Every correspondence-checked invocation of one component. */
  invocationsOf(selector: string): readonly InvocationRef[];
  /**
   * Component-like tags in one file that cannot be attributed to a single
   * component — surfaced with their candidates, never silently dropped.
   */
  unresolved(file: string): readonly UnresolvedInvocation[];
  /** The invocation whose element span contains this offset. */
  at(file: string, offset: number): InvocationRef | undefined;
  placeOf(invocation: InvocationRef): Place;
  explain(
    place: Place,
    question: { property: string; at?: ScenarioPoint }
  ): PlaceExplanation;
  /**
   * Carry a candidate change across every place of the component and
   * partition the outcomes (PLACES.md §2): changed / stable / ambiguous /
   * inaccessible, per materially different context.
   */
  carry(
    deltas: readonly WorldDelta[],
    subject: { component: string; property: string }
  ): readonly CarriedOutcome[];
  /**
   * The observation-first entry (PLACES.md §5): which components produced
   * these observed classes, at which replay-verified bindings, and which
   * places could have rendered them — a narrowing, never a pick.
   */
  locate(observation: Observation): LocateResult;
  /**
   * Apply an observation to a place: open axes discharge with observation
   * evidence, refutation demands a complete chain, and a contradiction with
   * static structure rejects the whole observation (PLACES.md §5).
   */
  observe(place: Place, observation: Observation): ObserveResult;
}

const bindAxis = (
  axis: string,
  read: SourceRead,
  invocation: InvocationRef
): { binding: AxisBinding; assumption?: string } => {
  const requirement = requirementOf(axis);
  if (!requirement.modeled) {
    return {
      binding: { axis, state: 'open', reason: 'unmodeled-relation' },
    };
  }

  let openReason: OpenReason | undefined;
  let openWitness: SourceElement | undefined;

  for (const ancestor of ancestorsOf(read, invocation.ordinal)) {
    if (ancestor.component) {
      // The chain is hidden from here outward — nothing farther can be
      // refuted, and nothing nearer established it.
      return {
        binding: {
          axis,
          state: 'open',
          reason: 'opaque-component',
          witness: {
            file: read.file,
            ordinal: ancestor.ordinal,
            tag: ancestor.tag,
          },
        },
      };
    }
    const verdict = elementSatisfies(ancestor, requirement);
    if (verdict === 'yes') {
      const witness = {
        file: read.file,
        ordinal: ancestor.ordinal,
        tag: ancestor.tag,
      };
      if (requirement.stateful) {
        // The structure is present but the axis also demands interaction
        // state (`.group:hover`) — statically at most refutable, never
        // established.
        return {
          binding: { axis, state: 'open', reason: 'stateful-pseudo', witness },
        };
      }
      return { binding: { axis, state: 'established', witness } };
    }
    if (verdict === 'unknown' && openReason === undefined) {
      openReason = ancestor.hasSpread
        ? 'spread-attributes'
        : 'dynamic-attribute';
      openWitness = ancestor;
    }
  }

  if (openReason !== undefined) {
    return {
      binding: {
        axis,
        state: 'open',
        reason: openReason,
        ...(openWitness === undefined
          ? {}
          : {
              witness: {
                file: read.file,
                ordinal: openWitness.ordinal,
                tag: openWitness.tag,
              },
            }),
      },
    };
  }

  return {
    binding: { axis, state: 'refuted' },
    assumption:
      `no ancestor beyond ${read.file}'s JSX root carries ` +
      `'${axis.slice('ancestor:'.length)}' — refutation is scoped to the ` +
      'structure this file shows',
  };
};

export const createPlaceAnalysis = (snapshot: Snapshot): PlaceAnalysis => {
  const rt: OracleRuntime = createRuntime(snapshot.host);
  const universe = snapshot.host.universe.universe();
  const components = snapshot.host.identity.components();

  const rulesOfComponent = (component: ComponentRecord): StyleRuleRecord[] =>
    universe.rules.filter((rule) => {
      const subject = rule.selector.subject ?? rule.selector;
      return subject.classNames.some(
        (name) =>
          name === component.className ||
          name.startsWith(`${component.className}--`)
      );
    });

  const ancestorAxesOf = (component: ComponentRecord): string[] => {
    const axes = new Set<string>();
    for (const rule of rulesOfComponent(component)) {
      for (const dimension of referencedDimensions(rule.condition)) {
        if (dimension.startsWith('ancestor:')) axes.add(dimension);
      }
    }
    return Array.from(axes).sort();
  };

  const invocationsIn = (file: string): InvocationRef[] => {
    const structure = snapshot.structureOf(file);
    if (!structure.ok) return [];
    const refs: InvocationRef[] = [];
    for (const element of structure.read.elements) {
      if (!element.component) continue;
      const resolution = resolveComponentTag(
        components,
        snapshot.fileFacts(file)?.imports,
        file,
        element.tag
      );
      if (resolution.kind !== 'resolved') continue;
      refs.push({
        file,
        ordinal: element.ordinal,
        span: element.span,
        component: resolution.component,
      });
    }
    return refs;
  };

  /**
   * Component-like tags this analysis cannot attribute to one component —
   * surfaced, never silently dropped. Tags outside the universe are not
   * listed: a plain wrapper component is an opaque boundary, not a failed
   * attribution.
   */
  const unresolved = (file: string): UnresolvedInvocation[] => {
    const structure = snapshot.structureOf(file);
    if (!structure.ok) return [];
    const entries: UnresolvedInvocation[] = [];
    for (const element of structure.read.elements) {
      if (!element.component) continue;
      const resolution = resolveComponentTag(
        components,
        snapshot.fileFacts(file)?.imports,
        file,
        element.tag
      );
      if (resolution.kind !== 'ambiguous') continue;
      entries.push({
        file,
        ordinal: element.ordinal,
        span: element.span,
        tag: element.tag,
        reason: 'ambiguous-binding',
        candidates: resolution.candidates.map((candidate) => candidate.id),
        ...(resolution.specifier === undefined
          ? {}
          : { specifier: resolution.specifier }),
      });
    }
    return entries;
  };

  const invocationsOf = (selector: string): InvocationRef[] =>
    snapshot
      .files()
      .flatMap(invocationsIn)
      .filter(
        (ref) =>
          ref.component.id === selector || ref.component.binding === selector
      );

  const at = (file: string, offset: number): InvocationRef | undefined => {
    const candidates = invocationsIn(file).filter(
      (ref) => ref.span[0] <= offset && offset < ref.span[1]
    );
    // Innermost containing invocation: the smallest span wins.
    candidates.sort((a, b) => a.span[1] - a.span[0] - (b.span[1] - b.span[0]));
    return candidates[0];
  };

  /** Fold decided bindings into the pinned domain + point of a place. */
  const placeFrom = (
    invocation: InvocationRef,
    bindings: readonly AxisBinding[],
    assumptions: readonly string[]
  ): Place => {
    const pinned: Record<string, ScenarioDomain[string]> = {};
    const point: Record<string, string | number | boolean> = {};
    for (const binding of bindings) {
      if (binding.state === 'established') {
        pinned[binding.axis] = { kind: 'finite', values: [true] };
        point[binding.axis] = true;
      } else if (binding.state === 'refuted') {
        pinned[binding.axis] = { kind: 'finite', values: [false] };
        point[binding.axis] = false;
      }
    }
    return { invocation, bindings, assumptions, pinned, point };
  };

  const placeOf = (invocation: InvocationRef): Place => {
    const structure = snapshot.structureOf(invocation.file);
    if (!structure.ok) {
      throw new Error(
        `placeOf: ${invocation.file} is not readable in this snapshot — ` +
          structure.detail
      );
    }
    const bindings: AxisBinding[] = [];
    const assumptions: string[] = [];

    for (const axis of ancestorAxesOf(invocation.component)) {
      const bound = bindAxis(axis, structure.read, invocation);
      bindings.push(bound.binding);
      if (bound.assumption !== undefined) assumptions.push(bound.assumption);
    }

    return placeFrom(invocation, bindings, assumptions);
  };

  const locate = (observation: Observation): LocateResult => {
    const subjectClasses = observation.subject?.classes ?? [];
    const matchedClasses = new Set<string>();
    const matches: LocateMatch[] = [];
    const modeDomain = snapshot.host.scenarios.dimensions()['mode'];

    for (const record of components) {
      if (!subjectClasses.includes(record.className)) continue;
      const resolution = snapshot.host.identity.resolveTarget(record.id);
      if (resolution === undefined) continue;

      const inversion = invertObservedClasses(resolution, subjectClasses);
      for (const name of inversion.matched) matchedClasses.add(name);
      const mode = impliedModeOf(observation, modeDomain);

      const candidates: LocateCandidate[] = invocationsOf(record.id).map(
        (invocation) => {
          const place = placeOf(invocation);
          const score = scorePlace(place, observation);
          return { place, verdict: score.verdict, notes: score.notes };
        }
      );

      matches.push({
        component: record,
        impliedPoint: { ...inversion.point, ...mode.point },
        conflicts: [...inversion.conflicts, ...mode.conflicts],
        candidates,
      });
    }

    return {
      matches,
      unmatchedClasses: subjectClasses.filter(
        (name) => !matchedClasses.has(name)
      ),
    };
  };

  const observe = (place: Place, observation: Observation): ObserveResult => {
    const result = dischargeObservation(place.bindings, observation);
    if (result.contradictions.length > 0) {
      return {
        place,
        discharged: [],
        contradictions: result.contradictions,
      };
    }
    return {
      place: placeFrom(place.invocation, result.bindings, [
        ...place.assumptions,
        ...result.assumptions,
      ]),
      discharged: result.discharged,
      contradictions: [],
    };
  };

  const explain = (
    place: Place,
    question: { property: string; at?: ScenarioPoint }
  ): PlaceExplanation => {
    const world = pinDomain(rt.baselineWorld(), place.pinned);
    const point = { ...rt.resolvePoint(question.at), ...place.point };
    const reading = readCascade(
      rt,
      world,
      place.invocation.component.id,
      point
    );
    const outcome = reading.analysis.outcomes.get(question.property);
    const winner = outcome?.winner;

    const guarded = new Set<string>();
    const competing = [
      ...(winner === undefined ? [] : [winner]),
      ...(outcome?.defeated ?? []).map((entry) => entry.declaration),
    ];
    for (const declaration of competing) {
      for (const dimension of referencedDimensions(
        declaration.candidate.rule.condition
      )) {
        if (dimension.startsWith('ancestor:')) guarded.add(dimension);
      }
    }

    return {
      place,
      point,
      property: question.property,
      value: reading.values.get(question.property),
      ...(winner === undefined
        ? {}
        : {
            winner: {
              selector: winner.candidate.rule.selector.raw,
              layer: winner.candidate.rule.layer,
              value: winner.declaration.value,
              ...(winner.candidate.rule.origin === undefined
                ? {}
                : { origin: winner.candidate.rule.origin }),
              ...(winner.candidate.rule.source === undefined
                ? {}
                : { source: winner.candidate.rule.source }),
            },
          }),
      defeated: (outcome?.defeated ?? []).map((entry) => ({
        selector: entry.declaration.candidate.rule.selector.raw,
        value: entry.declaration.declaration.value,
        reason: entry.reason,
      })),
      requiredAncestors: place.bindings.filter((binding) =>
        guarded.has(binding.axis)
      ),
      assumptions: [...place.assumptions, ...reading.assumptions],
    };
  };

  const carry = (
    deltas: readonly WorldDelta[],
    subject: { component: string; property: string }
  ): CarriedOutcome[] => {
    const outcomes: CarriedOutcome[] = [];
    const modeDomain = snapshot.host.scenarios.dimensions()['mode'];
    const modes =
      modeDomain?.kind === 'finite' ? modeDomain.values : [undefined];

    for (const invocation of invocationsOf(subject.component)) {
      const place = placeOf(invocation);

      // An open axis only clouds the outcome when a rule that declares the
      // queried property is gated on it — an open hover axis cannot make a
      // color question ambiguous.
      const deciding = place.bindings.filter(
        (binding) =>
          binding.state === 'open' &&
          rulesOfComponent(invocation.component).some(
            (rule) =>
              referencedDimensions(rule.condition).includes(binding.axis) &&
              rule.declarations.some(
                (declaration) => declaration.property === subject.property
              )
          )
      );

      for (const mode of modes) {
        const context: ScenarioPoint = {
          ...(mode === undefined ? {} : { mode }),
          ...place.point,
        };
        if (deciding.length > 0) {
          const opaque = deciding.some(
            (binding) => binding.reason === 'opaque-component'
          );
          outcomes.push({
            place,
            context,
            outcome: opaque ? 'inaccessible' : 'ambiguous',
            reason: deciding
              .map((binding) => `${binding.axis} open (${binding.reason})`)
              .join('; '),
          });
          continue;
        }

        const baseWorld = pinDomain(rt.baselineWorld(), place.pinned);
        const candidateWorld = applyDeltas(baseWorld, deltas);
        const point = { ...rt.resolvePoint(undefined), ...context };
        const base = readCascade(rt, baseWorld, invocation.component.id, point);
        const candidate = readCascade(
          rt,
          candidateWorld,
          invocation.component.id,
          point
        );
        const from = base.values.get(subject.property);
        const to = candidate.values.get(subject.property);
        outcomes.push({
          place,
          context,
          outcome: from === to ? 'stable' : 'changed',
          ...(from === undefined ? {} : { from }),
          ...(to === undefined ? {} : { to }),
        });
      }
    }
    return outcomes;
  };

  return {
    snapshot,
    invocationsOf,
    unresolved,
    at,
    placeOf,
    explain,
    carry,
    locate,
    observe,
  };
};
