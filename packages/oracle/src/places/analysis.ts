import { referencedDimensions } from '../core/predicate';
import { applyDeltas } from '../core/world';
import { pinDomain } from '../engines/cells';
import { readCascade } from '../engines/inspect';
import { createRuntime } from '../engines/runtime';
import { analyzeSelector, canonicalCompound } from '../host/animus/selector';
import { ancestorsOf } from './source';

import type { ScenarioDomain, ScenarioPoint } from '../core/scenario';
import type { WorldDelta } from '../core/world';
import type { OracleRuntime } from '../engines/runtime';
import type { ComponentRecord } from '../providers/identity';
import type { StyleRuleRecord } from '../providers/style-universe';
import type { Snapshot } from './snapshot';
import type { SourceElement, SourceRead } from './source';

/**
 * The many-place model (PLACES.md §2): invocations found in real source,
 * places built from their structural context, ancestor axes bound per place,
 * and outcomes carried across every place that matters.
 */

export interface InvocationRef {
  file: string;
  ordinal: number;
  span: readonly [number, number];
  component: ComponentRecord;
}

export type OpenReason =
  | 'opaque-component'
  | 'dynamic-attribute'
  | 'spread-attributes'
  | 'stateful-pseudo'
  | 'unmodeled-relation';

export interface AxisBinding {
  axis: string;
  state: 'established' | 'refuted' | 'open';
  reason?: OpenReason;
  /** The ancestor that establishes the axis or opens the question. */
  witness?: { file: string; ordinal: number; tag: string };
}

export interface Place {
  invocation: InvocationRef;
  bindings: readonly AxisBinding[];
  /** What a refutation is scoped to — never silently assumed. */
  assumptions: readonly string[];
  /** The scenario override pinning every decided axis. */
  pinned: ScenarioDomain;
  point: ScenarioPoint;
}

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
}

interface AxisRequirement {
  classNames: readonly string[];
  attributes: readonly string[];
  stateful: boolean;
  /** Undefined when the prefix is more than one descendant compound. */
  modeled: boolean;
}

const requirementOf = (axis: string): AxisRequirement => {
  const prefix = axis.slice('ancestor:'.length);
  const analyzed = analyzeSelector(`${prefix} .__axis-probe__`);
  const links = analyzed.model.ancestry ?? [];
  if (links.length !== 1 || links[0].combinator !== 'descendant') {
    return { classNames: [], attributes: [], stateful: false, modeled: false };
  }
  const model = links[0].model;
  return {
    classNames: model.classNames,
    attributes: (model.attributes ?? []).map(canonicalCompound),
    stateful: (model.pseudo ?? []).length > 0,
    modeled: true,
  };
};

const classListOf = (element: SourceElement): readonly string[] | undefined => {
  const className = element.attributes.find((a) => a.name === 'className');
  if (className === undefined) return element.hasSpread ? undefined : [];
  if (className.kind !== 'static') return undefined;
  return (className.value ?? '').split(/\s+/).filter((name) => name !== '');
};

const attributeMatch = (
  element: SourceElement,
  required: string
): 'yes' | 'no' | 'unknown' => {
  const parsed = /^\[([^\]=]+)(?:=([^\]]*))?\]$/.exec(required);
  if (parsed === null) return 'unknown';
  const name = parsed[1];
  const value = parsed[2]?.replace(/^["']|["']$/g, '');
  const attr = element.attributes.find((a) => a.name === name);
  if (attr === undefined) return element.hasSpread ? 'unknown' : 'no';
  if (attr.kind !== 'static') return 'unknown';
  if (value === undefined) return 'yes';
  return attr.value === value ? 'yes' : 'no';
};

/** How one structural ancestor relates to one axis requirement. */
const elementSatisfies = (
  element: SourceElement,
  requirement: AxisRequirement
): 'yes' | 'no' | 'unknown' => {
  let unknown = false;

  for (const attribute of requirement.attributes) {
    const verdict = attributeMatch(element, attribute);
    if (verdict === 'no') return 'no';
    if (verdict === 'unknown') unknown = true;
  }
  if (requirement.classNames.length > 0) {
    const classes = classListOf(element);
    if (classes === undefined) unknown = true;
    else if (!requirement.classNames.every((name) => classes.includes(name))) {
      return 'no';
    }
  }
  return unknown ? 'unknown' : 'yes';
};

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

  /** Resolve a JSX tag in one file to an extracted component, or undefined. */
  const componentForTag = (
    file: string,
    tag: string
  ): ComponentRecord | undefined => {
    const local = components.find(
      (component) => component.file === file && component.binding === tag
    );
    if (local !== undefined) return local;

    const imported = snapshot
      .fileFacts(file)
      ?.imports?.find((entry) => entry.local === tag);
    const name = imported?.imported ?? tag;
    const matches = components.filter(
      (component) => component.binding === name
    );
    // An ambiguous bare binding resolves to nothing rather than to an
    // arbitrary winner — same contract as IdentityProvider.resolveTarget.
    return matches.length === 1 ? matches[0] : undefined;
  };

  const invocationsIn = (file: string): InvocationRef[] => {
    const structure = snapshot.structureOf(file);
    if (!structure.ok) return [];
    const refs: InvocationRef[] = [];
    for (const element of structure.read.elements) {
      if (!element.component) continue;
      const component = componentForTag(file, element.tag);
      if (component === undefined) continue;
      refs.push({
        file,
        ordinal: element.ordinal,
        span: element.span,
        component,
      });
    }
    return refs;
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
    const pinned: Record<string, ScenarioDomain[string]> = {};
    const point: Record<string, string | number | boolean> = {};

    for (const axis of ancestorAxesOf(invocation.component)) {
      const bound = bindAxis(axis, structure.read, invocation);
      bindings.push(bound.binding);
      if (bound.assumption !== undefined) assumptions.push(bound.assumption);
      if (bound.binding.state === 'established') {
        pinned[axis] = { kind: 'finite', values: [true] };
        point[axis] = true;
      } else if (bound.binding.state === 'refuted') {
        pinned[axis] = { kind: 'finite', values: [false] };
        point[axis] = false;
      }
    }

    return { invocation, bindings, assumptions, pinned, point };
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
    at,
    placeOf,
    explain,
    carry,
  };
};
