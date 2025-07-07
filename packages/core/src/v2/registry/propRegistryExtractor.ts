/**
 * Type-based PropRegistry extraction from Animus instances
 *
 * This module extracts PropRegistry configuration directly from the TypeScript
 * type system, leveraging the fact that Animus instances have propRegistry
 * and groupRegistry as typed properties with literal values.
 */

import * as ts from 'typescript';

import type { Logger } from '../infrastructure/logger';

// Core types (matching those in index.ts)
interface PropConfig {
  readonly name: string;
  readonly property: string; // Primary CSS property
  readonly properties?: string[]; // Multiple CSS properties
  readonly scale?: string; // Theme scale name
  readonly transform?: string; // Transform function name (deprecated but kept for compatibility)
}

interface PropRegistry {
  readonly props: Map<string, PropConfig>;
  readonly groups: Map<string, string[]>; // group name -> prop names
  readonly source: PropRegistrySource;
}

type PropRegistrySource =
  | { kind: 'import'; path: string }
  | { kind: 'default' }
  | { kind: 'custom'; description: string };

/**
 * Main interface for PropRegistry extraction
 */
export interface PropRegistryExtractor {
  extract(
    sourceFile: ts.SourceFile,
    program: ts.Program,
    typeChecker: ts.TypeChecker,
    logger: Logger
  ): PropRegistry | null;
}

/**
 * Extracts PropRegistry from Animus instances using TypeScript's type system
 */
export class TypeBasedPropRegistryExtractor implements PropRegistryExtractor {
  /**
   * Extract PropRegistry from a source file by finding Animus imports
   */
  extract(
    sourceFile: ts.SourceFile,
    program: ts.Program,
    typeChecker: ts.TypeChecker,
    logger: Logger
  ): PropRegistry | null {
    logger.debug('Starting PropRegistry extraction for', sourceFile.fileName);

    // Find animus imports in the file
    const animusImport = this.findAnimusImport(sourceFile, typeChecker, logger);
    if (!animusImport) {
      logger.debug('No animus import found in file');
      return null;
    }

    // Extract registry from the import
    return this.extractRegistryFromSymbol(animusImport, typeChecker, logger);
  }

  /**
   * Find animus import in the source file
   */
  private findAnimusImport(
    sourceFile: ts.SourceFile,
    typeChecker: ts.TypeChecker,
    logger: Logger
  ): ts.Symbol | null {
    let animusSymbol: ts.Symbol | null = null;

    ts.forEachChild(sourceFile, (node) => {
      if (ts.isImportDeclaration(node)) {
        const moduleSpecifier = node.moduleSpecifier;
        if (ts.isStringLiteral(moduleSpecifier)) {
          const moduleName = moduleSpecifier.text;

          // Check if this is an animus import
          if (
            moduleName.includes('animus') ||
            moduleName === '@animus-ui/core'
          ) {
            const importClause = node.importClause;
            if (!importClause) return;

            // Handle named imports like: import { animus } from './theme'
            if (
              importClause.namedBindings &&
              ts.isNamedImports(importClause.namedBindings)
            ) {
              for (const element of importClause.namedBindings.elements) {
                const name = element.name.text;
                const propertyName = element.propertyName?.text;

                if (name === 'animus' || propertyName === 'animus') {
                  const symbol = typeChecker.getSymbolAtLocation(element.name);
                  if (symbol) {
                    logger.debug('Found named animus import');
                    animusSymbol = symbol;
                    return;
                  }
                }
              }
            }

            // Handle default imports like: import animus from './theme'
            if (importClause.name) {
              const symbol = typeChecker.getSymbolAtLocation(importClause.name);
              if (symbol) {
                logger.debug("Found default import, checking if it's animus");
                animusSymbol = symbol;
                return;
              }
            }
          }
        }
      }
    });

    return animusSymbol;
  }

  /**
   * Extract PropRegistry from an Animus symbol using the type system
   */
  private extractRegistryFromSymbol(
    symbol: ts.Symbol,
    typeChecker: ts.TypeChecker,
    logger: Logger
  ): PropRegistry | null {
    try {
      // Get the type of the animus instance
      const valueDeclaration = symbol.valueDeclaration;
      if (!valueDeclaration) {
        logger.debug('No value declaration for symbol');
        return null;
      }

      const type = typeChecker.getTypeOfSymbolAtLocation(
        symbol,
        valueDeclaration
      );

      // Check if this is an Animus instance by looking for propRegistry property
      const propRegistrySymbol = type.getProperty('propRegistry');
      if (!propRegistrySymbol) {
        logger.debug('No propRegistry property found - not an Animus instance');
        return null;
      }

      logger.debug('Found Animus instance, extracting PropRegistry');

      // Get the type of propRegistry
      const propRegistryType = typeChecker.getTypeOfSymbolAtLocation(
        propRegistrySymbol,
        propRegistrySymbol.valueDeclaration!
      );

      // Extract props
      const props = this.extractPropsFromType(
        propRegistryType,
        typeChecker,
        logger
      );

      // Get the type of groupRegistry
      const groupRegistrySymbol = type.getProperty('groupRegistry');
      let groups = new Map<string, string[]>();

      if (groupRegistrySymbol) {
        const groupRegistryType = typeChecker.getTypeOfSymbolAtLocation(
          groupRegistrySymbol,
          groupRegistrySymbol.valueDeclaration!
        );
        groups = this.extractGroupsFromType(
          groupRegistryType,
          typeChecker,
          logger
        );
      }

      const source: PropRegistrySource = {
        kind: 'import',
        path: valueDeclaration.getSourceFile().fileName,
      };

      logger.debug(`Extracted ${props.size} props and ${groups.size} groups`);

      return { props, groups, source };
    } catch (error) {
      logger.error('Failed to extract PropRegistry from symbol', error);
      return getDefaultPropRegistry();
    }
  }

  /**
   * Extract prop definitions from the PropRegistry type
   */
  private extractPropsFromType(
    type: ts.Type,
    typeChecker: ts.TypeChecker,
    logger: Logger
  ): Map<string, PropConfig> {
    const props = new Map<string, PropConfig>();

    // Iterate through all properties of the PropRegistry type
    for (const property of type.getProperties()) {
      const propName = property.getName();

      // Skip internal TypeScript properties
      if (propName.startsWith('__')) continue;

      try {
        // Get the type of this prop configuration
        const propType = typeChecker.getTypeOfSymbolAtLocation(
          property,
          property.valueDeclaration!
        );

        // Extract the Prop configuration
        const propConfig = this.extractPropConfig(
          propType,
          propName,
          typeChecker
        );
        if (propConfig) {
          props.set(propName, propConfig);
          logger.debug(`Extracted prop: ${propName}`, propConfig);
        }
      } catch (error) {
        logger.warn(`Failed to extract prop ${propName}`, error);
      }
    }

    return props;
  }

  /**
   * Extract a single prop configuration from its type
   */
  private extractPropConfig(
    type: ts.Type,
    propName: string,
    typeChecker: ts.TypeChecker
  ): PropConfig | null {
    let property = '';
    let properties: string[] | undefined;
    let scale: string | undefined;

    // Extract 'property' field (required)
    const propertySymbol = type.getProperty('property');
    if (propertySymbol) {
      const propertyType = typeChecker.getTypeOfSymbolAtLocation(
        propertySymbol,
        propertySymbol.valueDeclaration!
      );
      const propertyValue = this.extractLiteralValue(propertyType, typeChecker);
      if (typeof propertyValue === 'string') {
        property = propertyValue;
      }
    }

    // Extract 'properties' field (optional, for multi-property props)
    const propertiesSymbol = type.getProperty('properties');
    if (propertiesSymbol) {
      const propertiesType = typeChecker.getTypeOfSymbolAtLocation(
        propertiesSymbol,
        propertiesSymbol.valueDeclaration!
      );
      const propertiesValue = this.extractLiteralValue(
        propertiesType,
        typeChecker
      );
      if (Array.isArray(propertiesValue)) {
        properties = propertiesValue;
      }
    }

    // Extract 'scale' field (optional)
    const scaleSymbol = type.getProperty('scale');
    if (scaleSymbol) {
      const scaleType = typeChecker.getTypeOfSymbolAtLocation(
        scaleSymbol,
        scaleSymbol.valueDeclaration!
      );
      const scaleValue = this.extractLiteralValue(scaleType, typeChecker);
      if (typeof scaleValue === 'string') {
        scale = scaleValue;
      }
    }

    // Validate we have at least a property
    if (!property && !properties) {
      return null;
    }

    return { name: propName, property, properties, scale };
  }

  /**
   * Extract group definitions from the GroupRegistry type
   */
  private extractGroupsFromType(
    type: ts.Type,
    typeChecker: ts.TypeChecker,
    logger: Logger
  ): Map<string, string[]> {
    const groups = new Map<string, string[]>();

    // Each property is a group name
    for (const property of type.getProperties()) {
      const groupName = property.getName();

      try {
        // Get the type of this group (should be an array of prop names)
        const groupType = typeChecker.getTypeOfSymbolAtLocation(
          property,
          property.valueDeclaration!
        );

        // Extract the array of prop names
        const propNames = this.extractLiteralValue(groupType, typeChecker);
        if (Array.isArray(propNames)) {
          groups.set(groupName, propNames);
          logger.debug(
            `Extracted group: ${groupName} with ${propNames.length} props`
          );
        }
      } catch (error) {
        logger.warn(`Failed to extract group ${groupName}`, error);
      }
    }

    return groups;
  }

  /**
   * Extract literal values from TypeScript types
   */
  private extractLiteralValue(
    type: ts.Type,
    typeChecker: ts.TypeChecker
  ): string | string[] | undefined {
    // Handle string literal types
    if (type.isStringLiteral()) {
      return type.value;
    }

    // Handle literal union types (e.g., 'margin' | 'padding')
    if (type.isUnion()) {
      const values: string[] = [];
      for (const subType of type.types) {
        if (subType.isStringLiteral()) {
          values.push(subType.value);
        }
      }
      return values.length > 0 ? values : undefined;
    }

    // Handle tuple types for arrays
    if (typeChecker.isTupleType(type)) {
      const values: string[] = [];
      const typeRef = type as ts.TypeReference;
      if (typeRef.typeArguments) {
        for (const elementType of typeRef.typeArguments) {
          const value = this.extractLiteralValue(elementType, typeChecker);
          if (typeof value === 'string') {
            values.push(value);
          } else if (Array.isArray(value)) {
            values.push(...value);
          }
        }
      }
      return values;
    }

    // Handle array types
    if (type.symbol && type.symbol.getName() === 'Array') {
      const typeRef = type as ts.TypeReference;
      if (typeRef.typeArguments && typeRef.typeArguments.length > 0) {
        const elementType = typeRef.typeArguments[0];
        const elementValue = this.extractLiteralValue(elementType, typeChecker);
        // If element type is a single string, return as array
        if (typeof elementValue === 'string') {
          return [elementValue];
        }
        return elementValue;
      }
    }

    // Handle readonly arrays
    const typeString = typeChecker.typeToString(type);
    if (typeString.startsWith('readonly [') && typeString.endsWith(']')) {
      // This is a readonly tuple, extract values
      const values: string[] = [];
      // For readonly arrays, we need to check if it's a tuple type
      const symbol = type.getSymbol();
      if (symbol && symbol.getName() === '__type') {
        // This is likely a tuple type
        for (const prop of type.getProperties()) {
          if (!isNaN(Number(prop.getName()))) {
            // Numeric property names indicate tuple elements
            const elemType = typeChecker.getTypeOfSymbolAtLocation(
              prop,
              prop.valueDeclaration!
            );
            const value = this.extractLiteralValue(elemType, typeChecker);
            if (typeof value === 'string') {
              values.push(value);
            }
          }
        }
      }
      return values.length > 0 ? values : undefined;
    }

    return undefined;
  }
}

export function getDefaultPropRegistry(): PropRegistry {
  const props = new Map<string, PropConfig>();

  // Space props
  props.set('m', { name: 'm', property: 'margin', scale: 'space' });
  props.set('mx', {
    name: 'mx',
    property: 'margin',
    properties: ['marginLeft', 'marginRight'],
    scale: 'space',
  });
  props.set('my', {
    name: 'my',
    property: 'margin',
    properties: ['marginTop', 'marginBottom'],
    scale: 'space',
  });
  props.set('mt', { name: 'mt', property: 'marginTop', scale: 'space' });
  props.set('mb', { name: 'mb', property: 'marginBottom', scale: 'space' });
  props.set('ml', { name: 'ml', property: 'marginLeft', scale: 'space' });
  props.set('mr', { name: 'mr', property: 'marginRight', scale: 'space' });

  props.set('p', { name: 'p', property: 'padding', scale: 'space' });
  props.set('px', {
    name: 'px',
    property: 'padding',
    properties: ['paddingLeft', 'paddingRight'],
    scale: 'space',
  });
  props.set('py', {
    name: 'py',
    property: 'padding',
    properties: ['paddingTop', 'paddingBottom'],
    scale: 'space',
  });
  props.set('pt', { name: 'pt', property: 'paddingTop', scale: 'space' });
  props.set('pb', { name: 'pb', property: 'paddingBottom', scale: 'space' });
  props.set('pl', { name: 'pl', property: 'paddingLeft', scale: 'space' });
  props.set('pr', { name: 'pr', property: 'paddingRight', scale: 'space' });

  // Color props
  props.set('color', { name: 'color', property: 'color', scale: 'colors' });
  props.set('bg', { name: 'bg', property: 'backgroundColor', scale: 'colors' });
  props.set('backgroundColor', {
    name: 'backgroundColor',
    property: 'backgroundColor',
    scale: 'colors',
  });
  props.set('borderColor', {
    name: 'borderColor',
    property: 'borderColor',
    scale: 'colors',
  });

  // Layout props
  props.set('display', { name: 'display', property: 'display' });
  props.set('width', { name: 'width', property: 'width', transform: 'size' });
  props.set('height', {
    name: 'height',
    property: 'height',
    transform: 'size',
  });
  props.set('size', {
    name: 'size',
    property: 'width',
    properties: ['width', 'height'],
    transform: 'size',
  });
  props.set('minWidth', {
    name: 'minWidth',
    property: 'minWidth',
    transform: 'size',
  });
  props.set('minHeight', {
    name: 'minHeight',
    property: 'minHeight',
    transform: 'size',
  });
  props.set('maxWidth', {
    name: 'maxWidth',
    property: 'maxWidth',
    transform: 'size',
  });
  props.set('maxHeight', {
    name: 'maxHeight',
    property: 'maxHeight',
    transform: 'size',
  });

  // Border props
  props.set('border', {
    name: 'border',
    property: 'border',
    scale: 'borders',
    transform: 'borderShorthand',
  });
  props.set('borderRadius', {
    name: 'borderRadius',
    property: 'borderRadius',
    scale: 'radii',
    transform: 'size',
  });
  props.set('borderWidth', {
    name: 'borderWidth',
    property: 'borderWidth',
    scale: 'borderWidths',
  });
  props.set('borderStyle', { name: 'borderStyle', property: 'borderStyle' });

  // Typography props
  props.set('fontFamily', {
    name: 'fontFamily',
    property: 'fontFamily',
    scale: 'fonts',
  });
  props.set('fontSize', {
    name: 'fontSize',
    property: 'fontSize',
    scale: 'fontSizes',
  });
  props.set('fontWeight', {
    name: 'fontWeight',
    property: 'fontWeight',
    scale: 'fontWeights',
  });
  props.set('lineHeight', {
    name: 'lineHeight',
    property: 'lineHeight',
    scale: 'lineHeights',
  });
  props.set('letterSpacing', {
    name: 'letterSpacing',
    property: 'letterSpacing',
    scale: 'letterSpacings',
  });
  props.set('textAlign', { name: 'textAlign', property: 'textAlign' });

  // Flexbox props
  props.set('flexDirection', {
    name: 'flexDirection',
    property: 'flexDirection',
  });
  props.set('flexWrap', { name: 'flexWrap', property: 'flexWrap' });
  props.set('flexBasis', { name: 'flexBasis', property: 'flexBasis' });
  props.set('flexGrow', { name: 'flexGrow', property: 'flexGrow' });
  props.set('flexShrink', { name: 'flexShrink', property: 'flexShrink' });
  props.set('alignItems', { name: 'alignItems', property: 'alignItems' });
  props.set('alignContent', { name: 'alignContent', property: 'alignContent' });
  props.set('justifyContent', {
    name: 'justifyContent',
    property: 'justifyContent',
  });
  props.set('justifyItems', { name: 'justifyItems', property: 'justifyItems' });
  props.set('gap', { name: 'gap', property: 'gap', scale: 'space' });

  // Position props
  props.set('position', { name: 'position', property: 'position' });
  props.set('top', { name: 'top', property: 'top', scale: 'space' });
  props.set('right', { name: 'right', property: 'right', scale: 'space' });
  props.set('bottom', { name: 'bottom', property: 'bottom', scale: 'space' });
  props.set('left', { name: 'left', property: 'left', scale: 'space' });
  props.set('zIndex', {
    name: 'zIndex',
    property: 'zIndex',
    scale: 'zIndices',
  });

  // Other common props
  props.set('opacity', { name: 'opacity', property: 'opacity' });
  props.set('overflow', { name: 'overflow', property: 'overflow' });
  props.set('overflowX', { name: 'overflowX', property: 'overflowX' });
  props.set('overflowY', { name: 'overflowY', property: 'overflowY' });

  const groups = new Map([
    [
      'space',
      [
        'm',
        'mx',
        'my',
        'mt',
        'mb',
        'ml',
        'mr',
        'p',
        'px',
        'py',
        'pt',
        'pb',
        'pl',
        'pr',
        'gap',
        'top',
        'right',
        'bottom',
        'left',
      ],
    ],
    ['color', ['color', 'bg', 'backgroundColor', 'borderColor']],
    [
      'layout',
      [
        'display',
        'width',
        'height',
        'size',
        'minWidth',
        'minHeight',
        'maxWidth',
        'maxHeight',
      ],
    ],
    [
      'border',
      ['border', 'borderRadius', 'borderWidth', 'borderStyle', 'borderColor'],
    ],
    [
      'typography',
      [
        'fontFamily',
        'fontSize',
        'fontWeight',
        'lineHeight',
        'letterSpacing',
        'textAlign',
      ],
    ],
    [
      'flexbox',
      [
        'flexDirection',
        'flexWrap',
        'flexBasis',
        'flexGrow',
        'flexShrink',
        'alignItems',
        'alignContent',
        'justifyContent',
        'justifyItems',
      ],
    ],
    ['position', ['position', 'top', 'right', 'bottom', 'left', 'zIndex']],
  ]);

  return {
    props,
    groups,
    source: { kind: 'default' },
  };
}

// Re-export types for use in index.ts
export type { PropConfig, PropRegistry, PropRegistrySource };
