/**
 * Shared cascade semantics — the one place where the modeled CSS dialect
 * is decided.
 *
 * inspect / explain / simulate / diff / prove / refine are all projections of
 * this single analysis (DESIGN §6), so every candidacy, guard-activity,
 * precedence and value-resolution decision lives here and nowhere else. The
 * dialect is deliberately smaller than CSS: class selectors, pseudo-classes as
 * scenario dimensions, attribute counts, element selectors for inheritance,
 * declared layers, and `!important`. Anything outside it becomes an assumption
 * or an obligation rather than a silently-approximated answer (DESIGN §8).
 */

import { subjectKey } from '../core/fact';
import {
  and,
  describePredicate,
  eq,
  evalPredicate,
  FALSE,
  not,
  or,
  referencedDimensions,
  TRUE,
} from '../core/predicate';
import { exact, unknownValue } from '../core/value';
import { tokenReferencesIn } from '../providers/tokens';
import { plural } from './format';

import type {
  DerivationEdge,
  FactGraph,
  RenderFact,
  RenderSubject,
  SourceRef,
} from '../core/fact';
import type { RuleId, TargetId } from '../core/identity';
import type { ObligationRegistry, UnknownObligation } from '../core/obligation';
import type { Predicate } from '../core/predicate';
import type { ScenarioDomain, ScenarioPoint } from '../core/scenario';
import type { AbstractValue } from '../core/value';
import type { DependencyProvider } from '../providers/dependency';
import type { TargetResolution } from '../providers/identity';
import type {
  DeclarationRecord,
  SelectorModel,
  StyleRuleRecord,
  StyleUniverse,
} from '../providers/style-universe';
import type { TokenProvider } from '../providers/tokens';

/**
 * Properties this phase propagates from an element-selector rule when the
 * target itself declares nothing. Deliberately tiny: a full inherited-property
 * table without a render-shape provider would be a guess about the ancestor
 * chain, and DESIGN §8 forbids that.
 */
export const INHERITABLE_PROPERTIES: readonly string[] = [
  'color',
  'font-family',
  'font-size',
  'line-height',
];

/** The layer element-selector inheritance sources are read from. */
export const GLOBAL_LAYER = 'anm-global';

/** Custom properties whose value is written at runtime, never at build time. */
const DYNAMIC_SLOT_PREFIX = '--animus-';

const PSEUDO_ELEMENT_NAMES = new Set([
  'after',
  'backdrop',
  'before',
  'first-letter',
  'first-line',
  'marker',
  'placeholder',
  'selection',
]);

export interface CascadeContext {
  universe: StyleUniverse;
  tokens: TokenProvider | undefined;
  /**
   * The world's declared axes — what "unbound in this world" is measured
   * against.
   */
  scenario: ScenarioDomain;
  obligations: ObligationRegistry;
  dependencies: DependencyProvider;
}

export interface Specificity {
  b: number;
  c: number;
}

export interface CascadeCandidate {
  rule: StyleRuleRecord;
  /** `and(rule.condition, …pseudo-class conjuncts)`. */
  guard: Predicate;
  specificity: Specificity;
  layerIndex: number;
  active: boolean;
  /** Guard dimensions the world's scenario domain does not declare at all. */
  unboundInWorld: readonly string[];
  /** Guard dimensions declared by the world but left free by the point. */
  unboundAtPoint: readonly string[];
  /** Inactive here, but satisfiable once an unbound dimension is fixed. */
  conditional: boolean;
}

export type DefeatReason =
  | 'condition-false'
  | 'lower-layer'
  | 'lower-specificity'
  | 'earlier-order'
  | 'overridden-by-important';

export interface DeclarationCandidate {
  candidate: CascadeCandidate;
  declaration: DeclarationRecord;
  index: number;
}

export interface DefeatedDeclaration {
  declaration: DeclarationCandidate;
  reason: DefeatReason;
}

export interface PropertyOutcome {
  property: string;
  winner?: DeclarationCandidate;
  defeated: readonly DefeatedDeclaration[];
}

export interface InheritedOutcome {
  property: string;
  declaration: DeclarationCandidate;
}

export interface CascadeAnalysis {
  target: TargetId;
  resolution: TargetResolution;
  point: ScenarioPoint;
  classes: readonly string[];
  candidates: readonly CascadeCandidate[];
  pseudoElementRules: readonly {
    rule: StyleRuleRecord;
    pseudoElement: string;
  }[];
  outcomes: ReadonlyMap<string, PropertyOutcome>;
  inherited: ReadonlyMap<string, InheritedOutcome>;
  assumptions: readonly string[];
  layersTouched: readonly string[];
}

export interface ResolvedValue {
  value: AbstractValue<string>;
  derivation: readonly DerivationEdge[];
  assumptions: readonly string[];
  raised: readonly UnknownObligation[];
  tokenChains: readonly (readonly string[])[];
}

export const styleTargetSubject = (target: TargetId): RenderSubject => ({
  kind: 'style-target',
  target,
});

export const declarationSubject = (
  rule: RuleId,
  property: string
): RenderSubject => ({ kind: 'declaration', rule, property });

export const pointGuard = (point: ScenarioPoint): Predicate =>
  and(
    ...Object.keys(point)
      .sort()
      .map((dim) => eq(dim, point[dim]))
  );

/**
 * Drop everything the point already decides.
 *
 * A leaf whose dimension the point binds is replaced by its truth value; the
 * rest survives, so the residual guard states exactly the conditions the point
 * left open. A fully-decided guard collapses to TRUE, which is what makes a
 * point-scoped fact read as unconditional *at that point*.
 */
export const simplifyAtPoint = (
  p: Predicate,
  point: ScenarioPoint
): Predicate => {
  switch (p.kind) {
    case 'true':
    case 'false':
      return p;
    case 'eq':
    case 'in':
    case 'range':
      if (!Object.hasOwn(point, p.dim)) return p;
      return evalPredicate(p, point) ? TRUE : FALSE;
    case 'and':
      return and(...p.operands.map((o) => simplifyAtPoint(o, point)));
    case 'or':
      return or(...p.operands.map((o) => simplifyAtPoint(o, point)));
    case 'not':
      return not(simplifyAtPoint(p.operand, point));
  }
};

interface PseudoParts {
  classes: readonly string[];
  elements: readonly string[];
}

const splitPseudo = (selector: SelectorModel): PseudoParts => {
  const classes: string[] = [];
  const elements: string[] = [];
  for (const raw of selector.pseudo ?? []) {
    const elementSyntax = raw.startsWith('::');
    const name = raw.replace(/^::?/, '');
    if (elementSyntax || PSEUDO_ELEMENT_NAMES.has(name)) elements.push(name);
    else classes.push(name);
  }
  return { classes, elements };
};

/**
 * Element (type) selectors in the raw selector text.
 *
 * The modeled dialect has no ids, so specificity is the pair (b, c): b counts
 * classes, pseudo-classes and attribute selectors, c counts elements. Attribute
 * and pseudo fragments are stripped before the scan so `div[data-x]:hover`
 * counts one element, and `*` — which contributes nothing in CSS — is
 * ignored because it does not start with an identifier character.
 */
const countElementSelectors = (raw: string): number => {
  const withoutAttributes = raw.replace(/\[[^\]]*\]/g, '');
  const withoutPseudo = withoutAttributes.replace(
    /::?[A-Za-z][A-Za-z0-9-]*(\([^)]*\))?/g,
    ''
  );
  return withoutPseudo
    .split(/[\s>+~,]+/)
    .filter((token) => token.length > 0)
    .filter((token) => /^[A-Za-z]/.test(token)).length;
};

export const specificityOf = (selector: SelectorModel): Specificity => {
  const pseudo = splitPseudo(selector);
  return {
    b:
      selector.classNames.length +
      pseudo.classes.length +
      (selector.attributes?.length ?? 0),
    c: countElementSelectors(selector.raw),
  };
};

/**
 * The compound whose classes and pseudo-classes belong to the styled element
 * itself: the subject of a relational selector, the whole selector otherwise.
 */
const subjectOf = (selector: SelectorModel): SelectorModel =>
  selector.subject ?? selector;

/**
 * The guard a rule really applies under: its declared condition plus one
 * `pseudo:<name> = true` conjunct per *subject* pseudo-class. Modelling
 * pseudo-classes as scenario dimensions is what lets `prove` quantify over
 * `:hover` instead of ignoring it. An ancestor's pseudo-class never lands
 * here — it lives inside the rule's `ancestor:*` condition, because
 * attributing an ancestor's interaction state to the subject would let a
 * subject-hover scenario activate a rule the tree cannot match.
 */
export const effectiveGuard = (rule: StyleRuleRecord): Predicate =>
  and(
    rule.condition,
    ...splitPseudo(subjectOf(rule.selector)).classes.map((name) =>
      eq(`pseudo:${name}`, true)
    )
  );

export const pseudoElementOf = (rule: StyleRuleRecord): string | undefined =>
  splitPseudo(subjectOf(rule.selector)).elements[0];

/**
 * Candidacy is purely structural: every class the *subject* compound names
 * must be on the target at this point — an ancestor's classes live on other
 * elements, so requiring them here made every `.group:hover .x` rule silently
 * vanish from the cascade. Element-selector rules (no classes) are not
 * candidates for the element's own cascade — they enter only through the
 * inheritance step.
 */
export const isCandidateSelector = (
  rule: StyleRuleRecord,
  classes: ReadonlySet<string>
): boolean => {
  const subject = subjectOf(rule.selector);
  return (
    subject.classNames.length > 0 &&
    subject.classNames.every((name) => classes.has(name))
  );
};

const orderKey = (declaration: DeclarationCandidate): readonly number[] => {
  const important = declaration.declaration.important === true;
  const { candidate } = declaration;
  return [
    important ? 1 : 0,
    // Non-important: a later layer wins. Important: the layer order reverses,
    // so the *earlier* layer wins — expressed as the negated layer index so a
    // single "largest key wins" comparison covers both halves of the cascade.
    important ? -candidate.layerIndex : candidate.layerIndex,
    candidate.specificity.b,
    candidate.specificity.c,
    candidate.rule.order,
    declaration.index,
  ];
};

const compareKeys = (a: readonly number[], b: readonly number[]): number => {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
};

/**
 * The CSS-correct total order for one property, largest key wins:
 *
 * 1. `!important` beats non-important.
 * 2. Non-important: later layer → higher specificity → later rule order →
 *    later declaration index.
 * 3. Important: the layer comparison is negated (earlier layer wins), the rest
 *    is unchanged.
 */
export const winnerOf = (
  declarations: readonly DeclarationCandidate[]
): DeclarationCandidate | undefined => {
  let best: DeclarationCandidate | undefined;
  let bestKey: readonly number[] | undefined;
  for (const declaration of declarations) {
    const key = orderKey(declaration);
    if (bestKey === undefined || compareKeys(key, bestKey) > 0) {
      best = declaration;
      bestKey = key;
    }
  }
  return best;
};

export const defeatReasonFor = (
  winner: DeclarationCandidate,
  loser: DeclarationCandidate
): DefeatReason => {
  if (!loser.candidate.active) return 'condition-false';
  const w = orderKey(winner);
  const l = orderKey(loser);
  if (w[0] !== l[0]) return 'overridden-by-important';
  if (w[1] !== l[1]) return 'lower-layer';
  if (w[2] !== l[2] || w[3] !== l[3]) return 'lower-specificity';
  return 'earlier-order';
};

export const describeDefeat = (defeated: DefeatedDeclaration): string =>
  `${defeated.declaration.candidate.rule.id} declared ` +
  `${defeated.declaration.declaration.property}: ` +
  `${defeated.declaration.declaration.value} — ${defeated.reason}`;

export const describeOrigin = (rule: StyleRuleRecord): string => {
  const origin = rule.origin;
  if (origin === undefined) return `rule ${rule.id} in layer ${rule.layer}`;

  const parts: string[] = [];
  if (origin.component !== undefined) parts.push(origin.component);
  if (origin.method !== undefined) parts.push(origin.method);
  if (origin.variantProp !== undefined) {
    parts.push(`${origin.variantProp}=${origin.variantOption ?? '?'}`);
  }
  if (origin.state !== undefined) parts.push(`state ${origin.state}`);
  if (origin.systemProp !== undefined) parts.push(`prop ${origin.systemProp}`);
  if (origin.token !== undefined) parts.push(`token ${origin.token}`);
  return parts.length === 0 ? `rule ${rule.id}` : parts.join(' · ');
};

const authoredNote = (declaration: DeclarationRecord): string | undefined => {
  if (
    declaration.authoredProperty === undefined &&
    declaration.authoredValue === undefined
  ) {
    return undefined;
  }
  const property = declaration.authoredProperty ?? declaration.property;
  const value = declaration.authoredValue ?? declaration.value;
  return `authored as ${property}: ${value}`;
};

export const provenanceOf = (
  declaration: DeclarationCandidate
): readonly SourceRef[] => {
  const refs: SourceRef[] = [];
  const source = declaration.candidate.rule.source;
  if (source !== undefined) refs.push(source);

  const note = authoredNote(declaration.declaration);
  if (note !== undefined) {
    refs.push({
      file: source?.file ?? `rule:${declaration.candidate.rule.id}`,
      note,
    });
  }
  return refs;
};

/**
 * Replace every `var(--x[, fallback])` with the looked-up value.
 *
 * The declared fallback is deliberately *not* used when the lookup fails: an
 * unmodeled custom property might well be defined at runtime, so substituting
 * the fallback would be a guess. The caller turns `undefined` into an
 * obligation instead (DESIGN §4).
 */
const substituteVariables = (
  value: string,
  lookup: (name: string) => string | undefined
): string | undefined => {
  let out = '';
  let cursor = 0;

  while (cursor < value.length) {
    const start = value.indexOf('var(', cursor);
    if (start === -1) {
      out += value.slice(cursor);
      return out;
    }
    out += value.slice(cursor, start);

    let depth = 0;
    let end = -1;
    for (let index = start + 3; index < value.length; index += 1) {
      if (value[index] === '(') depth += 1;
      else if (value[index] === ')') {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    if (end === -1) return undefined;

    const inner = value.slice(start + 4, end);
    const comma = inner.indexOf(',');
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    const resolved = lookup(name);
    if (resolved === undefined) return undefined;

    out += resolved;
    cursor = end + 1;
  }

  return out;
};

/**
 * Per-registry memo for engine-raised obligations. The content is fully
 * determined by (rule, property, procedure, reason), but `register` pays a
 * content hash over the guard tree and dependency list every call — a cost
 * that otherwise repeats for the same unresolved declaration at every cell of
 * every sweep.
 */
const raisedObligations = new WeakMap<
  ObligationRegistry,
  Map<string, UnknownObligation>
>();

const raiseDynamicValue = (
  ctx: CascadeContext,
  declaration: DeclarationCandidate,
  reason: string,
  procedure: 'partial-evaluation' | 'context-capsule-measurement'
): UnknownObligation => {
  const rule = declaration.candidate.rule;
  const memo =
    raisedObligations.get(ctx.obligations) ??
    new Map<string, UnknownObligation>();
  raisedObligations.set(ctx.obligations, memo);
  const key = `${rule.id}|${declaration.declaration.property}|${procedure}|${reason}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  const registered = raiseDynamicValueUncached(
    ctx,
    declaration,
    reason,
    procedure
  );
  memo.set(key, registered);
  return registered;
};

const raiseDynamicValueUncached = (
  ctx: CascadeContext,
  declaration: DeclarationCandidate,
  reason: string,
  procedure: 'partial-evaluation' | 'context-capsule-measurement'
): UnknownObligation => {
  const rule = declaration.candidate.rule;
  return ctx.obligations.register({
    origin: rule.source ?? { file: `rule:${rule.id}` },
    guard: declaration.candidate.guard,
    effectClass: 'dynamic-value',
    // Property-precise on purpose: scoping an engine-raised unknown to the
    // whole target would make every later answer about *any* property of that
    // target CONDITIONAL, and would do so depending on which probe ran first.
    // A host that means "this gap affects the whole component" says so itself.
    influenceScope: [
      declarationSubject(rule.id, declaration.declaration.property),
    ],
    reason,
    dischargeOptions: [
      {
        kind: procedure,
        description:
          procedure === 'partial-evaluation'
            ? 'model the missing custom property in the token provider'
            : 'measure the computed value in a browser context capsule',
        automated: false,
      },
    ],
    dependencies: ctx.dependencies.dependenciesOfRule(rule.id),
  });
};

/**
 * Turn a declaration's authored string into an abstract value.
 *
 * `var()` chains resolve through the token provider under the point's mode;
 * every other outcome is explicit — a runtime slot variable, an unmodeled
 * custom property and a malformed expression all become addressable unknowns,
 * and a missing token provider leaves the raw text in place under a stated
 * assumption. Nothing here ever invents a value.
 */
export const resolveDeclarationValue = (
  ctx: CascadeContext,
  point: ScenarioPoint,
  declaration: DeclarationCandidate
): ResolvedValue => {
  const raw = declaration.declaration.value;
  const references = tokenReferencesIn(raw);

  if (references.length === 0) {
    return {
      value: exact(raw),
      derivation: [],
      assumptions: [],
      raised: [],
      tokenChains: [],
    };
  }

  const dynamic = references.filter((name) =>
    name.startsWith(DYNAMIC_SLOT_PREFIX)
  );
  if (dynamic.length > 0) {
    const obligation = raiseDynamicValue(
      ctx,
      declaration,
      `${declaration.declaration.property} reads the runtime slot ` +
        `${dynamic.join(', ')} — its value is written by the runtime, ` +
        'not by the closed style universe',
      'context-capsule-measurement'
    );
    return {
      value: unknownValue(obligation.id),
      derivation: dynamic.map((name) => ({
        kind: 'derived-from' as const,
        ref: `token:${name}`,
        note: 'dynamic slot variable',
      })),
      assumptions: [],
      raised: [obligation],
      tokenChains: [],
    };
  }

  const tokens = ctx.tokens;
  if (tokens === undefined) {
    return {
      value: exact(raw),
      derivation: references.map((name) => ({
        kind: 'derived-from' as const,
        ref: `token:${name}`,
        note: 'unresolved — no token provider is configured',
      })),
      assumptions: [
        'no token provider is configured — ' +
          `${declaration.declaration.property} is reported as '${raw}' with ` +
          'its var() references intact',
      ],
      raised: [],
      tokenChains: [],
    };
  }

  const bound = point['mode'];
  const mode = typeof bound === 'string' ? bound : tokens.defaultMode();
  const assumptions =
    typeof bound === 'string'
      ? []
      : [
          `mode is unbound at this point — token values resolved under the ` +
            `default mode '${mode}'`,
        ];

  const resolutions = new Map<string, string>();
  const chains: (readonly string[])[] = [];
  for (const name of references) {
    const resolution = tokens.resolve(name, mode);
    if (resolution === undefined) {
      const obligation = raiseDynamicValue(
        ctx,
        declaration,
        `custom property ${name} is not modeled by the token provider under ` +
          `mode '${mode}' — ${declaration.declaration.property} cannot be ` +
          'resolved to a terminal value',
        'partial-evaluation'
      );
      return {
        value: unknownValue(obligation.id),
        derivation: [
          { kind: 'derived-from', ref: `token:${name}`, note: 'unresolvable' },
        ],
        assumptions,
        raised: [obligation],
        tokenChains: chains,
      };
    }
    resolutions.set(name, resolution.value);
    chains.push(resolution.chain);
  }

  const substituted = substituteVariables(raw, (name) => resolutions.get(name));
  if (substituted === undefined) {
    const obligation = raiseDynamicValue(
      ctx,
      declaration,
      `the value '${raw}' is not a var() expression this model can rewrite`,
      'partial-evaluation'
    );
    return {
      value: unknownValue(obligation.id),
      derivation: [],
      assumptions,
      raised: [obligation],
      tokenChains: chains,
    };
  }

  return {
    value: exact(substituted),
    derivation: references.map((name, index) => ({
      kind: 'derived-from' as const,
      ref: `token:${name}`,
      note: `${chains[index].join(' → ')} = ${
        resolutions.get(name) ?? ''
      } under mode '${mode}'`,
    })),
    assumptions,
    raised: [],
    tokenChains: chains,
  };
};

/** Everything about a rule that no scenario point can change. */
interface RuleStatics {
  guard: Predicate;
  dims: readonly string[];
  specificity: Specificity;
  pseudoElement?: string;
  layerIndex: number;
  /** Index in `universe.rules` — candidate enumeration order. */
  position: number;
}

interface UniverseIndex {
  statics: Map<RuleId, RuleStatics>;
  /**
   * Class-selector rules keyed by their FIRST class name. Candidacy requires
   * every named class on the target, so a candidate is always discoverable
   * through its first class alone — one bucket per rule, no dedupe needed.
   */
  byFirstClass: Map<string, readonly StyleRuleRecord[]>;
  /** Class-less rules in the global layer — the inheritance sources. */
  globalRules: readonly StyleRuleRecord[];
}

const universeIndexes = new WeakMap<StyleUniverse, UniverseIndex>();

/**
 * Rule-invariant work (guard construction, selector specificity, layer
 * lookup) is paid once per universe here instead of once per rule per cell —
 * it dominated the per-cell cost of `analyzeCascade` otherwise. Universes are
 * immutable; speculation builds a fresh one, which simply gets its own index.
 */
const indexOfUniverse = (universe: StyleUniverse): UniverseIndex => {
  const cached = universeIndexes.get(universe);
  if (cached !== undefined) return cached;

  const statics = new Map<RuleId, RuleStatics>();
  const byFirstClass = new Map<string, StyleRuleRecord[]>();
  const globalRules: StyleRuleRecord[] = [];

  universe.rules.forEach((rule, position) => {
    const guard = effectiveGuard(rule);
    statics.set(rule.id, {
      guard,
      dims: referencedDimensions(guard),
      specificity: specificityOf(rule.selector),
      pseudoElement: pseudoElementOf(rule),
      layerIndex: universe.layerOrder.indexOf(rule.layer),
      position,
    });

    // Keyed by the subject compound's first class — the same compound
    // candidacy tests — so a relational rule is discoverable from the classes
    // the target actually carries, not from an ancestor's class.
    const first = (rule.selector.subject ?? rule.selector).classNames[0];
    if (first !== undefined) {
      const bucket = byFirstClass.get(first) ?? [];
      bucket.push(rule);
      byFirstClass.set(first, bucket);
    } else if (rule.layer === GLOBAL_LAYER) {
      globalRules.push(rule);
    }
  });

  const built: UniverseIndex = { statics, byFirstClass, globalRules };
  universeIndexes.set(universe, built);
  return built;
};

const staticsOf = (
  universe: StyleUniverse,
  rule: StyleRuleRecord
): RuleStatics => indexOfUniverse(universe).statics.get(rule.id) as RuleStatics;

const buildCandidate = (
  ctx: CascadeContext,
  rule: StyleRuleRecord,
  layerIndex: number,
  point: ScenarioPoint
): CascadeCandidate => {
  const { guard, dims, specificity } = staticsOf(ctx.universe, rule);
  const unboundInWorld = dims.filter(
    (dim) => !Object.hasOwn(ctx.scenario, dim)
  );
  const unboundAtPoint = dims.filter(
    (dim) => !Object.hasOwn(point, dim) && Object.hasOwn(ctx.scenario, dim)
  );
  const active = evalPredicate(guard, point);

  return {
    rule,
    guard,
    specificity,
    layerIndex,
    active,
    unboundInWorld,
    unboundAtPoint,
    conditional: !active && unboundInWorld.length + unboundAtPoint.length > 0,
  };
};

const declarationsOf = (
  candidates: readonly CascadeCandidate[]
): Map<string, DeclarationCandidate[]> => {
  const byProperty = new Map<string, DeclarationCandidate[]>();
  for (const candidate of candidates) {
    candidate.rule.declarations.forEach((declaration, index) => {
      const bucket = byProperty.get(declaration.property) ?? [];
      bucket.push({ candidate, declaration, index });
      byProperty.set(declaration.property, bucket);
    });
  }
  return byProperty;
};

const outcomeFor = (
  property: string,
  declarations: readonly DeclarationCandidate[]
): PropertyOutcome => {
  const active = declarations.filter(
    (declaration) => declaration.candidate.active
  );
  const winner = winnerOf(active);
  if (winner === undefined) {
    return {
      property,
      defeated: declarations.map((declaration) => ({
        declaration,
        reason: 'condition-false' as const,
      })),
    };
  }

  return {
    property,
    winner,
    defeated: declarations
      .filter((declaration) => declaration !== winner)
      .map((declaration) => ({
        declaration,
        reason: defeatReasonFor(winner, declaration),
      })),
  };
};

const inheritanceFor = (
  ctx: CascadeContext,
  point: ScenarioPoint,
  outcomes: ReadonlyMap<string, PropertyOutcome>
): Map<string, InheritedOutcome> => {
  const inherited = new Map<string, InheritedOutcome>();

  const globals = indexOfUniverse(ctx.universe)
    .globalRules.map((rule) =>
      buildCandidate(ctx, rule, staticsOf(ctx.universe, rule).layerIndex, point)
    )
    .filter((candidate) => candidate.active);

  if (globals.length === 0) return inherited;

  const byProperty = declarationsOf(globals);
  for (const property of INHERITABLE_PROPERTIES) {
    if (outcomes.get(property)?.winner !== undefined) continue;
    const declarations = byProperty.get(property);
    if (declarations === undefined) continue;
    const winner = winnerOf(declarations);
    if (winner === undefined) continue;
    inherited.set(property, { property, declaration: winner });
  }

  return inherited;
};

/**
 * The whole cascade at one point: which rules are candidates, which of them are
 * active, who wins each property and why the others lost.
 *
 * Everything that could not be decided is surfaced, never dropped: rules in a
 * layer the universe does not order are excluded with an assumption,
 * pseudo-element rules are split off into their own subject, and candidates
 * guarded by an axis this world never declared are reported as
 * conditionally-inactive rather than silently failing their guard.
 */
export const analyzeCascade = (
  ctx: CascadeContext,
  resolution: TargetResolution,
  point: ScenarioPoint
): CascadeAnalysis => {
  const classes = resolution.classes(point);
  const classSet = new Set(classes);
  const assumptions: string[] = [];

  const candidates: CascadeCandidate[] = [];
  const pseudoElementRules: { rule: StyleRuleRecord; pseudoElement: string }[] =
    [];

  // Candidates come off the first-class index instead of a full-universe
  // scan, then re-sorted into universe order so every downstream sequence
  // (defeats, facts, summaries) is unchanged.
  const index = indexOfUniverse(ctx.universe);
  const gathered: StyleRuleRecord[] = [];
  for (const className of classSet) {
    for (const rule of index.byFirstClass.get(className) ?? []) {
      if (isCandidateSelector(rule, classSet)) gathered.push(rule);
    }
  }
  gathered.sort(
    (a, b) =>
      staticsOf(ctx.universe, a).position - staticsOf(ctx.universe, b).position
  );

  for (const rule of gathered) {
    const statics = staticsOf(ctx.universe, rule);
    if (statics.layerIndex === -1) {
      assumptions.push(
        `rule ${rule.id} is emitted into layer '${rule.layer}', which the ` +
          'universe does not order — excluded as outside the modeled cascade'
      );
      continue;
    }

    if (statics.pseudoElement !== undefined) {
      pseudoElementRules.push({ rule, pseudoElement: statics.pseudoElement });
      continue;
    }

    candidates.push(buildCandidate(ctx, rule, statics.layerIndex, point));
  }

  const byProperty = declarationsOf(candidates);
  const outcomes = new Map<string, PropertyOutcome>();
  for (const property of Array.from(byProperty.keys()).sort()) {
    outcomes.set(
      property,
      outcomeFor(property, byProperty.get(property) as DeclarationCandidate[])
    );
  }

  const unboundCounts = new Map<string, number>();
  for (const candidate of candidates) {
    for (const dim of candidate.unboundInWorld) {
      unboundCounts.set(dim, (unboundCounts.get(dim) ?? 0) + 1);
    }
  }
  for (const dim of Array.from(unboundCounts.keys()).sort()) {
    assumptions.push(
      `${plural(unboundCounts.get(dim) as number, 'rule')} guarded by ` +
        `${dim} — dimension unbound in this world`
    );
  }

  for (const entry of pseudoElementRules) {
    assumptions.push(
      `rule ${entry.rule.id} targets the ::${entry.pseudoElement} ` +
        "pseudo-element — a distinct subject, excluded from this element's " +
        'own cascade'
    );
  }

  const layersTouched = Array.from(
    new Set(candidates.map((candidate) => candidate.rule.layer))
  ).sort(
    (a, b) =>
      ctx.universe.layerOrder.indexOf(a) - ctx.universe.layerOrder.indexOf(b)
  );

  return {
    target: resolution.target,
    resolution,
    point,
    classes,
    candidates,
    pseudoElementRules,
    outcomes,
    inherited: inheritanceFor(ctx, point, outcomes),
    assumptions,
    layersTouched,
  };
};

/**
 * The candidate rules at one point with their guards — the cheap slice of
 * `analyzeCascade` that cut harvesting needs. Same candidacy and the same
 * exclusions (unordered layers, pseudo-element subjects), but no outcomes,
 * no inheritance and no value resolution.
 */
export const candidateGuardsAt = (
  ctx: CascadeContext,
  resolution: TargetResolution,
  point: ScenarioPoint
): readonly { rule: StyleRuleRecord; guard: Predicate }[] => {
  const classSet = new Set(resolution.classes(point));
  const index = indexOfUniverse(ctx.universe);
  const guards: { rule: StyleRuleRecord; guard: Predicate }[] = [];
  for (const className of classSet) {
    for (const rule of index.byFirstClass.get(className) ?? []) {
      if (!isCandidateSelector(rule, classSet)) continue;
      const statics = staticsOf(ctx.universe, rule);
      if (statics.layerIndex === -1 || statics.pseudoElement !== undefined) {
        continue;
      }
      guards.push({ rule, guard: statics.guard });
    }
  }
  return guards;
};

export const activeCandidates = (
  analysis: CascadeAnalysis
): readonly CascadeCandidate[] =>
  analysis.candidates.filter((candidate) => candidate.active);

export const conditionalCandidates = (
  analysis: CascadeAnalysis
): readonly CascadeCandidate[] =>
  analysis.candidates.filter((candidate) => candidate.conditional);

export const activeRuleIds = (analysis: CascadeAnalysis): readonly RuleId[] =>
  activeCandidates(analysis)
    .map((candidate) => candidate.rule.id)
    .sort();

export interface BuiltFact {
  fact: RenderFact;
  resolved: ResolvedValue;
}

/**
 * The winning declaration as a fact.
 *
 * The guard is the winning rule's effective guard simplified at the point (so
 * it states only what the point left open) conjoined with `contextGuard`, which
 * is how a forked branch records the value it was pinned under. Derivation
 * carries the origin rule, the guard, the token chain and one `defeats` edge
 * per beaten declaration — that edge set is exactly what `explain` walks
 * backward.
 */
export const buildWinnerFact = (
  ctx: CascadeContext,
  graph: FactGraph,
  analysis: CascadeAnalysis,
  outcome: PropertyOutcome,
  contextGuard: Predicate = TRUE
): BuiltFact | undefined => {
  const winner = outcome.winner;
  if (winner === undefined) return undefined;

  const resolved = resolveDeclarationValue(ctx, analysis.point, winner);

  const derivation: DerivationEdge[] = [
    {
      kind: 'origin',
      ref: winner.candidate.rule.id,
      note: describeOrigin(winner.candidate.rule),
    },
    {
      kind: 'guarded-by',
      ref: `guard:${describePredicate(winner.candidate.guard)}`,
    },
    ...resolved.derivation,
    ...outcome.defeated.map((defeated) => ({
      kind: 'defeats' as const,
      ref: `${defeated.declaration.candidate.rule.id}#${outcome.property}`,
      note: describeDefeat(defeated),
    })),
  ];

  const fact = graph.add({
    subject: styleTargetSubject(analysis.target),
    property: outcome.property,
    value: resolved.value,
    guard: and(
      contextGuard,
      simplifyAtPoint(winner.candidate.guard, analysis.point)
    ),
    authority: { kind: 'static-proof' },
    derivation,
    dependencies: ctx.dependencies.dependenciesOfRule(winner.candidate.rule.id),
    provenance: provenanceOf(winner),
  });

  return { fact, resolved };
};

export const buildInheritedFact = (
  ctx: CascadeContext,
  graph: FactGraph,
  analysis: CascadeAnalysis,
  inherited: InheritedOutcome,
  contextGuard: Predicate = TRUE
): BuiltFact => {
  const resolved = resolveDeclarationValue(
    ctx,
    analysis.point,
    inherited.declaration
  );
  const rule = inherited.declaration.candidate.rule;

  const fact = graph.add({
    subject: styleTargetSubject(analysis.target),
    property: inherited.property,
    value: resolved.value,
    guard: and(
      contextGuard,
      simplifyAtPoint(inherited.declaration.candidate.guard, analysis.point)
    ),
    authority: { kind: 'static-proof' },
    derivation: [
      {
        kind: 'inherited-from',
        ref: rule.id,
        note:
          `no rule on the target declares ${inherited.property}; inherited ` +
          `from '${rule.selector.raw}' in layer ${rule.layer}`,
      },
      ...resolved.derivation,
    ],
    dependencies: ctx.dependencies.dependenciesOfRule(rule.id),
    provenance: provenanceOf(inherited.declaration),
  });

  return { fact, resolved };
};

/**
 * A declaration that is inactive here but would apply once an unbound axis is
 * fixed, recorded as a fact about the *declaration* rather than the target —
 * the target's value under that binding is a separate question `simulate` or a
 * fork answers.
 */
export const buildConditionalFact = (
  ctx: CascadeContext,
  graph: FactGraph,
  analysis: CascadeAnalysis,
  declaration: DeclarationCandidate
): RenderFact => {
  const rule = declaration.candidate.rule;
  return graph.add({
    subject: declarationSubject(rule.id, declaration.declaration.property),
    property: declaration.declaration.property,
    value: exact(declaration.declaration.value),
    guard: simplifyAtPoint(declaration.candidate.guard, analysis.point),
    authority: { kind: 'static-proof' },
    derivation: [
      {
        kind: 'origin',
        ref: rule.id,
        note: `${describeOrigin(rule)} — conditionally-inactive at this point`,
      },
    ],
    dependencies: ctx.dependencies.dependenciesOfRule(rule.id),
    provenance: provenanceOf(declaration),
  });
};

export const buildDefeatedFact = (
  ctx: CascadeContext,
  graph: FactGraph,
  analysis: CascadeAnalysis,
  winner: DeclarationCandidate,
  defeated: DefeatedDeclaration
): RenderFact => {
  const rule = defeated.declaration.candidate.rule;
  return graph.add({
    subject: declarationSubject(
      rule.id,
      defeated.declaration.declaration.property
    ),
    property: defeated.declaration.declaration.property,
    value: exact(defeated.declaration.declaration.value),
    guard: simplifyAtPoint(
      defeated.declaration.candidate.guard,
      analysis.point
    ),
    authority: { kind: 'static-proof' },
    derivation: [
      { kind: 'origin', ref: rule.id, note: describeOrigin(rule) },
      {
        kind: 'defeated-by',
        ref: winner.candidate.rule.id,
        note: describeDefeat(defeated),
      },
    ],
    dependencies: ctx.dependencies.dependenciesOfRule(rule.id),
    provenance: provenanceOf(defeated.declaration),
  });
};

/** The guard conjuncts a point makes false, in describe form. */
export const failingConjuncts = (
  guard: Predicate,
  point: ScenarioPoint
): readonly string[] => {
  const operands = guard.kind === 'and' ? guard.operands : [guard];
  return operands
    .filter((operand) => !evalPredicate(operand, point))
    .map(describePredicate);
};

/**
 * The subjects one property's answer rests on — the target, and every rule
 * and declaration that competed for it. Narrowing the subject list is what
 * keeps an obligation about a *different* property from making an answer
 * CONDITIONAL.
 */
/**
 * The subjects whose obligations can make this answer CONDITIONAL: the target
 * itself, then per candidate its rule and declaration subjects — every
 * declaration when no property is given, only the declarations of `property`
 * (and only rules that declare it) when one is.
 */
export const subjectsOf = (
  analysis: CascadeAnalysis,
  property?: string
): readonly RenderSubject[] => {
  const subjects: RenderSubject[] = [styleTargetSubject(analysis.target)];
  const seen = new Set<string>(subjects.map(subjectKey));
  const push = (subject: RenderSubject): void => {
    if (seen.has(subjectKey(subject))) return;
    seen.add(subjectKey(subject));
    subjects.push(subject);
  };

  for (const candidate of analysis.candidates) {
    if (property !== undefined) {
      const declares = candidate.rule.declarations.some(
        (declaration) => declaration.property === property
      );
      if (!declares) continue;
      push({ kind: 'rule', rule: candidate.rule.id });
      push(declarationSubject(candidate.rule.id, property));
      continue;
    }

    push({ kind: 'rule', rule: candidate.rule.id });
    for (const declaration of candidate.rule.declarations) {
      push(declarationSubject(candidate.rule.id, declaration.property));
    }
  }

  return subjects;
};

export const subjectsForProperty = (
  analysis: CascadeAnalysis,
  property: string
): readonly RenderSubject[] => subjectsOf(analysis, property);
