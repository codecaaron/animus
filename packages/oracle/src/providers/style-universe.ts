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
  subject?: SelectorModel;
  ancestry?: readonly AncestorLink[];
}

export interface AncestorLink {
  raw: string;
  combinator: 'descendant' | 'child' | 'adjacent' | 'general';
  model: SelectorModel;
}

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

export interface StyleUniverse {
  rules: readonly StyleRuleRecord[];
  ruleById(id: RuleId): StyleRuleRecord | undefined;
  layerOrder: readonly string[];
  exclusions: readonly string[];
}

export interface StyleUniverseProvider {
  universe(): StyleUniverse;
}

export const ANIMUS_LAYER_ORDER: readonly string[] = [
  'anm-global',
  'anm-base',
  'anm-variants',
  'anm-compounds',
  'anm-states',
  'anm-system',
  'anm-custom',
];
