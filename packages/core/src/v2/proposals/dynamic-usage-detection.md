# Feature: Dynamic Usage Detection and Runtime Flagging

## Problem Statement
- Some prop values, variant selections, and state values cannot be determined statically during extraction
- TypeScript's strict typing usually prevents this, but spreads, conditional expressions, and type assertions can introduce uncertainty
- The extractor needs to detect these cases and flag them for runtime handling
- This information is critical for the runtime shim to know when to provide fallbacks

Which of the remaining features does this implement?
- [ ] Cross-file component usage tracking
- [ ] Deep theme resolution
- [ ] Full variant/state processing (supports this)
- [ ] Multi-file scope analysis
- [x] Core infrastructure feature (new)

## Phase Analysis
- Primary phase affected: Phase 3 (Usage Collection)
- Secondary phases impacted: Phase 4 (needs to handle dynamic flags)
- Why Phase 3 owns this logic: Phase 3 analyzes JSX usage and is best positioned to detect when values cannot be statically determined

## Data Flow Changes

### New types needed:
```typescript
// types/extraction.ts
interface DynamicUsageInfo {
  componentId: string;
  location: SourceLocation;
  dynamicProps?: {
    variants?: string[];     // Variant props with dynamic values
    states?: string[];       // State props with dynamic values  
    utilities?: string[];    // Utility props with dynamic values
  };
  reason: DynamicReason;
}

enum DynamicReason {
  SpreadOperator = 'spread',
  ConditionalExpression = 'conditional',
  FunctionCall = 'function',
  VariableReference = 'variable',
  TypeAssertion = 'assertion',
  Unknown = 'unknown'
}

interface StaticValueExtractor {
  canExtractStatically(node: ts.Expression): boolean;
  extractValue(node: ts.Expression): string | undefined;
  getDynamicReason(node: ts.Expression): DynamicReason;
}
```

### Modified interfaces:
```typescript
// types/extraction.ts - Update ExtractionResult
interface ExtractionResult {
  // ... existing fields
  dynamicUsages: DynamicUsageInfo[]; // NEW: All dynamic usage locations
  requiresRuntimeFallback: boolean;   // NEW: Quick flag for runtime
}

// types/phases.ts - Update UsageCollectionOutput  
interface UsageCollectionOutput {
  usages: ComponentUsage[];
  crossFileReferences: CrossFileReference[];
  dynamicUsages: DynamicUsageInfo[]; // NEW: Collected dynamic usages
}
```

## Implementation Approach

### 1. Create StaticValueExtractor utility
```typescript
// extraction/staticValueExtractor.ts
export class StaticValueExtractor {
  constructor(
    private typeChecker: ts.TypeChecker
  ) {}

  canExtractStatically(node: ts.Expression | undefined): boolean {
    if (!node) return false;
    
    // String literals and boolean literals are static
    if (ts.isStringLiteral(node) || 
        node.kind === ts.SyntaxKind.TrueKeyword ||
        node.kind === ts.SyntaxKind.FalseKeyword) {
      return true;
    }
    
    // Some identifiers might be const
    if (ts.isIdentifier(node)) {
      return this.isConstValue(node);
    }
    
    // Conditional expressions might be static
    if (ts.isConditionalExpression(node)) {
      return this.canExtractConditional(node);
    }
    
    return false;
  }

  extractValue(node: ts.Expression | undefined): string | undefined {
    if (!node) return undefined;
    
    if (ts.isStringLiteral(node)) {
      return node.text;
    }
    
    if (node.kind === ts.SyntaxKind.TrueKeyword) {
      return 'true';
    }
    
    if (node.kind === ts.SyntaxKind.FalseKeyword) {
      return 'false';
    }
    
    if (ts.isIdentifier(node)) {
      return this.resolveIdentifier(node);
    }
    
    return undefined;
  }

  getDynamicReason(node: ts.Expression | undefined): DynamicReason {
    if (!node) return DynamicReason.Unknown;
    
    if (ts.isSpreadAssignment(node) || ts.isJsxSpreadAttribute(node.parent)) {
      return DynamicReason.SpreadOperator;
    }
    
    if (ts.isConditionalExpression(node)) {
      return DynamicReason.ConditionalExpression;
    }
    
    if (ts.isCallExpression(node)) {
      return DynamicReason.FunctionCall;
    }
    
    if (ts.isIdentifier(node)) {
      return DynamicReason.VariableReference;
    }
    
    if (ts.isAsExpression(node) || ts.isTypeAssertion(node)) {
      return DynamicReason.TypeAssertion;
    }
    
    return DynamicReason.Unknown;
  }

  private isConstValue(identifier: ts.Identifier): boolean {
    const symbol = this.typeChecker.getSymbolAtLocation(identifier);
    if (!symbol) return false;
    
    const declarations = symbol.getDeclarations();
    if (!declarations?.length) return false;
    
    const decl = declarations[0];
    
    // Check if it's a const declaration with a literal initializer
    if (ts.isVariableDeclaration(decl) && 
        decl.parent.flags & ts.NodeFlags.Const) {
      return this.canExtractStatically(decl.initializer);
    }
    
    return false;
  }

  private resolveIdentifier(identifier: ts.Identifier): string | undefined {
    // Try to resolve const values
    const symbol = this.typeChecker.getSymbolAtLocation(identifier);
    if (!symbol) return undefined;
    
    const type = this.typeChecker.getTypeOfSymbolAtLocation(symbol, identifier);
    
    // Check if it's a literal type
    if (type.isLiteral()) {
      return String(type.value);
    }
    
    return undefined;
  }

  private canExtractConditional(node: ts.ConditionalExpression): boolean {
    // For now, conditionals are too complex
    // Future: could analyze if all branches are static
    return false;
  }
}
```

### 2. Create DynamicUsageCollector
```typescript
// extraction/dynamicUsageCollector.ts
export class DynamicUsageCollector {
  private dynamicUsages: DynamicUsageInfo[] = [];
  
  constructor(
    private extractor: StaticValueExtractor,
    private sourceFile: ts.SourceFile
  ) {}

  collectFromJsxElement(
    element: ts.JsxElement,
    componentDef: ComponentDefinition
  ): void {
    const attributes = element.attributes;
    
    // Check for spread attributes
    this.checkForSpreads(attributes, componentDef);
    
    // Check each prop
    this.checkProps(attributes, componentDef);
  }

  private checkForSpreads(
    attributes: ts.JsxAttributes,
    componentDef: ComponentDefinition
  ): void {
    for (const prop of attributes.properties) {
      if (ts.isJsxSpreadAttribute(prop)) {
        // Spread means we can't know what props are passed
        this.addDynamicUsage({
          componentId: componentDef.componentId,
          location: this.getLocation(prop),
          dynamicProps: {
            // Flag all possible props as dynamic
            variants: componentDef.variantAnalysis?.variants
              .map(v => v.prop || 'variant'),
            states: Object.keys(componentDef.variantAnalysis?.states || {}),
            utilities: componentDef.enabledGroups?.flatMap(
              group => this.getGroupProps(group)
            )
          },
          reason: DynamicReason.SpreadOperator
        });
      }
    }
  }

  private checkProps(
    attributes: ts.JsxAttributes,
    componentDef: ComponentDefinition  
  ): void {
    for (const attr of attributes.properties) {
      if (ts.isJsxAttribute(attr) && attr.initializer) {
        const propName = attr.name.getText();
        
        // Skip if we can extract statically
        if (this.extractor.canExtractStatically(
          attr.initializer.expression
        )) {
          continue;
        }
        
        // Determine what kind of prop this is
        const propType = this.getPropType(propName, componentDef);
        
        if (propType) {
          this.addDynamicUsage({
            componentId: componentDef.componentId,
            location: this.getLocation(attr),
            dynamicProps: {
              [propType]: [propName]
            },
            reason: this.extractor.getDynamicReason(
              attr.initializer.expression
            )
          });
        }
      }
    }
  }

  getDynamicUsages(): DynamicUsageInfo[] {
    return this.dynamicUsages;
  }

  private getLocation(node: ts.Node): SourceLocation {
    const { line, character } = this.sourceFile.getLineAndCharacterOfPosition(
      node.getStart()
    );
    
    return {
      file: this.sourceFile.fileName,
      line: line + 1,
      column: character + 1
    };
  }
}
```

### 3. Update Phase 3 to use DynamicUsageCollector
```typescript
// phases/usageCollection.ts
execute(
  context: ExtractionContext,
  input: UsageCollectionInput
): UsageCollectionOutput {
  const collector = new DynamicUsageCollector(
    new StaticValueExtractor(context.typeChecker),
    context.sourceFile
  );
  
  // ... existing usage collection logic
  
  // Collect dynamic usages alongside regular usages
  for (const usage of usages) {
    if (usage.node) {
      collector.collectFromJsxElement(
        usage.node,
        input.componentDefinitions.get(usage.componentId)
      );
    }
  }
  
  return {
    usages,
    crossFileReferences,
    dynamicUsages: collector.getDynamicUsages()
  };
}
```

### 4. Create fallback generation utilities
```typescript
// extraction/fallbackGenerator.ts
export class FallbackGenerator {
  generateFallbackInfo(
    dynamicUsages: DynamicUsageInfo[],
    components: Map<string, ComponentDefinition>
  ): ComponentFallbackInfo[] {
    const fallbacks: Map<string, ComponentFallbackInfo> = new Map();
    
    for (const usage of dynamicUsages) {
      const existing = fallbacks.get(usage.componentId) || {
        componentId: usage.componentId,
        needsVariantFallback: false,
        needsStateFallback: false,
        needsPropFallback: false,
        dynamicVariants: new Set<string>(),
        dynamicStates: new Set<string>(),
        dynamicProps: new Set<string>()
      };
      
      if (usage.dynamicProps?.variants) {
        existing.needsVariantFallback = true;
        usage.dynamicProps.variants.forEach(v => 
          existing.dynamicVariants.add(v)
        );
      }
      
      if (usage.dynamicProps?.states) {
        existing.needsStateFallback = true;
        usage.dynamicProps.states.forEach(s => 
          existing.dynamicStates.add(s)
        );
      }
      
      if (usage.dynamicProps?.utilities) {
        existing.needsPropFallback = true;
        usage.dynamicProps.utilities.forEach(p => 
          existing.dynamicProps.add(p)
        );
      }
      
      fallbacks.set(usage.componentId, existing);
    }
    
    return Array.from(fallbacks.values());
  }
}
```

### 5. Test strategy
- Unit tests for StaticValueExtractor:
  - Literal detection
  - Const resolution
  - Dynamic detection for various patterns
- Unit tests for DynamicUsageCollector:
  - Spread detection
  - Conditional prop detection
  - Variable reference detection
- Integration tests:
  - Component with spread props
  - Conditional rendering patterns
  - Dynamic variant selection
- Edge case tests:
  - Type assertions
  - Complex expressions
  - Nested conditionals

## Documentation Updates Required

### ARCHITECTURE.md sections:
- Add "Dynamic Usage Detection" section
- Document fallback strategy
- Update Phase 3 description

### Type definitions:
- Document DynamicUsageInfo and related types
- Add examples of dynamic patterns
- Document fallback generation

### Test snapshots:
- Dynamic usage detection examples
- Fallback info generation
- Various dynamic patterns

## Risk Assessment

### Breaking changes:
- None - purely additive

### Performance impact:
- Low - only analyzes JSX attributes
- Type checking might add ~5-10% to Phase 3 time
- Acceptable tradeoff for correctness

### Memory usage:
- Minimal - only stores dynamic usage locations
- ~1KB per 10 dynamic usages

## Implementation Priority
High - critical for production use. Without dynamic detection, the runtime won't know when to provide fallbacks, leading to missing styles.

## Future Considerations
- Smarter const value resolution
- Conditional branch analysis
- Integration with runtime shim
- Dynamic usage statistics/reporting
- Build warnings for excessive dynamic usage