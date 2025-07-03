import ts from 'typescript';

import {
  ComponentIdentity,
  createComponentIdentity,
  isSameComponent,
} from './component-identity';

/**
 * Import information for a component
 */
export interface ImportInfo {
  componentName: string;
  importPath: string;
  importedName: string; // Could be different due to aliasing
  isDefault: boolean;
  isNamespaceImport: boolean;
}

/**
 * Export information for a component
 */
export interface ExportInfo {
  componentName: string;
  exportName: string; // 'default' or the actual export name
  isReExport: boolean;
  reExportPath?: string;
}

/**
 * Resolved component reference with full identity
 */
export interface ResolvedReference {
  localName: string; // Name used in this file
  resolvedIdentity: ComponentIdentity;
  importInfo?: ImportInfo; // Present if imported
}

/**
 * The Import Resolver - traces component paths across the void
 * It sees how components flow from file to file, following the quantum threads
 */
export class ImportResolver {
  private program: ts.Program;
  private fileImports = new Map<string, ImportInfo[]>();
  private fileExports = new Map<string, ExportInfo[]>();

  constructor(program: ts.Program) {
    this.program = program;
  }

  /**
   * Resolve a component import to its source identity
   */
  resolveImport(
    componentName: string,
    fromFile: string
  ): ComponentIdentity | undefined {
    const sourceFile = this.program.getSourceFile(fromFile);
    if (!sourceFile) return undefined;

    // First, check if it's a local component (not imported)
    const localExport = this.findLocalExport(sourceFile, componentName);
    if (localExport) {
      return createComponentIdentity(
        componentName,
        fromFile,
        localExport.exportName
      );
    }

    // Look for imports
    const imports = this.extractImports(sourceFile);
    const importInfo = imports.find(
      (imp) => imp.componentName === componentName
    );

    if (!importInfo) return undefined;

    // Resolve the import path
    const resolved = this.resolveModulePath(importInfo.importPath, fromFile);
    if (!resolved) return undefined;

    // Find the export in the target file
    const targetFile = this.program.getSourceFile(resolved);
    if (!targetFile) return undefined;

    const exports = this.extractExports(targetFile);
    const exportInfo = exports.find((exp) => {
      if (importInfo.isDefault) {
        return exp.exportName === 'default';
      }
      return exp.exportName === importInfo.importedName;
    });

    if (!exportInfo) return undefined;

    return createComponentIdentity(
      exportInfo.componentName,
      resolved,
      exportInfo.exportName
    );
  }

  /**
   * Find all files that import a specific component
   */
  findComponentReferences(identity: ComponentIdentity): Set<string> {
    const references = new Set<string>();

    for (const sourceFile of this.program.getSourceFiles()) {
      if (
        sourceFile.isDeclarationFile ||
        sourceFile.fileName.includes('node_modules')
      ) {
        continue;
      }

      const imports = this.extractImports(sourceFile);

      for (const imp of imports) {
        const resolved = this.resolveImport(
          imp.componentName,
          sourceFile.fileName
        );
        if (resolved && isSameComponent(resolved, identity)) {
          references.add(sourceFile.fileName);
        }
      }
    }

    return references;
  }

  /**
   * Extract all imports from a file
   */
  private extractImports(sourceFile: ts.SourceFile): ImportInfo[] {
    const cached = this.fileImports.get(sourceFile.fileName);
    if (cached) return cached;

    const imports: ImportInfo[] = [];

    const visitNode = (node: ts.Node) => {
      if (
        ts.isImportDeclaration(node) &&
        node.importClause &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const importPath = node.moduleSpecifier.text;
        const clause = node.importClause;

        // Default import: import Button from './Button'
        if (clause.name) {
          imports.push({
            componentName: clause.name.text,
            importPath,
            importedName: 'default',
            isDefault: true,
            isNamespaceImport: false,
          });
        }

        // Named imports: import { Button, Card } from './components'
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            const importedName =
              element.propertyName?.text || element.name.text;
            const localName = element.name.text;

            imports.push({
              componentName: localName,
              importPath,
              importedName,
              isDefault: false,
              isNamespaceImport: false,
            });
          }
        }

        // Namespace import: import * as Components from './components'
        if (
          clause.namedBindings &&
          ts.isNamespaceImport(clause.namedBindings)
        ) {
          // We'll handle these differently as they're accessed via dot notation
          imports.push({
            componentName: clause.namedBindings.name.text,
            importPath,
            importedName: '*',
            isDefault: false,
            isNamespaceImport: true,
          });
        }
      }

      ts.forEachChild(node, visitNode);
    };

    visitNode(sourceFile);
    this.fileImports.set(sourceFile.fileName, imports);
    return imports;
  }

  /**
   * Extract all exports from a file
   */
  private extractExports(sourceFile: ts.SourceFile): ExportInfo[] {
    const cached = this.fileExports.get(sourceFile.fileName);
    if (cached) return cached;

    const exports: ExportInfo[] = [];

    const visitNode = (node: ts.Node) => {
      // Named export: export const Button = ...
      if (
        ts.isVariableStatement(node) &&
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            exports.push({
              componentName: declaration.name.text,
              exportName: declaration.name.text,
              isReExport: false,
            });
          }
        }
      }

      // Export declaration: export { Button }
      if (ts.isExportDeclaration(node)) {
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const element of node.exportClause.elements) {
            const exportedName = element.name.text;
            const localName = element.propertyName?.text || element.name.text;

            exports.push({
              componentName: localName,
              exportName: exportedName,
              isReExport: !!node.moduleSpecifier,
              reExportPath:
                node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
                  ? node.moduleSpecifier.text
                  : undefined,
            });
          }
        }
      }

      // Default export: export default Button
      if (ts.isExportAssignment(node) && !node.isExportEquals) {
        if (ts.isIdentifier(node.expression)) {
          exports.push({
            componentName: node.expression.text,
            exportName: 'default',
            isReExport: false,
          });
        }
      }

      ts.forEachChild(node, visitNode);
    };

    visitNode(sourceFile);
    this.fileExports.set(sourceFile.fileName, exports);
    return exports;
  }

  /**
   * Find a local export in the same file
   */
  private findLocalExport(
    sourceFile: ts.SourceFile,
    componentName: string
  ): ExportInfo | undefined {
    const exports = this.extractExports(sourceFile);
    return exports.find((exp) => exp.componentName === componentName);
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
   * Build a complete import/export graph for the project
   */
  buildDependencyGraph(): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();

    for (const sourceFile of this.program.getSourceFiles()) {
      if (
        sourceFile.isDeclarationFile ||
        sourceFile.fileName.includes('node_modules')
      ) {
        continue;
      }

      const dependencies = new Set<string>();
      const imports = this.extractImports(sourceFile);

      for (const imp of imports) {
        const resolved = this.resolveModulePath(
          imp.importPath,
          sourceFile.fileName
        );
        if (resolved && !resolved.includes('node_modules')) {
          dependencies.add(resolved);
        }
      }

      graph.set(sourceFile.fileName, dependencies);
    }

    return graph;
  }

  /**
   * Clear all caches (useful when files change)
   */
  clearCache(): void {
    this.fileImports.clear();
    this.fileExports.clear();
  }
}

// The import paths are illuminated
// Components can now be traced across the quantum void
