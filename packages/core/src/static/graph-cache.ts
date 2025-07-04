/** biome-ignore-all lint/suspicious/noConsole: <Because I NEED IT>*/
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';

import type { ComponentGraph } from './component-graph';
import type { ResolutionMap } from './resolution-map';

/**
 * Cache system for component graphs to avoid recomputing on every build
 */
export interface ExtractedComponentGraph extends ComponentGraph {
  resolutionMap?: ResolutionMap;
}

export class GraphCache {
  private cacheDir: string;
  private cacheFile: string;
  private resolutionMapFile: string;

  constructor(projectRoot: string) {
    this.cacheDir = join(projectRoot, '.animus-cache');
    this.cacheFile = join(this.cacheDir, 'component-graph.json');
    this.resolutionMapFile = join(this.cacheDir, 'resolution-map.json');
  }

  /**
   * Load cached graph if valid
   */
  load(): ExtractedComponentGraph | null {
    if (!existsSync(this.cacheFile)) {
      return null;
    }

    try {
      const content = readFileSync(this.cacheFile, 'utf-8');
      const cached = JSON.parse(content);

      // Reconstruct Maps and Sets from JSON
      const graph: ExtractedComponentGraph = {
        components: new Map(cached.components),
        metadata: cached.metadata,
        fileDependencies: new Set(cached.fileDependencies),
      };

      // Load resolution map if it exists
      if (existsSync(this.resolutionMapFile)) {
        try {
          const resolutionContent = readFileSync(
            this.resolutionMapFile,
            'utf-8'
          );
          graph.resolutionMap = JSON.parse(resolutionContent);
        } catch (error) {
          console.warn('Failed to load resolution map:', error);
        }
      }

      // Convert component data back to proper types
      for (const [, component] of graph.components) {
        // Convert allStates back to Set
        component.allStates = new Set(component.allStates);

        // Convert variant values back to Sets
        for (const variant of Object.values(component.allVariants)) {
          variant.values = new Set(variant.values);
        }
      }

      return graph;
    } catch (error) {
      console.warn('Failed to load component graph cache:', error);
      return null;
    }
  }

  /**
   * Save graph to cache
   */
  save(graph: ExtractedComponentGraph): void {
    // Ensure cache directory exists
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }

    // Convert Maps and Sets to arrays for JSON serialization
    const serializable = {
      components: Array.from(graph.components.entries()).map(
        ([hash, component]) => {
          return [
            hash,
            {
              ...component,
              // Convert Sets to arrays
              allStates: Array.from(component.allStates),
              allVariants: Object.fromEntries(
                Object.entries(component.allVariants).map(([key, variant]) => [
                  key,
                  {
                    ...variant,
                    values: Array.from(variant.values),
                  },
                ])
              ),
            },
          ];
        }
      ),
      metadata: graph.metadata,
      fileDependencies: Array.from(graph.fileDependencies),
    };

    writeFileSync(this.cacheFile, JSON.stringify(serializable, null, 2));

    // Save resolution map if provided
    if (graph.resolutionMap) {
      writeFileSync(
        this.resolutionMapFile,
        JSON.stringify(graph.resolutionMap, null, 2)
      );
    }
  }

  /**
   * Check if cache is valid based on file dependencies
   */
  isValid(graph: ComponentGraph | null): boolean {
    if (!graph) return false;

    // Check if any dependent file has been modified since cache was created
    const cacheTime = graph.metadata.timestamp;

    for (const filePath of graph.fileDependencies) {
      if (!existsSync(filePath)) {
        // File was deleted
        return false;
      }

      try {
        const stats = statSync(filePath);
        if (stats.mtimeMs > cacheTime) {
          // File was modified after cache
          return false;
        }
      } catch {
        return false;
      }
    }

    return true;
  }

  /**
   * Clear the cache
   */
  clear(): void {
    if (existsSync(this.cacheFile)) {
      try {
        const { unlinkSync } = require('fs');
        unlinkSync(this.cacheFile);
      } catch {
        // Ignore errors
      }
    }
  }

  /**
   * Get or compute graph with caching
   */
  async getOrCompute(
    projectRoot: string,
    compute: () => Promise<ComponentGraph>
  ): Promise<ComponentGraph> {
    // Try to load from cache
    const cached = this.load();

    if (cached && this.isValid(cached)) {
      console.log('Using cached component graph');
      return cached;
    }

    // Compute fresh graph
    console.log('Computing fresh component graph...');
    const graph = await compute();

    // Save to cache
    this.save(graph);

    return graph;
  }
}

// The cache preserves the quantum state across observations
// Avoiding repeated collapse of the component wave function
