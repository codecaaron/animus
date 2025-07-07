# Feature: Atomic Class Generation and Pooling

## Problem Statement
- The system needs to generate atomic utility classes for prop values (e.g., `animus-p-4` for `padding: 1rem`)
- These classes must be globally deduplicated and reusable across components
- Atomic classes are different from component-scoped style classes
- PropRegistry defines the available props and their scale mappings
- Custom props can override or extend the global registry per component

Which of the remaining features does this implement?
- [ ] Cross-file component usage tracking
- [ ] Deep theme resolution
- [ ] Full variant/state processing
- [ ] Multi-file scope analysis
- [x] Core infrastructure feature (new)

## Phase Analysis
- Primary phase affected: Phase 4 (Atomic Computation)
- Secondary phases impacted: Phase 3 (needs to track prop usage)
- Why Phase 4 owns this logic: Phase 4 is responsible for generating all CSS output, including atomic classes from prop usage

## Data Flow Changes

### New types needed:
```typescript
// types/extraction.ts
interface AtomicClass {
  className: string; // e.g., 'animus-p-4'
  property: string;  // e.g., 'padding'
  value: string;     // e.g., '1rem'
  css: string;       // Full CSS rule
  breakpoint?: string; // e.g., 'sm', 'md'
}

interface AtomicClassPool {
  classes: Map<string, AtomicClass>;
  getClassName(prop: string, value: string, breakpoint?: string): string;
  addClass(prop: string, value: string, css: string, breakpoint?: string): string;
  getAllClasses(): AtomicClass[];
}

interface PropUsage {
  propName: string;
  value: string | string[]; // Can be responsive array
  isCustomProp: boolean;
  isDynamic: boolean;
}
```

### Modified interfaces:
```typescript
// types/extraction.ts - Update ComponentUsage
interface ComponentUsage {
  // ... existing fields
  propUsages?: PropUsage[]; // NEW: Track all prop usage
  enabledGroups?: string[]; // NEW: Which groups are enabled
}

// types/core.ts - Update ExtractionContext
interface ExtractionContext {
  // ... existing fields
  atomicPool: AtomicClassPool; // NEW: Global atomic class pool
}

// types/extraction.ts - Update ExtractionResult
interface ExtractionResult {
  // ... existing fields
  atomicClasses: string[]; // NEW: List of atomic class names used
  componentClasses: StyleClass[]; // Component-scoped classes
}
```

## Implementation Approach

### 1. Create AtomicClassPool
```typescript
// extraction/atomicClassPool.ts
export class AtomicClassPool {
  private classes = new Map<string, AtomicClass>();

  getClassName(prop: string, value: string, breakpoint?: string): string {
    const key = this.generateKey(prop, value, breakpoint);
    const existing = this.classes.get(key);
    return existing?.className || '';
  }

  addClass(
    prop: string, 
    value: string, 
    css: string, 
    breakpoint?: string
  ): string {
    const key = this.generateKey(prop, value, breakpoint);
    
    if (!this.classes.has(key)) {
      const className = this.generateClassName(prop, value, breakpoint);
      this.classes.set(key, {
        className,
        property: prop,
        value,
        css,
        breakpoint
      });
    }
    
    return this.classes.get(key)!.className;
  }

  private generateKey(prop: string, value: string, breakpoint?: string): string {
    return breakpoint ? `${prop}-${value}-${breakpoint}` : `${prop}-${value}`;
  }

  private generateClassName(prop: string, value: string, breakpoint?: string): string {
    // Simple naming strategy: animus-[prop]-[value]-[breakpoint?]
    const base = `animus-${prop}-${this.sanitizeValue(value)}`;
    return breakpoint ? `${base}-${breakpoint}` : base;
  }

  private sanitizeValue(value: string): string {
    // Convert value to valid CSS class name
    // e.g., "1rem" -> "1rem", "#fff" -> "fff", "100%" -> "100p"
    return value.replace(/[^a-zA-Z0-9-]/g, '');
  }

  getAllClasses(): AtomicClass[] {
    return Array.from(this.classes.values());
  }

  generateCSS(): string {
    const classes = this.getAllClasses();
    return classes.map(({ className, css, breakpoint }) => {
      if (breakpoint) {
        const mediaQuery = this.getMediaQuery(breakpoint);
        return `@media ${mediaQuery} { .${className} { ${css} } }`;
      }
      return `.${className} { ${css} }`;
    }).join('\n');
  }
}
```

### 2. Create PropUsageExtractor
```typescript
// extraction/propUsageExtractor.ts
export class PropUsageExtractor {
  constructor(
    private propRegistry: PropRegistry,
    private componentProps: CustomPropDefinitions
  ) {}

  extractPropUsages(
    jsxAttributes: ts.JsxAttributes,
    enabledGroups: string[]
  ): PropUsage[] {
    const usages: PropUsage[] = [];
    
    for (const attr of jsxAttributes.properties) {
      if (ts.isJsxAttribute(attr)) {
        const propName = attr.name.getText();
        const propDef = this.getPropDefinition(propName, enabledGroups);
        
        if (propDef) {
          const usage = this.analyzePropUsage(attr, propDef);
          if (usage) usages.push(usage);
        }
      }
    }
    
    return usages;
  }

  private getPropDefinition(
    propName: string, 
    enabledGroups: string[]
  ): PropDefinition | undefined {
    // Check custom props first
    if (this.componentProps[propName]) {
      return this.componentProps[propName];
    }
    
    // Check if prop is in enabled groups
    const registryProp = this.propRegistry[propName];
    if (registryProp && this.isPropEnabled(propName, enabledGroups)) {
      return registryProp;
    }
    
    return undefined;
  }

  private analyzePropUsage(
    attr: ts.JsxAttribute,
    propDef: PropDefinition
  ): PropUsage | undefined {
    const value = this.extractValue(attr.initializer);
    
    if (!value) {
      return {
        propName: attr.name.getText(),
        value: '',
        isCustomProp: !!this.componentProps[attr.name.getText()],
        isDynamic: true // Can't determine value statically
      };
    }
    
    return {
      propName: attr.name.getText(),
      value,
      isCustomProp: !!this.componentProps[attr.name.getText()],
      isDynamic: false
    };
  }
}
```

### 3. Update Phase 3 to track prop usage
```typescript
// phases/usageCollection.ts
private analyzeJsxElement(node: ts.JsxElement): ComponentUsage {
  // ... existing logic
  
  // NEW: Extract prop usages
  const propUsages = this.propUsageExtractor.extractPropUsages(
    node.attributes,
    componentDef.enabledGroups || []
  );
  
  return {
    ...usage,
    propUsages,
    enabledGroups: componentDef.enabledGroups
  };
}
```

### 4. Update Phase 4 to generate atomic classes
```typescript
// phases/atomicComputation.ts
private generateAtomicClasses(
  usage: ComponentUsage,
  context: ExtractionContext
): string[] {
  const atomicClassNames: string[] = [];
  
  if (!usage.propUsages) return atomicClassNames;
  
  for (const propUsage of usage.propUsages) {
    if (propUsage.isDynamic) {
      // Flag for runtime handling
      continue;
    }
    
    const classNames = this.generateClassesForProp(
      propUsage,
      context.atomicPool,
      context.propRegistry
    );
    
    atomicClassNames.push(...classNames);
  }
  
  return atomicClassNames;
}

private generateClassesForProp(
  usage: PropUsage,
  pool: AtomicClassPool,
  registry: PropRegistry
): string[] {
  const classNames: string[] = [];
  const propDef = registry[usage.propName];
  
  if (!propDef) return classNames;
  
  // Handle responsive values
  if (Array.isArray(usage.value)) {
    usage.value.forEach((val, index) => {
      if (val !== undefined) {
        const breakpoint = this.getBreakpointName(index);
        const css = this.generatePropCSS(propDef, val);
        const className = pool.addClass(usage.propName, val, css, breakpoint);
        classNames.push(className);
      }
    });
  } else {
    const css = this.generatePropCSS(propDef, usage.value);
    const className = pool.addClass(usage.propName, usage.value, css);
    classNames.push(className);
  }
  
  return classNames;
}
```

### 5. Test strategy
- Unit tests for AtomicClassPool:
  - Class name generation
  - Deduplication
  - Breakpoint handling
- Unit tests for PropUsageExtractor:
  - Static value extraction
  - Dynamic value detection
  - Custom prop handling
- Integration tests:
  - Component with space/color props
  - Responsive prop values
  - Custom props with scales
- Performance tests:
  - Large number of unique atomic classes
  - Memory usage of global pool

## Documentation Updates Required

### ARCHITECTURE.md sections:
- Add "Atomic Class System" section explaining dual class approach
- Update Phase 4 description to include atomic class generation
- Add AtomicClassPool to infrastructure components

### Type definitions:
- Document AtomicClass and AtomicClassPool interfaces
- Update ComponentUsage with prop tracking
- Document PropUsage type

### Test snapshots:
- Add snapshots showing atomic class generation
- Examples with responsive values
- Dynamic prop flagging examples

## Risk Assessment

### Breaking changes:
- None - new feature addition

### Performance impact:
- Low - atomic classes are small and deduplicated
- Memory usage scales with unique prop/value combinations
- Typical app: ~500-2000 atomic classes = ~50-200KB

### Memory usage:
- Global pool persists across extraction
- Each atomic class ~100 bytes
- Scales linearly with unique prop/value combinations

## Implementation Priority
Critical - atomic classes are fundamental to the Animus prop system. Without them, the extractor cannot generate CSS for component props, which is a core feature.

## Future Considerations
- Atomic class optimization (merging similar classes)
- Critical CSS extraction (above-the-fold atoms only)
- Atomic class usage analytics
- Build-time purging of unused atoms
- Integration with PurgeCSS or similar tools