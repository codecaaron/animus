import type { NodePath, types as BabelTypes } from '@babel/core';
import template from '@babel/template';
import type { Expression,JSXElement } from '@babel/types';

import { createAtomicClass } from './css-generator';
import type { AnimusExtractState,ComponentData } from './types';
import { isStaticValue } from './utils';

export function createRuntimeReplacement(
  componentData: ComponentData,
  state: AnimusExtractState
): BabelTypes.Expression {
  const { types: t } = state;

  if (state.options.runtimeFallback) {
    // Create a runtime wrapper that handles dynamic props
    const runtimeCall = template.expression(`
      __animus_runtime(ELEMENT, STATIC_CLASS, COMPONENT_DATA)
    `)({
      ELEMENT: t.stringLiteral(componentData.element || 'div'),
      STATIC_CLASS: t.stringLiteral(componentData.className || ''),
      COMPONENT_DATA: t.objectExpression([
        t.objectProperty(t.identifier('id'), t.stringLiteral(componentData.id)),
        t.objectProperty(t.identifier('props'), t.valueToNode(componentData.props || {})),
        t.objectProperty(t.identifier('states'), t.valueToNode(componentData.states || {})),
      ])
    });

    return runtimeCall;
  } else {
    // Create a simple component with static class
    const componentFunction = template.expression(`
      function(props) {
        return React.createElement(ELEMENT, {
          ...props,
          className: cx(STATIC_CLASS, props.className)
        }, props.children);
      }
    `)({
      ELEMENT: t.stringLiteral(componentData.element || 'div'),
      STATIC_CLASS: t.stringLiteral(componentData.className || '')
    });

    return componentFunction;
  }
}

export function transformToRuntime(
  path: NodePath<JSXElement>,
  componentData: ComponentData,
  state: AnimusExtractState
): void {
  const { types: t } = state;
  const opening = path.node.openingElement;
  const {attributes} = opening;

  const staticClasses: string[] = [];
  const dynamicProps: BabelTypes.JSXAttribute[] = [];
  const classNameAttr = findClassNameAttribute(attributes);

  // Add base component class if exists
  if (componentData.className) {
    staticClasses.push(componentData.className);
  }

  // Process each prop
  for (let i = attributes.length - 1; i >= 0; i--) {
    const attr = attributes[i];
    if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) continue;

    const propName = attr.name.name;

    // Skip className as we handle it separately
    if (propName === 'className') continue;

    // Check if this is an animus prop
    if (componentData.props && propName in componentData.props) {
      const value = extractJSXAttributeValue(attr, state);

      if (value !== undefined && isStaticValue(value)) {
        // Convert to atomic class
        const atomicClass = processStaticProp(propName, value, state);
        if (atomicClass) {
          staticClasses.push(atomicClass.className);
          // Store atomic class for CSS generation
          state.atomicClasses.set(atomicClass.className, atomicClass);
          // Remove the prop
          attributes.splice(i, 1);
        }
      } else {
        // Keep for runtime processing
        dynamicProps.push(attr);
      }
    }
  }

  // Handle responsive props
  transformResponsiveProps(attributes, staticClasses, state);

  // Update or add className
  updateClassName(path, staticClasses, classNameAttr, state);
}

function processStaticProp(
  propName: string,
  value: any,
  state: AnimusExtractState
): ReturnType<typeof createAtomicClass> {
  // Handle responsive values
  if (typeof value === 'object' && !Array.isArray(value)) {
    // This is a responsive object like { _: 2, md: 4 }
    const classes: ReturnType<typeof createAtomicClass>[] = [];

    for (const [breakpoint, breakpointValue] of Object.entries(value)) {
      const bp = breakpoint === '_' ? undefined : breakpoint;
      const atomicClass = createAtomicClass(propName, breakpointValue, state, bp);
      if (atomicClass) {
        classes.push(atomicClass);
      }
    }

    // Return the first one for now (we need to handle multiple)
    return classes[0] || null;
  }

  return createAtomicClass(propName, value, state, undefined);
}

function transformResponsiveProps(
  attributes: (BabelTypes.JSXAttribute | BabelTypes.JSXSpreadAttribute)[],
  staticClasses: string[],
  state: AnimusExtractState
): void {
  const { types: t } = state;

  for (let i = attributes.length - 1; i >= 0; i--) {
    const attr = attributes[i];
    if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) continue;

    const propName = attr.name.name;
    const value = extractJSXAttributeValue(attr, state);

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Handle responsive object
      let allStatic = true;
      const atomicClasses: ReturnType<typeof createAtomicClass>[] = [];

      for (const [breakpoint, breakpointValue] of Object.entries(value)) {
        if (!isStaticValue(breakpointValue)) {
          allStatic = false;
          break;
        }

        const bp = breakpoint === '_' ? undefined : breakpoint;
        const atomicClass = createAtomicClass(propName, breakpointValue, state, bp);
        if (atomicClass) {
          atomicClasses.push(atomicClass);
        }
      }

      if (allStatic && atomicClasses.length > 0) {
        // Add all atomic classes
        for (const atomicClass of atomicClasses) {
          if (atomicClass) {
            staticClasses.push(atomicClass.className);
            state.atomicClasses.set(atomicClass.className, atomicClass);
          }
        }
        // Remove the prop
        attributes.splice(i, 1);
      }
    }
  }
}

function findClassNameAttribute(
  attributes: (BabelTypes.JSXAttribute | BabelTypes.JSXSpreadAttribute)[]
): BabelTypes.JSXAttribute | null {
  for (const attr of attributes) {
    if (attr.type === 'JSXAttribute' &&
        attr.name.type === 'JSXIdentifier' &&
        attr.name.name === 'className') {
      return attr;
    }
  }
  return null;
}

function updateClassName(
  path: NodePath<JSXElement>,
  staticClasses: string[],
  existingClassNameAttr: BabelTypes.JSXAttribute | null,
  state: AnimusExtractState
): void {
  const { types: t } = state;

  if (staticClasses.length === 0 && !existingClassNameAttr) return;

  const classNameValue = staticClasses.join(' ');

  if (existingClassNameAttr) {
    // Merge with existing className
    if (t.isStringLiteral(existingClassNameAttr.value)) {
      existingClassNameAttr.value = t.stringLiteral(
        `${existingClassNameAttr.value.value} ${classNameValue}`.trim()
      );
    } else if (t.isJSXExpressionContainer(existingClassNameAttr.value)) {
      // Handle dynamic className
      existingClassNameAttr.value = t.jsxExpressionContainer(
        t.callExpression(
          t.identifier('cx'),
          [
            t.stringLiteral(classNameValue),
            existingClassNameAttr.value.expression as Expression
          ]
        )
      );
    }
  } else {
    // Add new className attribute
    const newClassNameAttr = t.jsxAttribute(
      t.jsxIdentifier('className'),
      t.stringLiteral(classNameValue)
    );
    path.node.openingElement.attributes.push(newClassNameAttr);
  }
}

function extractJSXAttributeValue(
  attr: BabelTypes.JSXAttribute,
  state: AnimusExtractState
): any {
  const { types: t } = state;

  if (!attr.value) return true; // Boolean prop

  if (t.isStringLiteral(attr.value)) {
    return attr.value.value;
  } else if (t.isJSXExpressionContainer(attr.value)) {
    const expr = attr.value.expression;

    if (t.isNumericLiteral(expr)) {
      return expr.value;
    } else if (t.isStringLiteral(expr)) {
      return expr.value;
    } else if (t.isBooleanLiteral(expr)) {
      return expr.value;
    } else if (t.isObjectExpression(expr)) {
      // Try to extract static object
      return extractStaticObject(expr, state);
    }
  }

  return undefined;
}

function extractStaticObject(
  node: BabelTypes.ObjectExpression,
  state: AnimusExtractState
): Record<string, any> | undefined {
  const { types: t } = state;
  const result: Record<string, any> = {};

  for (const prop of node.properties) {
    if (!t.isObjectProperty(prop)) return undefined;

    const key = t.isIdentifier(prop.key) ? prop.key.name :
                t.isStringLiteral(prop.key) ? prop.key.value :
                undefined;

    if (!key) return undefined;

    const value = extractStaticValue(prop.value, state);
    if (value === undefined) return undefined;

    result[key] = value;
  }

  return result;
}

function extractStaticValue(node: BabelTypes.Node, state: AnimusExtractState): any {
  const { types: t } = state;

  if (t.isNumericLiteral(node)) return node.value;
  if (t.isStringLiteral(node)) return node.value;
  if (t.isBooleanLiteral(node)) return node.value;
  if (t.isNullLiteral(node)) return null;

  return undefined;
}
