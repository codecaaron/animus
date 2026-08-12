/**
 * The world comparator shared by `simulate` and `diff`.
 *
 * A semantic diff is not a text diff of emitted CSS: it reports, per subject
 * and per context, *what the cascade decided differently* and why the decision
 * moved — a different winner, a re-activated rule, a token that resolved
 * elsewhere. That classification is the difference between "these bytes
 * changed" and "this component's padding changed in the dark, compact class".
 */

import { subjectKey } from '../core/fact';
import { canonicalJson } from '../core/identity';
import { describeValue } from '../core/value';
import { applyDeltas, worldId } from '../core/world';
import {
  analyzeCascade,
  buildWinnerFact,
  resolveDeclarationValue,
  styleTargetSubject,
} from './cascade';
import {
  cellCount,
  cellsOf,
  harvestCuts,
  scopedDomain,
  sharedDomain,
} from './cells';
import { activeRuleFingerprint } from './equivalence';
import { describeCell, listOf, plural } from './format';
import { dedupeOperations, dischargeOperations, zeroDelta } from './result';

import type { RenderFact, RenderSubject } from '../core/fact';
import type { RuleId } from '../core/identity';
import type { ProbeResult, SuggestedOperation } from '../core/probe';
import type {
  DimensionValue,
  ScenarioCell,
  ScenarioPoint,
} from '../core/scenario';
import type { RenderWorld, WorldDelta } from '../core/world';
import type { ComponentRecord, TargetResolution } from '../providers/identity';
import type {
  StyleRuleRecord,
  StyleUniverse,
} from '../providers/style-universe';
import type {
  CascadeAnalysis,
  CascadeContext,
  DeclarationCandidate,
} from './cascade';
import type { OracleRuntime } from './runtime';

export type SemanticDiffKind =
  | 'value-changed'
  | 'winner-changed'
  | 'rule-activated'
  | 'rule-deactivated'
  | 'token-changed'
  | 'declaration-added'
  | 'declaration-removed';

export interface SemanticDiffEntry {
  subject: RenderSubject;
  property: string;
  kind: SemanticDiffKind;
  context: string;
  before?: string;
  after?: string;
}

export interface SemanticDiff {
  entries: readonly SemanticDiffEntry[];
  affectedContextClasses: number;
  unaffectedContextClasses: number;
}

export interface ComparisonSide {
  world: RenderWorld;
  ctx: CascadeContext;
}

/**
 * A `force-dimension` intervention is the one delta that moves the *point*
 * rather than the universe: "what if this were hovered / large / dark". Both
 * sides are therefore read at the same cell but under their own world's forced
 * bindings, which is what makes rule activation observable — enumerating
 * cells from the candidate's already-narrowed domain would compare a forced
 * world against itself.
 */
const forcedBindings = (world: RenderWorld): ScenarioPoint => {
  const forced: Record<string, DimensionValue> = {};
  for (const delta of world.interventions) {
    if (delta.kind === 'force-dimension') forced[delta.dimension] = delta.value;
  }
  return forced;
};

const hasDeclaration = (
  universe: StyleUniverse,
  ruleId: RuleId,
  property: string
): boolean =>
  universe
    .ruleById(ruleId)
    ?.declarations.some((declaration) => declaration.property === property) ===
  true;

const valueAt = (
  ctx: CascadeContext,
  analysis: CascadeAnalysis,
  declaration: DeclarationCandidate
): string =>
  describeValue(
    resolveDeclarationValue(ctx, analysis.point, declaration).value
  );

const activeIds = (analysis: CascadeAnalysis): ReadonlySet<string> =>
  new Set(
    analysis.candidates
      .filter((candidate) => candidate.active)
      .map((candidate) => candidate.rule.id)
  );

/**
 * Classify one property at one cell.
 *
 * The order of the tests is the classification policy: a changed winner is
 * attributed to *activation* whenever the new winner was inactive before (or
 * the old one is inactive now), because "this rule started applying" is the
 * cause an author can act on; only when both rules were active in both worlds
 * is it a plain precedence change. A same-rule change is a token change exactly
 * when the authored text is untouched and only the resolution moved.
 */
const classify = (
  property: string,
  before: DeclarationCandidate | undefined,
  after: DeclarationCandidate | undefined,
  baseline: ComparisonSide,
  candidate: ComparisonSide,
  baselineAnalysis: CascadeAnalysis,
  candidateAnalysis: CascadeAnalysis
): SemanticDiffKind | undefined => {
  const baselineActive = activeIds(baselineAnalysis);
  const candidateActive = activeIds(candidateAnalysis);

  if (before === undefined && after !== undefined) {
    return hasDeclaration(
      baseline.ctx.universe,
      after.candidate.rule.id,
      property
    )
      ? 'rule-activated'
      : 'declaration-added';
  }

  if (before !== undefined && after === undefined) {
    return hasDeclaration(
      candidate.ctx.universe,
      before.candidate.rule.id,
      property
    )
      ? 'rule-deactivated'
      : 'declaration-removed';
  }

  if (before === undefined || after === undefined) return undefined;

  if (before.candidate.rule.id !== after.candidate.rule.id) {
    if (!baselineActive.has(after.candidate.rule.id)) return 'rule-activated';
    if (!candidateActive.has(before.candidate.rule.id)) {
      return 'rule-deactivated';
    }
    return 'winner-changed';
  }

  const beforeValue = valueAt(baseline.ctx, baselineAnalysis, before);
  const afterValue = valueAt(candidate.ctx, candidateAnalysis, after);
  if (beforeValue === afterValue) return undefined;

  return before.declaration.value === after.declaration.value
    ? 'token-changed'
    : 'value-changed';
};

/** Every property either world decides for this target at this cell. */
const propertiesOf = (
  baseline: CascadeAnalysis,
  candidate: CascadeAnalysis
): readonly string[] =>
  Array.from(
    new Set([
      ...baseline.outcomes.keys(),
      ...candidate.outcomes.keys(),
      ...baseline.inherited.keys(),
      ...candidate.inherited.keys(),
    ])
  ).sort();

const winnerFor = (
  analysis: CascadeAnalysis,
  property: string
): DeclarationCandidate | undefined =>
  analysis.outcomes.get(property)?.winner ??
  analysis.inherited.get(property)?.declaration;

export const compareAtCell = (
  baseline: ComparisonSide,
  candidate: ComparisonSide,
  resolution: TargetResolution,
  cell: ScenarioCell
): readonly SemanticDiffEntry[] => {
  const before = analyzeCascade(baseline.ctx, resolution, {
    ...cell.point,
    ...forcedBindings(baseline.world),
  });
  const after = analyzeCascade(candidate.ctx, resolution, {
    ...cell.point,
    ...forcedBindings(candidate.world),
  });
  const context = `${resolution.component.binding} @ ${describeCell(cell)}`;
  const entries: SemanticDiffEntry[] = [];

  for (const property of propertiesOf(before, after)) {
    const beforeWinner = winnerFor(before, property);
    const afterWinner = winnerFor(after, property);
    const kind = classify(
      property,
      beforeWinner,
      afterWinner,
      baseline,
      candidate,
      before,
      after
    );
    if (kind === undefined) continue;

    const entry: SemanticDiffEntry = {
      subject: styleTargetSubject(resolution.target),
      property,
      kind,
      context,
    };
    if (beforeWinner !== undefined) {
      entry.before = valueAt(baseline.ctx, before, beforeWinner);
    }
    if (afterWinner !== undefined) {
      entry.after = valueAt(candidate.ctx, after, afterWinner);
    }
    entries.push(entry);
  }

  return entries;
};

const entryKey = (entry: SemanticDiffEntry): string =>
  [
    subjectKey(entry.subject),
    entry.property,
    entry.kind,
    entry.context,
    entry.before ?? '',
    entry.after ?? '',
  ].join('|');

/**
 * Does this component own the rule a delta touched? Ownership decides how wide
 * the collateral sweep goes: the owner's own variant and state axes are
 * enumerated (a change can hide behind a variant nobody looked at), while every
 * other component is checked at the shared axes only.
 */
export const ownsRule = (
  component: ComponentRecord,
  rule: StyleRuleRecord | undefined
): boolean => {
  if (rule === undefined) return false;
  if (
    rule.origin?.component === component.binding ||
    rule.origin?.component === component.id
  ) {
    return true;
  }
  return rule.selector.classNames.some(
    (name) =>
      name === component.className ||
      name.startsWith(`${component.className}--`)
  );
};

export interface SweepRequest {
  rt: OracleRuntime;
  baseline: ComparisonSide;
  candidate: ComparisonSide;
  affectedRules: readonly RuleId[];
  maxCells: number;
  focal?: TargetResolution;
  focalCells?: readonly ScenarioCell[];
}

export interface SweepResult {
  entries: readonly SemanticDiffEntry[];
  cellsEvaluated: number;
  componentsSwept: number;
  truncated: boolean;
  affectedContextClasses: number;
  unaffectedContextClasses: number;
  subjects: readonly RenderSubject[];
  changedProperties: readonly string[];
  /** Cells where the focal target changed / was evaluated at all. */
  focalCellsChanged: number;
  focalCellsEvaluated: number;
}

/**
 * Compare two worlds over the focal target and then over every component in the
 * system.
 *
 * The collateral half is the point: a repair that fixes the symptom under the
 * probed context but silently moves another component in another context class
 * is not a clean repair, and only an exhaustive sweep of the closed universe
 * can say so (DESIGN §12, step 3).
 */
export const sweepWorlds = (request: SweepRequest): SweepResult => {
  const { rt, baseline, candidate, focal } = request;
  const entries = new Map<string, SemanticDiffEntry>();
  const subjects: RenderSubject[] = [];
  const changedProperties = new Set<string>();
  const declaredCuts = rt.host.scenarios.cuts();

  let cellsEvaluated = 0;
  let truncated = false;
  let focalCellsChanged = 0;
  let focalCellsEvaluated = 0;

  const evaluate = (
    resolution: TargetResolution,
    cells: readonly ScenarioCell[],
    counted: boolean
  ): Map<string, boolean> => {
    const classes = new Map<string, boolean>();
    subjects.push(styleTargetSubject(resolution.target));

    for (const cell of cells) {
      if (cellsEvaluated >= request.maxCells) {
        truncated = true;
        break;
      }
      cellsEvaluated += 1;

      const fingerprint = activeRuleFingerprint(
        baseline.ctx,
        resolution,
        cell.point
      );
      const found = compareAtCell(baseline, candidate, resolution, cell);
      classes.set(
        fingerprint,
        (classes.get(fingerprint) ?? false) || found.length > 0
      );

      for (const entry of found) {
        entries.set(entryKey(entry), entry);
        changedProperties.add(entry.property);
      }
      if (counted) {
        focalCellsEvaluated += 1;
        if (found.length > 0) focalCellsChanged += 1;
      }
    }

    return classes;
  };

  const contextClasses = new Map<string, boolean>();
  const mergeClasses = (classes: ReadonlyMap<string, boolean>): void => {
    for (const [fingerprint, affected] of classes) {
      contextClasses.set(
        fingerprint,
        (contextClasses.get(fingerprint) ?? false) || affected
      );
    }
  };

  if (focal !== undefined && request.focalCells !== undefined) {
    mergeClasses(evaluate(focal, request.focalCells, true));
  }

  const shared = sharedDomain(baseline.world);
  const rules = request.affectedRules.map((rule) =>
    candidate.ctx.universe.ruleById(rule)
  );
  let componentsSwept = 0;

  for (const component of rt.host.identity.components()) {
    const resolution = rt.host.identity.resolveTarget(component.id);
    if (resolution === undefined) continue;
    componentsSwept += 1;

    const owns = rules.some((rule) => ownsRule(component, rule));
    const domain = owns ? scopedDomain(resolution, baseline.world) : shared;
    const harvested = harvestCuts(
      candidate.ctx,
      resolution,
      domain,
      declaredCuts,
      request.maxCells
    );
    const classes = evaluate(
      resolution,
      cellsOf(domain, harvested.cuts),
      false
    );
    if (focal === undefined) mergeClasses(classes);
  }

  const affectedContextClasses = Array.from(contextClasses.values()).filter(
    (affected) => affected
  ).length;

  return {
    entries: Array.from(entries.values()),
    cellsEvaluated,
    componentsSwept,
    truncated,
    affectedContextClasses,
    unaffectedContextClasses: contextClasses.size - affectedContextClasses,
    subjects,
    changedProperties: Array.from(changedProperties).sort(),
    focalCellsChanged,
    focalCellsEvaluated,
  };
};

export const toSemanticDiff = (sweep: SweepResult): SemanticDiff => ({
  entries: sweep.entries,
  affectedContextClasses: sweep.affectedContextClasses,
  unaffectedContextClasses: sweep.unaffectedContextClasses,
});

export const summarizeDiff = (sweep: SweepResult, label: string): string => {
  const kinds = new Map<SemanticDiffKind, number>();
  for (const entry of sweep.entries) {
    kinds.set(entry.kind, (kinds.get(entry.kind) ?? 0) + 1);
  }
  const kindList = Array.from(kinds.keys())
    .sort()
    .map((kind) => `${kind} × ${kinds.get(kind) as number}`);

  return (
    `${label} produced ${plural(
      sweep.entries.length,
      'semantic change'
    )} over ${plural(sweep.cellsEvaluated, 'scenario cell')} in ` +
    `${plural(sweep.componentsSwept, 'component')} (${listOf(kindList)}). ` +
    `${sweep.affectedContextClasses} of ${
      sweep.affectedContextClasses + sweep.unaffectedContextClasses
    } context classes changed.` +
    (sweep.truncated
      ? ' The sweep stopped at the cell budget — the report is partial.'
      : '')
  );
};

/** Interventions the candidate world carries that the baseline does not. */
export const addedInterventions = (
  baseline: RenderWorld,
  candidate: RenderWorld
): readonly WorldDelta[] => {
  const known = new Set(baseline.interventions.map(canonicalJson));
  return candidate.interventions.filter(
    (delta) => !known.has(canonicalJson(delta))
  );
};

export const affectedRulesOf = (
  deltas: readonly WorldDelta[]
): readonly RuleId[] => {
  const rules = new Set<RuleId>();
  for (const delta of deltas) {
    if (
      delta.kind === 'remove-declaration' ||
      delta.kind === 'replace-declaration' ||
      delta.kind === 'add-declaration'
    ) {
      rules.add(delta.rule);
    }
  }
  return Array.from(rules).sort();
};

/**
 * The candidate world's value for every property the sweep saw move on the
 * focal target — the load-bearing facts of a comparison, and the only ones
 * worth adding to the candidate world's graph.
 */
export const focalFacts = (
  rt: OracleRuntime,
  candidate: ComparisonSide,
  world: RenderWorld,
  resolution: TargetResolution | undefined,
  point: ScenarioPoint,
  changedProperties: readonly string[]
): readonly RenderFact[] => {
  if (resolution === undefined) return [];

  const graph = rt.graphFor(world);
  const facts: RenderFact[] = [];
  const analysis = analyzeCascade(candidate.ctx, resolution, point);

  for (const property of changedProperties) {
    const outcome = analysis.outcomes.get(property);
    if (outcome === undefined) continue;
    const built = buildWinnerFact(candidate.ctx, graph, analysis, outcome);
    if (built !== undefined) facts.push(built.fact);
  }

  return facts;
};

export const subjectsOfDeltas = (
  deltas: readonly WorldDelta[]
): readonly RenderSubject[] => {
  const subjects: RenderSubject[] = [];
  for (const delta of deltas) {
    if (
      delta.kind === 'remove-declaration' ||
      delta.kind === 'replace-declaration' ||
      delta.kind === 'add-declaration'
    ) {
      subjects.push({ kind: 'rule', rule: delta.rule });
      subjects.push({
        kind: 'declaration',
        rule: delta.rule,
        property: delta.property,
      });
    }
  }
  return subjects;
};

export interface DiffRequest {
  candidate: { world: RenderWorld } | { deltas: readonly WorldDelta[] };
  baseline?: RenderWorld;
  /** Scopes the context-class count to one component; the sweep is total. */
  target?: string;
}

export const runDiff = (
  rt: OracleRuntime,
  request: DiffRequest
): ProbeResult => {
  const baselineWorld = rt.worldOf(request.baseline);
  const candidateWorld =
    'world' in request.candidate
      ? request.candidate.world
      : applyDeltas(baselineWorld, request.candidate.deltas);

  // Build both views eagerly so a malformed delta throws here rather than
  // becoming an empty diff that reads like "nothing changed".
  const baselineView = rt.viewFor(baselineWorld);
  const candidateView = rt.viewFor(candidateWorld);
  const resolution =
    request.target === undefined ? undefined : rt.resolveTarget(request.target);

  return rt.run(
    {
      world: candidateWorld,
      ...(resolution === undefined ? {} : { target: resolution.target }),
      scope: resolution === undefined ? 'all-invocations' : 'equivalence-class',
      objective: { kind: 'diff', against: worldId(baselineWorld) },
      budget: rt.budget,
    },
    (stateId, probeWorld) => {
      const factsBefore = rt.factCount(probeWorld);
      const obligationsBefore = rt.obligationCount();

      const baseline: ComparisonSide = {
        world: baselineWorld,
        ctx: rt.contextFor(baselineWorld),
      };
      const candidate: ComparisonSide = {
        world: probeWorld,
        ctx: rt.contextFor(probeWorld),
      };
      const added = addedInterventions(baselineWorld, probeWorld);

      let focalCells: readonly ScenarioCell[] | undefined;
      if (resolution !== undefined) {
        const domain = scopedDomain(resolution, baselineWorld);
        const harvested = harvestCuts(
          candidate.ctx,
          resolution,
          domain,
          rt.host.scenarios.cuts(),
          rt.maxCells()
        );
        focalCells = cellsOf(domain, harvested.cuts);
      }

      const sweep = sweepWorlds({
        rt,
        baseline,
        candidate,
        affectedRules: affectedRulesOf(added),
        maxCells: rt.maxCells(),
        ...(resolution === undefined ? {} : { focal: resolution }),
        ...(focalCells === undefined ? {} : { focalCells }),
      });

      const facts = focalFacts(
        rt,
        candidate,
        probeWorld,
        resolution,
        focalCells?.[0]?.point ?? {},
        sweep.changedProperties
      );
      const unknowns = rt.unknownsFor(
        [...sweep.subjects, ...subjectsOfDeltas(added)],
        []
      );

      const operations: SuggestedOperation[] = [
        ...dischargeOperations(unknowns),
      ];
      if (sweep.entries.length > 0 && resolution === undefined) {
        operations.push({
          kind: 'inspect',
          description:
            'inspect the components named in the diff entries to see the ' +
            'winners behind each change',
          expectedInformationGain: 'MEDIUM',
        });
      }

      return {
        probeStateId: stateId,
        worldId: worldId(probeWorld),
        verdict: unknowns.length === 0 ? 'ESTABLISHED' : 'CONDITIONAL',
        summary: summarizeDiff(
          sweep,
          added.length === 0
            ? 'Comparing two explicitly given worlds'
            : `Comparing ${plural(added.length, 'intervention')} against ` +
                'the baseline world'
        ),
        facts,
        semanticDiff: toSemanticDiff(sweep),
        assumptions: Array.from(
          new Set([...baselineView.assumptions, ...candidateView.assumptions])
        ),
        unknowns,
        coverage: rt.coverage(
          resolution === undefined
            ? sweep.cellsEvaluated
            : cellCount(
                scopedDomain(resolution, baselineWorld),
                rt.host.scenarios.cuts()
              ),
          sweep.cellsEvaluated
        ),
        knowledgeDelta: {
          ...zeroDelta(),
          newFacts: rt.factCount(probeWorld) - factsBefore,
          newObligations: rt.obligationCount() - obligationsBefore,
        },
        nextOperations: dedupeOperations(operations),
      };
    }
  );
};
