import * as parser from '@babel/parser';
import * as t from '@babel/types';

// Handle the babel/traverse CommonJS export issue
// @ts-ignore - babel/traverse has complex module exports
import traverseDefault from '@babel/traverse';
const traverse = (traverseDefault as any).default || traverseDefault;
import type { NodePath } from '@babel/traverse';

/**
 * Usage value with optional breakpoint information
 */
export interface UsageValue {
  value: any;
  breakpoint?: string; // '_' for base, 'sm', 'md', etc.
}

/**
 * Map of component usage - tracks which prop values are actually used
 */
export interface UsageMap {
  [componentName: string]: {
    [propName: string]: Set<string>; // Set of "value:breakpoint" strings
  };
}

/**
 * Component reference found in JSX
 */
export interface ComponentUsage {
  componentName: string;
  props: Record<string, any>;
  location?: {
    line: number;
    column: number;
  };
}

/**
 * Extract component usage from JSX in code
 */
export function extractComponentUsage(code: string): ComponentUsage[] {
  const ast = parser.parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  });

  const usages: ComponentUsage[] = [];

  traverse(ast as any, {
    JSXOpeningElement(path: NodePath<t.JSXOpeningElement>) {
      // Get component name
      let componentName: string | null = null;

      if (t.isJSXIdentifier(path.node.name)) {
        // Simple component: <Box />
        const name = path.node.name.name;
        // Only track capitalized components (not HTML elements)
        if (name[0] === name[0].toUpperCase()) {
          componentName = name;
        }
      } else if (
        t.isJSXMemberExpression(path.node.name) &&
        t.isJSXIdentifier(path.node.name.object) &&
        t.isJSXIdentifier(path.node.name.property)
      ) {
        // Compound component: <Layout.Header />
        componentName = `${path.node.name.object.name}.${path.node.name.property.name}`;
      }

      if (!componentName) return;

      // Extract props
      const props: Record<string, any> = {};

      for (const attr of path.node.attributes) {
        if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name)) {
          const propName = attr.name.name;
          let propValue: any = true; // default for boolean props like <Box disabled />

          if (attr.value) {
            if (t.isJSXExpressionContainer(attr.value)) {
              // {expression}
              propValue = extractJSXExpressionValue(attr.value.expression);
            } else if (t.isStringLiteral(attr.value)) {
              // "string"
              propValue = attr.value.value;
            }
          }

          if (propValue !== undefined) {
            props[propName] = propValue;
          }
        }
        // TODO: Handle spread props {...props}
      }

      const usage: ComponentUsage = {
        componentName,
        props,
      };

      // Add location for debugging
      if (path.node.loc) {
        usage.location = {
          line: path.node.loc.start.line,
          column: path.node.loc.start.column,
        };
      }

      usages.push(usage);
    },
  });

  return usages;
}

/**
 * Extract value from JSX expression container
 */
function extractJSXExpressionValue(
  node: t.Expression | t.JSXEmptyExpression
): any {
  if (t.isStringLiteral(node)) {
    return node.value;
  } else if (t.isNumericLiteral(node)) {
    return node.value;
  } else if (t.isBooleanLiteral(node)) {
    return node.value;
  } else if (t.isNullLiteral(node)) {
    return null;
  } else if (t.isArrayExpression(node)) {
    // Handle responsive arrays: p={[1, 2, 3]}
    const values = [];
    for (const el of node.elements) {
      if (el && t.isExpression(el)) {
        const value = extractJSXExpressionValue(el);
        if (value !== undefined) {
          values.push(value);
        }
      }
    }
    return values.length > 0 ? values : undefined;
  } else if (t.isObjectExpression(node)) {
    // Handle responsive objects: p={{ _: 1, sm: 2 }}
    const obj: Record<string, any> = {};
    for (const prop of node.properties) {
      if (t.isObjectProperty(prop) && !prop.computed) {
        const key = t.isIdentifier(prop.key)
          ? prop.key.name
          : t.isStringLiteral(prop.key)
            ? prop.key.value
            : null;

        if (key && t.isExpression(prop.value)) {
          const value = extractJSXExpressionValue(prop.value);
          if (value !== undefined) {
            obj[key] = value;
          }
        }
      }
    }
    return Object.keys(obj).length > 0 ? obj : undefined;
  }

  // Return undefined for non-literal expressions
  return undefined;
}

/**
 * Build usage map from component usages
 */
export function buildUsageMap(usages: ComponentUsage[]): UsageMap {
  const map: UsageMap = {};

  // Breakpoint order from propertyMappings
  const breakpointOrder = ['_', 'xs', 'sm', 'md', 'lg', 'xl'];

  for (const usage of usages) {
    if (!map[usage.componentName]) {
      map[usage.componentName] = {};
    }

    for (const [propName, propValue] of Object.entries(usage.props)) {
      if (!map[usage.componentName][propName]) {
        map[usage.componentName][propName] = new Set();
      }

      // Handle different value types
      if (Array.isArray(propValue)) {
        // Responsive array: map to breakpoints
        propValue.forEach((v, index) => {
          if (v !== undefined && index < breakpointOrder.length) {
            const breakpoint = breakpointOrder[index];
            map[usage.componentName][propName].add(`${v}:${breakpoint}`);
          }
        });
      } else if (
        propValue &&
        typeof propValue === 'object' &&
        !Array.isArray(propValue)
      ) {
        // Responsive object: extract breakpoint from keys
        Object.entries(propValue).forEach(([breakpoint, v]) => {
          if (v !== undefined) {
            map[usage.componentName][propName].add(`${v}:${breakpoint}`);
          }
        });
      } else {
        // Single value - base breakpoint
        map[usage.componentName][propName].add(`${propValue}:_`);
      }
    }
  }

  return map;
}

/**
 * Merge multiple usage maps
 */
export function mergeUsageMaps(...maps: UsageMap[]): UsageMap {
  const merged: UsageMap = {};

  for (const map of maps) {
    for (const [componentName, props] of Object.entries(map)) {
      if (!merged[componentName]) {
        merged[componentName] = {};
      }

      for (const [propName, values] of Object.entries(props)) {
        if (!merged[componentName][propName]) {
          merged[componentName][propName] = new Set();
        }

        values.forEach((v) => merged[componentName][propName].add(v));
      }
    }
  }

  return merged;
}
