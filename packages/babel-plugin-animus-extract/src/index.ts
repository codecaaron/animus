import type { NodePath, PluginObj } from '@babel/core';
import type {
  CallExpression,
  ImportDeclaration,
  JSXElement,
  Program} from '@babel/types';

import { generateAtomicClasses } from './css-generator';
import { extractAnimusComponent,isAnimusBuilder } from './extractor';
import { transformToRuntime } from './transformer';
import { AnimusExtractState } from './types';

export interface AnimusExtractOptions {
  cssOutputPath?: string;
  atomic?: boolean;
  extractComponents?: boolean;
  runtimeFallback?: boolean;
  generateTypes?: boolean;
  development?: boolean;
  runtimeImportPath?: string;
}

export default function animusExtractPlugin(
  babel: typeof import('@babel/core'),
  options: AnimusExtractOptions = {}
): PluginObj<AnimusExtractState> {
  const { types: t } = babel;

  const defaultOptions: AnimusExtractOptions = {
    cssOutputPath: './dist/styles',
    atomic: true,
    extractComponents: true,
    runtimeFallback: true,
    generateTypes: true,
    development: process.env.NODE_ENV === 'development',
    ...options
  };

  return {
    name: 'animus-extract',

    visitor: {
      Program: {
        enter(path: NodePath<Program>, state: AnimusExtractState) {
          state.animusComponents = new Map();
          state.cssOutput = new Map();
          state.atomicClasses = new Map();
          state.hasAnimusImport = false;
          state.options = defaultOptions;
          state.types = t;
          state.file = state.file || { opts: { filename: 'unknown' } };
        },

        exit(path: NodePath<Program>, state: AnimusExtractState) {
          if (!state.hasAnimusImport) return;

          // Add runtime import if needed
          if (state.animusComponents.size > 0 && state.options.runtimeFallback) {
            // Check if runtime import already exists
            const hasRuntimeImport = path.node.body.some(node => 
              t.isImportDeclaration(node) && 
              node.source.value.includes('animus-runtime')
            );
            
            if (!hasRuntimeImport) {
              const runtimePath = state.options.runtimeImportPath || '@animus-ui/babel-plugin-animus-extract/lib/runtime';
              const importDeclaration = t.importDeclaration(
                [
                  t.importSpecifier(t.identifier('__animus_runtime'), t.identifier('__animus_runtime')),
                  t.importSpecifier(t.identifier('cx'), t.identifier('cx'))
                ],
                t.stringLiteral(runtimePath)
              );
              path.node.body.unshift(importDeclaration);
            }
          }

          if (state.options.atomic && state.atomicClasses.size > 0) {
            const atomicCSS = generateAtomicClasses(state.atomicClasses);
            state.cssOutput.set('atomic', atomicCSS);
          }

          if (state.cssOutput.size > 0) {
            // In a real implementation, we would write CSS files here
            // For now, we'll add it as a comment to see it working
            const allCSS = Array.from(state.cssOutput.values()).join('\n\n');
            path.addComment('leading', `\n Generated CSS:\n${allCSS}\n`);
          }
        }
      },

      ImportDeclaration(path: NodePath<ImportDeclaration>, state: AnimusExtractState) {
        if (path.node.source.value === '@animus-ui/core') {
          state.hasAnimusImport = true;

          // Track import bindings
          path.node.specifiers.forEach(specifier => {
            if (t.isImportDefaultSpecifier(specifier)) {
              state.animusBinding = specifier.local.name;
            } else if (t.isImportSpecifier(specifier) && specifier.imported.type === 'Identifier') {
              if (specifier.imported.name === 'animus') {
                state.animusBinding = specifier.local.name;
              }
            }
          });
        }
      },

      CallExpression(path: NodePath<CallExpression>, state: AnimusExtractState) {
        if (!state.hasAnimusImport) return;

        if (isAnimusBuilder(path, state)) {
          if (state.options.development) {
            // In dev mode, skip transformation for hot reloading
            return;
          }

          extractAnimusComponent(path, state);
        }
      },

      JSXElement(path: NodePath<JSXElement>, state: AnimusExtractState) {
        if (!state.hasAnimusImport) return;

        const opening = path.node.openingElement;
        if (!t.isJSXIdentifier(opening.name)) return;

        const componentName = opening.name.name;
        const componentData = state.animusComponents.get(componentName);

        if (componentData && state.options.atomic) {
          // Transform static props to atomic classes
          transformToRuntime(path, componentData, state);
        }
      }
    }
  };
}
