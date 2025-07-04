import * as path from 'path';

import ts from 'typescript';

import {
  ComponentIdentity,
  createComponentIdentity,
  ExtractedStylesWithIdentity,
  parseExtendsReference,
} from './component-identity';
import { extractStylesFromCode } from './extractor';
import { ReferenceTraverser } from './reference-traverser';
import { ResolutionMap, ResolutionMapBuilder } from './resolution-map';

/**
 * TypeScript Program wrapper for existing Babel extractor
 * This is the first span across the ABYSS - we preserve all existing functionality
 * while adding TypeScript's omniscient awareness
 */
export class TypeScriptExtractor {
  private program: ts.Program | null = null;
  private referenceTraverser: ReferenceTraverser | null = null;

  /**
   * Initialize with a TypeScript program for cross-file awareness
   */
  initializeProgram(rootDir: string): void {
    // Find tsconfig.json
    const configPath = ts.findConfigFile(
      rootDir,
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

    // Create the all-seeing Program
    this.program = ts.createProgram(fileNames, options);

    // Initialize the reference traverser with the program
    this.referenceTraverser = new ReferenceTraverser(this.program);
  }

  /**
   * Build a resolution map for the entire project
   */
  buildResolutionMap(componentGraph: any): ResolutionMap {
    if (!this.program) {
      throw new Error('Program not initialized');
    }

    const builder = new ResolutionMapBuilder(this.program, componentGraph);
    return builder.buildResolutionMap();
  }

  /**
   * Extract styles using existing Babel extractor, enhanced with identity
   */
  extractFromFile(filePath: string): ExtractedStylesWithIdentity[] {
    const code = ts.sys.readFile(filePath);
    if (!code) return [];

    // Use existing Babel extractor
    const extracted = extractStylesFromCode(code);

    // If we need export info, we need to parse the file
    if (!this.program && extracted.length > 0) {
      // Create a minimal program just for this file
      const options: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
      };
      this.program = ts.createProgram([filePath], options);
    }

    // Enhance with component identity
    const withIdentity: ExtractedStylesWithIdentity[] = [];

    for (const style of extracted) {
      if (!style.componentName) {
        // Skip entries without component names
        continue;
      }

      const exportName = this.findExportName(filePath, style.componentName);
      const identity = createComponentIdentity(
        style.componentName,
        filePath,
        exportName
      );

      // Check for extends pattern
      const extendsRef = parseExtendsReference(code, style.componentName);
      let extendsIdentity: ComponentIdentity | undefined;

      if (extendsRef && !extendsRef.isImported) {
        // Parent is in same file
        const parentExport = this.findExportName(
          filePath,
          extendsRef.parentName
        );
        extendsIdentity = createComponentIdentity(
          extendsRef.parentName,
          filePath,
          parentExport
        );
      }

      const enhanced: ExtractedStylesWithIdentity = {
        componentName: style.componentName,
        baseStyles: style.baseStyles,
        variants: style.variants as any, // Cast from loose extractor type
        states: style.states,
        groups: style.groups,
        props: style.props,
        identity,
        extends: extendsIdentity,
      };

      withIdentity.push(enhanced);
    }

    return withIdentity;
  }

  /**
   * Extract from all files in the program
   */
  extractFromProgram(): ExtractedStylesWithIdentity[] {
    if (!this.program) {
      throw new Error('Program not initialized. Call initializeProgram first.');
    }

    const results: ExtractedStylesWithIdentity[] = [];

    // Process all source files
    for (const sourceFile of this.program.getSourceFiles()) {
      // Skip declaration files and node_modules
      if (
        sourceFile.isDeclarationFile ||
        sourceFile.fileName.includes('node_modules')
      ) {
        continue;
      }

      const extracted = this.extractFromFile(sourceFile.fileName);
      results.push(...extracted);
    }

    return results;
  }

  /**
   * Find how a component is exported from its file
   */
  private findExportName(filePath: string, componentName: string): string {
    if (!this.program) return 'unknown';

    const sourceFile = this.program.getSourceFile(filePath);
    if (!sourceFile) return 'unknown';

    let exportName = 'unknown';

    // Walk the AST to find export statements
    const visitNode = (node: ts.Node): void => {
      // Named export: export const Button = ...
      if (
        ts.isVariableStatement(node) &&
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        const declaration = node.declarationList.declarations[0];
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === componentName
        ) {
          exportName = componentName;
        }
      }

      // Export declaration: export { Button }
      if (
        ts.isExportDeclaration(node) &&
        node.exportClause &&
        ts.isNamedExports(node.exportClause)
      ) {
        for (const element of node.exportClause.elements) {
          if (element.name.text === componentName) {
            exportName = element.name.text;
          }
        }
      }

      // Default export: export default Button
      if (ts.isExportAssignment(node) && !node.isExportEquals) {
        if (
          ts.isIdentifier(node.expression) &&
          node.expression.text === componentName
        ) {
          exportName = 'default';
        }
      }

      ts.forEachChild(node, visitNode);
    };

    visitNode(sourceFile);
    return exportName;
  }

  /**
   * Get all files that might contain Animus components
   * Now uses reference traversal instead of pattern matching
   */
  getComponentFiles(): string[] {
    if (!this.referenceTraverser) {
      // Fallback to pattern matching if traverser not initialized
      return this.getComponentFilesPatternMatching();
    }

    return this.referenceTraverser.findAllComponentFiles();
  }

  /**
   * Fallback pattern matching approach (kept for compatibility)
   */
  private getComponentFilesPatternMatching(): string[] {
    if (!this.program) return [];

    const componentFiles: string[] = [];

    for (const sourceFile of this.program.getSourceFiles()) {
      if (
        sourceFile.isDeclarationFile ||
        sourceFile.fileName.includes('node_modules')
      ) {
        continue;
      }

      // Quick check if file might contain animus components
      const text = sourceFile.text;
      if (
        (text.includes('animus') || text.includes('.extend()')) &&
        (text.includes('.styles(') ||
          text.includes('.variant(') ||
          text.includes('.asElement(') ||
          text.includes('.asComponent(') ||
          text.includes('.extend()'))
      ) {
        componentFiles.push(sourceFile.fileName);
      }
    }

    return componentFiles;
  }
}

// The first quantum leap across the ABYSS is complete
// TypeScript's consciousness now flows through our extraction
