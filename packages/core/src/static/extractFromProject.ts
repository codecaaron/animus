import * as path from 'path';
import * as ts from 'typescript';
import { ComponentRegistry } from './component-registry';
import { TypeScriptExtractor } from './typescript-extractor';
import type { ExtractedStyles, UsageMap } from './types';
import type { ComponentUsageWithIdentity } from './cross-file-usage';
import { CSSGenerator, type LayeredCSS } from './generator';
import { buildUsageMap } from './usageCollector';
import { getGroupDefinitionsForComponent } from './cli/utils/groupDefinitions';

export interface ProjectExtractionResult {
  extraction: ExtractedStyles;
  filePath: string;
  usages?: ComponentUsageWithIdentity[];
}

export interface ProjectExtractionResults {
  results: ProjectExtractionResult[];
  registry: ComponentRegistry;
}

/**
 * Extract Animus components from a TypeScript project
 * This is the high-level API used by the CLI
 */
export async function extractFromTypeScriptProject(
  rootPath: string
): Promise<ProjectExtractionResults> {
  // Create TypeScript program
  const configPath = ts.findConfigFile(
    rootPath,
    ts.sys.fileExists,
    'tsconfig.json'
  );

  if (!configPath) {
    throw new Error('Could not find tsconfig.json');
  }

  // Parse tsconfig
  const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
  const { options, fileNames } = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    path.dirname(configPath)
  );

  // Create program
  const program = ts.createProgram(fileNames, options);
  
  // Initialize the component registry with the program
  const registry = new ComponentRegistry(program);
  await registry.initialize();
  
  // Create extractor for getting styles
  const extractor = new TypeScriptExtractor();
  extractor.initializeProgram(rootPath);
  
  // Collect results
  const results: ProjectExtractionResult[] = [];
  
  // Get all component files
  const componentFiles = extractor.getComponentFiles();
  
  for (const filePath of componentFiles) {
    // Extract styles from the file
    const extractedStyles = extractor.extractFromFile(filePath);
    
    for (const style of extractedStyles) {
      // Convert to the expected format
      const extraction: ExtractedStyles = {
        componentName: style.componentName,
        baseStyles: style.baseStyles,
        variants: style.variants,
        states: style.states,
        groups: style.groups,
        props: style.props,
      };
      
      // Get usage data from registry
      const component = registry.getComponent(style.identity);
      const usages = component ? 
        registry.getGlobalUsage().get(style.identity.hash)?.usages : 
        undefined;
      
      results.push({
        extraction,
        filePath,
        usages,
      });
    }
  }
  
  return {
    results,
    registry,
  };
}

/**
 * Generate layered CSS from a TypeScript project with proper cascade ordering
 * This function respects component extension hierarchy
 */
export async function generateLayeredCSSFromProject(
  rootPath: string,
  options: {
    theme?: any;
    themeResolution?: 'inline' | 'css-variable' | 'hybrid';
    atomic?: boolean;
  } = {}
): Promise<LayeredCSS> {
  // Extract components and get registry
  const { results, registry } = await extractFromTypeScriptProject(rootPath);

  // Build global usage map
  const allUsages = results.flatMap((r) => r.usages || []);
  const usageMap = buildUsageMap(allUsages);
  
  // Convert to format expected by layered generator
  const globalUsageMap: Record<string, UsageMap> = {};
  for (const [componentName, componentUsage] of Object.entries(usageMap)) {
    globalUsageMap[componentName] = { [componentName]: componentUsage };
  }

  // Collect all enabled groups from all components
  const allGroups = new Set<string>();
  for (const result of results) {
    if (result.extraction.groups) {
      result.extraction.groups.forEach(group => allGroups.add(group));
    }
  }

  // Get group definitions for all enabled groups
  const groupDefinitions = allGroups.size > 0 
    ? getGroupDefinitionsForComponent(Array.from(allGroups))
    : {};

  // Generate layered CSS
  const generator = new CSSGenerator({
    atomic: options.atomic !== false,
    themeResolution: { mode: options.themeResolution || 'hybrid' },
  });

  return generator.generateLayeredCSS(
    registry,
    groupDefinitions,
    options.theme,
    globalUsageMap
  );
}