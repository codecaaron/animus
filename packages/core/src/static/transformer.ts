/**
 * AST Transformer for Animus components
 * Transforms runtime builder chains into static shimmed components
 */

import * as parser from '@babel/parser';
// Handle the babel/traverse CommonJS export issue
// @ts-ignore - babel/traverse has complex module exports
import traverseDefault from '@babel/traverse';
import * as t from '@babel/types';
import MagicString from 'magic-string';

const traverse = (traverseDefault as any).default || traverseDefault;

import type { NodePath } from '@babel/traverse';

import { extractStylesFromCode } from './extractor';
import type { ComponentRuntimeMetadata } from './generator';
import type { ExtractedComponentGraph } from './graph-cache';
import { UsageTracker } from './usage-tracker';

export interface TransformResult {
  code: string;
  map?: any;
  metadata?: Record<string, ComponentRuntimeMetadata>;
}

export interface TransformOptions {
  componentMetadata: Record<string, ComponentRuntimeMetadata>;
  rootDir: string;
  generateMetadata?: boolean; // Whether to generate metadata if not provided
  shimImportPath?: string; // Custom import path for runtime shim
  injectMetadata?: 'inline' | 'external' | 'both'; // How to inject metadata
  preserveDevExperience?: boolean; // Keep runtime behavior in dev
  componentGraph?: ExtractedComponentGraph; // Complete component graph for usage tracking
  usageTracker?: UsageTracker; // Shared usage tracker instance
}

/**
 * Transform Animus code to use runtime shims
 */
export async function transformAnimusCode(
  code: string,
  filename: string,
  options: TransformOptions
): Promise<TransformResult | null> {
  // Quick check to see if this file has animus imports
  if (!code.includes('animus') || !code.includes('@animus-ui/core')) {
    return null;
  }

  // First extract styles to get metadata
  const extractedComponents = extractStylesFromCode(code);
  const extractedMetadata = new Map<string, any>();

  for (const component of extractedComponents) {
    if (component.componentName) {
      extractedMetadata.set(component.componentName, component);
    }
  }

  const ast = parser.parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
    sourceFilename: filename,
  });

  const s = new MagicString(code);
  const metadata: Record<string, ComponentRuntimeMetadata> = {};
  let hasTransformations = false;
  let hasAnimusImport = false;
  let animusImportName = 'animus';

  // Note: JSX usage tracking removed - we use the complete component graph instead
  // First pass: identify animus imports
  traverse(ast as any, {
    ImportDeclaration(path: NodePath<t.ImportDeclaration>) {
      if (path.node.source.value === '@animus-ui/core') {
        hasAnimusImport = true;

        // Find the imported name for animus
        for (const spec of path.node.specifiers) {
          if (
            t.isImportSpecifier(spec) &&
            t.isIdentifier(spec.imported) &&
            spec.imported.name === 'animus'
          ) {
            animusImportName = spec.local.name;
          }
        }

        // Replace the import
        const start = path.node.start!;
        const end = path.node.end!;
        const shimPath = options.shimImportPath || '@animus-ui/core/runtime';

        if (options.preserveDevExperience) {
          // Keep original import and add shim import
          s.appendLeft(
            end + 1,
            `\nimport { createShimmedComponent } from '${shimPath}';`
          );
        } else {
          // Replace the import entirely
          s.overwrite(
            start,
            end,
            `import { createShimmedComponent } from '${shimPath}';`
          );
        }
        hasTransformations = true;
      }
    },
  });

  if (!hasAnimusImport) {
    return null;
  }

  // Second pass: transform animus builder chains
  traverse(ast as any, {
    VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
      // Check if this is an animus component declaration
      if (!t.isIdentifier(path.node.id)) return;

      const componentName = path.node.id.name;
      const init = path.node.init;

      if (!init) return;

      // Check if this is an extend chain first
      const baseComponentName = isExtendChain(init);
      if (baseComponentName) {
        // This is an extend chain
        const terminalCall = getTerminalCall(init);
        if (!terminalCall) return;

        const { method, elementType } = terminalCall;

        // Get parent metadata
        const parentMeta =
          options.componentMetadata[baseComponentName] ||
          metadata[baseComponentName];
        if (!parentMeta) {
          // Parent not found, skip transformation
          return;
        }

        // Create metadata for extended component
        metadata[componentName] = {
          ...parentMeta,
          baseClass: `animus-${generateHash(componentName)}`,
          extends: {
            from: baseComponentName,
            hash: generateHash(baseComponentName),
          },
        } as ComponentRuntimeMetadata & {
          extends?: { from: string; hash: string };
        };

        // Transform the declaration
        const start = init.start!;
        const end = init.end!;

        if (method === 'asElement' && elementType) {
          s.overwrite(
            start,
            end,
            `createShimmedComponent('${elementType}', '${componentName}')`
          );
          hasTransformations = true;
        }
        return;
      }

      // Regular animus chain
      if (!isAnimusChain(init, animusImportName)) return;

      // Extract the terminal method and element type
      const terminalCall = getTerminalCall(init);
      if (!terminalCall) return;

      const { method, elementType } = terminalCall;

      // Check if we have pre-generated metadata
      let componentMeta: ComponentRuntimeMetadata;

      if (options.componentMetadata[componentName]) {
        // Use pre-generated metadata from CSS extraction
        componentMeta = options.componentMetadata[componentName];
      } else if (options.generateMetadata !== false) {
        // Fallback: generate metadata from extraction
        const extracted = extractedMetadata.get(componentName);
        componentMeta = {
          baseClass: `animus-${generateHash(componentName)}`,
          variants: {},
          states: {},
          systemProps: [],
          groups: extracted?.groups || [],
          customProps: [],
        };

        // Process variants
        if (extracted?.variants) {
          const variants = Array.isArray(extracted.variants)
            ? extracted.variants
            : [extracted.variants];
          for (const variant of variants) {
            if (variant.prop && variant.variants) {
              componentMeta.variants[variant.prop] = {};
              for (const [variantName, _] of Object.entries(variant.variants)) {
                componentMeta.variants[variant.prop][variantName] =
                  `animus-${generateHash(componentName)}-${variant.prop}-${variantName}`;
              }
            }
          }
        }

        // Process states
        if (extracted?.states) {
          for (const [stateName, _] of Object.entries(extracted.states)) {
            componentMeta.states[stateName] =
              `animus-${generateHash(componentName)}-state-${stateName}`;
          }
        }

        // Process custom props
        if (extracted?.props) {
          componentMeta.customProps = Object.keys(extracted.props);
        }
      } else {
        // No metadata available and generation disabled
        // Skip transformation for this component
        return;
      }

      // Store metadata
      metadata[componentName] = componentMeta;

      // Get component hash from graph if available
      let componentHash = '';
      if (options.componentGraph) {
        for (const [hash, node] of options.componentGraph.components) {
          if (
            node.identity.name === componentName &&
            node.identity.filePath === filename
          ) {
            componentHash = hash;
            break;
          }
        }
      }

      // Create human-readable identifier
      const componentId = componentHash
        ? `${componentName}-${componentHash}`
        : componentName;

      // Transform the declaration
      const start = init.start!;
      const end = init.end!;

      if (method === 'asElement' && elementType) {
        s.overwrite(
          start,
          end,
          `createShimmedComponent('${elementType}', '${componentId}')`
        );
        hasTransformations = true;
      } else if (method === 'asComponent') {
        // For asComponent, we need to handle it differently
        // This is a simplified version - real implementation would be more complex
        s.overwrite(
          start,
          end,
          `createShimmedComponent('div', '${componentId}')`
        );
        hasTransformations = true;
      }
    },

    // Handle direct exports
    ExportDefaultDeclaration(path: NodePath<t.ExportDefaultDeclaration>) {
      const decl = path.node.declaration;

      if (isAnimusChain(decl, animusImportName)) {
        // Generate a name for the component
        const componentName = 'AnimusComponent';
        const terminalCall = getTerminalCall(decl);

        if (
          terminalCall &&
          terminalCall.method === 'asElement' &&
          terminalCall.elementType
        ) {
          const start = path.node.start!;
          const end = path.node.end!;

          // For default exports, we need to find the hash
          let componentHash = '';
          if (options.componentGraph) {
            for (const [hash, node] of options.componentGraph.components) {
              if (
                node.identity.exportName === 'default' &&
                node.identity.filePath === filename
              ) {
                componentHash = hash;
                break;
              }
            }
          }

          const componentId = componentHash
            ? `${componentName}-${componentHash}`
            : componentName;

          s.overwrite(
            start,
            end,
            `const ${componentName} = createShimmedComponent('${terminalCall.elementType}', '${componentId}');\nexport default ${componentName}`
          );

          hasTransformations = true;

          // Add metadata (for default export we don't have extraction data)
          metadata[componentName] = {
            baseClass: `animus-${generateHash(componentName)}`,
            variants: {},
            states: {},
            systemProps: [],
            groups: [],
            customProps: [],
          };
        }
      }
    },

    // Handle named exports
    ExportNamedDeclaration(path: NodePath<t.ExportNamedDeclaration>) {
      if (
        path.node.declaration &&
        t.isVariableDeclaration(path.node.declaration)
      ) {
        // The VariableDeclarator visitor will handle the transformation
        // We don't need to do anything special here
      }
    },
  });

  // Third pass: Track JSX usage if we have a usage tracker
  // NOTE: Since React transforms JSX before our transformer runs, we need to track jsx() calls
  if (options.usageTracker && options.componentGraph) {
    traverse(ast as any, {
      CallExpression(path: NodePath<t.CallExpression>) {
        // Look for jsx() or jsxs() calls from react/jsx-runtime
        const callee = path.node.callee;
        if (!t.isIdentifier(callee)) return;

        const funcName = callee.name;
        if (funcName !== 'jsx' && funcName !== 'jsxs') return;

        // Get the component and props arguments
        const args = path.node.arguments;
        if (args.length < 2) return;

        const componentArg = args[0];
        if (!t.isIdentifier(componentArg)) return;

        const componentName = componentArg.name;

        // Skip HTML elements (they would be strings, not identifiers)

        // Find component in graph
        let componentNode = null;
        let componentHash = '';

        for (const [hash, node] of options.componentGraph!.components) {
          if (node.identity.name === componentName) {
            componentNode = node;
            componentHash = hash;
            break;
          }
        }

        if (!componentNode) {
          return;
        }

        // Extract props from the second argument
        const propsArg = args[1];
        const props: Record<string, any> = {};

        if (t.isObjectExpression(propsArg)) {
          for (const prop of propsArg.properties) {
            if (t.isObjectProperty(prop) || t.isObjectMethod(prop)) {
              if (t.isIdentifier(prop.key)) {
                const propName = prop.key.name;

                if (t.isObjectProperty(prop)) {
                  const propValue = prop.value;

                  if (
                    t.isStringLiteral(propValue) ||
                    t.isNumericLiteral(propValue)
                  ) {
                    props[propName] = propValue.value;
                  } else if (t.isBooleanLiteral(propValue)) {
                    props[propName] = propValue.value;
                  } else if (t.isArrayExpression(propValue)) {
                    // Handle responsive arrays
                    const values = [];
                    for (const element of propValue.elements) {
                      if (
                        t.isStringLiteral(element) ||
                        t.isNumericLiteral(element)
                      ) {
                        values.push(element.value);
                      } else if (t.isNullLiteral(element) || !element) {
                        values.push(undefined);
                      }
                    }
                    props[propName] = values;
                  } else if (t.isObjectExpression(propValue)) {
                    // Handle responsive objects
                    const obj: Record<string, any> = {};
                    for (const objProp of propValue.properties) {
                      if (
                        t.isObjectProperty(objProp) &&
                        t.isIdentifier(objProp.key)
                      ) {
                        const key = objProp.key.name;
                        if (
                          t.isStringLiteral(objProp.value) ||
                          t.isNumericLiteral(objProp.value)
                        ) {
                          obj[key] = objProp.value.value;
                        }
                      }
                    }
                    props[propName] = obj;
                  } else {
                    // Dynamic value, just mark as used
                    props[propName] = true;
                  }
                }
              }
            }
          }
        }

        // Record usage
        options.usageTracker!.recordComponentUsage(
          componentNode.identity,
          props
        );

        // Track specific variant/state usage
        for (const [propName, propValue] of Object.entries(props)) {
          // Check if this is a variant prop
          if (componentNode.allVariants[propName]) {
            options.usageTracker!.recordVariantUsage(
              componentHash,
              propName,
              String(propValue)
            );
          }

          // Check if this is a state prop
          if (componentNode.allStates.has(propName) && propValue === true) {
            options.usageTracker!.recordStateUsage(componentHash, propName);
          }
        }
      },
    });
  }

  if (!hasTransformations && !options.usageTracker) {
    return null;
  }

  // Inject metadata based on configuration
  if (
    Object.keys(metadata).length > 0 &&
    options.injectMetadata !== 'external'
  ) {
    const shimPath = options.shimImportPath || '@animus-ui/core/runtime';
    const metadataCode = `
// Component metadata injected by build tool
const __animusMetadata = ${JSON.stringify(metadata, null, 2)};

// Initialize shim with metadata
import { initializeAnimusShim } from '${shimPath}';
initializeAnimusShim(__animusMetadata);
`;

    // Find the position after imports
    let insertPosition = 0;
    traverse(ast as any, {
      ImportDeclaration(path: NodePath<t.ImportDeclaration>) {
        if (path.node.end! > insertPosition) {
          insertPosition = path.node.end!;
        }
      },
    });

    s.appendLeft(insertPosition, metadataCode);
  }

  return {
    code: s.toString(),
    map: s.generateMap({ hires: true }),
    metadata,
  };
}

/**
 * Check if a node is an extend chain (Component.extend()...)
 */
function isExtendChain(node: t.Node): string | null {
  if (t.isCallExpression(node)) {
    // Check if it's a chained call
    if (t.isMemberExpression(node.callee)) {
      const object = node.callee.object;
      const property = node.callee.property;

      // Check if it ends with .asElement() or .asComponent()
      if (
        t.isIdentifier(property) &&
        (property.name === 'asElement' || property.name === 'asComponent')
      ) {
        // Traverse up the chain to find .extend()
        const baseComponent = findExtendBase(object);
        return baseComponent;
      }

      // Check if it's part of a chain
      return isExtendChain(object);
    }
  }

  return null;
}

/**
 * Find the base component in an extend chain
 */
function findExtendBase(node: t.Node): string | null {
  if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
    const property = node.callee.property;

    // Found .extend() call
    if (t.isIdentifier(property) && property.name === 'extend') {
      const object = node.callee.object;
      if (t.isIdentifier(object)) {
        return object.name;
      }
    }

    // Continue searching up the chain
    return findExtendBase(node.callee.object);
  }

  if (t.isMemberExpression(node)) {
    return findExtendBase(node.object);
  }

  return null;
}

/**
 * Check if a node is an animus builder chain
 */
function isAnimusChain(node: t.Node, animusImportName: string): boolean {
  if (t.isCallExpression(node)) {
    // Check if it's a chained call
    if (t.isMemberExpression(node.callee)) {
      const object = node.callee.object;

      // Check if it ends with .asElement() or .asComponent()
      const property = node.callee.property;
      if (
        t.isIdentifier(property) &&
        (property.name === 'asElement' || property.name === 'asComponent')
      ) {
        // Traverse up the chain to find animus
        return hasAnimusInChain(object, animusImportName);
      }

      // Check if it's part of a chain
      return isAnimusChain(object, animusImportName);
    }
  }

  return false;
}

/**
 * Check if the chain contains animus
 */
function hasAnimusInChain(node: t.Node, animusImportName: string): boolean {
  if (t.isIdentifier(node) && node.name === animusImportName) {
    return true;
  }

  if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
    return hasAnimusInChain(node.callee.object, animusImportName);
  }

  if (t.isMemberExpression(node)) {
    return hasAnimusInChain(node.object, animusImportName);
  }

  return false;
}

/**
 * Get the terminal method call and its argument
 */
function getTerminalCall(
  node: t.Node
): { method: string; elementType?: string } | null {
  if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
    const property = node.callee.property;

    if (t.isIdentifier(property)) {
      if (property.name === 'asElement' && node.arguments.length > 0) {
        const arg = node.arguments[0];
        if (t.isStringLiteral(arg)) {
          return { method: 'asElement', elementType: arg.value };
        }
      } else if (property.name === 'asComponent') {
        return { method: 'asComponent' };
      }
    }
  }

  return null;
}

/**
 * Generate a component hash matching the CSS generator format
 * Must match the format in generator.ts generateComponentHash()
 */
function generateHash(componentName: string): string {
  // Match the CSS generator format: ComponentName-firstLetterLengthLastLetter
  const first = componentName.charAt(0).toLowerCase();
  const last = componentName.charAt(componentName.length - 1).toLowerCase();
  const len = componentName.length;

  return `${componentName}-${first}${len}${last}`;
}
