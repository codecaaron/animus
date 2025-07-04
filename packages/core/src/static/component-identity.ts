import * as crypto from 'crypto';

import type { ExtractedStyles } from './types';

/**
 * Every component across the ABYSS needs a unique identity
 * This identity persists across files, imports, and transformations
 */
export interface ComponentIdentity {
  name: string; // Original component name
  filePath: string; // Absolute file path
  exportName: string; // 'default' or named export
  hash: string; // Unique identifier across the project
}

/**
 * Enhanced ExtractedStyles with identity information
 * This bridges the gap between file-local names and project-wide identities
 */
export interface ExtractedStylesWithIdentity extends ExtractedStyles {
  identity: ComponentIdentity;
  extends?: ComponentIdentity; // For components using .extend()
}

/**
 * Create a unique hash for a component based on its location and export
 */
export function createComponentHash(
  filePath: string,
  exportName: string
): string {
  const content = `${filePath}:${exportName}`;
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
}

/**
 * Create a ComponentIdentity from basic information
 */
export function createComponentIdentity(
  name: string,
  filePath: string,
  exportName: string
): ComponentIdentity {
  return {
    name,
    filePath,
    exportName,
    hash: createComponentHash(filePath, exportName),
  };
}

/**
 * Check if two identities refer to the same component
 */
export function isSameComponent(
  a: ComponentIdentity,
  b: ComponentIdentity
): boolean {
  return a.hash === b.hash;
}

/**
 * Parse an extends reference to determine parent identity
 * Handles cases like:
 * - Button.extend() (same file reference)
 * - PrimaryButton extends Button (imported reference)
 */
export interface ExtendsReference {
  parentName: string;
  isImported: boolean;
  importPath?: string;
}

export function parseExtendsReference(
  code: string,
  componentName: string
): ExtendsReference | null {
  // Pattern 1: Direct extend - const Primary = Button.extend()
  // Also handle: export const Primary = Button.extend()
  const directExtendMatch = new RegExp(
    `(?:export\\s+)?const\\s+${componentName}\\s*=\\s*(\\w+)\\.extend\\(`
  ).exec(code);

  if (directExtendMatch) {
    const parentName = directExtendMatch[1];
    // Check if parent is imported
    const importMatch = new RegExp(
      `import\\s+(?:{[^}]*\\b${parentName}\\b[^}]*}|${parentName})\\s+from\\s+['"]([^'"]+)['"]`
    ).exec(code);

    if (importMatch) {
      return {
        parentName,
        isImported: true,
        importPath: importMatch[1],
      };
    }

    return {
      parentName,
      isImported: false,
    };
  }

  return null;
}

/**
 * Component reference in JSX or function calls
 */
export interface ComponentReference {
  name: string;
  location: {
    line: number;
    column: number;
  };
  isJSX: boolean;
}

/**
 * Extract component references from code
 * Finds both JSX usage and direct function calls
 */
export function extractComponentReferences(code: string): ComponentReference[] {
  const references: ComponentReference[] = [];
  const lines = code.split('\n');

  lines.forEach((line, lineIndex) => {
    // JSX opening tags: <Button or <Button>
    const jsxMatches = [...line.matchAll(/<(\w+)[\s>]/g)];
    jsxMatches.forEach((match) => {
      if (match.index !== undefined && /^[A-Z]/.test(match[1])) {
        references.push({
          name: match[1],
          location: {
            line: lineIndex + 1,
            column: match.index + 1,
          },
          isJSX: true,
        });
      }
    });

    // Function calls: Button({ ... })
    const callMatches = [...line.matchAll(/(\w+)\s*\(/g)];
    callMatches.forEach((match) => {
      if (match.index !== undefined && /^[A-Z]/.test(match[1])) {
        references.push({
          name: match[1],
          location: {
            line: lineIndex + 1,
            column: match.index,
          },
          isJSX: false,
        });
      }
    });
  });

  return references;
}

/**
 * Identity-aware component metadata
 * This is what flows through the compiler pipeline
 */
export interface ComponentMetadata {
  identity: ComponentIdentity;
  styles: ExtractedStylesWithIdentity;
  references: ComponentReference[];
  dependencies: ComponentIdentity[]; // Other components this one depends on
}

// The identity system is manifest
// Each component now has a name that echoes across the ABYSS
