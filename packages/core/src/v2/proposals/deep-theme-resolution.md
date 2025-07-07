# Feature: Deep Theme Resolution

## Problem Statement
- Current implementation only performs basic theme token resolution (e.g., `theme.colors.primary` → `#0066cc`)
- Nested theme references are not resolved (e.g., `theme.colors.brand` where `brand` references `primary`)
- Theme functions and computed values are not evaluated
- Responsive theme values in arrays/objects are not fully processed
- This limits the accuracy of generated CSS, especially for complex design systems

Which of the remaining features does this implement?
- [ ] Cross-file component usage tracking
- [x] Deep theme resolution
- [ ] Full variant/state processing
- [ ] Multi-file scope analysis

## Phase Analysis
- Primary phase affected: Phase 4 (Atomic Computation)
- Secondary phases impacted: Phase 2 (Chain Reconstruction) for theme object extraction
- Why Phase 4 owns this logic: Phase 4 is responsible for converting style values to CSS. Deep theme resolution is part of that value conversion process.

## Data Flow Changes

### New types needed:
```typescript
// types/extraction.ts
interface ThemeToken {
  path: string[]; // e.g., ['colors', 'brand', 'primary']
  value: unknown;
  resolved?: unknown; // Final resolved value
  isFunction: boolean;
  dependencies?: string[][]; // Other theme paths this depends on
}

interface ThemeResolutionContext {
  theme: Record<string, unknown>;
  tokens: Map<string, ThemeToken>;
  resolutionDepth: number;
  maxDepth: number; // Prevent infinite recursion
}

// types/core.ts
interface ThemeAnalysis {
  tokens: ThemeToken[];
  functions: Map<string, Function>;
  circularDependencies: string[][];
}
```

### Modified interfaces:
```typescript
// types/extraction.ts
interface StyleValue {
  // ... existing fields
  themeTokens?: ThemeToken[]; // NEW: Track all theme tokens in this value
  requiresDeepResolution?: boolean; // NEW: Flag for complex resolution
}

// types/core.ts - Update ExtractionContext
interface ExtractionContext {
  // ... existing fields
  themeAnalysis?: ThemeAnalysis; // NEW: Cached theme analysis
}
```

### Context additions:
- `themeAnalysis`: Comprehensive analysis of the theme object
- Cached to avoid re-analyzing theme for every component

## Implementation Approach

### 1. Create ThemeAnalyzer utility
```typescript
// extraction/themeAnalyzer.ts
export class ThemeAnalyzer {
  analyze(theme: Record<string, unknown>): ThemeAnalysis {
    // Traverse theme object
    // Build token dependency graph
    // Identify functions and computed values
    // Detect circular dependencies
  }

  resolveToken(
    token: ThemeToken, 
    context: ThemeResolutionContext
  ): unknown {
    // Recursive resolution with cycle detection
    // Handle functions with proper context
    // Support nested references
  }

  resolveResponsiveValue(
    value: unknown,
    breakpoints: string[]
  ): Record<string, unknown> {
    // Handle array syntax [mobile, tablet, desktop]
    // Handle object syntax { sm: ..., md: ..., lg: ... }
  }
}
```

### 2. Enhance StyleResolver
```typescript
// extraction/styleResolver.ts
export class StyleResolver {
  constructor(
    private themeAnalyzer: ThemeAnalyzer // NEW dependency
  ) {}

  resolveValue(value: unknown): StyleValue {
    // Check if value contains theme references
    // Use ThemeAnalyzer for deep resolution
    // Handle computed values and functions
    // Cache resolved values
  }
}
```

### 3. CSS Variable Strategy for Theme Resolution
```typescript
// extraction/cssVariableResolver.ts
export class CSSVariableResolver {
  resolveThemeValue(
    path: string[],
    theme: Record<string, unknown>
  ): string | { value: string; cssVar: string } {
    const value = this.getValueAtPath(theme, path);
    
    // If the value is already a CSS variable, return as-is
    if (typeof value === 'string' && value.startsWith('var(--')) {
      return value;
    }
    
    // For non-variable values, we can still resolve at build time
    // but also provide the CSS variable for runtime flexibility
    const cssVarName = `--${path.join('-')}`;
    
    return {
      value: String(value),
      cssVar: `var(${cssVarName}, ${value})`
    };
  }
  
  generateThemeVariables(
    theme: Record<string, unknown>
  ): Record<string, string> {
    const variables: Record<string, string> = {};
    
    const traverse = (obj: any, path: string[] = []) => {
      for (const [key, value] of Object.entries(obj)) {
        const currentPath = [...path, key];
        
        if (typeof value === 'object' && value !== null) {
          traverse(value, currentPath);
        } else {
          const varName = `--${currentPath.join('-')}`;
          variables[varName] = String(value);
        }
      }
    };
    
    traverse(theme);
    return variables;
  }
}

### 4. Update Phase 4 to use deep resolution
```typescript
// phases/atomicComputation.ts
private computeAtomicClasses(
  usage: ComponentUsage,
  definition: ComponentDefinition
): AtomicClass[] {
  // Get or create theme analysis
  // Use enhanced StyleResolver with ThemeAnalyzer
  // Generate classes with fully resolved values
}
```

### 5. Test strategy
- Unit tests for ThemeAnalyzer:
  - Nested token resolution
  - Circular dependency detection
  - Function evaluation
  - Responsive value handling
- Integration tests with complex themes:
  - Multi-level nesting
  - Computed values
  - Theme functions
- Snapshot tests showing resolved CSS output

## Documentation Updates Required

### ARCHITECTURE.md sections:
- Update "Current Limitations" for theme resolution
- Add section on "Theme Resolution" explaining the deep resolution process
- Add ThemeAnalyzer to the utilities section in mermaid diagram

### Type definitions:
- Document ThemeToken and ThemeResolutionContext
- Update StyleValue interface documentation
- Add themeAnalysis to ExtractionContext docs

### Test snapshots:
- Add snapshots for deep theme resolution tests
- Update existing snapshots with improved theme values

## Risk Assessment

### Breaking changes:
- None - enhanced resolution is backwards compatible

### Performance impact:
- Medium - theme analysis adds processing time
- Mitigated by caching theme analysis per file
- Typical theme analysis: ~10-50ms for medium themes
- Resolution per value: <1ms with caching

### Memory usage:
- Moderate increase for theme analysis cache
- ~10KB for typical theme token map
- Resolved value cache prevents redundant computation

## Implementation Priority
High priority - accurate theme resolution is critical for generating correct CSS. Many production apps rely on complex theme structures that current implementation doesn't handle properly.

## Future Considerations
- Theme validation and type checking
- Runtime theme switching support
- Theme composition and extension patterns
- Integration with CSS custom properties