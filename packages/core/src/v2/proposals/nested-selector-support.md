# Feature: Comprehensive Nested Selector Support

## Problem Statement
- Current implementation may not fully support all CSS selector patterns in style objects
- Complex selectors like `.parent &`, `& + &`, and arbitrary nesting need proper handling
- Nested selectors appear in `.styles()`, `.variant()`, and `.states()` methods
- CSS generation must correctly resolve `&` tokens in various contexts
- Media queries and other at-rules need proper nesting support

Which of the remaining features does this implement?
- [ ] Cross-file component usage tracking
- [ ] Deep theme resolution
- [x] Full variant/state processing (enhances this)
- [ ] Multi-file scope analysis
- [x] Core infrastructure feature (new)

## Phase Analysis
- Primary phase affected: Phase 4 (Atomic Computation - CSS generation)
- Secondary phases impacted: Phase 2 (Chain Reconstruction - style extraction)
- Why Phase 4 owns this logic: CSS generation is where selectors are resolved and final CSS is produced

## Data Flow Changes

### New types needed:
```typescript
// types/extraction.ts
interface NestedSelector {
  selector: string;
  styles: StyleObject;
  type: 'pseudo-class' | 'pseudo-element' | 'child' | 'adjacent' | 'complex' | 'media' | 'supports' | 'container';
  specificity?: number; // For cascade resolution
}

interface StyleObjectWithSelectors extends StyleObject {
  // Regular CSS properties
  [property: string]: any;
  
  // Nested selectors - explicitly typed
  [K: `&${string}`]: StyleObject;
  [K: `@media${string}`]: StyleObject;
  [K: `@supports${string}`]: StyleObject;
  [K: `@container${string}`]: StyleObject;
  // Allow "wonky" selectors
  [K: string]: any; // Catches patterns like '.parent &'
}

interface SelectorResolver {
  resolve(selector: string, baseClass: string): string;
  isNestedSelector(property: string): boolean;
  getSelectorType(selector: string): NestedSelector['type'];
  calculateSpecificity(selector: string): number;
}

interface CSSGenerationContext {
  className: string;
  variantKey?: string;
  stateKey?: string;
  parentSelectors: string[]; // Track nesting depth
  mediaQueries: string[]; // Track media query nesting
}
```

### Modified interfaces:
```typescript
// types/extraction.ts - Update StyleClass
interface StyleClass {
  className: string;
  styles: StyleObject;
  selector?: string; // Base selector for this class
  nestedSelectors?: NestedSelector[]; // NEW: Extracted nested selectors
  type: 'base' | 'variant' | 'state';
  metadata?: {
    variantProp?: string;
    variantValue?: string;
    stateName?: string;
  };
}

// types/extraction.ts - Add to extraction options
interface ExtractorConfig {
  // ... existing fields
  selectorSupport?: {
    allowParentSelectors?: boolean; // Allow '.parent &'
    allowComplexCombinators?: boolean; // Allow '& + &', '& ~ &'
    validateSelectors?: boolean; // Validate selector syntax
    warnOnComplexity?: boolean; // Warn on overly complex selectors
  };
}
```

## Implementation Approach

### 1. Create SelectorResolver utility
```typescript
// extraction/selectorResolver.ts
export class SelectorResolver {
  resolve(selector: string, baseClass: string): string {
    // Handle different selector patterns
    if (selector === '&') {
      return baseClass;
    }
    
    // Pseudo-classes and pseudo-elements
    if (selector.startsWith('&:')) {
      return `${baseClass}${selector.substring(1)}`;
    }
    
    // Child and descendant selectors
    if (selector.startsWith('& ')) {
      return `${baseClass}${selector.substring(1)}`;
    }
    
    // Adjacent and sibling selectors
    if (selector.startsWith('& + ') || selector.startsWith('& ~ ')) {
      return `${baseClass}${selector.substring(1)}`;
    }
    
    // Complex selectors with & in the middle or end
    if (selector.includes('&')) {
      return selector.replace(/&/g, baseClass);
    }
    
    // Media queries and at-rules (return as-is)
    if (selector.startsWith('@')) {
      return selector;
    }
    
    // No & means it's a descendant selector
    return `${baseClass} ${selector}`;
  }

  isNestedSelector(property: string): boolean {
    // Check if property is a selector (not a CSS property)
    return (
      property.includes('&') ||
      property.startsWith('@') ||
      property.includes(':') ||
      property.includes('>') ||
      property.includes('+') ||
      property.includes('~') ||
      property.includes('[') ||
      property.includes('.') ||
      property.includes('#')
    );
  }

  getSelectorType(selector: string): NestedSelector['type'] {
    if (selector.startsWith('@media')) return 'media';
    if (selector.startsWith('@supports')) return 'supports';
    if (selector.startsWith('@container')) return 'container';
    if (selector.includes('::')) return 'pseudo-element';
    if (selector.includes(':')) return 'pseudo-class';
    if (selector.includes(' > ')) return 'child';
    if (selector.includes(' + ') || selector.includes(' ~ ')) return 'adjacent';
    return 'complex';
  }

  calculateSpecificity(selector: string): number {
    // Simplified specificity calculation
    let specificity = 0;
    
    // IDs
    specificity += (selector.match(/#[\w-]+/g) || []).length * 100;
    
    // Classes, attributes, pseudo-classes
    specificity += (selector.match(/\.[\w-]+/g) || []).length * 10;
    specificity += (selector.match(/\[[\w-]+/g) || []).length * 10;
    specificity += (selector.match(/:[\w-]+/g) || []).length * 10;
    
    // Elements and pseudo-elements
    specificity += (selector.match(/^[a-zA-Z]+|::[\w-]+/g) || []).length * 1;
    
    return specificity;
  }
}
```

### 2. Create NestedStyleExtractor
```typescript
// extraction/nestedStyleExtractor.ts
export class NestedStyleExtractor {
  constructor(
    private resolver: SelectorResolver
  ) {}

  extractNestedStyles(
    styles: StyleObject,
    baseSelector: string
  ): { flat: StyleObject; nested: NestedSelector[] } {
    const flat: StyleObject = {};
    const nested: NestedSelector[] = [];
    
    for (const [property, value] of Object.entries(styles)) {
      if (this.resolver.isNestedSelector(property)) {
        // Extract nested selector
        const resolvedSelector = this.resolver.resolve(property, baseSelector);
        const type = this.resolver.getSelectorType(property);
        
        if (type === 'media' || type === 'supports' || type === 'container') {
          // At-rules need special handling
          const innerNested = this.extractNestedStyles(
            value as StyleObject,
            baseSelector
          );
          
          nested.push({
            selector: property,
            styles: innerNested.flat,
            type,
            // Nested at-rule selectors
            nestedSelectors: innerNested.nested
          } as any);
        } else {
          // Regular nested selector
          const innerNested = this.extractNestedStyles(
            value as StyleObject,
            resolvedSelector
          );
          
          nested.push({
            selector: resolvedSelector,
            styles: innerNested.flat,
            type,
            specificity: this.resolver.calculateSpecificity(resolvedSelector),
            // Allow further nesting
            nestedSelectors: innerNested.nested.length > 0 ? innerNested.nested : undefined
          } as any);
        }
      } else {
        // Regular CSS property
        flat[property] = value;
      }
    }
    
    return { flat, nested };
  }
}
```

### 3. Create EnhancedCSSGenerator
```typescript
// extraction/enhancedCSSGenerator.ts
export class EnhancedCSSGenerator {
  constructor(
    private resolver: SelectorResolver,
    private extractor: NestedStyleExtractor
  ) {}

  generateCSS(styleClass: StyleClass): string {
    const { className, styles } = styleClass;
    const baseSelector = `.${className}`;
    
    // Extract nested styles
    const { flat, nested } = this.extractor.extractNestedStyles(
      styles,
      baseSelector
    );
    
    // Generate CSS
    const rules: string[] = [];
    
    // Base rule
    if (Object.keys(flat).length > 0) {
      rules.push(this.generateRule(baseSelector, flat));
    }
    
    // Nested rules
    rules.push(...this.generateNestedRules(nested, baseSelector));
    
    return rules.join('\n');
  }

  private generateRule(selector: string, styles: StyleObject): string {
    const declarations = Object.entries(styles)
      .map(([prop, value]) => `  ${this.kebabCase(prop)}: ${value};`)
      .join('\n');
    
    return `${selector} {\n${declarations}\n}`;
  }

  private generateNestedRules(
    nested: NestedSelector[],
    baseSelector: string
  ): string[] {
    const rules: string[] = [];
    
    // Sort by specificity for proper cascade
    const sorted = [...nested].sort((a, b) => 
      (a.specificity || 0) - (b.specificity || 0)
    );
    
    for (const item of sorted) {
      if (item.type === 'media' || item.type === 'supports' || item.type === 'container') {
        // At-rule wrapping
        const innerRules: string[] = [];
        
        if (Object.keys(item.styles).length > 0) {
          innerRules.push(this.generateRule(baseSelector, item.styles));
        }
        
        if (item.nestedSelectors) {
          innerRules.push(...this.generateNestedRules(
            item.nestedSelectors,
            baseSelector
          ));
        }
        
        rules.push(`${item.selector} {\n${innerRules.join('\n')}\n}`);
      } else {
        // Regular nested selector
        if (Object.keys(item.styles).length > 0) {
          rules.push(this.generateRule(item.selector, item.styles));
        }
        
        // Handle further nesting
        if (item.nestedSelectors) {
          rules.push(...this.generateNestedRules(
            item.nestedSelectors,
            item.selector
          ));
        }
      }
    }
    
    return rules;
  }

  private kebabCase(str: string): string {
    return str.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
  }
}
```

### 4. Update StyleClassGenerator to use enhanced CSS generation
```typescript
// extraction/styleClassGenerator.ts
export class StyleClassGenerator {
  constructor(
    private componentId: string,
    private classNameGenerator: ClassNameGenerator,
    private cssGenerator: EnhancedCSSGenerator // NEW
  ) {}

  generateStyleClasses(
    usage: ComponentUsage,
    definition: ComponentDefinition
  ): StyleClass[] {
    const classes: StyleClass[] = [];
    
    // Generate base classes with nested selector support
    if (definition.baseStyles) {
      const className = this.classNameGenerator.generate(
        `${this.componentId}-base`
      );
      
      classes.push({
        className,
        styles: definition.baseStyles,
        type: 'base'
      });
    }
    
    // Variants and states also support nested selectors
    // ... existing variant/state logic
    
    return classes;
  }
}
```

### 5. Test strategy
- Unit tests for SelectorResolver:
  - All selector pattern types
  - Complex selector combinations
  - Edge cases (multiple &, escaped characters)
- Unit tests for NestedStyleExtractor:
  - Deep nesting extraction
  - Media query nesting
  - Mixed flat and nested styles
- Unit tests for EnhancedCSSGenerator:
  - CSS output formatting
  - Specificity ordering
  - At-rule handling
- Integration tests:
  - Component with complex hover states
  - Variants with nested pseudo-elements
  - States overriding variant hovers
  - Media queries with nested selectors
- Snapshot tests:
  - Real-world component examples
  - Complex selector patterns
  - Generated CSS output

## Documentation Updates Required

### ARCHITECTURE.md sections:
- Add "Nested Selector Support" section
- Document supported selector patterns
- Explain cascade resolution in variants/states

### Type definitions:
- Document NestedSelector type
- Update StyleObject documentation
- Add selector pattern examples

### Test snapshots:
- Complex selector examples
- Variant/state nesting examples
- Media query nesting

## Risk Assessment

### Breaking changes:
- None - enhances existing functionality
- Backward compatible with simple selectors

### Performance impact:
- Low - selector parsing is fast
- CSS generation happens at build time
- Minimal overhead for nested extraction

### Memory usage:
- Slight increase for nested selector storage
- ~1KB per component with complex selectors

## Implementation Priority
Medium - Important for full CSS feature parity but not blocking core functionality. Should be implemented alongside or after variant/state processing.

## Selector Support Matrix

### Fully Supported
- `&:hover`, `&:focus`, `&:active` - Pseudo-classes
- `&::before`, `&::after` - Pseudo-elements
- `& > div`, `& + span` - Combinators
- `&[data-state="active"]` - Attribute selectors
- `@media`, `@supports`, `@container` - At-rules
- `.parent &` - Parent selectors
- `&.additional-class` - Compound selectors

### Special Handling
- `& + &` - Adjacent siblings of same component
- Deep nesting (3+ levels)
- Multiple & in one selector

### Future Considerations
- CSS nesting spec alignment
- Performance optimization for deeply nested selectors
- Selector validation and linting
- Integration with CSS-in-JS libraries' selector handling