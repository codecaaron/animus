import type { ComponentIdentity } from './component-identity';
import type { ComponentRuntimeMetadata } from './generator';
import type { ExtractedStyles } from './types';

/**
 * Complete representation of a component with ALL possible styles/variants/states
 * This is the "universe" of what's possible, not what's used
 */
export interface ComponentNode {
  identity: ComponentIdentity;
  
  // All possible variant values defined in the component
  allVariants: Record<string, VariantDefinition>;
  
  // All possible states defined
  allStates: Set<string>;
  
  // All custom props defined
  allProps: Record<string, PropDefinition>;
  
  // Enabled prop groups
  groups: string[];
  
  // Parent component if this extends another
  extends?: ComponentIdentity;
  
  // Raw extracted data
  extraction: ExtractedStyles;
  
  // Runtime metadata for this component
  metadata: ComponentRuntimeMetadata;
}

/**
 * Variant definition with all possible values
 */
export interface VariantDefinition {
  prop: string;
  values: Set<string>;
  defaultValue?: string;
}

/**
 * Custom prop definition
 */
export interface PropDefinition {
  property: string;
  scale?: string;
  transform?: string;
}

/**
 * Complete component graph representing all components and their possibilities
 */
export interface ComponentGraph {
  // All components keyed by hash
  components: Map<string, ComponentNode>;
  
  // Metadata about the graph
  metadata: {
    timestamp: number;
    projectRoot: string;
    totalComponents: number;
    totalVariants: number;
    totalStates: number;
  };
  
  // File dependencies for cache invalidation
  fileDependencies: Set<string>;
}

/**
 * Builds a complete component graph from extracted components
 */
export class ComponentGraphBuilder {
  private components = new Map<string, ComponentNode>();
  private fileDependencies = new Set<string>();
  
  /**
   * Add a component to the graph with all its possibilities
   */
  addComponent(
    identity: ComponentIdentity,
    extraction: ExtractedStyles,
    metadata: ComponentRuntimeMetadata,
    extendsIdentity?: ComponentIdentity
  ): void {
    // Extract all variant values
    const allVariants: Record<string, VariantDefinition> = {};
    
    if (extraction.variants) {
      const variantArray = Array.isArray(extraction.variants) 
        ? extraction.variants 
        : [extraction.variants];
      
      for (const variantDef of variantArray) {
        if (variantDef.prop && variantDef.variants) {
          allVariants[variantDef.prop] = {
            prop: variantDef.prop,
            values: new Set(Object.keys(variantDef.variants)),
            defaultValue: variantDef.defaultValue
          };
        }
      }
    }
    
    // Extract all states
    const allStates = new Set<string>();
    if (extraction.states) {
      Object.keys(extraction.states).forEach(state => allStates.add(state));
    }
    
    // Extract all custom props
    const allProps: Record<string, PropDefinition> = {};
    if (extraction.props) {
      Object.entries(extraction.props).forEach(([prop, def]) => {
        allProps[prop] = {
          property: def.property || prop,
          scale: def.scale,
          transform: def.transform
        };
      });
    }
    
    const node: ComponentNode = {
      identity,
      allVariants,
      allStates,
      allProps,
      groups: extraction.groups || [],
      extends: extendsIdentity,
      extraction,
      metadata
    };
    
    this.components.set(identity.hash, node);
    this.fileDependencies.add(identity.filePath);
  }
  
  /**
   * Build the final graph
   */
  build(projectRoot: string): ComponentGraph {
    // Calculate statistics
    let totalVariants = 0;
    let totalStates = 0;
    
    for (const component of this.components.values()) {
      totalVariants += Object.keys(component.allVariants).length;
      totalStates += component.allStates.size;
    }
    
    return {
      components: this.components,
      metadata: {
        timestamp: Date.now(),
        projectRoot,
        totalComponents: this.components.size,
        totalVariants,
        totalStates
      },
      fileDependencies: this.fileDependencies
    };
  }
  
  /**
   * Get all possible values for a component variant
   */
  static getVariantValues(graph: ComponentGraph, componentHash: string, variantProp: string): Set<string> | undefined {
    const component = graph.components.get(componentHash);
    if (!component) return undefined;
    
    const variant = component.allVariants[variantProp];
    return variant?.values;
  }
  
  /**
   * Get all possible states for a component
   */
  static getComponentStates(graph: ComponentGraph, componentHash: string): Set<string> | undefined {
    const component = graph.components.get(componentHash);
    return component?.allStates;
  }
  
  /**
   * Check if a component extends another
   */
  static getExtensionChain(graph: ComponentGraph, componentHash: string): ComponentIdentity[] {
    const chain: ComponentIdentity[] = [];
    let current = graph.components.get(componentHash);
    
    while (current) {
      chain.push(current.identity);
      if (current.extends) {
        current = graph.components.get(current.extends.hash);
      } else {
        break;
      }
    }
    
    return chain;
  }
}

// The component graph captures the quantum superposition of all possibilities
// Before observation (usage), all variants and states exist simultaneously