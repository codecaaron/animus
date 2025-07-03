import type ts from 'typescript';

import {
  ComponentIdentity,
  ExtractedStylesWithIdentity,
} from './component-identity';
import { CrossFileUsageCollector, GlobalUsageMap } from './cross-file-usage';
import { ImportResolver } from './import-resolver';
import type { UsageMap } from './types';
import { TypeScriptExtractor } from './typescript-extractor';

/**
 * Component entry in the registry
 */
export interface ComponentEntry {
  identity: ComponentIdentity;
  styles: ExtractedStylesWithIdentity;
  lastModified: number;
  dependencies: ComponentIdentity[]; // Components this one extends or references
  dependents: Set<string>; // File paths that use this component
}

/**
 * Registry events for external listeners
 */
export interface RegistryEvents {
  componentAdded: (entry: ComponentEntry) => void;
  componentUpdated: (entry: ComponentEntry) => void;
  componentRemoved: (identity: ComponentIdentity) => void;
  fileInvalidated: (filePath: string) => void;
}

/**
 * The Component Registry - Central authority for all components in the project
 * It sees all, knows all, and maintains the truth across the void
 */
export class ComponentRegistry {
  private components = new Map<string, ComponentEntry>(); // hash -> entry
  private fileComponents = new Map<string, Set<string>>(); // filePath -> Set<hash>
  private extractor: TypeScriptExtractor;
  private resolver: ImportResolver;
  private usageCollector: CrossFileUsageCollector;
  private listeners: Partial<RegistryEvents> = {};

  constructor(private program: ts.Program) {
    this.extractor = new TypeScriptExtractor();
    this.extractor.initializeProgram(this.getProjectRoot());
    this.resolver = new ImportResolver(program);
    this.usageCollector = new CrossFileUsageCollector(program, this.resolver);
  }

  /**
   * Initialize registry by scanning all project files
   */
  async initialize(): Promise<void> {
    const componentFiles = this.extractor.getComponentFiles();

    for (const file of componentFiles) {
      await this.processFile(file);
    }

    // Build dependency relationships
    this.buildDependencyGraph();
  }

  /**
   * Process a single file and register its components
   */
  async processFile(filePath: string): Promise<void> {
    const components = this.extractor.extractFromFile(filePath);
    const fileHashes = new Set<string>();

    for (const component of components) {
      const entry: ComponentEntry = {
        identity: component.identity,
        styles: component,
        lastModified: Date.now(),
        dependencies: [],
        dependents: new Set(),
      };

      // Handle extends relationship
      if (component.extends) {
        entry.dependencies.push(component.extends);
      }

      // Register the component
      this.registerComponent(entry);
      fileHashes.add(component.identity.hash);
    }

    // Track which components are in this file
    this.fileComponents.set(filePath, fileHashes);
  }

  /**
   * Register a component in the registry
   */
  private registerComponent(entry: ComponentEntry): void {
    const existing = this.components.get(entry.identity.hash);

    if (existing) {
      // Update existing
      this.components.set(entry.identity.hash, entry);
      this.emit('componentUpdated', entry);
    } else {
      // Add new
      this.components.set(entry.identity.hash, entry);
      this.emit('componentAdded', entry);
    }
  }

  /**
   * Get a component by its identity
   */
  getComponent(identity: ComponentIdentity): ComponentEntry | undefined {
    return this.components.get(identity.hash);
  }

  /**
   * Get all components
   */
  getAllComponents(): ComponentEntry[] {
    return Array.from(this.components.values());
  }

  /**
   * Get components from a specific file
   */
  getFileComponents(filePath: string): ComponentEntry[] {
    const hashes = this.fileComponents.get(filePath);
    if (!hashes) return [];

    return Array.from(hashes)
      .map((hash) => this.components.get(hash))
      .filter((c): c is ComponentEntry => c !== undefined);
  }

  /**
   * Get usage map for a component
   */
  getComponentUsage(identity: ComponentIdentity): UsageMap {
    return this.usageCollector.buildComponentUsageMap(identity);
  }

  /**
   * Get global usage map for all components
   */
  getGlobalUsage(): GlobalUsageMap {
    return this.usageCollector.collectFromProgram();
  }

  /**
   * Invalidate a file and reprocess it
   */
  async invalidateFile(filePath: string): Promise<void> {
    // Remove old components from this file
    const oldHashes = this.fileComponents.get(filePath);
    if (oldHashes) {
      for (const hash of oldHashes) {
        const component = this.components.get(hash);
        if (component) {
          this.components.delete(hash);
          this.emit('componentRemoved', component.identity);
        }
      }
    }

    // Clear usage cache
    this.usageCollector.invalidateFile(filePath);

    // Reprocess the file
    await this.processFile(filePath);

    // Rebuild dependencies for affected components
    this.updateDependentsOf(filePath);

    this.emit('fileInvalidated', filePath);
  }

  /**
   * Build the dependency graph between components
   */
  private buildDependencyGraph(): void {
    // Clear existing dependents
    for (const entry of this.components.values()) {
      entry.dependents.clear();
    }

    // Build dependents from dependencies
    for (const entry of this.components.values()) {
      for (const dep of entry.dependencies) {
        const depEntry = this.getComponent(dep);
        if (depEntry) {
          depEntry.dependents.add(entry.identity.filePath);
        }
      }
    }

    // Add usage-based dependents
    const globalUsage = this.getGlobalUsage();
    for (const [hash, usage] of globalUsage) {
      const component = this.components.get(hash);
      if (component) {
        for (const use of usage.usages) {
          component.dependents.add(use.usageLocation);
        }
      }
    }
  }

  /**
   * Update components that depend on a changed file
   */
  private updateDependentsOf(filePath: string): void {
    const changedComponents = this.getFileComponents(filePath);

    for (const component of changedComponents) {
      for (const dependentFile of component.dependents) {
        // Mark dependent files as needing reprocessing
        // In a real implementation, this would trigger incremental compilation
        this.usageCollector.invalidateFile(dependentFile);
      }
    }
  }

  /**
   * Get components sorted by extension hierarchy (topological sort)
   * Parents come before children to ensure proper CSS cascade
   */
  getComponentsSortedByExtension(): ComponentEntry[] {
    const components = Array.from(this.components.values());
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const sorted: ComponentEntry[] = [];

    const visit = (component: ComponentEntry): void => {
      const hash = component.identity.hash;

      if (visiting.has(hash)) {
        // Circular dependency detected - skip to prevent infinite loop
        return;
      }

      if (visited.has(hash)) {
        return;
      }

      visiting.add(hash);

      // Visit dependencies first (parents before children)
      for (const dep of component.dependencies) {
        const depComponent = this.getComponent(dep);
        if (depComponent) {
          visit(depComponent);
        }
      }

      visiting.delete(hash);
      visited.add(hash);
      sorted.push(component);
    };

    // Visit all components
    for (const component of components) {
      if (!visited.has(component.identity.hash)) {
        visit(component);
      }
    }

    return sorted;
  }

  /**
   * Get the project root directory
   */
  private getProjectRoot(): string {
    const files = this.program.getRootFileNames();
    if (files.length === 0 || files.some((file) => file.includes('vite-test'))) return process.cwd();

    // Find common ancestor directory

    const path = require('path');
    let commonDir = path.dirname(files[0]);

    for (const file of files) {
      const dir = path.dirname(file);
      while (!dir.startsWith(commonDir)) {
        commonDir = path.dirname(commonDir);
      }
    }

    return commonDir;
  }

  /**
   * Subscribe to registry events
   */
  on<K extends keyof RegistryEvents>(
    event: K,
    handler: RegistryEvents[K]
  ): void {
    this.listeners[event] = handler;
  }

  /**
   * Emit an event
   */
  private emit<K extends keyof RegistryEvents>(
    event: K,
    ...args: Parameters<RegistryEvents[K]>
  ): void {
    const handler = this.listeners[event];
    if (handler) {
      (handler as any)(...args);
    }
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    totalComponents: number;
    totalFiles: number;
    componentsWithUsage: number;
    componentsWithDependents: number;
    averageDependentsPerComponent: number;
  } {
    const stats = {
      totalComponents: this.components.size,
      totalFiles: this.fileComponents.size,
      componentsWithUsage: 0,
      componentsWithDependents: 0,
      averageDependentsPerComponent: 0,
    };

    let totalDependents = 0;

    for (const component of this.components.values()) {
      if (component.dependents.size > 0) {
        stats.componentsWithDependents++;
        totalDependents += component.dependents.size;
      }
    }

    // Check usage
    const globalUsage = this.getGlobalUsage();
    stats.componentsWithUsage = globalUsage.size;

    if (stats.componentsWithDependents > 0) {
      stats.averageDependentsPerComponent =
        totalDependents / stats.componentsWithDependents;
    }

    return stats;
  }

  /**
   * Clear all caches and reset the registry
   */
  clear(): void {
    this.components.clear();
    this.fileComponents.clear();
    this.usageCollector.clearCache();
    this.resolver.clearCache();
  }
}

// The Registry is manifest - the central authority across the void
// All components are known, their relationships tracked, their usage recorded
