# Static Extraction Architecture

This document captures key architectural decisions and design rationale for the Animus static extraction system.

## Core Principles

1. **Build-Time Analysis, Runtime Compatibility**
   - Extract at build time, but maintain full runtime API in development
   - No changes required to component code
   - Progressive enhancement strategy

2. **TypeScript-First**
   - Use TypeScript compiler API for accurate extraction
   - Preserve type information throughout pipeline
   - Handle complex module resolution correctly

3. **Cascade Preservation**
   - CSS output order must match runtime cascade semantics
   - Base → Variants → States → Utilities
   - Parent components before child components in each layer

## Key Design Decisions

### Component Identity

**Decision**: Use content-based hashing for component identification
```typescript
hash = crypto.createHash('md5')
  .update(sourceFile + lineNumber + componentDefinition)
  .digest('hex')
  .substring(0, 3);
```

**Rationale**:
- Stable across builds if code unchanged
- Unique enough to avoid collisions (with file+line context)
- Short enough for readable class names

### Theme Resolution Strategy

**Decision**: Support three modes - inline, css-variable, hybrid (default)

**Rationale**:
- **Inline**: Best for static sites, no runtime overhead
- **CSS Variables**: Best for dynamic themes, runtime switching
- **Hybrid**: Balance of both - common tokens as variables, rest inline

### Extraction Approach

**Decision**: Combine Babel AST traversal with TypeScript program analysis

**Rationale**:
- Babel: Fast AST traversal, handles JSX well
- TypeScript: Accurate module resolution, type information
- Together: Best of both worlds

### CSS Organization

**Decision**: Group by cascade layer, not by component

```css
/* All base styles together */
.component-a { }
.component-b { }

/* All variants together */
.component-a-variant { }
.component-b-variant { }
```

**Rationale**:
- Natural cascade ordering
- Better compression (similar selectors together)
- Easier debugging (find all variants in one place)
- Predictable specificity

### Incremental Rebuilds

**Decision**: Track component-to-file mappings for targeted updates

**Rationale**:
- Full rebuilds too slow for large codebases
- File watching alone insufficient (doesn't handle deletions well)
- Component-level tracking enables precise updates

### Extension Handling (Lineage-Aware Cascade System)

**Decision**: Track component lineage and enforce parent-before-child ordering through topological sorting

**Implementation**:
```typescript
// ComponentRegistry tracks extension relationships
interface ComponentEntry {
  identity: ComponentIdentity;
  styles: ExtractedStylesWithIdentity;
  dependencies: ComponentIdentity[]; // Parent components
  dependents: Set<string>; // Child components that extend this
}

// Topological sort ensures correct ordering
getComponentsSortedByExtension(): ComponentEntry[] {
  // Depth-first traversal placing parents before children
  // Handles circular dependencies gracefully
}
```

**CSS Generation Strategy**:
```typescript
// 1. Sort components by extension hierarchy
const sortedComponents = registry.getComponentsSortedByExtension();

// 2. Generate CSS in lineage order within each cascade layer
for (const component of sortedComponents) {
  // Base styles - parents first, children after
  generateBaseStyles(component);
  // Variant styles - same ordering preserved
  generateVariantStyles(component);
  // State styles - same ordering preserved
  generateStateStyles(component);
}
```

**Rationale**:
- Extended components override parents through cascade position, not specificity
- All selectors maintain equal specificity (single class)
- Maintains identical behavior to runtime
- Enables future optimizations (e.g., property deduplication)
- Predictable and debuggable output

**Example Output**:
```css
/* Base Styles Layer */
.animus-Button-b1n { 
  padding: 8px;
  background: gray;
}
.animus-PrimaryButton-p2b { /* Child after parent */
  background: blue; /* Naturally overrides */
}

/* Variant Styles Layer */
.animus-Button-b1n-size-small { padding: 4px; }
.animus-PrimaryButton-p2b-size-small { font-weight: bold; }
```

**Breakpoint Consistency**:
The extension ordering is maintained across all breakpoints, ensuring consistent override behavior at every viewport size.

## Technical Constraints

### AST Extraction Limitations

Only extracts statically analyzable code:
- Literal objects: `{ color: 'red' }`
- Direct references: `styles(baseStyles)`
- Template literals with no interpolation

Cannot extract:
- Dynamic expressions: `{ color: isDark ? 'white' : 'black' }`
- Computed properties: `{ [prop]: value }`
- Spread operations: `{ ...otherStyles }`

### Theme Token Resolution

- Requires theme at build time
- TypeScript themes auto-transformed to JavaScript
- Nested paths resolved: `'text.primary'` → `theme.colors.text.primary`

### Performance Targets

- Full extraction: < 10s for 1000 components
- Incremental update: < 500ms per file change
- CSS output: < 100KB for typical applications

## Future Considerations

### CSS Layers API
```css
@layer base, variants, states, utilities;

@layer base {
  .component { }
}
```
Would provide native cascade isolation but requires browser support.

### Build-Time Component Props
Could analyze JSX usage patterns to optimize further:
- Remove unused variants
- Inline single-use utilities
- Generate minimal CSS per route

### Zero-Runtime Mode
Complete static extraction with no runtime overhead:
- Build-time className resolution
- Static style injection
- Dead code elimination

## Error Philosophy

**Fail Gracefully**: If extraction fails for a component, skip it rather than breaking the build. Runtime will handle it.

**Warn Liberally**: Alert developers to patterns that prevent extraction so they can refactor if desired.

**Preserve Semantics**: Never generate CSS that behaves differently than runtime would.

## Testing Strategy

1. **Snapshot Tests**: Ensure CSS output stability
2. **Integration Tests**: Verify with real components
3. **Regression Tests**: Specific bug patterns
4. **Performance Tests**: Monitor extraction speed

## Maintenance Guidelines

When modifying the extraction system:
1. Consider runtime parity first
2. Preserve existing CSS output format
3. Maintain backward compatibility
4. Document new AST patterns
5. Add extraction test cases
6. Update performance benchmarks