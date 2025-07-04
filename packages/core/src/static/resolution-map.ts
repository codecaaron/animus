import ts from 'typescript';

import type { ComponentIdentity } from './component-identity';
import type { ComponentGraph } from './component-graph';

/**
 * Maps identifiers in a file to their resolved component hashes
 */
export interface FileResolutionMap {
  [identifier: string]: {
    componentHash: string;
    originalName: string;
  };
}

/**
 * Maps file paths to their identifier resolutions
 */
export interface ResolutionMap {
  [filePath: string]: FileResolutionMap;
}

/**
 * Builds a resolution map using TypeScript's type checker
 * This allows Babel to resolve JSX elements back to their component definitions
 */
export class ResolutionMapBuilder {
  private checker: ts.TypeChecker;
  private componentGraph: ComponentGraph;
  private resolutionMap: ResolutionMap = {};

  constructor(
    private program: ts.Program,
    componentGraph: ComponentGraph
  ) {
    this.checker = program.getTypeChecker();
    this.componentGraph = componentGraph;
  }

  /**
   * Build the complete resolution map for all source files
   */
  buildResolutionMap(): ResolutionMap {
    // Process all source files
    for (const sourceFile of this.program.getSourceFiles()) {
      // Skip node_modules and .d.ts files
      if (sourceFile.isDeclarationFile || sourceFile.fileName.includes('node_modules')) {
        continue;
      }

      this.processFile(sourceFile);
    }

    return this.resolutionMap;
  }

  /**
   * Process a single file to build its resolution map
   */
  private processFile(sourceFile: ts.SourceFile): void {
    const filePath = sourceFile.fileName;
    const fileMap: FileResolutionMap = {};

    // Visit all nodes in the file
    const visit = (node: ts.Node) => {
      // Handle import declarations
      if (ts.isImportDeclaration(node) && node.importClause) {
        this.processImport(node, fileMap);
      }
      
      // Handle variable declarations that might be re-exports
      if (ts.isVariableDeclaration(node) && node.initializer) {
        this.processVariableDeclaration(node, fileMap);
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    // Only add to map if we found any component references
    if (Object.keys(fileMap).length > 0) {
      this.resolutionMap[filePath] = fileMap;
    }
  }

  /**
   * Process import declarations to track component aliases
   */
  private processImport(
    importDecl: ts.ImportDeclaration,
    fileMap: FileResolutionMap
  ): void {
    const importClause = importDecl.importClause;
    if (!importClause) return;

    // Handle named imports: import { Button as MyButton }
    if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
      for (const element of importClause.namedBindings.elements) {
        const localName = element.name.text;

        // Get the symbol for this import
        const symbol = this.checker.getSymbolAtLocation(element.name);
        if (!symbol) continue;

        // Resolve to the original symbol
        const aliasedSymbol = this.checker.getAliasedSymbol(symbol);
        if (!aliasedSymbol) continue;

        // Find the component in our graph
        const componentInfo = this.findComponentBySymbol(aliasedSymbol);
        if (componentInfo) {
          fileMap[localName] = {
            componentHash: componentInfo.hash,
            originalName: componentInfo.name,
          };
        }
      }
    }

    // Handle default imports: import Button from './Button'
    if (importClause.name) {
      const localName = importClause.name.text;
      const symbol = this.checker.getSymbolAtLocation(importClause.name);
      if (symbol) {
        const aliasedSymbol = this.checker.getAliasedSymbol(symbol);
        if (aliasedSymbol) {
          const componentInfo = this.findComponentBySymbol(aliasedSymbol);
          if (componentInfo) {
            fileMap[localName] = {
              componentHash: componentInfo.hash,
              originalName: componentInfo.name,
            };
          }
        }
      }
    }
  }

  /**
   * Process variable declarations that might be component aliases
   */
  private processVariableDeclaration(
    node: ts.VariableDeclaration,
    fileMap: FileResolutionMap
  ): void {
    if (!ts.isIdentifier(node.name)) return;

    const localName = node.name.text;
    const symbol = this.checker.getSymbolAtLocation(node.name);
    if (!symbol) return;

    // Check if this is a component assignment
    const type = this.checker.getTypeOfSymbolAtLocation(symbol, node);
    const componentInfo = this.findComponentByType(type);
    
    if (componentInfo) {
      fileMap[localName] = {
        componentHash: componentInfo.hash,
        originalName: componentInfo.name,
      };
    }
  }

  /**
   * Find a component in the graph by its TypeScript symbol
   */
  private findComponentBySymbol(symbol: ts.Symbol): ComponentIdentity | null {
    // Get the declaration of the symbol
    const declarations = symbol.getDeclarations();
    if (!declarations || declarations.length === 0) return null;

    const declaration = declarations[0];
    const sourceFile = declaration.getSourceFile();
    const filePath = sourceFile.fileName;

    // Get the export name
    let exportName = 'default';
    if (symbol.name && symbol.name !== 'default') {
      exportName = symbol.name;
    }

    // Look up in component graph
    for (const [hash, node] of this.componentGraph.components) {
      if (
        node.identity.filePath === filePath &&
        node.identity.exportName === exportName
      ) {
        return {
          ...node.identity,
          hash,
        };
      }
    }

    return null;
  }

  /**
   * Find a component in the graph by its TypeScript type
   */
  private findComponentByType(type: ts.Type): ComponentIdentity | null {
    // This is a simplified version - in reality, we'd need more sophisticated
    // type checking to determine if this is an Animus component
    const symbol = type.getSymbol();
    if (symbol) {
      return this.findComponentBySymbol(symbol);
    }
    return null;
  }
}

// The Resolution Map bridges the semantic gap
// TypeScript's omniscience flows into Babel's syntax tree