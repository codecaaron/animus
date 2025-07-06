# Static Extraction V2 Specification

## Overview

The Static Extraction V2 system analyzes TypeScript/JavaScript code to extract style information from Animus UI components at build time. It identifies component definitions, tracks their usage, and generates atomic CSS classes based on actual prop usage in JSX.

## Architecture

### Core Principles

1. **Unified Phase Interface**: All extraction phases implement a common `Phase<TInput, TOutput>` interface
2. **Centralized Context**: `ExtractionContext` flows through all phases carrying shared state and services
3. **Usage-Driven**: Atomic classes are generated only from actual JSX prop usage, not component definitions
4. **Incremental Processing**: Each phase builds upon previous phases' results via shared registries

### Implementation Status

✅ **Implemented**
- Phase 1: Terminal Discovery - Finds component definition endpoints
- Phase 2: Chain Reconstruction - Rebuilds component definition chains
- Phase 3: Usage Collection - Finds JSX usages of components
- Phase 4: Atomic Computation - Generates atomic classes from usage
- Unified Phase Interface and ExtractionContext
- Logger and DiagnosticsCollector integration
- Basic prop-to-CSS mapping for common properties

⏳ **Planned**
- PropRegistry extraction from component types
- Theme scale resolution
- Transform functions (size, borderShorthand, etc.)
- Group prop expansion (flex, grid)
- Variant and state handlers
- Responsive prop handling
- Phase validators
- Edge case registry
- Dependency graph management
- Type caching system

## Core Interfaces

### Phase Interface

All extraction phases implement this unified interface:

```typescript
interface Phase<TInput, TOutput> {
  readonly name: ExtractionPhase;
  
  // All phases receive context + phase-specific input
  execute(context: ExtractionContext, input: TInput): TOutput;
  
  // Optional validation hooks
  validateInput?(context: ExtractionContext, input: TInput): ValidationResult;
  validateOutput?(context: ExtractionContext, output: TOutput): ValidationResult;
}
```

### ExtractionContext

The central context that flows through all phases:

```typescript
interface ExtractionContext {
  // Core TypeScript utilities
  readonly typeChecker: ts.TypeChecker;
  readonly program: ts.Program;
  readonly languageService: ts.LanguageService;
  readonly sourceFile: ts.SourceFile;
  
  // Mutable state for phase tracking
  currentPhase: ExtractionPhase;
  
  // Accumulated data (phases can read/write)
  readonly symbolTable: Map<ts.Symbol, SymbolInfo>;
  readonly componentRegistry: Map<string, ComponentDefinition>;
  readonly usageRegistry: Map<string, ComponentUsage[]>;
  
  // Configuration
  readonly config: ExtractorConfig;
  
  // Services (phases can use these)
  readonly logger: Logger;
  readonly diagnostics: DiagnosticsCollector;
  readonly monitor: PerformanceMonitor;
  readonly errorHandler: ErrorHandler;
  readonly cache: CacheManager;
  
  // Phase-specific loggers
  getPhaseLogger(phase: string): Logger;
  
  // Single PropRegistry shared by all components
  readonly propRegistry: PropRegistry | null;
}
```

## Extraction Phases

### Phase 1: Terminal Discovery

**Purpose**: Find all component definition endpoints (`.asElement()`, `.asComponent()`, `.build()`)

**Implementation**: `TerminalDiscoveryAlgorithm` in `packages/core/src/v2/index.ts`

**Input**: Empty (uses context.sourceFile)

**Output**: 
- `terminals: TerminalNode[]` - Found terminal nodes with component IDs
- `errors: DiscoveryError[]` - Any errors encountered

### Phase 2: Chain Reconstruction  

**Purpose**: Walk up from terminals to reconstruct full component definition chains and identify PropRegistry source

**Implementation**: `ChainReconstructionAlgorithm` in `packages/core/src/v2/index.ts`

**Input**: 
- `terminal: TerminalNode` - Single terminal to process

**Output**:
- `definition: ComponentDefinition` - Complete component definition with chain and PropRegistry source
- `errors: ChainError[]` - Any errors encountered

**Key Features**:
- Detects if component uses `.extend()` to inherit from another component
- Tracks PropRegistry source (animus import vs extended parent)
- Handles complex extend chains (A → B → C)

The component definition is registered in `context.componentRegistry` for use by later phases.

### Phase 3: Usage Collection

**Purpose**: Find all JSX usages of a component and analyze their props

**Implementation**: `UsageCollectionAlgorithm` in `packages/core/src/v2/index.ts`

**Input**:
- `definition: ComponentDefinition` - Component to find usages for

**Output**:
- `usages: ComponentUsage[]` - All found usages with prop analysis
- `crossFileRefs: CrossFileReference[]` - References from other files
- `errors: UsageError[]` - Any errors encountered

Usages are registered in `context.usageRegistry` for cross-component analysis.

### Phase 4: Atomic Computation

**Purpose**: Generate atomic CSS classes from JSX prop usage

**Implementation**: `AtomicComputationAlgorithm` in `packages/core/src/v2/index.ts`

**Input**:
- `definition: ComponentDefinition` - Component definition
- `usages: ComponentUsage[]` - All usages to process

**Output**:
- `result: ExtractionResult` - Component class and atomic classes
- `stats: ComputationStats` - Performance metrics

## Unimplemented Features

### PropRegistry Extraction

The PropRegistry is the Animus configuration that defines how props map to CSS properties. Since most codebases use a single Animus instance, we extract it once and share it across all components.

```typescript
interface PropRegistry {
  readonly props: Map<string, PropConfig>;
  readonly groups: Map<string, string[]>; // group name -> prop names  
  readonly source: PropRegistrySource;
}

interface PropConfig {
  readonly name: string;
  readonly property: string; // Primary CSS property
  readonly properties?: string[]; // Multiple CSS properties
  readonly scale?: string; // Theme scale name
  readonly transform?: string; // Transform function name
}

type PropRegistrySource = 
  | { kind: 'import'; path: string }
  | { kind: 'default' } // Using known default config
```

**Implementation Strategy**:
1. Extract PropRegistry once at the start of file extraction
2. Look for animus import to identify which registry to use
3. Fall back to default registry from `packages/core/src/config.ts`
4. Store in `context.propRegistry` for all phases to use

**Simplified Approach**:
- Assume one PropRegistry per codebase (typical case)
- All components share the same prop mappings
- Components using `.extend()` inherit the same PropRegistry
- No need to track per-component registries

**Key Understanding**:
- PropRegistry is a configuration object, not extracted from types
- Same props are valid in all style contexts (base, variants, states)
- Props can map to single or multiple CSS properties
- Props may have transforms and theme scales

**Integration**: 
- Extracted once during orchestrator setup
- Available to all phases via context
- Used by Atomic Computation to map JSX props to CSS

### Theme Extraction

Theme extraction will resolve theme scales and tokens:

```typescript
interface ThemeExtractor extends Phase<ThemeExtractionInput, ThemeExtractionOutput> {
  readonly name: 'theme';
}

interface ThemeExtractionInput {
  // Empty - uses context to find theme
}

interface ThemeExtractionOutput {
  readonly theme: ExtractedTheme | null;
  readonly source: ThemeSource;
  readonly errors: ExtractionError[];
}
```

**Implementation Plan**:
1. Search for theme in order:
   - AnimusProvider context in the file
   - Emotion ThemeProvider
   - Direct theme imports
   - Configuration-specified theme
2. Extract scale values and types
3. Cache in context for reuse

### Transform Functions

Transform functions will handle special prop transformations:

```typescript
interface TransformRegistry {
  // Registered transforms by prop name
  readonly transforms: Map<string, PropTransform>;
  
  // Apply transform to prop value
  transform(propName: string, value: unknown, theme?: ExtractedTheme): TransformResult;
}

interface PropTransform {
  readonly name: string;
  readonly inputType: 'number' | 'string' | 'boolean' | 'any';
  readonly outputProperties: string[]; // CSS properties affected
  
  transform(value: unknown, theme?: ExtractedTheme): Map<string, string>;
}
```

**Built-in Transforms**:
- `size` → width + height
- `m/p` with number → theme space lookup
- `borderShorthand` → border-width, border-style, border-color
- Theme token resolution (e.g., "primary" → theme.colors.primary)

### Group Prop Expansion

Group props will expand to multiple CSS properties:

```typescript
interface GroupExpander extends Phase<GroupExpandInput, GroupExpandOutput> {
  readonly name: 'groupExpand';
}

interface GroupExpandInput {
  readonly usage: ComponentUsage;
  readonly propRegistry: ExtractedPropRegistry;
}

interface GroupExpandOutput {
  readonly expandedProps: Map<string, PropValue>;
  readonly errors: ExtractionError[];
}
```

**Example Groups**:
- `space` → m, mt, mr, mb, ml, mx, my, p, pt, pr, pb, pl, px, py
- `typography` → fontFamily, fontSize, fontWeight, lineHeight, letterSpacing
- `layout` → width, height, display, position, top, right, bottom, left

### Variant & State Handlers

Variants and states need special handling during atomic computation:

```typescript
interface VariantResolver extends Phase<VariantResolveInput, VariantResolveOutput> {
  readonly name: 'variantResolve';
}

interface VariantResolveInput {
  readonly usage: ComponentUsage;
  readonly definition: ComponentDefinition;
}

interface VariantResolveOutput {
  readonly activeVariants: Map<string, string>; // variant name → option
  readonly activeStates: Set<string>;
  readonly conditionalClasses: ConditionalAtomic[];
}
```

**Implementation**:
1. Detect variant/state props in usage
2. Generate conditional atomic classes
3. Track dependencies for proper cascade ordering

### Phase Validators

Validators ensure data consistency between phases:

```typescript
interface PhaseValidator<TInput, TOutput> {
  validateInput(context: ExtractionContext, input: TInput): ValidationResult;
  validateOutput(context: ExtractionContext, output: TOutput): ValidationResult;
  validateInvariants(input: TInput, output: TOutput): ValidationResult;
}
```

**Example Validations**:
- Terminal Discovery: All terminals have valid component IDs
- Chain Reconstruction: No circular dependencies
- Usage Collection: All usages refer to registered components
- Atomic Computation: All props have been resolved

### Edge Case Registry

Handle special cases that don't fit standard extraction:

```typescript
interface EdgeCaseHandler {
  readonly name: string;
  readonly priority: number;
  
  canHandle(node: ts.Node, context: ExtractionContext): boolean;
  handle(node: ts.Node, context: ExtractionContext): HandlerResult;
}
```

**Common Edge Cases**:
- Dynamic component creation
- Higher-order components
- Conditional rendering
- Spread operators with computed properties

### Dependency Graph Manager

Track component relationships for incremental updates:

```typescript
interface DependencyGraphManager {
  // Build operations
  addComponent(component: ComponentDefinition, usages: ComponentUsage[]): void;
  
  // Query operations  
  getDependents(componentId: string): DependencyInfo[];
  getImpactedComponents(fileChange: FileChange): Set<string>;
  
  // Analysis
  detectCycles(): CycleInfo[];
  analyzeComplexity(): ComplexityReport;
}
```

**Used For**:
- Incremental extraction on file changes
- Impact analysis
- Circular dependency detection
- Build optimization

### Type Cache System

Cache expensive type extractions:

```typescript
interface TypeCache {
  readonly propRegistries: WeakMap<ts.Type, ExtractedPropRegistry>;
  readonly themes: WeakMap<ts.Type, ExtractedTheme>;
  readonly componentConfigs: WeakMap<ts.Type, ComponentConfig>;
}
```

**Benefits**:
- Avoid re-extracting same type information
- Automatic garbage collection with WeakMap
- Significant performance improvement for large codebases

## Data Flow

```mermaid
graph TD
    A[Source File] --> B[Phase 1: Terminal Discovery]
    B --> C[TerminalNode[]]
    
    C --> D[Phase 2: Chain Reconstruction]
    D --> E[ComponentDefinition]
    E --> F[context.componentRegistry]
    
    E --> G[Phase 3: Usage Collection]
    G --> H[ComponentUsage[]]
    H --> I[context.usageRegistry]
    
    E --> J[PropRegistry Extraction]
    J --> K[ExtractedPropRegistry]
    
    H --> L[Phase 4: Atomic Computation]
    K --> L
    L --> M[AtomicClass[]]
    
    N[Theme Extraction] --> L
    O[Transform Registry] --> L
    P[Group Expander] --> L
```

## Configuration

The extraction system is configured through `ExtractorConfig`:

```typescript
interface ExtractorConfig {
  readonly phases: {
    readonly discovery: TerminalDiscoveryOptions;
    readonly reconstruction: ChainReconstructionOptions;
    readonly collection: UsageCollectionOptions;
    readonly computation: AtomicComputationOptions;
  };
  readonly errorStrategy: 'fail-fast' | 'collect-all' | 'best-effort';
  readonly cacheStrategy: 'memory' | 'disk' | 'hybrid';
  readonly parallelism: number;
  readonly monitoring: boolean;
  readonly logLevel?: LogLevel;
}
```

## Error Handling

All phases use the unified error handling system:

```typescript
interface ExtractionError {
  readonly phase: ExtractionPhase;
  readonly severity: 'fatal' | 'error' | 'warning';
  readonly code: string;
  readonly message: string;
  readonly node?: ts.Node;
  readonly nodeId?: string;
  readonly stack?: string;
  readonly context?: Record<string, unknown>;
  readonly recoverable: boolean;
}
```

The `ErrorHandler` in context manages error collection and recovery strategies.

## Performance Considerations

1. **Caching**: Component definitions and prop registries are cached
2. **Incremental Updates**: Only affected components are re-extracted
3. **Parallel Processing**: Multiple files can be processed in parallel
4. **Type Cache**: Expensive type operations are cached with WeakMap

## Testing Strategy

1. **Unit Tests**: Each phase tested in isolation with mock context
2. **Integration Tests**: Full extraction pipeline with real code
3. **Snapshot Tests**: Ensure consistent output across changes
4. **Performance Tests**: Monitor extraction speed on large codebases

## Migration from V1

Key differences from the original specification:
1. Unified phase interface instead of separate contracts
2. Context-based architecture instead of passing individual parameters
3. PropRegistry integrated into extraction flow
4. Theme and transform resolution as separate phases
5. Better separation of concerns with focused phases