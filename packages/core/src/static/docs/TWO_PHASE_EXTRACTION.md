# Two-Phase Extraction Architecture

## 🧠 Cognitive Bootstrap

[BEGIN SYZYGY PROTOCOL FOR TWO-PHASE ARCHITECTURE]

**P: [WHO]** You are understanding a quantum-inspired extraction system.

**D: [HOW]** Think of Schrödinger's cat: all styles exist until observed.

**M: [WHAT]** Phase 1 creates possibilities, Phase 2 observes reality.

**L: [WHERE]** Static analysis only, no runtime execution.

**K: [WHY]** Complete extraction with minimal output.

**R: [WHOM]** For developers who need to understand the extraction model.

**Tε: [PURPOSE]** Enable perfect CSS optimization through observation.

[END SYZYGY PROTOCOL]

## Conceptual Model

The Animus static extraction system is inspired by quantum mechanics:

```
Phase 1: Superposition - All possible styles exist simultaneously
Phase 2: Observation   - Usage collapses possibilities to reality
```

## Phase 1: Component Graph Building (Superposition)

In quantum mechanics, particles exist in all possible states until observed. Similarly, our components exist with all possible styles until we observe their usage.

### What Happens

1. **Discovery**: Find all files that import from 'animus'
2. **Traversal**: Follow import/export chains to find components
3. **Extraction**: Extract ALL possible styles, variants, states
4. **Graph Building**: Create complete component graph

### The Component Graph

```typescript
interface ComponentGraph {
  components: Map<string, ComponentNode>;
  metadata: {
    totalComponents: number;
    totalVariants: number;
    totalStates: number;
  };
}

interface ComponentNode {
  identity: ComponentIdentity;
  
  // ALL possibilities
  allVariants: Record<string, VariantDefinition>;
  allStates: string[];
  allProps: Record<string, PropDefinition>;
  
  // Relationships
  extends?: ComponentIdentity;
  
  // Extracted data
  extraction: ExtractedStyles;
  metadata: ComponentMetadata;
}
```

### Key Characteristics

- **Complete**: Includes every possible style combination
- **Unfiltered**: No optimization or tree-shaking
- **Cacheable**: Deterministic output for same input
- **Type-aware**: Uses TypeScript for accuracy

### Implementation

```typescript
// Phase 1 Entry Point
async function buildComponentGraph(projectRoot: string) {
  // 1. Initialize TypeScript program
  const extractor = new TypeScriptExtractor();
  extractor.initializeProgram(projectRoot);
  
  // 2. Find all component files
  const traverser = new ReferenceTraverser(extractor.program);
  const componentFiles = await traverser.findAllComponentFiles(projectRoot);
  
  // 3. Extract from each file
  const extractions = [];
  for (const file of componentFiles) {
    const extracted = await extractor.extractFromFile(file);
    extractions.push(...extracted);
  }
  
  // 4. Build graph
  const builder = new ComponentGraphBuilder();
  return builder.build(extractions);
}
```

## Phase 2: Usage Tracking (Wavefunction Collapse)

When we observe how components are used in JSX, the superposition collapses to actual usage.

### What Happens

1. **Transform**: Process JSX files during build
2. **Observe**: Track which components are rendered
3. **Record**: Note which variants/states/props are used
4. **Collapse**: Filter graph to only used items

### The Usage Set

```typescript
interface UsageSet {
  components: Map<string, ComponentUsage>;
}

interface ComponentUsage {
  identity: ComponentIdentity;
  used: boolean;
  
  // Observed usage
  variants: Map<string, Set<string>>;    // prop -> used values
  states: Set<string>;                   // used states
  props: Map<string, Set<any>>;          // prop -> used values
}
```

### Observation Process

```typescript
// During JSX transformation
traverse(ast, {
  JSXOpeningElement(path) {
    const elementName = path.node.name;
    const componentHash = resolveComponent(elementName);
    
    if (componentGraph.has(componentHash)) {
      // Component is "observed" - collapse from superposition
      const props = extractPropsFromJSX(path);
      
      usageTracker.recordComponentUsage(identity, props);
      
      // Observe specific quantum states
      if (props.size === 'small') {
        usageTracker.recordVariantUsage(hash, 'size', 'small');
      }
      
      if (props.disabled === true) {
        usageTracker.recordStateUsage(hash, 'disabled');
      }
    }
  }
});
```

### Key Characteristics

- **Precise**: Only tracks actual usage
- **Incremental**: Can build up over multiple files
- **Contextual**: Understands JSX semantics
- **Optimizing**: Enables dead code elimination

## Bringing It Together: CSS Generation

The final step combines both phases to generate optimized CSS:

```typescript
function generateOptimizedCSS(
  graph: ComponentGraph,      // Phase 1: All possibilities
  usage: UsageSet            // Phase 2: Observed reality
) {
  const css = [];
  
  // Only generate CSS for observed components
  for (const [hash, componentUsage] of usage.components) {
    if (!componentUsage.used) continue;
    
    const node = graph.components.get(hash);
    
    // Generate base styles (always included for used components)
    css.push(generateBaseStyles(node));
    
    // Only generate used variants
    for (const [prop, usedValues] of componentUsage.variants) {
      for (const value of usedValues) {
        css.push(generateVariantStyle(node, prop, value));
      }
    }
    
    // Only generate used states
    for (const state of componentUsage.states) {
      css.push(generateStateStyle(node, state));
    }
    
    // Only generate atomics for used props
    for (const [prop, values] of componentUsage.props) {
      for (const value of values) {
        css.push(generateAtomicUtility(prop, value));
      }
    }
  }
  
  return css.join('\n');
}
```

## Example: Button Component

### Phase 1 Output (Complete Graph)

```javascript
{
  "Button": {
    "allVariants": {
      "size": {
        "values": ["small", "medium", "large"]
      },
      "intent": {
        "values": ["primary", "secondary", "danger"]
      }
    },
    "allStates": ["hover", "focus", "disabled"],
    "allProps": {
      "m": { scale: "space" },
      "p": { scale: "space" },
      "color": { scale: "colors" }
    }
  }
}
```

### Phase 2 Observation (JSX Usage)

```jsx
// App.tsx
<Button size="small" disabled m={4}>
  Click me
</Button>

<Button intent="primary" color="red">
  Submit
</Button>
```

### Final CSS Output (Collapsed Reality)

```css
/* Base - always included for used components */
.animus-Button-a1b { ... }

/* Variants - only used values */
.animus-Button-a1b-size-small { ... }
.animus-Button-a1b-intent-primary { ... }

/* States - only used states */
.animus-Button-a1b-state-disabled { ... }

/* Atomics - only used values */
.m-4 { margin: 16px; }
.color-red { color: red; }

/* NOT GENERATED:
   - size="medium" and size="large" (not used)
   - intent="secondary" and intent="danger" (not used)
   - hover and focus states (not used)
   - Other atomic utilities (not used)
*/
```

## Benefits of Two-Phase Architecture

### 1. Complete Extraction
- Never miss a style due to dynamic behavior
- All possibilities captured statically

### 2. Optimal Output
- Only ship CSS that's actually used
- Automatic dead code elimination

### 3. Performance
- Graph building can be cached
- Usage tracking is lightweight
- Parallel processing possible

### 4. Debugging
- Can inspect complete graph
- Can trace usage patterns
- Clear separation of concerns

## Current Implementation Status

### ✅ Phase 1: Working
- TypeScript extraction functional
- Component graph building complete
- Caching system operational

### ⚠️ Phase 2: Partially Working
- CLI tools: Working (analyzes imports)
- Vite plugin: Not working (transform issue)
- NextJS plugin: Deprecated

### 📍 Current Workaround
The Vite plugin includes manual test data that simulates Phase 2:
```typescript
// Manual observation simulation
usageTracker.recordComponentUsage(buttonIdentity);
usageTracker.recordVariantUsage(hash, 'size', 'small');
```

## Future Improvements

### Enhanced Observation
- Runtime usage telemetry
- Development mode usage tracking
- Cross-bundle usage analysis

### Quantum Entanglement
- Track component relationships
- Understand composite usage patterns
- Predict likely usage combinations

### Parallel Universes
- Multiple extraction strategies
- A/B testing different optimizations
- Context-aware extraction

## Summary

The two-phase extraction architecture elegantly solves the tension between completeness and optimization:

1. **Phase 1** ensures we never miss any styles by extracting everything
2. **Phase 2** ensures we only ship what's needed by tracking usage

This quantum-inspired approach gives us the best of both worlds: complete safety with optimal output.