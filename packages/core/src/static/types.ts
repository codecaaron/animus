/**
 * Type definitions for Animus static extraction
 * These types form the bridge between AST analysis and CSS generation
 */

export interface BaseStyles {
  [property: string]: any;
}

export interface VariantConfig {
  prop: string;
  variants: {
    [variantName: string]: BaseStyles;
  };
}

export interface StatesConfig {
  [stateName: string]: BaseStyles;
}

export interface PropConfig {
  property: string;
  scale?: string;
}

export interface PropsConfig {
  [propName: string]: PropConfig;
}

export interface ExtractedStyles {
  componentName: string;
  baseStyles?: BaseStyles;
  variants?: VariantConfig | VariantConfig[];
  states?: StatesConfig;
  groups?: string[];
  props?: PropsConfig;
}

export interface ComponentUsage {
  componentName: string;
  props: Record<string, any>;
}

export type UsageMap = Record<string, Record<string, Set<string>>>;

export interface GenerationResult {
  css: string;
  atomicClasses?: Record<string, string>;
}
