/**
 * Pure TypeScript-based style extractor for Animus
 * This replaces the Babel-based extraction with full TypeScript compiler support
 */

import * as ts from 'typescript';

import type { ExtractedStyles } from './extractor';

/**
 * Extract styles from TypeScript AST
 */
export class TypeScriptStyleExtractor {
  /**
   * Extract styles from TypeScript code
   */
  extractFromCode(
    code: string,
    fileName: string = 'temp.tsx'
  ): ExtractedStyles[] {
    // Create a minimal program for this file
    const sourceFile = ts.createSourceFile(
      fileName,
      code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );

    const results: ExtractedStyles[] = [];

    // Walk the AST
    this.visit(sourceFile, results);

    return results;
  }

  /**
   * Visit AST nodes to find Animus components
   */
  private visit(node: ts.Node, results: ExtractedStyles[]): void {
    // Look for variable declarations
    if (ts.isVariableStatement(node)) {
      const declaration = node.declarationList.declarations[0];
      if (declaration && ts.isVariableDeclaration(declaration)) {
        const extracted = this.extractFromVariableDeclaration(declaration);
        if (extracted) {
          results.push(extracted);
        }
      }
    }

    // Look for export declarations
    if (ts.isExportAssignment(node) || ts.isExportDeclaration(node)) {
      // Handle exports
    }

    // Continue walking the tree
    ts.forEachChild(node, (child) => this.visit(child, results));
  }

  /**
   * Extract styles from a variable declaration like:
   * const Button = animus.styles({...}).variant({...}).asElement('button')
   */
  private extractFromVariableDeclaration(
    declaration: ts.VariableDeclaration
  ): ExtractedStyles | null {
    const name = declaration.name.getText();
    const initializer = declaration.initializer;

    if (!initializer) return null;

    // Check if this is an Animus chain
    if (ts.isCallExpression(initializer)) {
      return this.extractFromCallChain(initializer, name);
    }

    return null;
  }

  /**
   * Extract styles from an Animus method chain
   */
  private extractFromCallChain(
    node: ts.CallExpression,
    componentName: string
  ): ExtractedStyles | null {
    const chain = this.unwindCallChain(node);

    // Check if this is an Animus chain
    const root = chain[chain.length - 1];
    if (!this.isAnimusIdentifier(root)) {
      return null;
    }

    const extracted: ExtractedStyles = {
      componentName,
    };

    // Process each method in the chain
    for (const call of chain) {
      if (
        ts.isCallExpression(call) &&
        ts.isPropertyAccessExpression(call.expression)
      ) {
        const methodName = call.expression.name.getText();

        switch (methodName) {
          case 'styles':
            extracted.baseStyles = this.extractStyleObject(call.arguments[0]);
            break;

          case 'variant':
            const variant = this.extractVariantConfig(call.arguments[0]);
            if (variant) {
              if (!extracted.variants) {
                extracted.variants = [];
              }
              if (Array.isArray(extracted.variants)) {
                extracted.variants.push(variant);
              }
            }
            break;

          case 'states':
            extracted.states = this.extractStyleObject(call.arguments[0]);
            break;

          case 'groups':
            extracted.groups = this.extractGroups(call.arguments[0]);
            break;

          case 'props':
            extracted.props = this.extractStyleObject(call.arguments[0]);
            break;
        }
      }
    }

    return extracted;
  }

  /**
   * Unwind a call chain to get all method calls in order
   */
  private unwindCallChain(node: ts.CallExpression): ts.Node[] {
    const chain: ts.Node[] = [];
    let current: ts.Node = node;

    while (current) {
      chain.push(current);

      if (
        ts.isCallExpression(current) &&
        ts.isPropertyAccessExpression(current.expression)
      ) {
        current = current.expression.expression;
      } else if (ts.isPropertyAccessExpression(current)) {
        current = current.expression;
      } else {
        break;
      }
    }

    return chain.reverse();
  }

  /**
   * Check if a node is an Animus identifier
   */
  private isAnimusIdentifier(node: ts.Node): boolean {
    if (ts.isIdentifier(node)) {
      const text = node.getText();
      return text === 'animus' || text === 'Animus';
    }

    // Handle imports like: import { animus } from '@animus-ui/core'
    return false;
  }

  /**
   * Extract a style object from an AST node
   */
  private extractStyleObject(
    node: ts.Node | undefined
  ): Record<string, any> | undefined {
    if (!node) return undefined;

    if (ts.isObjectLiteralExpression(node)) {
      const result: Record<string, any> = {};

      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop) && prop.name) {
          const key = this.getPropertyName(prop.name);
          const value = this.extractValue(prop.initializer);

          if (key && value !== undefined) {
            result[key] = value;
          }
        }
      }

      return result;
    }

    return undefined;
  }

  /**
   * Extract variant configuration
   */
  private extractVariantConfig(
    node: ts.Node | undefined
  ): Record<string, any> | null {
    if (!node || !ts.isObjectLiteralExpression(node)) return null;

    const config: Record<string, any> = {};

    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop) && prop.name) {
        const key = this.getPropertyName(prop.name);

        if (key === 'prop' && ts.isStringLiteral(prop.initializer)) {
          config.prop = prop.initializer.text;
        } else if (key === 'variants') {
          config.variants = this.extractStyleObject(prop.initializer);
        }
      }
    }

    return config.prop && config.variants ? config : null;
  }

  /**
   * Extract groups configuration
   */
  private extractGroups(node: ts.Node | undefined): string[] | undefined {
    if (!node || !ts.isObjectLiteralExpression(node)) return undefined;

    const groups: string[] = [];

    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop) && prop.name) {
        const key = this.getPropertyName(prop.name);
        const value = this.extractValue(prop.initializer);

        // If the value is truthy, include this group
        if (key && value) {
          groups.push(key);
        }
      }
    }

    return groups.length > 0 ? groups : undefined;
  }

  /**
   * Get property name from various property name types
   */
  private getPropertyName(name: ts.PropertyName): string | null {
    if (ts.isIdentifier(name)) {
      return name.text;
    } else if (ts.isStringLiteral(name)) {
      return name.text;
    } else if (ts.isComputedPropertyName(name)) {
      // Handle computed property names if needed
      return null;
    }
    return null;
  }

  /**
   * Extract value from an AST node
   */
  private extractValue(node: ts.Node): any {
    // String literals
    if (ts.isStringLiteral(node)) {
      return node.text;
    }

    // Numeric literals
    if (ts.isNumericLiteral(node)) {
      return parseFloat(node.text);
    }

    // Boolean literals
    if (node.kind === ts.SyntaxKind.TrueKeyword) {
      return true;
    }
    if (node.kind === ts.SyntaxKind.FalseKeyword) {
      return false;
    }

    // Arrays
    if (ts.isArrayLiteralExpression(node)) {
      return node.elements.map((element) => this.extractValue(element));
    }

    // Objects
    if (ts.isObjectLiteralExpression(node)) {
      return this.extractStyleObject(node);
    }

    // Template literals
    if (
      ts.isTemplateExpression(node) ||
      ts.isNoSubstitutionTemplateLiteral(node)
    ) {
      // For now, treat template literals as strings
      // In a full implementation, we'd need to evaluate these
      return node.getText().slice(1, -1); // Remove backticks
    }

    // Identifiers (for theme references, etc.)
    if (ts.isIdentifier(node)) {
      // This could be a reference to a theme value or constant
      // For now, return as string
      return node.text;
    }

    // Binary expressions (for computed values)
    if (ts.isBinaryExpression(node)) {
      // For now, return the text representation
      return node.getText();
    }

    // Default: return the text representation
    return node.getText();
  }
}
