/**
 * Style extraction from TypeScript AST nodes
 *
 * This module provides functionality to extract style properties from
 * TypeScript AST nodes, particularly object literals and expressions
 * used in Animus style definitions.
 */

import * as ts from 'typescript';

import { orderPropNames } from '../../properties/orderPropNames';
import type { Prop } from '../../types/config';
import type {
  CSSProperty,
  NodeId,
  SourcePosition,
  TrackedNode,
} from '../types';

// Import the Confidence enum as a value
import { Confidence } from '../types';

// ============================================================================
// Style Extraction Interfaces
// ============================================================================

export interface ExtractedStyles {
  readonly static: Map<string, CSSProperty>;
  readonly dynamic: Map<string, DynamicStyle>;
  readonly nested: Map<string, ExtractedStyles>;
  readonly confidence: Confidence;
}

export interface DynamicStyle {
  readonly property: string;
  readonly expression: ts.Expression;
  readonly possibleValues?: unknown[]; // If we can determine possible values
  readonly reason: string;
}

export interface StyleExtractor {
  extractFromObjectLiteral(
    node: ts.ObjectLiteralExpression
  ): ExtractedStyles;
  extractFromExpression(
    expr: ts.Expression
  ): ExtractedStyles;
}

// ============================================================================
// Style Extraction Implementation
// ============================================================================

export class StyleExtractorImpl implements StyleExtractor {
  constructor(private readonly typeChecker: ts.TypeChecker) {}

  extractFromObjectLiteral(node: ts.ObjectLiteralExpression): ExtractedStyles {
    const staticProps = new Map<string, CSSProperty>();
    const dynamicProps = new Map<string, DynamicStyle>();
    const nestedStyles = new Map<string, ExtractedStyles>();
    let overallConfidence = Confidence.STATIC;

    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;

      const propName = this.getPropertyName(prop);
      if (!propName) {
        overallConfidence = Math.min(overallConfidence, Confidence.DYNAMIC);
        continue;
      }

      // Handle nested selectors like &:hover
      if (propName.startsWith('&') || propName.startsWith(':')) {
        if (ts.isObjectLiteralExpression(prop.initializer)) {
          nestedStyles.set(
            propName,
            this.extractFromObjectLiteral(prop.initializer)
          );
        }
        continue;
      }

      // Try to evaluate the value statically
      const staticValue = this.tryEvaluateStatic(prop.initializer);

      // Check if it's a responsive value (array or object with breakpoint keys)
      if (this.isResponsiveStyleValue(staticValue)) {
        // For styles blocks, responsive values are handled differently
        // They generate media queries within the same class
        staticProps.set(propName, {
          name: propName,
          value: staticValue as any, // Preserve the responsive structure
          source: createNodeId(prop, prop.getSourceFile() as ts.SourceFile),
          confidence: Confidence.STATIC,
        });
      } else if (staticValue !== undefined && staticValue !== null) {
        staticProps.set(propName, {
          name: propName,
          value: staticValue as string | number,
          source: createNodeId(prop, prop.getSourceFile() as ts.SourceFile),
          confidence: Confidence.STATIC,
        });
      } else {
        dynamicProps.set(propName, {
          property: propName,
          expression: prop.initializer,
          reason: 'Non-literal value',
        });
        overallConfidence = Math.min(overallConfidence, Confidence.PARTIAL);
      }
    }

    // Sort properties by CSS precedence order
    const sortedStaticProps = this.sortStyleProperties(staticProps);
    const sortedDynamicProps = this.sortStyleProperties(dynamicProps);

    return {
      static: sortedStaticProps,
      dynamic: sortedDynamicProps,
      nested: nestedStyles,
      confidence: overallConfidence,
    };
  }

  extractFromExpression(expr: ts.Expression): ExtractedStyles {
    if (ts.isObjectLiteralExpression(expr)) {
      return this.extractFromObjectLiteral(expr);
    }

    // Handle other expression types
    return {
      static: new Map(),
      dynamic: new Map([
        [
          '_expression',
          {
            property: '_expression',
            expression: expr,
            reason: 'Non-object literal expression',
          },
        ],
      ]),
      nested: new Map(),
      confidence: Confidence.DYNAMIC,
    };
  }

  private getPropertyName(prop: ts.PropertyAssignment): string | null {
    if (ts.isIdentifier(prop.name)) {
      return prop.name.text;
    }
    if (ts.isStringLiteral(prop.name)) {
      return prop.name.text;
    }
    // Computed property - try to evaluate
    if (ts.isComputedPropertyName(prop.name)) {
      const value = this.tryEvaluateStatic(prop.name.expression);
      if (typeof value === 'string' || typeof value === 'number') {
        return String(value);
      }
    }
    return null;
  }

  private isResponsiveStyleValue(value: unknown): boolean {
    if (Array.isArray(value)) {
      return true;
    }
    if (value && typeof value === 'object' && !(value instanceof Object && 'kind' in value)) {
      // Check if keys match breakpoint patterns
      const keys = Object.keys(value);
      const breakpointPatterns = ['xs', 'sm', 'md', 'lg', 'xl', '_', '@'];
      return keys.some((key) =>
        breakpointPatterns.some((pattern) => key.startsWith(pattern))
      );
    }
    return false;
  }

  private tryEvaluateStatic(expr: ts.Expression): unknown {
    // Literal values
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
      return expr.text;
    }

    if (ts.isNumericLiteral(expr)) {
      return Number(expr.text);
    }

    if (expr.kind === ts.SyntaxKind.TrueKeyword) {
      return true;
    }

    if (expr.kind === ts.SyntaxKind.FalseKeyword) {
      return false;
    }

    if (expr.kind === ts.SyntaxKind.NullKeyword) {
      return null;
    }

    // Template literal
    if (ts.isTemplateExpression(expr) && expr.templateSpans.length === 0) {
      return expr.head.text;
    }

    // Array literal (for responsive array syntax)
    if (ts.isArrayLiteralExpression(expr)) {
      const elements: any[] = [];
      for (const element of expr.elements) {
        const value = this.tryEvaluateStatic(element);
        elements.push(value);
      }
      return elements;
    }

    // Object literal (for responsive object syntax)
    if (ts.isObjectLiteralExpression(expr)) {
      const obj: Record<string, any> = {};
      for (const prop of expr.properties) {
        if (ts.isPropertyAssignment(prop)) {
          const key = prop.name?.getText();
          if (key && prop.initializer) {
            const value = this.tryEvaluateStatic(prop.initializer);
            obj[key] = value;
          }
        }
      }
      return obj;
    }

    // Prefix unary expression (e.g., -5)
    if (ts.isPrefixUnaryExpression(expr)) {
      const value = this.tryEvaluateStatic(expr.operand);
      if (
        typeof value === 'number' &&
        expr.operator === ts.SyntaxKind.MinusToken
      ) {
        return -value;
      }
    }

    // Binary expression (e.g., 10 + 5)
    if (ts.isBinaryExpression(expr)) {
      const left = this.tryEvaluateStatic(expr.left);
      const right = this.tryEvaluateStatic(expr.right);

      if (typeof left === 'number' && typeof right === 'number') {
        switch (expr.operatorToken.kind) {
          case ts.SyntaxKind.PlusToken:
            return left + right;
          case ts.SyntaxKind.MinusToken:
            return left - right;
          case ts.SyntaxKind.AsteriskToken:
            return left * right;
          case ts.SyntaxKind.SlashToken:
            return left / right;
        }
      }

      if (
        typeof left === 'string' &&
        typeof right === 'string' &&
        expr.operatorToken.kind === ts.SyntaxKind.PlusToken
      ) {
        return left + right;
      }
    }

    // Can't evaluate statically
    return undefined;
  }

  private sortStyleProperties<T extends { [key: string]: any }>(
    props: Map<string, T>
  ): Map<string, T> {
    // Create a simple prop config for CSS properties
    const propConfig: Record<string, Prop> = {};

    props.forEach((_, propName) => {
      // For CSS properties in styles/variants/states, we use the property name directly
      propConfig[propName] = {
        property: propName as any,
      };
    });

    // Get ordered property names
    const orderedNames = orderPropNames(propConfig);

    // Create new sorted map
    const sorted = new Map<string, T>();

    // Add properties in order
    orderedNames.forEach((name) => {
      const value = props.get(name);
      if (value) {
        sorted.set(name, value);
      }
    });

    // Add any properties that weren't in the ordered list
    props.forEach((value, key) => {
      if (!sorted.has(key)) {
        sorted.set(key, value);
      }
    });

    return sorted;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

function createNodeId(node: ts.Node, sourceFile: ts.SourceFile): NodeId {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart()
  );
  return `${sourceFile.fileName}:${line + 1}:${character + 1}:${ts.SyntaxKind[node.kind]}`;
}

function getSourcePosition(
  node: ts.Node,
  sourceFile: ts.SourceFile
): SourcePosition {
  const start = node.getStart();
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
  return {
    fileName: sourceFile.fileName,
    line: line + 1,
    column: character + 1,
    offset: start,
  };
}

function createTrackedNode<T extends ts.Node>(
  node: T,
  sourceFile: ts.SourceFile,
  parent?: NodeId
): TrackedNode<T> {
  return {
    id: createNodeId(node, sourceFile),
    node,
    position: getSourcePosition(node, sourceFile),
    parent,
  };
}

// Re-export utility functions for use by other modules
export { createNodeId, getSourcePosition, createTrackedNode };