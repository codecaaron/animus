/**
 * TypeScript-based usage collector for Animus components
 * Extracts prop usage from JSX elements using TypeScript AST
 */

import * as ts from 'typescript';

import type { ComponentUsage } from './usageCollector';

/**
 * Extract component usage from TypeScript/TSX code
 */
export class TypeScriptUsageCollector {
  /**
   * Extract component usage from code
   */
  extractUsage(code: string, fileName: string = 'temp.tsx'): ComponentUsage[] {
    const sourceFile = ts.createSourceFile(
      fileName,
      code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );

    const usages: ComponentUsage[] = [];
    this.visitNode(sourceFile, usages, sourceFile);
    return usages;
  }

  /**
   * Visit AST nodes to find JSX elements
   */
  private visitNode(
    node: ts.Node,
    usages: ComponentUsage[],
    sourceFile: ts.SourceFile
  ): void {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const usage = this.extractJsxUsage(node, sourceFile);
      if (usage) {
        usages.push(usage);
      }
    }

    ts.forEachChild(node, (child) => this.visitNode(child, usages, sourceFile));
  }

  /**
   * Extract usage from a JSX element
   */
  private extractJsxUsage(
    node: ts.JsxElement | ts.JsxSelfClosingElement,
    sourceFile: ts.SourceFile
  ): ComponentUsage | null {
    const openingElement = ts.isJsxElement(node)
      ? node.openingElement
      : node;

    // Get component name
    const componentName = this.getComponentName(openingElement.tagName);
    if (!componentName) return null;

    // Only track capitalized components (not HTML elements)
    if (componentName[0] !== componentName[0].toUpperCase()) {
      return null;
    }

    // Extract props
    const props: Record<string, any> = {};
    
    if (openingElement.attributes) {
      openingElement.attributes.properties.forEach((attr) => {
        if (ts.isJsxAttribute(attr) && attr.name) {
          const propName = attr.name.getText();
          const propValue = this.extractAttributeValue(attr);
          
          if (propValue !== undefined) {
            props[propName] = propValue;
          }
        }
        // TODO: Handle spread attributes
      });
    }

    const usage: ComponentUsage = {
      componentName,
      props,
    };

    // Add location if available
    const pos = openingElement.getStart();
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(pos);
    usage.location = {
      line: line + 1,
      column: character,
    };

    return usage;
  }

  /**
   * Get component name from JSX tag name
   */
  private getComponentName(tagName: ts.JsxTagNameExpression): string | null {
    if (ts.isIdentifier(tagName)) {
      // Simple component: <Box />
      return tagName.text;
    } else if (ts.isPropertyAccessExpression(tagName)) {
      // Compound component: <Layout.Header />
      const objName = tagName.expression.getText();
      const propName = tagName.name.text;
      return `${objName}.${propName}`;
    }
    
    return null;
  }

  /**
   * Extract value from JSX attribute
   */
  private extractAttributeValue(attr: ts.JsxAttribute): any {
    if (!attr.initializer) {
      // Boolean prop like <Box disabled />
      return true;
    }

    if (ts.isStringLiteral(attr.initializer)) {
      // String value: prop="value"
      return attr.initializer.text;
    } else if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
      // Expression: prop={value}
      return this.extractExpressionValue(attr.initializer.expression);
    }

    return undefined;
  }

  /**
   * Extract value from an expression
   */
  private extractExpressionValue(expr: ts.Expression): any {
    if (ts.isStringLiteral(expr)) {
      return expr.text;
    } else if (ts.isNumericLiteral(expr)) {
      return parseFloat(expr.text);
    } else if (expr.kind === ts.SyntaxKind.TrueKeyword) {
      return true;
    } else if (expr.kind === ts.SyntaxKind.FalseKeyword) {
      return false;
    } else if (expr.kind === ts.SyntaxKind.NullKeyword) {
      return null;
    } else if (ts.isArrayLiteralExpression(expr)) {
      // Handle responsive arrays: p={[1, 2, 3]}
      const values: any[] = [];
      expr.elements.forEach((element) => {
        const value = this.extractExpressionValue(element);
        if (value !== undefined) {
          values.push(value);
        }
      });
      return values.length > 0 ? values : undefined;
    } else if (ts.isObjectLiteralExpression(expr)) {
      // Handle responsive objects: p={{ _: 1, sm: 2 }}
      const obj: Record<string, any> = {};
      expr.properties.forEach((prop) => {
        if (ts.isPropertyAssignment(prop) && prop.name) {
          const key = this.getPropertyKey(prop.name);
          if (key && prop.initializer) {
            const value = this.extractExpressionValue(prop.initializer);
            if (value !== undefined) {
              obj[key] = value;
            }
          }
        }
      });
      return Object.keys(obj).length > 0 ? obj : undefined;
    } else if (ts.isIdentifier(expr)) {
      // For now, return the identifier name
      // In a full implementation, we'd need to resolve the value
      return expr.text;
    }

    // For complex expressions, return a placeholder
    // In production, you might want to evaluate or track these differently
    return '__expression__';
  }

  /**
   * Get property key from property name
   */
  private getPropertyKey(name: ts.PropertyName): string | null {
    if (ts.isIdentifier(name)) {
      return name.text;
    } else if (ts.isStringLiteral(name)) {
      return name.text;
    }
    return null;
  }
}