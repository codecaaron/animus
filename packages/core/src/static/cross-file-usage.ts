import type ts from 'typescript';

import { ComponentIdentity, isSameComponent } from './component-identity';
import { ImportResolver } from './import-resolver';
import type { ComponentUsage, UsageMap } from './types';
import { buildUsageMap, extractComponentUsage } from './usageCollector';

/**
 * Enhanced component usage with resolved identity
 */
export interface ComponentUsageWithIdentity extends ComponentUsage {
  identity: ComponentIdentity;
  usageLocation: string; // file where this usage occurs
}

/**
 * Global usage map keyed by component identity hash
 */
export type GlobalUsageMap = Map<
  string,
  {
    identity: ComponentIdentity;
    usages: ComponentUsageWithIdentity[];
    propValueSets: Map<string, Set<string>>; // prop -> Set of "value:breakpoint"
  }
>;

/**
 * Cross-File Usage Collector - Sees component usage across the entire project
 * Enhances existing usage collection with identity resolution
 */
export class CrossFileUsageCollector {
  private resolver: ImportResolver;
  private fileCache = new Map<string, ComponentUsageWithIdentity[]>();

  constructor(
    private program: ts.Program,
    resolver?: ImportResolver
  ) {
    this.resolver = resolver || new ImportResolver(program);
  }

  /**
   * Collect usage from a single file with identity resolution
   */
  collectFromFile(filePath: string): ComponentUsageWithIdentity[] {
    // Check cache first
    const cached = this.fileCache.get(filePath);
    if (cached) return cached;

    const sourceFile = this.program.getSourceFile(filePath);
    if (!sourceFile) return [];

    const code = sourceFile.getText();

    // Use existing usage collector
    const basicUsages = extractComponentUsage(code);

    // Enhance with resolved identities
    const enhancedUsages: ComponentUsageWithIdentity[] = [];

    for (const usage of basicUsages) {
      const identity = this.resolver.resolveImport(
        usage.componentName,
        filePath
      );

      if (identity) {
        enhancedUsages.push({
          ...usage,
          identity,
          usageLocation: filePath,
        });
      } else {
        // Component not found through imports - might be a local component
        // or a non-Animus component (like HTML elements)
        // Skip for now, but could enhance to handle local components
      }
    }

    this.fileCache.set(filePath, enhancedUsages);
    return enhancedUsages;
  }

  /**
   * Collect usage from all files in the program
   */
  collectFromProgram(): GlobalUsageMap {
    const globalMap: GlobalUsageMap = new Map();

    for (const sourceFile of this.program.getSourceFiles()) {
      if (
        sourceFile.isDeclarationFile ||
        sourceFile.fileName.includes('node_modules')
      ) {
        continue;
      }

      const usages = this.collectFromFile(sourceFile.fileName);

      // Aggregate by component identity
      for (const usage of usages) {
        const key = usage.identity.hash;
        let entry = globalMap.get(key);

        if (!entry) {
          entry = {
            identity: usage.identity,
            usages: [],
            propValueSets: new Map(),
          };
          globalMap.set(key, entry);
        }

        entry.usages.push(usage);

        // Aggregate prop values
        for (const [propName, propValue] of Object.entries(usage.props)) {
          let propSet = entry.propValueSets.get(propName);
          if (!propSet) {
            propSet = new Set();
            entry.propValueSets.set(propName, propSet);
          }

          // Convert value to "value:breakpoint" format
          if (Array.isArray(propValue)) {
            // Responsive array values
            propValue.forEach((val, idx) => {
              if (val !== undefined) {
                const breakpoint = this.getBreakpointByIndex(idx);
                propSet!.add(`${val}:${breakpoint}`);
              }
            });
          } else if (typeof propValue === 'object' && propValue !== null) {
            // Responsive object values
            for (const [bp, val] of Object.entries(propValue)) {
              propSet!.add(`${val}:${bp}`);
            }
          } else {
            // Simple value
            propSet!.add(`${propValue}:_`);
          }
        }
      }
    }

    return globalMap;
  }

  /**
   * Find all usages of a specific component across the project
   */
  findComponentUsages(
    identity: ComponentIdentity
  ): ComponentUsageWithIdentity[] {
    const allUsages: ComponentUsageWithIdentity[] = [];

    // Find all files that reference this component
    const referencingFiles = this.resolver.findComponentReferences(identity);

    for (const file of referencingFiles) {
      const fileUsages = this.collectFromFile(file);
      const componentUsages = fileUsages.filter((u) =>
        isSameComponent(u.identity, identity)
      );
      allUsages.push(...componentUsages);
    }

    return allUsages;
  }

  /**
   * Build a traditional UsageMap for a specific component
   * This maintains compatibility with existing CSS generation
   */
  buildComponentUsageMap(identity: ComponentIdentity): UsageMap {
    const usages = this.findComponentUsages(identity);

    // Group by component name (though they should all be the same)
    const grouped: ComponentUsage[] = usages.map((u) => ({
      componentName: u.componentName,
      props: u.props,
    }));

    return buildUsageMap(grouped);
  }

  /**
   * Clear file cache for a specific file
   */
  invalidateFile(filePath: string): void {
    this.fileCache.delete(filePath);
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.fileCache.clear();
    this.resolver.clearCache();
  }

  /**
   * Get breakpoint name by array index
   * This should match your theme's breakpoint configuration
   */
  private getBreakpointByIndex(index: number): string {
    const breakpoints = ['_', 'xs', 'sm', 'md', 'lg', 'xl'];
    return breakpoints[index] || '_';
  }

  /**
   * Get usage statistics for reporting
   */
  getUsageStats(): {
    totalComponents: number;
    totalUsages: number;
    componentsWithUsage: Array<{
      name: string;
      filePath: string;
      usageCount: number;
      uniqueProps: number;
    }>;
  } {
    const globalMap = this.collectFromProgram();

    const stats = {
      totalComponents: globalMap.size,
      totalUsages: 0,
      componentsWithUsage: [] as any[],
    };

    for (const [, entry] of globalMap) {
      stats.totalUsages += entry.usages.length;

      stats.componentsWithUsage.push({
        name: entry.identity.name,
        filePath: entry.identity.filePath,
        usageCount: entry.usages.length,
        uniqueProps: entry.propValueSets.size,
      });
    }

    // Sort by usage count
    stats.componentsWithUsage.sort((a, b) => b.usageCount - a.usageCount);

    return stats;
  }
}

// The cross-file usage collector is manifest
// It sees all, tracks all, knows which styles are truly needed
