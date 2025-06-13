# Animus Static CSS Extraction Babel Plugin - Requirements Document

## Overview

The Animus Babel Plugin transforms Animus builder chains at build time to generate static CSS classes while maintaining 100% API compatibility. This plugin intercepts the runtime CSS-in-JS generation and replaces it with atomic CSS classes.

## Architecture Overview

```
Source Code → Babel AST → Plugin Transforms → Static CSS + Modified JS
```

### Core Principles
1. **Zero API Changes** - Developers write the same Animus code
2. **Atomic CSS Generation** - Each style property generates one class
3. **Deterministic Class Names** - Consistent hashing for deduplication
4. **Progressive Enhancement** - Fallback to runtime for unsupported features

## Phase 1 Scope

### Supported Features
- Basic style properties (padding, margin, color, etc.)
- Static variants (no dynamic conditions)
- Theme token references
- Responsive arrays (breakpoint-based)
- `extend()` chains

### NOT Supported (Phase 1)
- Pseudo-selectors (`:hover`, `:focus`, etc.)
- Dynamic prop interpolation
- Runtime theme switching
- CSS animations/keyframes
- Complex selectors (child, sibling)
- Media queries beyond responsive arrays

## Task Breakdown

### Task 1: AST Visitor Pattern
**Owner**: TBD  
**Estimated Effort**: 2-3 days

**Responsibility**: Create the core Babel visitor that identifies Animus builder chains

**Contract**:
```typescript
interface AnimusVisitor {
  // Entry point for babel plugin
  visitor: {
    CallExpression(path: NodePath<CallExpression>, state: PluginState): void;
  }
}

interface PluginState {
  // Collected CSS rules for this file
  cssRules: Map<string, string>;
  // Import tracking
  animusImports: Set<string>;
  // Configuration
  opts: PluginOptions;
}
```

**Requirements**:
1. Detect imports from `@animus-ui/core`
2. Track variable bindings for `animus` builder
3. Identify complete builder chains (styles → variants → props → output)
4. Handle renamed imports and destructuring

**Deliverables**:
- `visitor.ts` - Main visitor implementation
- `detector.ts` - Animus chain detection utilities
- Unit tests for various import patterns

---

### Task 2: Style Extractor
**Owner**: TBD  
**Estimated Effort**: 3-4 days

**Responsibility**: Extract styles from AST nodes and convert to atomic CSS

**Contract**:
```typescript
interface StyleExtractor {
  // Extract styles from ObjectExpression AST node
  extractStyles(
    node: ObjectExpression,
    context: ExtractionContext
  ): ExtractedStyle[];
  
  // Check if a style can be statically extracted
  canExtract(node: Node): boolean;
}

interface ExtractedStyle {
  property: string;      // e.g., "padding"
  value: string;         // e.g., "1rem"
  className: string;     // e.g., "_p-1rem"
  css: string;          // e.g., ".p-1rem { padding: 1rem; }"
  specificity: number;   // For cascade ordering
}

interface ExtractionContext {
  theme?: ThemeTokens;
  breakpoints?: string[];
  currentChainType: 'styles' | 'variants' | 'states' | 'props';
}
```

**Requirements**:
1. Parse style objects from AST
2. Generate atomic class names using deterministic hash
3. Handle theme token references (`$space.md` → `var(--space-md)`)
4. Support responsive arrays (`[mobile, tablet, desktop]`)
5. Return `null` for non-extractable styles (runtime expressions)

**Stub Implementations**:
```typescript
// Pseudo-selectors - NOT IMPLEMENTED
if (property.includes(':')) {
  console.warn(`Pseudo-selector "${property}" not supported in static extraction`);
  return null;
}

// Dynamic values - NOT IMPLEMENTED  
if (node.type === 'TemplateLiteral' || node.type === 'BinaryExpression') {
  console.warn('Dynamic style values not supported in static extraction');
  return null;
}
```

**Deliverables**:
- `extractor.ts` - Main extraction logic
- `atomicCss.ts` - Atomic class generation
- `unsupported.ts` - Handlers for unsupported features
- Comprehensive test suite

---

### Task 3: Class Name Generator
**Owner**: TBD  
**Estimated Effort**: 1-2 days

**Responsibility**: Generate consistent, collision-free class names

**Contract**:
```typescript
interface ClassNameGenerator {
  // Generate atomic class name from property and value
  generate(property: string, value: string): string;
  
  // Generate variant class name
  generateVariant(variantName: string, variantValue: string): string;
  
  // Ensure no collisions across files
  ensureUnique(className: string): string;
}

interface GeneratorConfig {
  prefix?: string;        // Optional prefix for all classes
  hash?: boolean;         // Use hash vs readable names
  shortNames?: boolean;   // Minify class names
}
```

**Requirements**:
1. Deterministic generation (same input → same output)
2. Handle special characters in values
3. Collision detection and resolution
4. Support configurable naming strategies

**Examples**:
```
padding: "1rem"     → "_p-1rem"
color: "#ff0000"    → "_c-ff0000"
margin: "0 auto"    → "_m-0-auto"
display: "flex"     → "_d-flex"
```

**Deliverables**:
- `classNames.ts` - Class name generation logic
- `collision.ts` - Collision detection/resolution
- Unit tests with edge cases

---

### Task 4: AST Transformer
**Owner**: TBD  
**Estimated Effort**: 3-4 days

**Responsibility**: Transform the original AST to use generated classes

**Contract**:
```typescript
interface ASTTransformer {
  // Transform animus chain to use static classes
  transformChain(
    chainPath: NodePath,
    extractedClasses: ExtractedClass[]
  ): void;
  
  // Inject className merging logic
  injectClassNameProp(
    componentPath: NodePath,
    classNames: string[]
  ): void;
}

interface ExtractedClass {
  type: 'base' | 'variant' | 'state' | 'prop';
  className: string;
  condition?: string;  // For conditional classes
}
```

**Requirements**:
1. Replace style objects with className strings
2. Preserve runtime fallback for unsupported features
3. Handle variant conditions → className logic
4. Maintain source maps for debugging

**Transformation Example**:
```javascript
// Before
const Button = animus
  .styles({ padding: '1rem', color: 'blue' })
  .variants({ size: { large: { padding: '2rem' } } })
  .asElement('button');

// After
const Button = animus
  .styles('_p-1rem _c-blue')  // Static classes
  .variants({ size: { large: '_p-2rem' } })  // Variant classes
  .asElement('button');
```

**Deliverables**:
- `transformer.ts` - AST transformation logic
- `runtime.ts` - Runtime fallback injection
- Integration tests

---

### Task 5: CSS Output Manager
**Owner**: TBD  
**Estimated Effort**: 2-3 days

**Responsibility**: Collect and output generated CSS

**Contract**:
```typescript
interface CSSOutputManager {
  // Add CSS rule to output
  addRule(rule: CSSRule): void;
  
  // Get all CSS for output
  getCSS(): string;
  
  // Write CSS to file or inject into build
  output(options: OutputOptions): Promise<void>;
}

interface CSSRule {
  selector: string;
  declarations: string;
  mediaQuery?: string;
  order: number;  // For cascade ordering
}

interface OutputOptions {
  outputPath?: string;      // File path for CSS
  inject?: boolean;         // Inject into HTML
  minify?: boolean;         // Minify output
  sourceMaps?: boolean;     // Generate source maps
}
```

**Requirements**:
1. Deduplicate CSS rules across files
2. Maintain correct cascade order
3. Group media queries
4. Support multiple output formats (file, inline, module)
5. Generate source maps

**Deliverables**:
- `cssManager.ts` - CSS collection and deduplication
- `output.ts` - File writing and injection
- `optimizer.ts` - CSS minification/optimization

---

### Task 6: Theme Integration
**Owner**: TBD  
**Estimated Effort**: 2-3 days

**Responsibility**: Resolve theme tokens at build time

**Contract**:
```typescript
interface ThemeResolver {
  // Load theme configuration
  loadTheme(configPath: string): Promise<Theme>;
  
  // Resolve token reference to CSS value
  resolveToken(token: string, theme: Theme): string | null;
  
  // Generate CSS variables for theme
  generateCSSVariables(theme: Theme): string;
}

interface Theme {
  tokens: Record<string, any>;
  breakpoints?: string[];
  // ... other theme config
}
```

**Requirements**:
1. Load theme from animus.config.js
2. Resolve nested token paths (`$colors.primary.500`)
3. Generate CSS custom properties
4. Handle missing tokens gracefully
5. Support theme inheritance/extension

**Deliverables**:
- `themeResolver.ts` - Token resolution logic
- `themeLoader.ts` - Configuration loading
- `cssVariables.ts` - CSS variable generation

---

### Task 7: Build Tool Integration
**Owner**: TBD  
**Estimated Effort**: 3-4 days

**Responsibility**: Integrate with webpack, Vite, and other build tools

**Contract**:
```typescript
interface BuildPlugin {
  // Webpack plugin
  webpackPlugin(options: PluginOptions): WebpackPlugin;
  
  // Vite plugin
  vitePlugin(options: PluginOptions): VitePlugin;
  
  // Rollup plugin
  rollupPlugin(options: PluginOptions): RollupPlugin;
}

interface PluginOptions {
  // Include/exclude patterns
  include?: string[];
  exclude?: string[];
  
  // Output configuration
  cssOutput?: OutputOptions;
  
  // Feature flags
  enableRuntimeFallback?: boolean;
  extractVariants?: boolean;
  
  // Theme config
  themeConfig?: string;
}
```

**Requirements**:
1. Seamless integration with build tools
2. Hot module replacement support
3. Production optimization
4. Development mode with debugging
5. Performance metrics/reporting

**Deliverables**:
- `webpack/plugin.ts` - Webpack integration
- `vite/plugin.ts` - Vite integration
- `rollup/plugin.ts` - Rollup integration
- Example configurations

---

### Task 8: Extension Chain Resolver
**Owner**: TBD  
**Estimated Effort**: 4-5 days

**Responsibility**: Handle `.extend()` chains and style composition

**Contract**:
```typescript
interface ExtensionResolver {
  // Resolve full extension chain
  resolveChain(
    component: NodePath,
    context: ResolutionContext
  ): ResolvedChain;
  
  // Merge styles from extended components
  mergeStyles(
    base: ExtractedStyle[],
    extension: ExtractedStyle[]
  ): ExtractedStyle[];
}

interface ResolvedChain {
  // All components in extension chain
  components: ComponentInfo[];
  // Merged styles in correct order
  styles: ExtractedStyle[];
  // Merged variants
  variants: VariantInfo[];
}
```

**Requirements**:
1. Track component extension relationships
2. Resolve styles in correct cascade order
3. Handle cross-file extensions
4. Support multiple extension levels
5. Preserve variant override semantics

**Deliverables**:
- `extensionResolver.ts` - Chain resolution logic
- `styleMerger.ts` - Style merging with precedence
- `componentTracker.ts` - Cross-file component tracking

---

## Testing Strategy

### Unit Tests
Each task should include comprehensive unit tests covering:
- Happy path scenarios
- Edge cases and error conditions
- Performance benchmarks
- Cross-platform compatibility

### Integration Tests
- Full plugin flow with sample projects
- Build tool integration tests
- Theme resolution tests
- Extension chain tests

### Performance Tests
- Build time impact measurement
- CSS output size optimization
- Memory usage profiling

## Configuration Schema

```typescript
interface AnimusBabelPluginConfig {
  // Feature flags
  features: {
    variants: boolean;
    responsive: boolean;
    themes: boolean;
    extensions: boolean;
  };
  
  // Output configuration
  output: {
    css: 'file' | 'inline' | 'module';
    path?: string;
    minify?: boolean;
  };
  
  // Development options
  dev: {
    sourceMaps: boolean;
    verbose: boolean;
    runtimeFallback: boolean;
  };
  
  // Theme configuration
  theme: {
    configPath?: string;
    tokens?: Record<string, any>;
  };
}
```

## Success Criteria

1. **Zero Breaking Changes** - Existing Animus code works without modification
2. **Performance Improvement** - 50%+ reduction in runtime overhead
3. **Build Time** - < 10% increase in build time for typical projects
4. **CSS Size** - Atomic CSS results in smaller total CSS size
5. **Developer Experience** - Clear error messages for unsupported features

## Timeline Estimation

- **Phase 1 Total**: 6-8 weeks with 2-3 developers
- **Phase 2 (Pseudo-selectors, animations)**: Additional 4-6 weeks
- **Phase 3 (Full feature parity)**: Additional 4-6 weeks

## Dependencies

- Babel 7.x
- Build tool specific APIs (webpack 5, Vite 3+, Rollup 3+)
- @animus-ui/core understanding
- CSS specification knowledge