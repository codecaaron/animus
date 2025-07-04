import * as ts from 'typescript';

import { defaultGroupDefinitions } from './cli/utils/groupDefinitions';
import { ComponentGraphBuilder } from './component-graph';
import type { ComponentRuntimeMetadata } from './generator';
import type { ExtractedComponentGraph } from './graph-cache';
import { TypeScriptExtractor } from './typescript-extractor';

/**
 * Reference Traverser - Follows the quantum threads of component relationships
 * through the TypeScript module graph, discovering all Animus components
 * by tracing import/export relationships from seed files
 */
export class ReferenceTraverser {
  private program: ts.Program;
  private importGraph: Map<string, Set<string>> = new Map();
  private exportGraph: Map<string, Set<string>> = new Map();
  private componentCache: Map<string, boolean> = new Map();

  constructor(program: ts.Program) {
    this.program = program;
  }

  /**
   * Find all files that contain Animus components by traversing
   * the import graph from seed files
   */
  findAllComponentFiles(): string[] {
    // Step 1: Find seed files (those that import 'animus' directly)
    const seedFiles = this.findSeedFiles();

    // Step 2: Build the import graph
    this.buildImportGraph();

    // Step 3: Traverse from seeds to find all component files
    const componentFiles = this.traverseFromSeeds(seedFiles);

    return Array.from(componentFiles);
  }

  /**
   * Find all files that import 'animus' or '@animus-ui/core' directly
   */
  private findSeedFiles(): Set<string> {
    const seeds = new Set<string>();

    for (const sourceFile of this.program.getSourceFiles()) {
      if (
        sourceFile.isDeclarationFile ||
        sourceFile.fileName.includes('node_modules')
      ) {
        continue;
      }

      // Check imports for animus packages
      ts.forEachChild(sourceFile, (node) => {
        if (
          ts.isImportDeclaration(node) &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          const moduleName = node.moduleSpecifier.text;
          if (
            moduleName === 'animus' ||
            moduleName === '@animus-ui/core' ||
            moduleName.includes('@animus-ui/core/')
          ) {
            seeds.add(sourceFile.fileName);
          }
        }
      });
    }

    return seeds;
  }

  /**
   * Build a complete import/export graph for the project
   * Maps each file to the files that import from it
   */
  private buildImportGraph(): void {
    // Clear existing graphs
    this.importGraph.clear();
    this.exportGraph.clear();

    for (const sourceFile of this.program.getSourceFiles()) {
      if (
        sourceFile.isDeclarationFile ||
        sourceFile.fileName.includes('node_modules')
      ) {
        continue;
      }

      const fileName = sourceFile.fileName;
      const imports = this.extractImportsFromFile(sourceFile);

      for (const importedFile of imports) {
        // Add to import graph (file imports from importedFile)
        if (!this.importGraph.has(importedFile)) {
          this.importGraph.set(importedFile, new Set());
        }
        this.importGraph.get(importedFile)!.add(fileName);

        // Add to export graph (importedFile exports to file)
        if (!this.exportGraph.has(fileName)) {
          this.exportGraph.set(fileName, new Set());
        }
        this.exportGraph.get(fileName)!.add(importedFile);
      }
    }
  }

  /**
   * Extract all imported file paths from a source file
   */
  private extractImportsFromFile(sourceFile: ts.SourceFile): Set<string> {
    const imports = new Set<string>();

    ts.forEachChild(sourceFile, (node) => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const importPath = node.moduleSpecifier.text;

        // Skip external modules
        if (importPath.startsWith('.') || importPath.startsWith('/')) {
          const resolved = this.resolveModulePath(
            importPath,
            sourceFile.fileName
          );
          if (resolved && !resolved.includes('node_modules')) {
            imports.add(resolved);
          }
        }
      }

      // Also handle export...from statements
      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const importPath = node.moduleSpecifier.text;
        if (importPath.startsWith('.') || importPath.startsWith('/')) {
          const resolved = this.resolveModulePath(
            importPath,
            sourceFile.fileName
          );
          if (resolved && !resolved.includes('node_modules')) {
            imports.add(resolved);
          }
        }
      }
    });

    return imports;
  }

  /**
   * Resolve a module path to an absolute file path
   */
  private resolveModulePath(
    modulePath: string,
    fromFile: string
  ): string | undefined {
    const result = ts.resolveModuleName(
      modulePath,
      fromFile,
      this.program.getCompilerOptions(),
      ts.sys
    );

    return result.resolvedModule?.resolvedFileName;
  }

  /**
   * Traverse the import graph from seed files to find all component files
   */
  private traverseFromSeeds(seedFiles: Set<string>): Set<string> {
    const visited = new Set<string>();
    const componentFiles = new Set<string>();
    const queue = Array.from(seedFiles);

    while (queue.length > 0) {
      const currentFile = queue.shift()!;

      if (visited.has(currentFile)) {
        continue;
      }
      visited.add(currentFile);

      // Check if this file contains Animus components
      if (this.hasAnimusComponents(currentFile)) {
        componentFiles.add(currentFile);
      }

      // Add all files that import from this file to the queue
      const importers = this.importGraph.get(currentFile) || new Set();
      for (const importer of importers) {
        if (!visited.has(importer)) {
          queue.push(importer);
        }
      }
    }

    return componentFiles;
  }

  /**
   * Check if a file contains Animus component definitions
   * Uses AST analysis instead of text pattern matching
   */
  private hasAnimusComponents(fileName: string): boolean {
    // Check cache first
    if (this.componentCache.has(fileName)) {
      return this.componentCache.get(fileName)!;
    }

    const sourceFile = this.program.getSourceFile(fileName);
    if (!sourceFile) {
      this.componentCache.set(fileName, false);
      return false;
    }

    let hasComponents = false;

    const checkNode = (node: ts.Node): void => {
      // Look for variable declarations that might be components
      if (ts.isVariableDeclaration(node) && node.initializer) {
        if (this.isAnimusChain(node.initializer)) {
          hasComponents = true;
        }
      }

      // Look for export assignments that might be components
      if (ts.isExportAssignment(node) && node.expression) {
        if (this.isAnimusChain(node.expression)) {
          hasComponents = true;
        }
      }

      // Continue traversing unless we found components
      if (!hasComponents) {
        ts.forEachChild(node, checkNode);
      }
    };

    checkNode(sourceFile);
    this.componentCache.set(fileName, hasComponents);
    return hasComponents;
  }

  /**
   * Check if an expression is an Animus method chain
   */
  private isAnimusChain(node: ts.Node): boolean {
    // Handle direct animus calls: animus.styles()
    if (this.isAnimusMethodCall(node)) {
      return true;
    }

    // Handle chained calls: something.extend().styles()
    if (ts.isCallExpression(node)) {
      let current: ts.Node = node;

      while (ts.isCallExpression(current)) {
        if (
          ts.isPropertyAccessExpression(current.expression) &&
          this.isAnimusMethod(current.expression.name.text)
        ) {
          // Check if we eventually reach an animus identifier or extend call
          const chain = this.unwrapCallChain(current);
          if (chain.hasAnimusIdentifier || chain.hasExtendCall) {
            return true;
          }
        }

        if (ts.isPropertyAccessExpression(current.expression)) {
          current = current.expression.expression;
        } else {
          break;
        }
      }
    }

    return false;
  }

  /**
   * Check if a node is a method call on 'animus'
   */
  private isAnimusMethodCall(node: ts.Node): boolean {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const propAccess = node.expression;

      // Check if the object is 'animus' identifier
      if (
        ts.isIdentifier(propAccess.expression) &&
        propAccess.expression.text === 'animus' &&
        this.isAnimusMethod(propAccess.name.text)
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a method name is an Animus builder method
   */
  private isAnimusMethod(methodName: string): boolean {
    const animusMethods = [
      'styles',
      'variant',
      'states',
      'groups',
      'props',
      'asElement',
      'asComponent',
      'extend',
      'build',
    ];
    return animusMethods.includes(methodName);
  }

  /**
   * Unwrap a call chain to find its root
   */
  private unwrapCallChain(node: ts.CallExpression): {
    hasAnimusIdentifier: boolean;
    hasExtendCall: boolean;
  } {
    let current: ts.Node = node;
    let hasAnimusIdentifier = false;
    let hasExtendCall = false;

    while (true) {
      if (ts.isCallExpression(current)) {
        if (
          ts.isPropertyAccessExpression(current.expression) &&
          current.expression.name.text === 'extend'
        ) {
          hasExtendCall = true;
        }
        current = current.expression;
      } else if (ts.isPropertyAccessExpression(current)) {
        if (current.name.text === 'extend') {
          hasExtendCall = true;
        }
        current = current.expression;
      } else if (ts.isIdentifier(current)) {
        if (current.text === 'animus') {
          hasAnimusIdentifier = true;
        }
        break;
      } else {
        break;
      }
    }

    return { hasAnimusIdentifier, hasExtendCall };
  }

  /**
   * Get all files that import from a specific file
   */
  getImportersOf(fileName: string): string[] {
    return Array.from(this.importGraph.get(fileName) || new Set());
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.componentCache.clear();
    this.importGraph.clear();
    this.exportGraph.clear();
  }

  /**
   * Extract complete component graph with ALL possibilities
   * This captures the full quantum state before observation
   */
  async extractCompleteGraph(
    projectRoot: string
  ): Promise<ExtractedComponentGraph> {
    // Initialize the extractor
    const extractor = new TypeScriptExtractor();
    extractor.initializeProgram(projectRoot);

    // Find all component files using reference traversal
    const componentFiles = this.findAllComponentFiles();

    // Build the complete graph
    const graphBuilder = new ComponentGraphBuilder();

    for (const filePath of componentFiles) {
      // Extract ALL styles from the file
      const extractedStyles = extractor.extractFromFile(filePath);

      for (const style of extractedStyles) {
        // Generate runtime metadata for the component
        const metadata = this.generateComponentMetadata(style);

        // Add to graph with all possibilities
        graphBuilder.addComponent(
          style.identity,
          style,
          metadata,
          style.extends
        );
      }
    }

    const graph = graphBuilder.build(projectRoot);

    // Build resolution map using the complete graph
    const resolutionMap = extractor.buildResolutionMap(graph);

    // Return graph with resolution map
    return {
      ...graph,
      resolutionMap,
    };
  }

  /**
   * Generate runtime metadata for a component
   */
  private generateComponentMetadata(extraction: any): ComponentRuntimeMetadata {
    const metadata: ComponentRuntimeMetadata = {
      baseClass: `animus-${extraction.componentName}-${extraction.identity.hash.slice(0, 3)}`,
      variants: {},
      states: {},
      systemProps: [],
      groups: extraction.groups || [],
      customProps: [],
    };

    // Populate systemProps from enabled groups
    if (extraction.groups) {
      for (const groupName of extraction.groups) {
        const groupDef = (defaultGroupDefinitions as any)[groupName];
        if (groupDef) {
          metadata.systemProps.push(...Object.keys(groupDef));
        }
      }
    }

    // Add all variant metadata
    if (extraction.variants) {
      const variantArray = Array.isArray(extraction.variants)
        ? extraction.variants
        : [extraction.variants];

      for (const variantDef of variantArray) {
        if (variantDef.prop && variantDef.variants) {
          metadata.variants[variantDef.prop] = {};
          for (const value of Object.keys(variantDef.variants)) {
            metadata.variants[variantDef.prop][value] =
              `${metadata.baseClass}-${variantDef.prop}-${value}`;
          }
        }
      }
    }

    // Add all state metadata
    if (extraction.states) {
      for (const state of Object.keys(extraction.states)) {
        metadata.states[state] = `${metadata.baseClass}-state-${state}`;
      }
    }

    // Add custom props
    if (extraction.props) {
      metadata.customProps = Object.keys(extraction.props);
    }

    // Add extends info
    if (extraction.extends) {
      metadata.extends = {
        from: extraction.extends.name,
        hash: `${extraction.extends.name}-${extraction.extends.hash.slice(0, 3)}`,
      };
    }

    return metadata;
  }
}

// The reference threads are illuminated
// Components can now be discovered through their true relationships
