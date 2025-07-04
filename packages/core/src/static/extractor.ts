import * as parser from '@babel/parser';
// Handle the babel/traverse CommonJS export issue
// @ts-ignore - babel/traverse has complex module exports
import traverseDefault from '@babel/traverse';
import * as t from '@babel/types';

const traverse = (traverseDefault as any).default || traverseDefault;

import type { NodePath } from '@babel/traverse';

/**
 * Extracted style data from an Animus component
 */
export interface ExtractedStyles {
  componentName?: string;
  baseStyles?: Record<string, any>;
  variants?: Record<string, any> | Record<string, any>[];
  states?: Record<string, any>;
  groups?: string[];
  props?: Record<string, any>;
}

/**
 * Extract styles from Animus method chains in code
 */
export function extractStylesFromCode(code: string): ExtractedStyles[] {
  const ast = parser.parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  });

  const extractedComponents: ExtractedStyles[] = [];

  traverse(ast as any, {
    CallExpression(path: NodePath<t.CallExpression>) {
      // Look for .styles() calls
      if (
        t.isMemberExpression(path.node.callee) &&
        t.isIdentifier(path.node.callee.property, { name: 'styles' })
      ) {
        const extracted: ExtractedStyles = {};

        // Try to get component name from variable declaration
        const varDeclarator = path.findParent((p: NodePath) =>
          p.isVariableDeclarator()
        );
        if (varDeclarator && t.isVariableDeclarator(varDeclarator.node)) {
          if (t.isIdentifier(varDeclarator.node.id)) {
            extracted.componentName = varDeclarator.node.id.name;
          }
        }

        // Extract styles object from first argument
        const stylesArg = path.node.arguments[0];
        if (t.isObjectExpression(stylesArg)) {
          extracted.baseStyles = extractObjectLiteral(stylesArg);
        }

        // Look for chained method calls by traversing up the AST
        // We need to find the full chain starting from .styles()
        const chainedCalls: any[] = [];
        let currentPath: any = path;

        // Traverse up to find all chained calls
        while (currentPath) {
          if (
            t.isCallExpression(currentPath.node) &&
            t.isMemberExpression(currentPath.node.callee) &&
            t.isIdentifier(currentPath.node.callee.property)
          ) {
            chainedCalls.push({
              method: currentPath.node.callee.property.name,
              args: currentPath.node.arguments,
            });
          }

          // Check if parent is also a call expression (chained)
          if (
            currentPath.parentPath &&
            t.isMemberExpression(currentPath.parentPath.node) &&
            currentPath.parentPath.parentPath &&
            t.isCallExpression(currentPath.parentPath.parentPath.node)
          ) {
            currentPath = currentPath.parentPath.parentPath;
          } else {
            break;
          }
        }

        // Process chained calls in order
        const variantCalls: any[] = [];

        for (const call of chainedCalls) {
          if (call.method === 'variant' && call.args[0]) {
            const variantArg = call.args[0];
            if (t.isObjectExpression(variantArg)) {
              variantCalls.push(extractObjectLiteral(variantArg));
            }
          } else if (call.method === 'states' && call.args[0]) {
            const statesArg = call.args[0];
            if (t.isObjectExpression(statesArg)) {
              extracted.states = extractObjectLiteral(statesArg);
            }
          } else if (call.method === 'groups' && call.args[0]) {
            const groupsArg = call.args[0];
            if (t.isObjectExpression(groupsArg)) {
              const groups = extractObjectLiteral(groupsArg);
              extracted.groups = Object.keys(groups).filter(
                (key) => groups[key]
              );
            }
          } else if (call.method === 'props' && call.args[0]) {
            const propsArg = call.args[0];
            if (t.isObjectExpression(propsArg)) {
              extracted.props = extractObjectLiteral(propsArg);
            }
          }
        }

        // Store variants - if multiple, keep as array; if single, flatten
        if (variantCalls.length > 1) {
          extracted.variants = variantCalls;
        } else if (variantCalls.length === 1) {
          extracted.variants = variantCalls[0];
        }

        extractedComponents.push(extracted);
      }
    },
  });

  return extractedComponents;
}

/**
 * Extract a literal object from an AST ObjectExpression
 */
function extractObjectLiteral(node: t.ObjectExpression): Record<string, any> {
  const result: Record<string, any> = {};

  for (const prop of node.properties) {
    if (t.isObjectProperty(prop) && !prop.computed) {
      const key = t.isIdentifier(prop.key)
        ? prop.key.name
        : t.isStringLiteral(prop.key)
          ? prop.key.value
          : null;

      if (key) {
        const value = extractValue(prop.value);
        if (value !== undefined) {
          result[key] = value;
        }
      }
    }
  }

  return result;
}

/**
 * Extract a literal value from an AST node
 */
function extractValue(node: t.Node): any {
  if (t.isStringLiteral(node)) {
    return node.value;
  } else if (t.isNumericLiteral(node)) {
    return node.value;
  } else if (t.isBooleanLiteral(node)) {
    return node.value;
  } else if (t.isNullLiteral(node)) {
    return null;
  } else if (t.isObjectExpression(node)) {
    return extractObjectLiteral(node);
  } else if (t.isArrayExpression(node)) {
    return node.elements
      .filter((el): el is t.Expression | t.SpreadElement => el !== null)
      .map((el) => (t.isExpression(el) ? extractValue(el) : undefined))
      .filter((v) => v !== undefined);
  } else if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
    // Simple template literal with no expressions
    return node.quasis[0].value.cooked;
  }

  // Return undefined for non-literal expressions
  return undefined;
}
