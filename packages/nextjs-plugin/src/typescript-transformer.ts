/**
 * Phase 1: TypeScript Transformer for Next.js
 * Runs during Next.js TypeScript compilation to extract Animus components
 * and build the global component registry with cascade ordering
 */

import type { ComponentRuntimeMetadata } from '@animus-ui/core/static';
import {
  extractFromTypeScriptProject,
  generateLayeredCSSFromProject,
  type ProjectExtractionResults,
} from '@animus-ui/core/static';
import * as ts from 'typescript';

import { type AnimusCacheData, writeAnimusCache } from './cache';

export interface AnimusTransformerOptions {
  rootDir?: string;
  cacheDir?: string;
  theme?: any;
  themeMode?: 'inline' | 'css-variable' | 'hybrid';
  atomic?: boolean;
  verbose?: boolean;
}

/**
 * Creates a TypeScript transformer factory for Animus static extraction
 * This runs as a custom transformer in Next.js's TypeScript compilation
 */
export function createAnimusTransformer(
  options: AnimusTransformerOptions = {}
): ts.TransformerFactory<ts.SourceFile> {
  const {
    rootDir = process.cwd(),
    cacheDir,
    theme,
    themeMode = 'hybrid',
    atomic = true,
    verbose = false,
  } = options;

  let hasRun = false;
  let extractionResults: ProjectExtractionResults | null = null;
  let componentMetadata: Record<string, ComponentRuntimeMetadata> = {};

  return (context: ts.TransformationContext) => {
    return (sourceFile: ts.SourceFile) => {
      // Only run extraction once on the first file
      if (!hasRun) {
        hasRun = true;

        if (verbose) {
          console.log(
            '[Animus] Phase 1: Starting global TypeScript analysis...'
          );
        }

        try {
          // Extract all components from the project
          extractionResults = extractFromTypeScriptProject(rootDir) as any;

          if (verbose && extractionResults) {
            console.log(
              `[Animus] Found ${extractionResults.results.length} components`
            );
          }

          // Generate layered CSS to get component metadata
          const layeredCSS = generateLayeredCSSFromProject(rootDir, {
            theme,
            themeResolution: themeMode,
            atomic,
          }) as any;

          if (layeredCSS.componentMetadata) {
            componentMetadata = layeredCSS.componentMetadata;
          }

          // Build cache data with all necessary information
          const cacheData: AnimusCacheData = {
            version: '1.0.0',
            timestamp: Date.now(),
            rootDir,
            registry: {
              components: {},
              componentsByFile: {},
              globalUsage: {},
            },
            metadata: componentMetadata,
            css: layeredCSS.fullCSS || '',
            layeredCSS: {
              cssVariables: layeredCSS.cssVariables || '',
              baseStyles: layeredCSS.baseStyles || '',
              variantStyles: layeredCSS.variantStyles || '',
              stateStyles: layeredCSS.stateStyles || '',
              atomicUtilities: layeredCSS.atomicUtilities || '',
              customPropUtilities: layeredCSS.customPropUtilities || '',
            },
          };

          // Serialize registry data from extraction results
          if (extractionResults && extractionResults.results) {
            // Build component map from results
            for (const result of extractionResults.results) {
              if (result.extraction && result.extraction.componentName) {
                const componentName = result.extraction.componentName;
                const hash = `${componentName}-${componentName.charAt(0).toLowerCase()}${componentName.length}${componentName.charAt(componentName.length - 1).toLowerCase()}`;

                cacheData.registry.components[hash] = {
                  identity: {
                    name: componentName,
                    hash,
                    filePath: result.filePath,
                    exportName: 'default',
                  },
                  filePath: result.filePath,
                  extractedStyles: result.extraction,
                  usages: result.usages || [],
                };
              }
            }

            // Build components by file map
            for (const result of extractionResults.results) {
              if (!cacheData.registry.componentsByFile[result.filePath]) {
                cacheData.registry.componentsByFile[result.filePath] = [];
              }
              if (result.extraction && result.extraction.componentName) {
                const componentName = result.extraction.componentName;
                const hash = `${componentName}-${componentName.charAt(0).toLowerCase()}${componentName.length}${componentName.charAt(componentName.length - 1).toLowerCase()}`;
                cacheData.registry.componentsByFile[result.filePath].push({
                  name: componentName,
                  hash,
                  filePath: result.filePath,
                  exportName: 'default',
                });
              }
            }

            // Build global usage map
            if (extractionResults.registry) {
              const globalUsage = extractionResults.registry.getGlobalUsage();
              for (const [hash, usage] of globalUsage) {
                cacheData.registry.globalUsage[hash] = {
                  identity: usage.identity,
                  usages: usage.usages,
                  propValueSets: Object.fromEntries(usage.propValueSets),
                };
              }
            }
          }

          // Write cache to filesystem
          writeAnimusCache(cacheData, cacheDir);

          if (verbose) {
            console.log('[Animus] Phase 1: Cache written successfully');
            console.log(
              `[Animus] Generated ${(cacheData.css.length / 1024).toFixed(2)}KB of CSS`
            );
          }
        } catch (error) {
          console.error('[Animus] Phase 1: Extraction failed:', error);
          // Continue without throwing to not break the build
        }
      }

      // Return the source file unchanged
      // The actual transformation happens in Phase 2 (webpack loader)
      return sourceFile;
    };
  };
}
