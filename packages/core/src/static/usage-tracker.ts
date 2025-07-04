import type { ComponentIdentity } from './component-identity';

/**
 * Tracks which components, variants, states, and props are actually used
 * This represents the "observed" subset of the complete component graph
 */
export interface UsageSet {
  // Components that are actually used
  components: Map<string, ComponentUsage>;

  // Metadata about usage collection
  metadata: {
    filesProcessed: number;
    timestamp: number;
  };
}

/**
 * Usage information for a single component
 */
export interface ComponentUsage {
  // Component identity
  identity: ComponentIdentity;

  // Whether this component is used at all
  used: boolean;

  // Which variant values are actually used
  variants: Map<string, Set<string>>;

  // Which states are actually used
  states: Set<string>;

  // Which prop values are used (for atomic utilities)
  props: Map<string, Set<any>>;

  // Atomic utility classes generated from props
  atomicUtilities: Set<string>;

  // Number of times this component is used
  usageCount: number;
}

/**
 * Tracks component usage during transformation
 */
export class UsageTracker {
  private components = new Map<string, ComponentUsage>();
  private filesProcessed = 0;

  /**
   * Record that a component is used
   */
  recordComponentUsage(
    identity: ComponentIdentity,
    props?: Record<string, any>
  ): void {
    const hash = identity.hash;

    // Get or create usage entry
    let usage = this.components.get(hash);
    if (!usage) {
      usage = {
        identity,
        used: true,
        variants: new Map(),
        states: new Set(),
        props: new Map(),
        atomicUtilities: new Set(),
        usageCount: 0,
      };
      this.components.set(hash, usage);
    }

    // Increment usage count
    usage.usageCount++;

    // Record prop usage if provided
    if (props) {
      this.recordPropUsage(usage, props);
    }
  }

  /**
   * Record variant usage
   */
  recordVariantUsage(
    componentHash: string,
    variantProp: string,
    value: string
  ): void {
    const usage = this.components.get(componentHash);
    if (!usage) return;

    let variantValues = usage.variants.get(variantProp);
    if (!variantValues) {
      variantValues = new Set();
      usage.variants.set(variantProp, variantValues);
    }

    variantValues.add(value);
  }

  /**
   * Record state usage
   */
  recordStateUsage(componentHash: string, state: string): void {
    const usage = this.components.get(componentHash);
    if (!usage) return;

    usage.states.add(state);
  }

  /**
   * Record prop usage for atomic utilities
   */
  private recordPropUsage(
    usage: ComponentUsage,
    props: Record<string, any>
  ): void {
    for (const [prop, value] of Object.entries(props)) {
      // Skip special props
      if (prop === 'children' || prop === 'className' || prop === 'style') {
        continue;
      }

      let propValues = usage.props.get(prop);
      if (!propValues) {
        propValues = new Set();
        usage.props.set(prop, propValues);
      }

      // Handle responsive values
      if (Array.isArray(value)) {
        value.forEach((v, index) => {
          if (v !== undefined && v !== null) {
            propValues!.add({ value: v, breakpoint: index });
          }
        });
      } else if (
        typeof value === 'object' &&
        value !== null &&
        !value.$$typeof
      ) {
        // Responsive object
        for (const [breakpoint, v] of Object.entries(value)) {
          if (v !== undefined && v !== null) {
            propValues!.add({ value: v, breakpoint });
          }
        }
      } else {
        // Regular value
        propValues.add(value);
      }
    }
  }

  /**
   * Record atomic utility usage
   */
  recordAtomicUtility(componentHash: string, utilityClass: string): void {
    const usage = this.components.get(componentHash);
    if (!usage) return;

    usage.atomicUtilities.add(utilityClass);
  }

  /**
   * Mark that a file has been processed
   */
  markFileProcessed(): void {
    this.filesProcessed++;
  }

  /**
   * Build the final usage set
   */
  build(): UsageSet {
    return {
      components: this.components,
      metadata: {
        filesProcessed: this.filesProcessed,
        timestamp: Date.now(),
      },
    };
  }

  /**
   * Merge another usage set into this one
   */
  merge(other: UsageSet): void {
    for (const [hash, otherUsage] of other.components) {
      const thisUsage = this.components.get(hash);

      if (!thisUsage) {
        // New component
        this.components.set(hash, otherUsage);
      } else {
        // Merge usage
        thisUsage.usageCount += otherUsage.usageCount;

        // Merge variants
        for (const [prop, values] of otherUsage.variants) {
          const thisValues = thisUsage.variants.get(prop) || new Set();
          values.forEach((v) => thisValues.add(v));
          thisUsage.variants.set(prop, thisValues);
        }

        // Merge states
        otherUsage.states.forEach((s) => thisUsage.states.add(s));

        // Merge props
        for (const [prop, values] of otherUsage.props) {
          const thisValues = thisUsage.props.get(prop) || new Set();
          values.forEach((v) => thisValues.add(v));
          thisUsage.props.set(prop, thisValues);
        }

        // Merge utilities
        otherUsage.atomicUtilities.forEach((u) =>
          thisUsage.atomicUtilities.add(u)
        );
      }
    }

    this.filesProcessed += other.metadata.filesProcessed;
  }

  /**
   * Get usage for a specific component
   */
  getComponentUsage(componentHash: string): ComponentUsage | undefined {
    return this.components.get(componentHash);
  }

  /**
   * Check if a component is used
   */
  isComponentUsed(componentHash: string): boolean {
    return this.components.has(componentHash);
  }

  /**
   * Check if a variant value is used
   */
  isVariantUsed(
    componentHash: string,
    variantProp: string,
    value: string
  ): boolean {
    const usage = this.components.get(componentHash);
    if (!usage) return false;

    const values = usage.variants.get(variantProp);
    return values ? values.has(value) : false;
  }

  /**
   * Check if a state is used
   */
  isStateUsed(componentHash: string, state: string): boolean {
    const usage = this.components.get(componentHash);
    return usage ? usage.states.has(state) : false;
  }

  allComponents() {
    return this.components;
  }
}

// The usage tracker observes the quantum collapse
// Recording which possibilities become reality through use
