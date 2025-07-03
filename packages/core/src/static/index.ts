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
export { cssPropertyScales } from './cssPropertyScales';
export type {
  ProjectExtractionResult,
  ProjectExtractionResults,
} from './extractFromProject';
export {
  extractFromTypeScriptProject,
  generateLayeredCSSFromProject,
} from './extractFromProject';
export type {
  ExportInfo,
  ImportInfo,
  ResolvedReference,
} from './import-resolver';
export { ImportResolver } from './import-resolver';
export type { ResolvedValue, ThemeResolutionStrategy } from './theme-resolver';
// Theme resolution
export { resolveThemeInStyles, StaticThemeResolver } from './theme-resolver';
// AST Transformation exports
export type { TransformOptions, TransformResult } from './transformer';
export { transformAnimusCode } from './transformer';
// Phase 4 exports - the bridge across the ABYSS
export { TypeScriptExtractor } from './typescript-extractor';
