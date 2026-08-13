import type { SourceRef } from '../core/fact';
import type { RuleId } from '../core/identity';
import type { Predicate } from '../core/predicate';

export interface DeclarationRecord {
  property: string;
  value: string;
  authoredProperty?: string;
  authoredValue?: string;
  important?: boolean;
  tokenRefs?: readonly string[];
}

export interface SelectorModel {
  raw: string;
  classNames: readonly string[];
  pseudo?: readonly string[];
  attributes?: readonly string[];
  /**
   * Present only on relational selectors: the trailing compound, where the
   * styled element's classes live. Candidacy and subject pseudo-class guards
   * read it; specificity stays a property of the full selector.
   */
  subject?: SelectorModel;
  /**
   * Present only on relational selectors: the compounds before the subject,
   * outermost first. A host that declares relational rules directly (the
   * in-memory double included) must populate these the same way the animus
   * adapter does, or candidacy will silently differ between fake and adapter.
   */
  ancestry?: readonly AncestorLink[];
}

/** One pre-subject compound and its relation toward the next compound. */
export interface AncestorLink {
  raw: string;
  combinator: 'descendant' | 'child' | 'adjacent' | 'general';
  model: SelectorModel;
}

/** Where a rule came from in the authoring vocabulary (DESIGN §11). */
export interface RuleOrigin {
  component?: string;
  method?:
    | 'styles'
    | 'variant'
    | 'compound'
    | 'states'
    | 'system'
    | 'props'
    | 'global';
  variantProp?: string;
  variantOption?: string;
  compoundIndex?: number;
  state?: string;
  systemProp?: string;
  token?: string;
}

/**
 * One modeled rule.
 *
 * PRECEDENCE CONTRACT — the total order over rules is
 * `(indexOf(layer, universe.layerOrder), order)`: layer first, then `order`,
 * which is the rule's emission index *within* its layer. The order is total
 * and host-supplied precisely so cascade resolution is a lookup rather than a
 * re-implementation of CSS specificity: the host already knows the emission
 * sequence, and a rule whose layer is absent from `layerOrder` is outside the
 * modeled universe rather than implicitly last. `!important` is not part of
 * this order — it flips precedence per declaration, so engines apply it at the
 * `DeclarationRecord` level on top of the rule order.
 */
export interface StyleRuleRecord {
  id: RuleId;
  selector: SelectorModel;
  declarations: readonly DeclarationRecord[];
  condition: Predicate;
  layer: string;
  order: number;
  source?: SourceRef;
  origin?: RuleOrigin;
}

/**
 * The closed rule set the oracle reasons over. `exclusions` names the
 * influences deliberately left out (third-party stylesheets, inline runtime
 * writes, user-agent defaults …) — they feed the `OUTSIDE_MODEL` residual list
 * so an answer can say what it did *not* model instead of implying the model
 * was complete (DESIGN §4, §8).
 */
export interface StyleUniverse {
  rules: readonly StyleRuleRecord[];
  ruleById(id: RuleId): StyleRuleRecord | undefined;
  layerOrder: readonly string[];
  exclusions: readonly string[];
}

export interface StyleUniverseProvider {
  universe(): StyleUniverse;
}

/** The animus emission layers, in cascade order. */
export const ANIMUS_LAYER_ORDER: readonly string[] = [
  'anm-global',
  'anm-base',
  'anm-variants',
  'anm-compounds',
  'anm-states',
  'anm-system',
  'anm-custom',
];
