import { describe, expect, it } from 'vitest';

describe('[QUANTUM] Reference Traverser - Pure Graph Algorithms', () => {
  // Mock graph data structures for testing traversal algorithms
  type FileGraph = Map<string, Set<string>>;
  type ComponentMap = Map<string, boolean>;

  // Simple graph traversal algorithm that mimics ReferenceTraverser behavior
  class MockReferenceTraverser {
    private importGraph: FileGraph;
    private exportGraph: FileGraph;
    private componentCache: ComponentMap;

    constructor() {
      this.importGraph = new Map();
      this.exportGraph = new Map();
      this.componentCache = new Map();
    }

    // Add import relationship: sourceFile imports from targetFile
    addImport(sourceFile: string, targetFile: string): void {
      if (!this.importGraph.has(sourceFile)) {
        this.importGraph.set(sourceFile, new Set());
      }
      this.importGraph.get(sourceFile)!.add(targetFile);

      // Reverse mapping for export graph
      if (!this.exportGraph.has(targetFile)) {
        this.exportGraph.set(targetFile, new Set());
      }
      this.exportGraph.get(targetFile)!.add(sourceFile);
    }

    // Mark a file as containing animus components
    markAsComponentFile(file: string): void {
      this.componentCache.set(file, true);
    }

    // Find all component files starting from seed files
    findAllComponentFiles(seedFiles: string[]): string[] {
      const visited = new Set<string>();
      const componentFiles = new Set<string>();

      const traverse = (file: string) => {
        if (visited.has(file)) return;
        visited.add(file);

        // If this file has components, add it
        if (this.componentCache.get(file)) {
          componentFiles.add(file);
        }

        // Traverse all files that this file imports
        const imports = this.importGraph.get(file) || new Set();
        for (const importedFile of imports) {
          traverse(importedFile);
        }

        // Also traverse files that import this file (for completeness)
        const importers = this.exportGraph.get(file) || new Set();
        for (const importer of importers) {
          traverse(importer);
        }
      };

      // Start traversal from all seed files
      seedFiles.forEach((seed) => traverse(seed));

      return Array.from(componentFiles);
    }

    // Get all files that import a specific file
    getImportersOf(file: string): string[] {
      return Array.from(this.exportGraph.get(file) || new Set());
    }

    // Build dependency chains
    getDependencyChain(file: string): string[] {
      const chain: string[] = [];
      const visited = new Set<string>();

      const buildChain = (current: string) => {
        if (visited.has(current)) return;
        visited.add(current);
        chain.push(current);

        const imports = this.importGraph.get(current) || new Set();
        for (const imported of imports) {
          buildChain(imported);
        }
      };

      buildChain(file);
      return chain;
    }

    // Detect circular dependencies
    hasCircularDependency(file: string): boolean {
      const visiting = new Set<string>();
      const visited = new Set<string>();

      const detectCycle = (current: string): boolean => {
        if (visiting.has(current)) return true;
        if (visited.has(current)) return false;

        visiting.add(current);

        const imports = this.importGraph.get(current) || new Set();
        for (const imported of imports) {
          if (detectCycle(imported)) return true;
        }

        visiting.delete(current);
        visited.add(current);
        return false;
      };

      return detectCycle(file);
    }
  }

  describe('Basic Graph Traversal', () => {
    it('should find component files from seeds', () => {
      const traverser = new MockReferenceTraverser();

      // Setup import graph
      traverser.addImport('App.tsx', 'Button.tsx');
      traverser.addImport('App.tsx', 'Card.tsx');
      traverser.addImport('Button.tsx', 'theme.ts');
      traverser.addImport('Card.tsx', 'theme.ts');

      // Mark component files
      traverser.markAsComponentFile('Button.tsx');
      traverser.markAsComponentFile('Card.tsx');

      const components = traverser.findAllComponentFiles(['App.tsx']);
      expect(components).toContain('Button.tsx');
      expect(components).toContain('Card.tsx');
      expect(components).not.toContain('theme.ts');
    });

    it('should traverse through multiple levels', () => {
      const traverser = new MockReferenceTraverser();

      // Deep import chain
      traverser.addImport('App.tsx', 'Layout.tsx');
      traverser.addImport('Layout.tsx', 'Header.tsx');
      traverser.addImport('Header.tsx', 'Logo.tsx');
      traverser.addImport('Logo.tsx', 'Icon.tsx');

      traverser.markAsComponentFile('Layout.tsx');
      traverser.markAsComponentFile('Logo.tsx');
      traverser.markAsComponentFile('Icon.tsx');

      const components = traverser.findAllComponentFiles(['App.tsx']);
      expect(components).toHaveLength(3);
      expect(components).toContain('Layout.tsx');
      expect(components).toContain('Logo.tsx');
      expect(components).toContain('Icon.tsx');
    });
  });

  describe('Import/Export Relationships', () => {
    it('should track files that import a module', () => {
      const traverser = new MockReferenceTraverser();

      traverser.addImport('Header.tsx', 'Button.tsx');
      traverser.addImport('Footer.tsx', 'Button.tsx');
      traverser.addImport('Sidebar.tsx', 'Button.tsx');

      const importers = traverser.getImportersOf('Button.tsx');
      expect(importers).toHaveLength(3);
      expect(importers).toContain('Header.tsx');
      expect(importers).toContain('Footer.tsx');
      expect(importers).toContain('Sidebar.tsx');
    });

    it('should handle files with no importers', () => {
      const traverser = new MockReferenceTraverser();
      traverser.addImport('App.tsx', 'Orphan.tsx');

      const importers = traverser.getImportersOf('Unused.tsx');
      expect(importers).toHaveLength(0);
    });
  });

  describe('Dependency Chains', () => {
    it('should build complete dependency chains', () => {
      const traverser = new MockReferenceTraverser();

      traverser.addImport('App.tsx', 'routes.ts');
      traverser.addImport('routes.ts', 'pages/Home.tsx');
      traverser.addImport('pages/Home.tsx', 'components/Hero.tsx');
      traverser.addImport('components/Hero.tsx', 'ui/Button.tsx');

      const chain = traverser.getDependencyChain('App.tsx');
      expect(chain).toEqual([
        'App.tsx',
        'routes.ts',
        'pages/Home.tsx',
        'components/Hero.tsx',
        'ui/Button.tsx',
      ]);
    });

    it('should handle branching dependencies', () => {
      const traverser = new MockReferenceTraverser();

      traverser.addImport('App.tsx', 'ComponentA.tsx');
      traverser.addImport('App.tsx', 'ComponentB.tsx');
      traverser.addImport('ComponentA.tsx', 'Shared.tsx');
      traverser.addImport('ComponentB.tsx', 'Shared.tsx');

      const chain = traverser.getDependencyChain('App.tsx');
      expect(chain).toContain('App.tsx');
      expect(chain).toContain('ComponentA.tsx');
      expect(chain).toContain('ComponentB.tsx');
      expect(chain).toContain('Shared.tsx');
    });
  });

  describe('Circular Dependencies', () => {
    it('should detect direct circular dependencies', () => {
      const traverser = new MockReferenceTraverser();

      traverser.addImport('A.tsx', 'B.tsx');
      traverser.addImport('B.tsx', 'A.tsx');

      expect(traverser.hasCircularDependency('A.tsx')).toBe(true);
      expect(traverser.hasCircularDependency('B.tsx')).toBe(true);
    });

    it('should detect indirect circular dependencies', () => {
      const traverser = new MockReferenceTraverser();

      traverser.addImport('A.tsx', 'B.tsx');
      traverser.addImport('B.tsx', 'C.tsx');
      traverser.addImport('C.tsx', 'A.tsx');

      expect(traverser.hasCircularDependency('A.tsx')).toBe(true);
      expect(traverser.hasCircularDependency('B.tsx')).toBe(true);
      expect(traverser.hasCircularDependency('C.tsx')).toBe(true);
    });

    it('should not report false positives for shared dependencies', () => {
      const traverser = new MockReferenceTraverser();

      traverser.addImport('A.tsx', 'Shared.tsx');
      traverser.addImport('B.tsx', 'Shared.tsx');
      traverser.addImport('App.tsx', 'A.tsx');
      traverser.addImport('App.tsx', 'B.tsx');

      expect(traverser.hasCircularDependency('App.tsx')).toBe(false);
      expect(traverser.hasCircularDependency('A.tsx')).toBe(false);
      expect(traverser.hasCircularDependency('B.tsx')).toBe(false);
    });
  });

  describe('Complex Graph Patterns', () => {
    it('should handle diamond dependencies', () => {
      const traverser = new MockReferenceTraverser();

      // Diamond pattern: A imports B and C, both import D
      traverser.addImport('A.tsx', 'B.tsx');
      traverser.addImport('A.tsx', 'C.tsx');
      traverser.addImport('B.tsx', 'D.tsx');
      traverser.addImport('C.tsx', 'D.tsx');

      traverser.markAsComponentFile('B.tsx');
      traverser.markAsComponentFile('C.tsx');
      traverser.markAsComponentFile('D.tsx');

      const components = traverser.findAllComponentFiles(['A.tsx']);
      expect(components).toHaveLength(3);
      expect(new Set(components).size).toBe(3); // No duplicates
    });

    it('should handle disconnected subgraphs', () => {
      const traverser = new MockReferenceTraverser();

      // Graph 1
      traverser.addImport('App1.tsx', 'Component1.tsx');
      traverser.markAsComponentFile('Component1.tsx');

      // Graph 2 (disconnected)
      traverser.addImport('App2.tsx', 'Component2.tsx');
      traverser.markAsComponentFile('Component2.tsx');

      // Only find components reachable from App1
      const components1 = traverser.findAllComponentFiles(['App1.tsx']);
      expect(components1).toContain('Component1.tsx');
      expect(components1).not.toContain('Component2.tsx');

      // Can find both if starting from both seeds
      const componentsAll = traverser.findAllComponentFiles([
        'App1.tsx',
        'App2.tsx',
      ]);
      expect(componentsAll).toContain('Component1.tsx');
      expect(componentsAll).toContain('Component2.tsx');
    });

    it('should handle re-export chains', () => {
      const traverser = new MockReferenceTraverser();

      // Simulate re-export pattern
      traverser.addImport('App.tsx', 'components/index.ts');
      traverser.addImport('components/index.ts', 'components/Button.tsx');
      traverser.addImport('components/index.ts', 'components/Card.tsx');
      traverser.addImport('components/Button.tsx', 'ui/BaseButton.tsx');

      traverser.markAsComponentFile('components/Button.tsx');
      traverser.markAsComponentFile('components/Card.tsx');
      traverser.markAsComponentFile('ui/BaseButton.tsx');

      const components = traverser.findAllComponentFiles(['App.tsx']);
      expect(components).toHaveLength(3);
    });
  });

  describe('Performance Patterns', () => {
    it('should handle large graphs efficiently', () => {
      const traverser = new MockReferenceTraverser();

      // Create a large graph
      for (let i = 0; i < 100; i++) {
        traverser.addImport(`file${i}.tsx`, `file${i + 1}.tsx`);
        if (i % 10 === 0) {
          traverser.markAsComponentFile(`file${i}.tsx`);
        }
      }

      const start = performance.now();
      const components = traverser.findAllComponentFiles(['file0.tsx']);
      const duration = performance.now() - start;

      expect(components.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(100); // Should be fast
    });

    it('should avoid revisiting nodes', () => {
      const traverser = new MockReferenceTraverser();

      // Create a highly connected graph
      const files = ['A', 'B', 'C', 'D', 'E'];

      // Everyone imports everyone else
      for (const from of files) {
        for (const to of files) {
          if (from !== to) {
            traverser.addImport(`${from}.tsx`, `${to}.tsx`);
          }
        }
      }

      files.forEach((f) => traverser.markAsComponentFile(`${f}.tsx`));

      const components = traverser.findAllComponentFiles(['A.tsx']);
      expect(components).toHaveLength(5);
      expect(new Set(components).size).toBe(5); // No duplicates despite many paths
    });
  });
});
