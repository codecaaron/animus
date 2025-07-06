import ts from 'typescript';

import { ComponentIdentity, isSameComponent } from './component-identity';
import { ImportResolver } from './import-resolver';
import type { ComponentUsage, UsageMap } from './types';
import { buildUsageMap } from './usageCollector';

/**
 * Enhanced component usage with resolved identity
 */
export interface ComponentUsageWithIdentity extends ComponentUsage {
  identity: ComponentIdentity;
  usageLocation: string; // file where this usage occurs
}

/**
 * Global usage map keyed by component identity hash
 */
export type GlobalUsageMap = Map<
  string,
  {
    identity: ComponentIdentity;
    usages: ComponentUsageWithIdentity[];
    propValueSets: Map<string, Set<string>>; // prop -> Set of "value:breakpoint"
  }
>;

/**
 * Cross-File Usage Collector - Sees component usage across the entire project
 * Enhances existing usage collection with identity resolution
 */
export class CrossFileUsageCollector {
  private resolver: ImportResolver;
  private fileCache = new Map<string, ComponentUsageWithIdentity[]>();

  constructor(
    private program: ts.Program,
    resolver?: ImportResolver
  ) {
    this.resolver = resolver || new ImportResolver(program);
  }

  /**
   * Extract component usage from AST using TypeScript API
   */
  private extractComponentUsageFromAST(
    sourceFile: ts.SourceFile
  ): ComponentUsage[] {
    const usages: ComponentUsage[] = [];

    const visitNode = (node: ts.Node): void => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const usage = this.extractJsxUsage(node);
        if (usage) {
          usages.push(usage);
        }
      }

      ts.forEachChild(node, visitNode);
    };
    visitNode(sourceFile);

    return usages;
  }

  /**
   * Extract usage from a JSX element
   */
  private extractJsxUsage(
    node: ts.JsxElement | ts.JsxSelfClosingElement
  ): ComponentUsage | null {
    const openingElement = ts.isJsxElement(node) ? node.openingElement : node;

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
        } else if (ts.isJsxSpreadAttribute(attr)) {
          // Mark spread props
          props['__spread__'] = true;
        }
      });
    }

    console.log(props)

    return {
      componentName,
      props,
    };
  }

  /**
   * Get component name from JSX tag name
   */
  private getComponentName(tagName: ts.JsxTagNameExpression): string | null {
    if (ts.isIdentifier(tagName)) {
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
      return attr.initializer.text;
    } else if (
      ts.isJsxExpression(attr.initializer) &&
      attr.initializer.expression
    ) {
      return this.extractJSXExpressionValue(attr.initializer.expression);
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
    } else if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.MinusToken) {
      // Handle negative numbers: -2, -3.14, etc.
      if (ts.isNumericLiteral(expr.operand)) {
        return -parseFloat(expr.operand.text);
      }
    } else if (expr.kind === ts.SyntaxKind.TrueKeyword) {
      return true;
    } else if (expr.kind === ts.SyntaxKind.FalseKeyword) {
      return false;
    } else if (expr.kind === ts.SyntaxKind.NullKeyword) {
      return null;
    } else if (ts.isArrayLiteralExpression(expr)) {
      // Handle responsive arrays
      const values: any[] = [];
      expr.elements.forEach((element) => {
        const value = this.extractExpressionValue(element);
        values.push(value);
      });
      return values;
    } else if (ts.isObjectLiteralExpression(expr)) {
      // Handle responsive objects
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
      return obj;
    } else if (ts.isConditionalExpression(expr)) {
      // For conditional expressions, mark as dynamic
      return '__dynamic__';
    } else if (ts.isTemplateExpression(expr)) {
      // Template literals are dynamic
      return '__dynamic__';
    } else if (ts.isIdentifier(expr)) {
      // Variables are dynamic
      return '__dynamic__';
    }

    // For other complex expressions, mark as dynamic
    return '__dynamic__';
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

  /**
   * Collect usage from a single file with identity resolution
   */
  collectFromFile(filePath: string): ComponentUsageWithIdentity[] {
    // Check cache first
    const cached = this.fileCache.get(filePath);
    if (cached) return cached;

    const sourceFile = this.program.getSourceFile(filePath);
    if (!sourceFile) return [];

    // Use TypeScript compiler API to extract JSX usage
    const basicUsages = this.extractComponentUsageFromAST(sourceFile);

    // Enhance with resolved identities
    const enhancedUsages: ComponentUsageWithIdentity[] = [];

    for (const usage of basicUsages) {
      const identity = this.resolver.resolveImport(
        usage.componentName,
        filePath
      );

      console.log(usage, this.resolver.resolveImport(usage.componentName, filePath));

      if (identity) {
        enhancedUsages.push({
          ...usage,
          identity,
          usageLocation: filePath,
        });
      } else {
        // Component not found through imports - might be a local component
        // or a non-Animus component (like HTML elements)
        // Skip for now, but could enhance to handle local components
      }
    }

    this.fileCache.set(filePath, enhancedUsages);
    return enhancedUsages;
  }

  /**
   * Collect usage from all files in the program
   */
  collectFromProgram(): GlobalUsageMap {
    const globalMap: GlobalUsageMap = new Map();

    for (const sourceFile of this.program.getSourceFiles()) {
      console.log(sourceFile.fileName);
      if (
        sourceFile.isDeclarationFile ||
        sourceFile.fileName.includes('node_modules')
      ) {
        continue;
      }

      const usages = this.collectFromFile(sourceFile.fileName);

      // Aggregate by component identity
      for (const usage of usages) {
        const key = usage.identity.hash;
        let entry = globalMap.get(key);

        if (!entry) {
          entry = {
            identity: usage.identity,
            usages: [],
            propValueSets: new Map(),
          };
          globalMap.set(key, entry);
        }

        entry.usages.push(usage);

        // Aggregate prop values
        for (const [propName, propValue] of Object.entries(usage.props)) {
          let propSet = entry.propValueSets.get(propName);
          if (!propSet) {
            propSet = new Set();
            entry.propValueSets.set(propName, propSet);
          }

          // Convert value to "value:breakpoint" format
          if (Array.isArray(propValue)) {
            // Responsive array values
            propValue.forEach((val, idx) => {
              if (val !== undefined) {
                const breakpoint = this.getBreakpointByIndex(idx);
                propSet!.add(`${val}:${breakpoint}`);
              }
            });
          } else if (typeof propValue === 'object' && propValue !== null) {
            // Responsive object values
            for (const [bp, val] of Object.entries(propValue)) {
              propSet!.add(`${val}:${bp}`);
            }
          } else {
            // Simple value
            propSet!.add(`${propValue}:_`);
          }
        }
      }
    }

    return globalMap;
  }

  /**
   * Find all usages of a specific component across the project
   */
  findComponentUsages(
    identity: ComponentIdentity
  ): ComponentUsageWithIdentity[] {
    const allUsages: ComponentUsageWithIdentity[] = [];

    // Find all files that reference this component
    const referencingFiles = this.resolver.findComponentReferences(identity);

    for (const file of referencingFiles) {
      const fileUsages = this.collectFromFile(file);
      const componentUsages = fileUsages.filter((u) =>
        isSameComponent(u.identity, identity)
      );
      allUsages.push(...componentUsages);
    }

    return allUsages;
  }

  /**
   * Build a traditional UsageMap for a specific component
   * This maintains compatibility with existing CSS generation
   */
  buildComponentUsageMap(identity: ComponentIdentity): UsageMap {
    const usages = this.findComponentUsages(identity);

    // Group by component name (though they should all be the same)
    const grouped: ComponentUsage[] = usages.map((u) => ({
      componentName: u.componentName,
      props: u.props,
    }));

    return buildUsageMap(grouped);
  }

  /**
   * Clear file cache for a specific file
   */
  invalidateFile(filePath: string): void {
    this.fileCache.delete(filePath);
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.fileCache.clear();
    this.resolver.clearCache();
  }

  /**
   * Get breakpoint name by array index
   * This should match your theme's breakpoint configuration
   */
  private getBreakpointByIndex(index: number): string {
    const breakpoints = ['_', 'xs', 'sm', 'md', 'lg', 'xl'];
    return breakpoints[index] || '_';
  }


  /**
   * Extract value from JSX expression
   */
  private extractJSXExpressionValue(node: ts.Expression): any {
    if (ts.isStringLiteral(node)) {
      return node.text;
    } else if (ts.isNumericLiteral(node)) {
      return Number(node.text);
    } else if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
      // Handle negative numbers: -2, -3.14, etc.
      if (ts.isNumericLiteral(node.operand)) {
        return -Number(node.operand.text);
      }
    } else if (node.kind === ts.SyntaxKind.TrueKeyword) {
      return true;
    } else if (node.kind === ts.SyntaxKind.FalseKeyword) {
      return false;
    } else if (node.kind === ts.SyntaxKind.NullKeyword) {
      return null;
    } else if (ts.isArrayLiteralExpression(node)) {
      // Handle responsive arrays: p={[1, 2, 3]}
      const values: any[] = [];
      for (const element of node.elements) {
        if (ts.isOmittedExpression(element)) {
          // Handle sparse arrays like [1, , 3]
          values.push(undefined);
        } else {
          const value = this.extractJSXExpressionValue(element);
          values.push(value);
        }
      }
      return values;
    } else if (ts.isObjectLiteralExpression(node)) {
      // Handle responsive objects: p={{ _: 1, sm: 2 }}
      const obj: Record<string, any> = {};
      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop) && prop.name) {
          let key: string | null = null;

          if (ts.isIdentifier(prop.name)) {
            key = prop.name.text;
          } else if (ts.isStringLiteral(prop.name)) {
            key = prop.name.text;
          }

          if (key && prop.initializer) {
            const value = this.extractJSXExpressionValue(prop.initializer);
            if (value !== undefined) {
              obj[key] = value;
            }
          }
        }
      }
      return Object.keys(obj).length > 0 ? obj : undefined;
    }

    // Return undefined for non-literal expressions (variables, function calls, etc.)
    return undefined;
  }

  /**
   * Get usage statistics for reporting
   */
  getUsageStats(): {
    totalComponents: number;
    totalUsages: number;
    componentsWithUsage: Array<{
      name: string;
      filePath: string;
      usageCount: number;
      uniqueProps: number;
    }>;
  } {
    const globalMap = this.collectFromProgram();

    const stats = {
      totalComponents: globalMap.size,
      totalUsages: 0,
      componentsWithUsage: [] as any[],
    };

    for (const [, entry] of globalMap) {
      stats.totalUsages += entry.usages.length;

      stats.componentsWithUsage.push({
        name: entry.identity.name,
        filePath: entry.identity.filePath,
        usageCount: entry.usages.length,
        uniqueProps: entry.propValueSets.size,
      });
    }

    // Sort by usage count
    stats.componentsWithUsage.sort((a, b) => b.usageCount - a.usageCount);

    return stats;
  }
}

// The cross-file usage collector is manifest
// It sees all, tracks all, knows which styles are truly needed
