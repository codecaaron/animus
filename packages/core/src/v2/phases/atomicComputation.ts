import * as crypto from 'crypto';

import * as ts from 'typescript';

import { orderPropNames } from '../../properties/orderPropNames';
import { Prop } from '../../types/config';
import {
  ResolutionContext,
  StyleValueResolver,
  StyleValueResolverImpl,
} from '../extraction/styleResolver';
import type { PropRegistry } from '../registry/propRegistryExtractor';
import type {
  AtomicClass,
  AtomicClassSet,
  AtomicComputationInput,
  AtomicComputationOutput,
  AtomicComputationPhase,
  AtomicCondition,
  ComponentClass,
  ComponentDefinition,
  ComponentUsage,
  ComputationStats,
  ConditionalAtomic,
  ConfidenceReport,
  DynamicProperty,
  ExtractionContext,
  ExtractionResult,
  PropConfig,
  PropValue,
  StateClass,
  VariantClass,
} from '../types';

export class AtomicComputationAlgorithm implements AtomicComputationPhase {
  readonly name = 'computation' as const;
  private readonly valueResolver: StyleValueResolver;

  constructor() {
    this.valueResolver = new StyleValueResolverImpl();
  }

  execute(
    context: ExtractionContext,
    input: AtomicComputationInput
  ): AtomicComputationOutput {
    const logger = context.getPhaseLogger('computation');
    logger.debug('Starting atomic computation', {
      componentId: input.definition.id,
      usageCount: input.usages.length,
    });

    const startTime = performance.now();

    // Generate component class from definition
    const componentClass = this.generateComponentClass(input.definition);
    logger.debug('Generated component class', {
      className: componentClass.className,
    });

    // Extract atomic classes from JSX usage only
    const atomicClasses = this.extractAtomicClasses(
      input.usages,
      context,
      input.definition
    );
    logger.debug('Extracted atomic classes', {
      required: atomicClasses.required.length,
      conditional: atomicClasses.conditional.length,
      customRequired: atomicClasses.customRequired.length,
      customConditional: atomicClasses.customConditional.length,
    });

    // Identify dynamic properties
    const dynamicProperties = this.identifyDynamicProperties(
      input.usages,
      input.definition,
      context
    );

    // Build final result
    const result: ExtractionResult = {
      componentId: input.definition.id,
      componentClass,
      atomicClasses,
      dynamicProperties,
      confidence: this.calculateConfidence(
        [...atomicClasses.required, ...atomicClasses.customRequired],
        dynamicProperties
      ),
    };

    const totalAtomics =
      atomicClasses.required.length + atomicClasses.customRequired.length;

    const stats: ComputationStats = {
      totalProperties: this.countProperties(componentClass) + totalAtomics,
      uniqueAtomics: totalAtomics,
      duplicatesRemoved: 0,
      executionTimeMs: performance.now() - startTime,
    };

    return { result, stats };
  }

  private generateComponentClass(
    definition: ComponentDefinition
  ): ComponentClass {
    const componentName = this.getComponentName(definition);
    const hash = this.generateHash('component', definition.id).substring(0, 3);
    const className = `animus-${componentName}-${hash}`;

    // Generate variant classes
    const variants = new Map<string, VariantClass[]>();
    definition.variants.variants.forEach((variant, variantName) => {
      const variantClasses: VariantClass[] = [];
      variant.options.forEach((styleMap, optionName) => {
        variantClasses.push({
          className: `${className}-${variantName}-${optionName}`,
          option: optionName,
          styles: styleMap,
        });
      });
      variants.set(variantName, variantClasses);
    });

    // Generate state classes
    const states = new Map<string, StateClass>();
    definition.states.states.forEach((state, stateName) => {
      states.set(stateName, {
        className: `${className}-state-${stateName}`,
        state: stateName,
        styles: state.styles,
      });
    });

    return {
      className,
      baseStyles: definition.baseStyles,
      variants,
      states,
    };
  }

  private extractAtomicClasses(
    usages: readonly ComponentUsage[],
    context: ExtractionContext,
    componentDef: ComponentDefinition
  ): AtomicClassSet {
    // Use component's custom props if available, otherwise fall back to global registry
    const effectiveRegistry = this.getEffectiveRegistry(
      componentDef,
      context.propRegistry
    );

    if (!effectiveRegistry) {
      context.logger.warn(
        'No PropRegistry available, skipping atomic extraction'
      );
      return {
        required: [],
        conditional: [],
        potential: [],
        customRequired: [],
        customConditional: [],
        customPotential: [],
      };
    }

    const atomicMap = new Map<string, AtomicClass>();
    const conditionalMap = new Map<string, ConditionalAtomic>();
    const customAtomicMap = new Map<string, AtomicClass>();
    const customConditionalMap = new Map<string, ConditionalAtomic>();

    for (const usage of usages) {
      usage.props.properties.forEach((propValue, propName) => {
        // Check if this is a style prop using PropRegistry
        const propConfig = effectiveRegistry.props.get(propName);
        if (!propConfig) {
          // Not a style prop
          return;
        }

        // Skip dynamic values
        if (
          propValue.staticValue === undefined ||
          propValue.staticValue === null
        )
          return;

        // Use the value resolver to handle theme tokens, scales, and transforms
        const resolutionContext: ResolutionContext = {
          theme: context.theme,
          propRegistry: effectiveRegistry,
          componentId: componentDef.id,
          logger: context.logger.child('resolver'),
        };

        const resolved = this.valueResolver.resolve(
          propValue.staticValue,
          propConfig,
          resolutionContext
        );

        // Skip if we couldn't resolve to a static value
        if (resolved.confidence === 0.0) {
          // DYNAMIC
          context.logger.warn('Skipping dynamic value', {
            prop: propName,
            value: propValue.staticValue,
          });
          return;
        }

        const value = String(resolved.value);

        // Handle props with multiple CSS properties (e.g., mx -> marginLeft, marginRight)
        const cssProperties = propConfig.properties || [propConfig.property];

        cssProperties.forEach((cssProperty) => {
          // Check if this prop is defined in the component's custom props
          const isCustomProp =
            componentDef.customProps?.props.has(propName) || false;

          const className = isCustomProp
            ? this.generateNamespacedAtomicClassName(
                propName,
                value,
                componentDef
              )
            : this.generateAtomicClassName(propName, value);

          // Convert camelCase to kebab-case for CSS
          const kebabProperty = this.toKebabCase(cssProperty);
          const key = `${cssProperty}:${value}`;

          const atomic: AtomicClass = {
            className,
            property: kebabProperty,
            value,
            sources: [usage.id],
          };

          // Check if this is a responsive value
          if (this.isResponsiveValue(propValue.staticValue)) {
            this.handleResponsiveProp(
              propName,
              propValue,
              propConfig,
              cssProperty,
              componentDef,
              usage,
              isCustomProp,
              atomicMap,
              conditionalMap,
              customAtomicMap,
              customConditionalMap,
              context
            );
            return; // Skip regular atomic handling
          }

          // Add to appropriate map based on whether it's a custom prop
          if (isCustomProp) {
            const customKey = `${key}:${componentDef.id}`;
            const existing = customAtomicMap.get(customKey);
            if (existing) {
              // Merge sources
              customAtomicMap.set(customKey, {
                ...existing,
                sources: [...existing.sources, ...atomic.sources],
              });
            } else {
              customAtomicMap.set(customKey, atomic);
            }
          } else {
            const existing = atomicMap.get(key);
            if (existing) {
              // Merge sources
              atomicMap.set(key, {
                ...existing,
                sources: [...existing.sources, ...atomic.sources],
              });
            } else {
              atomicMap.set(key, atomic);
            }
          }
        });
      });
    }

    // Sort atomic classes by CSS property order
    const sortedAtomics = this.sortAtomicClasses(
      Array.from(atomicMap.values()),
      context.propRegistry
    );

    const sortedCustomAtomics = this.sortAtomicClasses(
      Array.from(customAtomicMap.values()),
      effectiveRegistry
    );

    return {
      required: sortedAtomics,
      conditional: Array.from(conditionalMap.values()),
      potential: [], // From spread analysis
      customRequired: sortedCustomAtomics,
      customConditional: Array.from(customConditionalMap.values()),
      customPotential: [], // From spread analysis
    };
  }

  private countProperties(componentClass: ComponentClass): number {
    let count = componentClass.baseStyles.properties.size;

    componentClass.variants.forEach((variantClasses) => {
      variantClasses.forEach((vc) => {
        count += vc.styles.properties.size;
      });
    });

    componentClass.states.forEach((stateClass) => {
      count += stateClass.styles.properties.size;
    });

    return count;
  }

  private getComponentName(definition: ComponentDefinition): string {
    // Try to get component name from variable binding
    if (definition.variableBinding) {
      return definition.variableBinding.name;
    }

    // Fallback to generic name
    return 'Component';
  }

  private generateAtomicClassName(prop: string, value: string): string {
    // Map common prop names to short versions
    const propMap: Record<string, string> = {
      margin: 'm',
      marginTop: 'mt',
      marginBottom: 'mb',
      marginLeft: 'ml',
      marginRight: 'mr',
      marginX: 'mx',
      marginY: 'my',
      padding: 'p',
      paddingTop: 'pt',
      paddingBottom: 'pb',
      paddingLeft: 'pl',
      paddingRight: 'pr',
      paddingX: 'px',
      paddingY: 'py',
      backgroundColor: 'bg',
      color: 'color',
      fontSize: 'fontSize',
      fontWeight: 'fontWeight',
      lineHeight: 'lineHeight',
      letterSpacing: 'letterSpacing',
      textAlign: 'textAlign',
      width: 'w',
      height: 'h',
      minWidth: 'minW',
      maxWidth: 'maxW',
      minHeight: 'minH',
      maxHeight: 'maxH',
      display: 'd',
      position: 'pos',
      top: 'top',
      right: 'right',
      bottom: 'bottom',
      left: 'left',
      zIndex: 'z',
      gap: 'gap',
      rowGap: 'rowGap',
      columnGap: 'colGap',
    };

    const shortProp = propMap[prop] || prop;

    // Handle special characters in values
    const sanitizedValue = value
      .replace(/\./g, '') // Remove dots (e.g., "space.4" -> "space4")
      .replace(/\//g, '-') // Replace slashes with dashes
      .replace(/[^a-zA-Z0-9-_]/g, ''); // Remove other special chars

    return `animus-${shortProp}-${sanitizedValue}`;
  }

  private generateNamespacedAtomicClassName(
    prop: string,
    value: string,
    componentDef: ComponentDefinition
  ): string {
    const componentName = this.getComponentName(componentDef);
    const hash = this.generateHash('component', componentDef.id).substring(
      0,
      3
    );

    // Handle special characters in values (same as generateAtomicClassName)
    const sanitizedValue = value
      .replace(/\./g, '') // Remove dots (e.g., "space.4" -> "space4")
      .replace(/\//g, '-') // Replace slashes with dashes
      .replace(/[^a-zA-Z0-9-_]/g, ''); // Remove other special chars

    return `animus-${componentName}-${hash}-${prop}-${sanitizedValue}`;
  }

  private identifyDynamicProperties(
    usages: readonly ComponentUsage[],
    _definition: ComponentDefinition,
    context: ExtractionContext
  ): DynamicProperty[] {
    const dynamics: DynamicProperty[] = [];
    const propRegistry = context.propRegistry;

    if (!propRegistry) {
      return dynamics;
    }

    for (const usage of usages) {
      usage.props.properties.forEach((propValue, name) => {
        // Check if this is a style prop using PropRegistry
        const propConfig = propRegistry.props.get(name);
        if (propConfig && propValue.confidence === 0.0) {
          // DYNAMIC
          dynamics.push({
            property: name,
            sources: [usage.id],
            reason: 'Dynamic value',
          });
        }
      });
    }

    return dynamics;
  }

  private calculateConfidence(
    atomics: readonly AtomicClass[],
    dynamic: readonly DynamicProperty[]
  ): ConfidenceReport {
    const total = atomics.length + dynamic.length;
    const staticCount = atomics.length;
    const dynamicCount = dynamic.length;

    return {
      overall: total > 0 ? staticCount / total : 1,
      staticProperties: staticCount,
      partialProperties: 0,
      dynamicProperties: dynamicCount,
      coverage: total > 0 ? staticCount / total : 0,
    };
  }

  private generateHash(property: string, value: string | number): string {
    return crypto
      .createHash('sha256')
      .update(`${property}:${value}`)
      .digest('hex')
      .substring(0, 8);
  }

  private toKebabCase(str: string): string {
    // Handle special cases
    if (str === 'backgroundColor') return 'background-color';
    if (str === 'marginLeft') return 'margin-left';
    if (str === 'marginRight') return 'margin-right';
    if (str === 'marginTop') return 'margin-top';
    if (str === 'marginBottom') return 'margin-bottom';
    if (str === 'paddingLeft') return 'padding-left';
    if (str === 'paddingRight') return 'padding-right';
    if (str === 'paddingTop') return 'padding-top';
    if (str === 'paddingBottom') return 'padding-bottom';

    // General conversion
    return str.replace(/[A-Z]/g, (match, offset) =>
      offset > 0 ? `-${match.toLowerCase()}` : match.toLowerCase()
    );
  }

  private isResponsiveValue(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;

    // Check for array syntax: MediaQueryArray<T>
    if (Array.isArray(value)) {
      return value.length > 0;
    }

    // Check for object syntax: MediaQueryMap<T>
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const keys = Object.keys(value);
      // Check if it has breakpoint keys from MediaQueryMap
      const breakpointKeys = ['_', 'xs', 'sm', 'md', 'lg', 'xl'];
      return keys.some((key) => breakpointKeys.includes(key));
    }

    return false;
  }

  private handleResponsiveProp(
    propName: string,
    propValue: PropValue,
    propConfig: PropConfig,
    cssProperty: string,
    componentDef: ComponentDefinition,
    usage: ComponentUsage,
    isCustomProp: boolean,
    atomicMap: Map<string, AtomicClass>,
    conditionalMap: Map<string, ConditionalAtomic>,
    customAtomicMap: Map<string, AtomicClass>,
    customConditionalMap: Map<string, ConditionalAtomic>,
    context: ExtractionContext
  ): void {
    const responsiveValue = propValue.staticValue as any;
    const breakpoints = this.getBreakpointsFromContext(context);

    if (Array.isArray(responsiveValue)) {
      // Array syntax: map to breakpoints by index
      responsiveValue.forEach((value, index) => {
        if (value === null || value === undefined) return;

        const breakpoint = this.getBreakpointByIndex(index, breakpoints);
        this.addConditionalAtomic(
          propName,
          value,
          propConfig,
          cssProperty,
          componentDef,
          usage,
          isCustomProp,
          breakpoint,
          conditionalMap,
          customConditionalMap,
          context
        );
      });
    } else if (typeof responsiveValue === 'object') {
      // Object syntax: use explicit breakpoint keys
      Object.entries(responsiveValue).forEach(([breakpoint, value]) => {
        if (value === null || value === undefined) return;

        this.addConditionalAtomic(
          propName,
          value,
          propConfig,
          cssProperty,
          componentDef,
          usage,
          isCustomProp,
          breakpoint,
          conditionalMap,
          customConditionalMap,
          context
        );
      });
    }
  }

  private addConditionalAtomic(
    propName: string,
    value: unknown,
    propConfig: PropConfig,
    cssProperty: string,
    componentDef: ComponentDefinition,
    usage: ComponentUsage,
    isCustomProp: boolean,
    breakpoint: string,
    conditionalMap: Map<string, ConditionalAtomic>,
    customConditionalMap: Map<string, ConditionalAtomic>,
    context: ExtractionContext
  ): void {
    // Resolve the value
    const resolutionContext: ResolutionContext = {
      theme: context.theme,
      propRegistry: context.propRegistry,
      componentId: componentDef.id,
      logger: context.logger.child('resolver'),
    };

    const resolved = this.valueResolver.resolve(
      value,
      propConfig,
      resolutionContext
    );
    if (resolved.confidence === 0.0) return; // DYNAMIC

    const resolvedValue = String(resolved.value);

    // Generate class name with breakpoint suffix
    const baseClassName = isCustomProp
      ? this.generateNamespacedAtomicClassName(
          propName,
          resolvedValue,
          componentDef
        )
      : this.generateAtomicClassName(propName, resolvedValue);

    // For responsive values, we append the breakpoint to the class name
    const className =
      breakpoint === '_' || breakpoint === 'base'
        ? baseClassName
        : `${baseClassName}-${breakpoint}`;

    const kebabProperty = this.toKebabCase(cssProperty);

    const condition: AtomicCondition = {
      type: 'media',
      query: this.getMediaQuery(breakpoint, context),
    };

    const conditionalAtomic: ConditionalAtomic = {
      className,
      property: kebabProperty,
      value: resolvedValue,
      sources: [usage.id],
      condition,
    };

    // Determine which map to use
    const targetMap = isCustomProp ? customConditionalMap : conditionalMap;
    const key = `${cssProperty}:${resolvedValue}:${breakpoint}${isCustomProp ? `:${componentDef.id}` : ''}`;

    const existing = targetMap.get(key);
    if (existing) {
      targetMap.set(key, {
        ...existing,
        sources: [...existing.sources, ...conditionalAtomic.sources],
      });
    } else {
      targetMap.set(key, conditionalAtomic);
    }
  }

  private getBreakpointsFromContext(context: ExtractionContext): string[] {
    // MediaQueryArray maps to breakpoints: [_, xs, sm, md, lg, xl]
    return ['_', 'xs', 'sm', 'md', 'lg', 'xl'];
  }

  private getBreakpointByIndex(index: number, breakpoints: string[]): string {
    // Index 0 = base (_), 1 = xs, 2 = sm, etc.
    return breakpoints[index] || breakpoints[breakpoints.length - 1];
  }

  private getMediaQuery(
    breakpoint: string,
    _context: ExtractionContext
  ): string {
    // Base case - no media query
    if (breakpoint === '_' || breakpoint === 'base') return 'all';

    // These values will come from theme.breakpoints which is always defined
    // For now, use typical breakpoint values
    const defaultBreakpoints: Record<string, string> = {
      xs: '480px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
    };

    const minWidth = defaultBreakpoints[breakpoint];
    if (!minWidth) return 'all';

    return `(min-width: ${minWidth})`;
  }

  private sortAtomicClasses(
    atomics: AtomicClass[],
    propRegistry: PropRegistry | null
  ): AtomicClass[] {
    if (!propRegistry) {
      return atomics;
    }

    // Create a map of prop names to their configs for ordering
    // Convert PropConfig to Prop-compatible format
    const propConfigMap: Record<string, Prop> = {};
    propRegistry.props.forEach((config, name) => {
      propConfigMap[name] = {
        property: config.property as any,
        properties: config.properties as any,
        scale: config.scale as any,
        transform: config.transform as any,
      };
    });

    // Get ordered prop names
    const orderedPropNames = orderPropNames(propConfigMap);

    // Create a map of atomic classes by their source prop name
    const atomicsByProp = new Map<string, AtomicClass[]>();

    atomics.forEach((atomic) => {
      // Find which prop this atomic came from by checking the className
      const propName = this.extractPropFromClassName(atomic.className);
      if (propName) {
        const existing = atomicsByProp.get(propName) || [];
        existing.push(atomic);
        atomicsByProp.set(propName, existing);
      }
    });

    // Build sorted result
    const sorted: AtomicClass[] = [];
    orderedPropNames.forEach((propName) => {
      const atomicsForProp = atomicsByProp.get(propName);
      if (atomicsForProp) {
        sorted.push(...atomicsForProp);
      }
    });

    // Add any atomics that didn't match (shouldn't happen)
    atomics.forEach((atomic) => {
      if (!sorted.includes(atomic)) {
        sorted.push(atomic);
      }
    });

    return sorted;
  }

  private extractPropFromClassName(className: string): string | null {
    // Extract prop name from className like "animus-p-2" -> "p"
    const match = className.match(/^animus-([a-zA-Z]+)-/);
    return match ? match[1] : null;
  }

  private getEffectiveRegistry(
    componentDef: ComponentDefinition,
    globalRegistry: PropRegistry | null
  ): PropRegistry | null {
    // If component has custom props, merge them with global registry
    if (componentDef.customProps) {
      if (!globalRegistry) {
        // Use only custom props
        return {
          props: componentDef.customProps.props,
          groups: componentDef.customProps.groups,
          source: { kind: 'custom', description: 'Component-level props()' },
        };
      }

      // Merge custom props with global registry (custom takes precedence)
      const mergedProps = new Map(globalRegistry.props);
      componentDef.customProps.props.forEach((config, name) => {
        mergedProps.set(name, config);
      });

      return {
        props: mergedProps,
        groups: globalRegistry.groups, // TODO: Merge groups too
        source: { kind: 'custom', description: 'Merged component + global' },
      };
    }

    // No custom props, use global registry
    return globalRegistry;
  }
}
