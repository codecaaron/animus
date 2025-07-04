export { extractStylesFromCode } from './extractor';
export type {
  ComponentRuntimeMetadata,
  GeneratedCSS,
  GeneratorOptions,
  LayeredCSS,
} from './generator';
export { CSSGenerator } from './generator';
// Runtime exports moved to separate runtime module
export type {
  BaseStyles,
  ComponentUsage,
  ExtractedStyles,
  GenerationResult,
  PropConfig,
  PropsConfig,
  StatesConfig,
  UsageMap,
  VariantConfig,
} from './types';

/**
 * High-level API for static extraction
 * @deprecated Use generateLayeredCSSFromProject for project-wide extraction with proper extension ordering
 */
export function extractAndGenerateCSS(code: string): {
  components: Array<{
    name?: string;
    className: string;
    css: string;
  }>;
  allCSS: string;
} {
  const { extractStylesFromCode } = require('./extractor');
  const { CSSGenerator } = require('./generator');

  const extracted = extractStylesFromCode(code);
  const generator = new CSSGenerator({ atomic: true });

  const components = extracted.map((component: any) => {
    const generated = generator.generateFromExtracted(component);
    return {
      name: component.componentName,
      className: generated.className,
      css: generated.css,
    };
  });

  const allCSS = components.map((c: any) => c.css).join('\n\n');

  return { components, allCSS };
}

// Component graph exports
export type {
  ComponentGraph as ExtractedComponentGraph,
  ComponentNode as ComponentGraphNode,
  PropDefinition,
  VariantDefinition,
} from './component-graph';
export { ComponentGraphBuilder } from './component-graph';
export type {
  ComponentIdentity,
  ComponentMetadata,
  ComponentReference,
  ExtendsReference,
  ExtractedStylesWithIdentity,
} from './component-identity';
export {
  createComponentHash,
  createComponentIdentity,
  extractComponentReferences,
  isSameComponent,
  parseExtendsReference,
} from './component-identity';
export type {
  ComponentEntry,
  RegistryEvents,
} from './component-registry';
export { ComponentRegistry } from './component-registry';
export type {
  ComponentUsageWithIdentity,
  GlobalUsageMap,
} from './cross-file-usage';
export { CrossFileUsageCollector } from './cross-file-usage';
// CSS property mappings
// Property mappings
export {
  cssPropertyAndShorthandScales,
  cssPropertyScales,
} from './cssPropertyScales';
export type {
  ProjectExtractionResult,
  ProjectExtractionResults,
} from './extractFromProject';
export {
  extractFromTypeScriptProject,
  generateLayeredCSSFromProject,
} from './extractFromProject';
export { GraphBuilder } from './graph/builder';
export { GraphSerializer as GraphSerializerImpl } from './graph/serializers/index';
// Graph building exports
export type {
  CascadeAnalysis,
  ComponentEdge,
  ComponentGraph,
  ComponentNode,
  GraphBuilder as IGraphBuilder,
  GraphOptions,
  GraphSerializer,
} from './graph/types';
// Graph cache exports
export { GraphCache } from './graph-cache';
export type {
  ExportInfo,
  ImportInfo,
  ResolvedReference,
} from './import-resolver';
export { ImportResolver } from './import-resolver';
// Reference traversal exports
export { ReferenceTraverser } from './reference-traverser';
export type { ResolvedValue, ThemeResolutionStrategy } from './theme-resolver';
// Theme resolution
export { resolveThemeInStyles, StaticThemeResolver } from './theme-resolver';
// AST Transformation exports
export type { TransformOptions, TransformResult } from './transformer';
export { transformAnimusCode } from './transformer';
// Phase 4 exports - the bridge across the ABYSS
export { TypeScriptExtractor } from './typescript-extractor';
// Usage tracking exports
export type {
  ComponentUsage as ComponentUsageInfo,
  UsageSet,
} from './usage-tracker';
export { UsageTracker } from './usage-tracker';
