import type { NodePath, types as BabelTypes } from '@babel/core';
import type { CallExpression } from '@babel/types';

import { generateCSS } from './css-generator';
import { createRuntimeReplacement } from './transformer';
import type { AnimusExtractState, ComponentData, ExtractedChainCall } from './types';
import { generateComponentId } from './utils';

export function isAnimusBuilder(
  path: NodePath<CallExpression>,
  state: AnimusExtractState
): boolean {
  const { types: t } = state;
  const {callee} = path.node;

  // Direct call: animus.styles()
  if (
    t.isMemberExpression(callee) &&
    t.isIdentifier(callee.object) &&
    (callee.object.name === 'animus' || callee.object.name === state.animusBinding)
  ) {
    return true;
  }

  // Chained call: animus.styles().states()
  if (t.isMemberExpression(callee) && t.isCallExpression(callee.object)) {
    const objectPath = path.get('callee.object') as NodePath<CallExpression>;
    return isAnimusBuilder(objectPath, state);
  }

  return false;
}

function isAnimusChainCall(path: NodePath<CallExpression>, state: AnimusExtractState): boolean {
  const { types: t } = state;
  const {callee} = path.node;

  return t.isMemberExpression(callee) &&
    (isAnimusBuilder(path, state) ||
     (t.isCallExpression(callee.object) && isAnimusChainCall(path.get('callee.object') as NodePath<CallExpression>, state)));
}

export function extractAnimusComponent(
  path: NodePath<CallExpression>,
  state: AnimusExtractState
): void {
  const chain = extractChain(path, state);
  if (chain.length === 0) return;

  const componentData = processChain(chain, state);

  // Generate CSS for this component
  const css = generateCSS(componentData, state);
  if (css) {
    state.cssOutput.set(componentData.id, css);
  }

  // Store component data for JSX transformation
  if (componentData.name) {
    state.animusComponents.set(componentData.name, componentData);
  }

  // Replace the original expression with runtime version
  const replacement = createRuntimeReplacement(componentData, state);
  path.replaceWith(replacement);
}

function extractChain(
  path: NodePath<CallExpression>,
  state: AnimusExtractState
): ExtractedChainCall[] {
  const chain: ExtractedChainCall[] = [];
  let current: NodePath<CallExpression> | null = path;

  while (current && isAnimusChainCall(current, state)) {
    const { types: t } = state;
    const {callee} = current.node;

    if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
      const methodName = callee.property.name;
      const args = current.node.arguments;

      chain.unshift({ methodName, args });

      if (t.isCallExpression(callee.object)) {
        current = current.get('callee.object') as NodePath<CallExpression>;
      } else {
        current = null;
      }
    } else {
      current = null;
    }
  }

  return chain;
}

function processChain(
  chain: ExtractedChainCall[],
  state: AnimusExtractState
): ComponentData {
  const { types: t } = state;
  const componentData: ComponentData = {
    id: generateComponentId(),
  };

  for (const { methodName, args } of chain) {
    switch (methodName) {
      case 'styles':
        if (args[0] && t.isObjectExpression(args[0])) {
          componentData.styles = extractObjectLiteral(args[0], state);
        }
        break;

      case 'states':
        if (args[0] && t.isObjectExpression(args[0])) {
          componentData.states = extractObjectLiteral(args[0], state);
        }
        break;

      case 'variants':
        if (args[0] && t.isObjectExpression(args[0])) {
          componentData.variants = extractObjectLiteral(args[0], state);
        }
        break;

      case 'groups':
        if (args[0] && t.isObjectExpression(args[0])) {
          componentData.groups = extractObjectLiteral(args[0], state);
        }
        break;

      case 'props':
        if (args[0] && t.isObjectExpression(args[0])) {
          componentData.props = extractObjectLiteral(args[0], state);
        }
        break;

      case 'asElement':
        if (args[0] && t.isStringLiteral(args[0])) {
          componentData.element = args[0].value;
        }
        break;

      case 'displayName':
        if (args[0] && t.isStringLiteral(args[0])) {
          componentData.name = args[0].value;
        }
        break;
    }
  }

  return componentData;
}

function extractObjectLiteral(
  node: BabelTypes.ObjectExpression,
  state: AnimusExtractState
): Record<string, any> {
  const { types: t } = state;
  const result: Record<string, any> = {};

  for (const prop of node.properties) {
    if (t.isObjectProperty(prop) || t.isObjectMethod(prop)) {
      const key = getPropertyKey(prop, state);
      if (key && t.isObjectProperty(prop)) {
        const value = extractValue(prop.value, state);
        if (value !== undefined) {
          result[key] = value;
        }
      }
    }
  }

  return result;
}

function getPropertyKey(
  prop: BabelTypes.ObjectProperty | BabelTypes.ObjectMethod,
  state: AnimusExtractState
): string | null {
  const { types: t } = state;

  if (t.isIdentifier(prop.key)) {
    return prop.key.name;
  } else if (t.isStringLiteral(prop.key)) {
    return prop.key.value;
  }

  return null;
}

function extractValue(node: BabelTypes.Node, state: AnimusExtractState): any {
  const { types: t } = state;

  if (t.isStringLiteral(node)) {
    return node.value;
  } else if (t.isNumericLiteral(node)) {
    return node.value;
  } else if (t.isBooleanLiteral(node)) {
    return node.value;
  } else if (t.isObjectExpression(node)) {
    return extractObjectLiteral(node, state);
  } else if (t.isArrayExpression(node)) {
    return node.elements.map(el => el ? extractValue(el, state) : null);
  } else if (t.isUnaryExpression(node) && node.operator === '-' && t.isNumericLiteral(node.argument)) {
    return -node.argument.value;
  }

  // For dynamic values, return undefined to skip extraction
  return undefined;
}
