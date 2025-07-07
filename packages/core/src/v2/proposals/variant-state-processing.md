# Feature: Full Variant/State Processing

## Problem Statement
- Current implementation detects variants in component definitions but doesn't fully process them
- State-based styles (hover, focus, active) are not extracted
- Variant combinations and compound variants are not handled
- Conditional styles based on props are not fully analyzed
- This results in missing CSS classes for interactive states and variant combinations

Which of the remaining features does this implement?
- [ ] Cross-file component usage tracking
- [ ] Deep theme resolution
- [x] Full variant/state processing
- [ ] Multi-file scope analysis

## Phase Analysis
- Primary phase affected: Phase 2 (Chain Reconstruction) and Phase 4 (Atomic Computation)
- Secondary phases impacted: Phase 3 (Usage Collection) for variant usage tracking
- Why these phases: 
  - Phase 2 needs to capture complete variant definitions from component chains
  - Phase 4 needs to generate CSS for all variant combinations used

## Data Flow Changes

### New types needed:
```typescript
// types/extraction.ts
interface Variant {
  prop?: string; // Optional - can be default variant without prop
  variants: Record<string, StyleObject>;
  defaultValue?: string;
}

interface StateDefinition {
  // Boolean states like disabled, active, submenu
  [stateName: string]: StyleObject;
}

interface StateStyle {
  stateName: string; // e.g., 'disabled', 'active', 'raised'
  styles: StyleObject;
  isBoolean: boolean; // Always true for Animus states
}

interface VariantAnalysis {
  variants: Variant[]; // Can have multiple .variant() calls
  states: StateDefinition; // From .states() call
  hasDefaultVariant: boolean; // When .variant() has no prop
}
```

### Modified interfaces:
```typescript
// types/phases.ts - Update ComponentDefinition
interface ComponentDefinition {
  // ... existing fields
  variantAnalysis?: VariantAnalysis; // NEW
  baseStyles: StyleObject; // Separated from variant styles
}

// types/extraction.ts - Update ComponentUsage
interface ComponentUsage {
  // ... existing fields
  variantProps?: Record<string, string>; // NEW: e.g., { size: 'small', variant: 'primary' }
  activeStates?: string[]; // NEW: e.g., ['disabled', 'active']
  dynamicProps?: {
    variants?: string[]; // NEW: Props we couldn't statically determine
    states?: string[];   // NEW: States we couldn't statically determine
  };
}

// types/extraction.ts - Update StyleClass
interface StyleClass {
  className: string; // Component-scoped class name
  styles: StyleObject;
  selector?: string; // Optional selector for variants/states
  type: 'base' | 'variant' | 'state';
  metadata?: {
    variantProp?: string;
    variantValue?: string;
    stateName?: string;
  };
}
```

### Context additions:
- Phase 2 will populate `variantAnalysis` in ComponentDefinition
- Phase 3 will track variant usage in ComponentUsage
- Phase 4 will generate classes for all used variant combinations

## Implementation Approach

### 1. Create VariantExtractor utility
```typescript
// extraction/variantExtractor.ts
export class VariantExtractor {
  extractVariants(chain: AnimusChainItem[]): VariantAnalysis {
    // Find all .variant() calls in the chain
    // Extract variant configurations
    // Find .states() call and extract state definitions
    // Return structured analysis
  }

  parseVariantCall(node: ts.CallExpression): Variant | undefined {
    // Parse .variant({ prop: 'size', variants: {...} })
    // or .variant({ variants: {...} }) for default variant
    // Extract variant options and their styles
  }

  parseStatesCall(node: ts.CallExpression): StateDefinition | undefined {
    // Parse .states({ disabled: {...}, active: {...} })
    // Extract boolean state definitions
    // All states in Animus are boolean flags
  }
}
```

### 2. Create StyleClassGenerator for Phase 4
```typescript
// extraction/styleClassGenerator.ts
export class StyleClassGenerator {
  constructor(
    private componentId: string,
    private classNameGenerator: ClassNameGenerator
  ) {}

  generateStyleClasses(
    usage: ComponentUsage,
    definition: ComponentDefinition
  ): StyleClass[] {
    const classes: StyleClass[] = [];
    
    // 1. Generate base style classes (same as current implementation)
    classes.push(...this.generateBaseClasses(definition.baseStyles));
    
    // 2. Generate variant classes based on usage
    if (usage.variantProps && definition.variantAnalysis) {
      classes.push(...this.generateVariantClasses(
        definition.variantAnalysis.variants,
        usage.variantProps
      ));
    }
    
    // 3. Generate state classes if states are active
    if (usage.activeStates?.length && definition.variantAnalysis?.states) {
      classes.push(...this.generateStateClasses(
        definition.variantAnalysis.states,
        usage.activeStates
      ));
    }
    
    return classes;
  }

  private generateVariantClasses(
    variants: Variant[],
    usedProps: Record<string, string>
  ): StyleClass[] {
    const classes: StyleClass[] = [];
    
    for (const variant of variants) {
      const propName = variant.prop || 'variant';
      const propValue = usedProps[propName];
      
      if (propValue && variant.variants[propValue]) {
        const styles = variant.variants[propValue];
        const className = this.classNameGenerator.generate(
          `${this.componentId}-${propName}-${propValue}`
        );
        
        // Handle responsive styles within the variant
        const processedStyles = this.processResponsiveStyles(styles);
        
        classes.push({
          className,
          styles: processedStyles,
          type: 'variant',
          metadata: {
            variantProp: propName,
            variantValue: propValue
          }
        });
      }
    }
    
    return classes;
  }

  private generateStateClasses(
    states: StateDefinition,
    activeStates: string[]
  ): StyleClass[] {
    const classes: StyleClass[] = [];
    
    for (const stateName of activeStates) {
      if (states[stateName]) {
        const className = this.classNameGenerator.generate(
          `${this.componentId}-state-${stateName}`
        );
        
        // States typically use data attributes or class selectors
        const selector = `&[data-state-${stateName}="true"]`;
        
        classes.push({
          className,
          styles: states[stateName],
          selector,
          type: 'state',
          metadata: {
            stateName
          }
        });
      }
    }
    
    return classes;
  }

  private processResponsiveStyles(styles: StyleObject): StyleObject {
    // Convert responsive arrays to media queries within a single class
    // { padding: ['1rem', '2rem'] } ->
    // { padding: '1rem', '@media (min-width: 640px)': { padding: '2rem' } }
    const processed: StyleObject = {};
    
    for (const [prop, value] of Object.entries(styles)) {
      if (Array.isArray(value)) {
        // Set base value
        processed[prop] = value[0];
        
        // Add media queries for other breakpoints
        value.slice(1).forEach((val, index) => {
          if (val !== undefined) {
            const breakpoint = this.getBreakpoint(index + 1);
            const mediaKey = `@media ${breakpoint}`;
            processed[mediaKey] = processed[mediaKey] || {};
            processed[mediaKey][prop] = val;
          }
        });
      } else {
        processed[prop] = value;
      }
    }
    
    return processed;
  }
}
```

### 3. Update Phase 2 to use VariantExtractor
```typescript
// phases/chainReconstruction.ts
private processChain(chain: AnimusChainItem[]): ComponentDefinition {
  // ... existing logic
  
  // NEW: Extract variants
  const variantAnalysis = this.variantExtractor.extractVariants(chain);
  
  return {
    ...definition,
    variantAnalysis,
    baseStyles: this.separateBaseStyles(allStyles, variantAnalysis)
  };
}
```

### 4. Update Phase 3 to track variant usage
```typescript
// phases/usageCollection.ts
private analyzeJsxElement(node: ts.JsxElement): ComponentUsage {
  // ... existing logic
  
  // NEW: Extract variant props from JSX attributes
  const variantResult = this.extractVariantProps(
    node.attributes,
    componentDef.variantAnalysis
  );
  
  // NEW: Extract active states (boolean props)
  const stateResult = this.extractActiveStates(
    node.attributes,
    componentDef.variantAnalysis.states
  );
  
  // Combine dynamic flags
  const dynamicProps = {
    variants: variantResult.dynamic,
    states: stateResult.dynamic
  };
  
  return {
    ...usage,
    variantProps: variantResult.props,
    activeStates: stateResult.states,
    dynamicProps: (dynamicProps.variants || dynamicProps.states) ? dynamicProps : undefined
  };
}

private extractVariantProps(
  attributes: ts.JsxAttributes,
  analysis: VariantAnalysis
): { props?: Record<string, string>; dynamic?: string[] } {
  const props: Record<string, string> = {};
  const dynamic: string[] = [];
  
  for (const variant of analysis.variants) {
    const propName = variant.prop || 'variant';
    const attr = this.findAttribute(attributes, propName);
    
    if (attr) {
      const value = this.extractStaticValue(attr);
      if (value) {
        props[propName] = value;
      } else {
        // Can't determine statically - flag as dynamic
        dynamic.push(propName);
      }
    }
  }
  
  return { 
    props: Object.keys(props).length ? props : undefined,
    dynamic: dynamic.length ? dynamic : undefined
  };
}

private extractActiveStates(
  attributes: ts.JsxAttributes,
  states: StateDefinition
): { states?: string[]; dynamic?: string[] } {
  const active: string[] = [];
  const dynamic: string[] = [];
  
  for (const stateName of Object.keys(states)) {
    const attr = this.findAttribute(attributes, stateName);
    
    if (attr) {
      if (this.isTrueBooleanProp(attr)) {
        active.push(stateName);
      } else if (!this.isFalseBooleanProp(attr)) {
        // Dynamic boolean - can't determine statically
        dynamic.push(stateName);
      }
    }
  }
  
  return {
    states: active.length ? active : undefined,
    dynamic: dynamic.length ? dynamic : undefined
  };
}
```

### 5. Update Phase 4 to use StyleClassGenerator
```typescript
// phases/atomicComputation.ts
private generateClasses(
  usage: ComponentUsage,
  definition: ComponentDefinition
): StyleClass[] {
  const generator = new StyleClassGenerator(
    definition.componentId,
    this.classNameGenerator
  );
  
  return generator.generateStyleClasses(usage, definition);
}
```

### 6. Test strategy
- Unit tests for VariantExtractor:
  - Single variant with prop name
  - Multiple variant calls
  - Default variant (no prop)
  - States object parsing
- Integration tests:
  - Button with size/variant props
  - Component with disabled/active states
  - Multiple variants on same component
  - Extended components with variants
- Snapshot tests:
  - CSS output for variant combinations
  - State-based selectors
  - Responsive variant values

## Documentation Updates Required

### ARCHITECTURE.md sections:
- Update limitations to show variant processing as complete
- Add "Variant Processing" section explaining the system
- Update Phase 2 and 4 descriptions
- Add VariantExtractor and StyleClassGenerator to utilities

### Type definitions:
- Document all new variant-related types
- Update ComponentDefinition and ComponentUsage docs
- Document component-scoped class naming patterns

### Test snapshots:
- Add comprehensive variant test snapshots
- Update existing snapshots with variant information

## Risk Assessment

### Breaking changes:
- Potentially - variant class naming might differ from current partial implementation
- Mitigation: Add compatibility mode for existing class names

### Performance impact:
- Medium - variant combination analysis can be complex
- Mitigation: 
  - Only compute variants that are actually used
  - Cache variant combinations
  - Limit compound variant depth

### Memory usage:
- Moderate increase for variant analysis storage
- ~1-5KB per component with variants
- Variant combination cache: ~10KB for typical app

## Implementation Priority
High priority - variants and states are core Animus features. Almost every component uses these patterns for conditional styling and interactive states.

## Key Implementation Notes

### Animus-Specific Patterns
1. **Variants can be called multiple times** - Each .variant() call adds a new variant configuration
2. **States are always boolean** - No string-based states, only true/false flags
3. **Default variants** - When .variant() has no `prop` field, it uses a default prop name
4. **States vs pseudo-selectors** - States create data attributes or classes, not :hover/:focus
5. **Responsive variants** - Variant values can use responsive array/object syntax

### Example Patterns from Codebase
```typescript
// Multiple variants
.variant({ prop: 'size', variants: { sm: {}, lg: {} }})
.variant({ prop: 'variant', variants: { fill: {}, stroke: {} }})

// Boolean states
.states({ disabled: {}, active: {}, raised: {} })

// Usage in JSX
<Button size="sm" variant="fill" disabled>Click</Button>
```

## Future Considerations
- Compound variants (combining multiple variant conditions)
- State-based pseudo-selector generation
- Variant inheritance in extended components
- Performance optimization for many variants
- TypeScript type generation for variant/state props