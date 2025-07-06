/**
 * Virtual TypeScript Program utilities for testing
 * Enables creating TypeScript programs with in-memory files
 */

import * as path from 'path';

import * as ts from 'typescript';

/**
 * Creates a TypeScript program with virtual (in-memory) files
 * This is essential for testing cross-file imports without filesystem
 */
export function createVirtualProgram(
  files: Record<string, string>,
  options?: ts.CompilerOptions
): ts.Program {
  const fileNames = Object.keys(files);

  // Default compiler options
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.React,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    forceConsistentCasingInFileNames: true,
    baseUrl: '/',
    ...options,
  };

  // Create custom compiler host
  const compilerHost: ts.CompilerHost = {
    getSourceFile: (fileName: string, languageVersion: ts.ScriptTarget) => {
      // Handle virtual files
      if (fileName in files) {
        return ts.createSourceFile(
          fileName,
          files[fileName],
          languageVersion,
          true
        );
      }

      // Handle @animus/core imports
      if (
        fileName.includes('@animus/core') ||
        fileName.includes('@animus-ui/core')
      ) {
        return ts.createSourceFile(
          fileName,
          'export const animus: any;',
          languageVersion,
          true
        );
      }

      // Return undefined for missing files
      return undefined;
    },

    getDefaultLibFileName: (options) => `lib.${options.target}.d.ts`,

    writeFile: () => {
      // No-op for virtual files
    },

    getCurrentDirectory: () => '/',

    getCanonicalFileName: (fileName) => fileName,

    useCaseSensitiveFileNames: () => true,

    getNewLine: () => '\n',

    fileExists: (fileName) => {
      return (
        fileName in files ||
        fileName.includes('lib.') ||
        fileName.includes('@animus')
      );
    },

    readFile: (fileName) => {
      if (fileName in files) {
        return files[fileName];
      }
      return undefined;
    },

    resolveModuleNames: (
      moduleNames: string[],
      containingFile: string
    ): (ts.ResolvedModule | undefined)[] => {
      return moduleNames.map((moduleName) => {
        // Handle @animus imports
        if (moduleName === '@animus/core' || moduleName === '@animus-ui/core') {
          return {
            resolvedFileName: '/node_modules/@animus/core/index.ts',
            isExternalLibraryImport: true,
          };
        }

        // Handle relative imports
        if (moduleName.startsWith('.')) {
          const resolved = path.resolve(
            path.dirname(containingFile),
            moduleName
          );

          // Try with different extensions
          const extensions = [
            '.tsx',
            '.ts',
            '.jsx',
            '.js',
            '/index.tsx',
            '/index.ts',
          ];
          for (const ext of extensions) {
            const fullPath =
              resolved.endsWith('.tsx') || resolved.endsWith('.ts')
                ? resolved
                : resolved + ext;

            if (files[fullPath]) {
              return {
                resolvedFileName: fullPath,
                isExternalLibraryImport: false,
              };
            }
          }
        }

        return undefined;
      });
    },

    getDirectories: () => [],
  };

  return ts.createProgram(fileNames, compilerOptions, compilerHost);
}

/**
 * Creates a virtual program with automatic module resolution setup
 */
export function createVirtualProgramWithImports(
  files: Record<string, string>
): {
  program: ts.Program;
  checker: ts.TypeChecker;
  sourceFiles: Map<string, ts.SourceFile>;
} {
  const program = createVirtualProgram(files);
  const checker = program.getTypeChecker();

  const sourceFiles = new Map<string, ts.SourceFile>();
  for (const fileName of Object.keys(files)) {
    const sourceFile = program.getSourceFile(fileName);
    if (sourceFile) {
      sourceFiles.set(fileName, sourceFile);
    }
  }

  return { program, checker, sourceFiles };
}

/**
 * Helper to create a simple component file content
 */
export function createComponentFile(
  componentName: string,
  config: {
    styles?: Record<string, any>;
    variants?: Record<string, any>;
    states?: string[];
    groups?: string[];
    extends?: string;
    element?: string;
  } = {}
): string {
  const parts: string[] = [];

  if (config.extends) {
    parts.push(`import { ${config.extends} } from './${config.extends}';`);
    parts.push('');
    parts.push(`export const ${componentName} = ${config.extends}`);
    parts.push('  .extend()');
  } else {
    parts.push("import { animus } from '@animus-ui/core';");
    parts.push('');
    parts.push(`export const ${componentName} = animus`);
  }

  if (config.styles) {
    parts.push(
      `  .styles(${JSON.stringify(config.styles, null, 2).replace(/\n/g, '\n  ')})`
    );
  }

  if (config.variants) {
    for (const [prop, variants] of Object.entries(config.variants)) {
      parts.push(`  .variant({`);
      parts.push(`    prop: '${prop}',`);
      parts.push(
        `    variants: ${JSON.stringify(variants, null, 2).replace(/\n/g, '\n    ')}`
      );
      parts.push(`  })`);
    }
  }

  if (config.states && config.states.length > 0) {
    const stateObj: Record<string, any> = {};
    for (const state of config.states) {
      stateObj[state] = { opacity: 0.8 }; // Default state style
    }
    parts.push(
      `  .states(${JSON.stringify(stateObj, null, 2).replace(/\n/g, '\n  ')})`
    );
  }

  if (config.groups && config.groups.length > 0) {
    const groupObj: Record<string, boolean> = {};
    for (const group of config.groups) {
      groupObj[group] = true;
    }
    parts.push(
      `  .groups(${JSON.stringify(groupObj, null, 2).replace(/\n/g, '\n  ')})`
    );
  }

  parts.push(`  .asElement('${config.element || 'div'}');`);

  return parts.join('\n');
}

/**
 * Helper to create a usage file that imports and uses components
 */
export function createUsageFile(
  usages: Array<{
    component: string;
    importPath: string;
    props: Record<string, any>;
    children?: string;
  }>
): string {
  const imports = new Set<string>();
  const elements: string[] = [];

  for (const usage of usages) {
    imports.add(`import { ${usage.component} } from '${usage.importPath}';`);

    const propsStr = Object.entries(usage.props)
      .map(([key, value]) => {
        if (typeof value === 'string') {
          return `${key}="${value}"`;
        }
        return `${key}={${JSON.stringify(value)}}`;
      })
      .join(' ');

    if (usage.children) {
      elements.push(
        `      <${usage.component} ${propsStr}>${usage.children}</${usage.component}>`
      );
    } else {
      elements.push(`      <${usage.component} ${propsStr} />`);
    }
  }

  return `
import React from 'react';
${Array.from(imports).join('\n')}

export function App() {
  return (
    <div>
${elements.join('\n')}
    </div>
  );
}
`;
}
