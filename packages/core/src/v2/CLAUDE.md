## Tools
- Run tests: `yarn test packages/core/src/v2`
- Format / Lint: `yarn biome check --write packages/core/src/v2`
- Check types: use `ide:getDiagnostic` in VSCode tool

## Quick Navigation Guide
- Architecture: `packages/core/src/v2/ARCHITECTURE.md`

### To add a new feature:

#### 1. Discovery & Analysis Phase (MANDATORY)

Before writing any code, you MUST:

```bash
# Search for existing implementations
grep -r "FEATURE_KEYWORD" packages/core/src/v2/ --include="*.ts" --include="*.md"
grep -r "TODO\|FIXME\|NOTE" packages/core/src/v2/ | grep -i "FEATURE_KEYWORD"

# Check architecture constraints
cat packages/core/src/v2/ARCHITECTURE.md | grep -A5 -B5 "Limitations"
cat packages/core/src/v2/types/*.ts  # Review all type definitions

# Analyze phase responsibilities
ls packages/core/src/v2/phases/  # Understand which phase owns what
```

#### 2. Feature Proposal (REQUIRED)

Create a proposal in `packages/core/src/v2/proposals/FEATURE_NAME.md`:

```markdown
# Feature: [Name]

## Problem Statement
- What limitation does this address?
- Which of the remaining features does this implement?
  - [ ] Cross-file component usage tracking
  - [ ] Deep theme resolution
  - [ ] Full variant/state processing
  - [ ] Multi-file scope analysis

## Phase Analysis
- Primary phase affected: [1-4]
- Secondary phases impacted: [list]
- Why this phase owns this logic: [reasoning]

## Data Flow Changes
- New types needed:
- Modified interfaces:
- Context additions:

## Implementation Approach
1. [Step by step plan]
2. [With specific files]
3. [And test strategy]

## Documentation Updates Required
- ARCHITECTURE.md sections:
- Type definitions:
- Test snapshots:

## Risk Assessment
- Breaking changes:
- Performance impact:
- Memory usage:
```

#### 3. Architecture Validation

Before implementation, validate your proposal:

```typescript
// 1. Does it respect single responsibility?
// Each phase should do ONE thing well

// 2. Is data flow still linear?
// P1 → P2 → P3 → P4 (no backwards flow)

// 3. Are you adding to the right phase?
// - P1: Discovery only (finding nodes)
// - P2: Building definitions (reconstruction)
// - P3: Finding usages (collection)
// - P4: Generating output (computation)

// 4. Infrastructure vs Phase logic?
// Cross-cutting = infrastructure/
// Phase-specific = phases/
```

#### 4. Implementation Process

```bash
# 1. Update types FIRST
# packages/core/src/v2/types/[appropriate].ts

# 2 Implement in correct location
# phases/[phase].ts OR infrastructure/[service].ts

# 3. Update ExtractionContext if needed
# types/core.ts → ExtractionContext interface

# 4. Add tests when contract is clear (include one snapshot test if possible)
# __tests__/[feature].test.ts
```

#### 5. Documentation-First Development

**CRITICAL**: Update docs BEFORE completing a task:

1. **Update ARCHITECTURE.md**:
   ```markdown
   ## Current Limitations
   - ~Old limitation~ ✅ Implemented in [#PR]

   ## Features
   ### [New Feature Name]
   - Phase: [X]
   - Files: [list]
   - How it works: [brief]
   ```

2. **Update mermaid diagram** if flow changes:
   - Add new data types
   - Show new connections
   - Update phase descriptions

3. **Create AI-readable summary**:
   ```typescript
   // At top of main implementation file
   /**
    * FEATURE: [Name]
    * PURPOSE: [What it does]
    * PHASE: [1-4]
    * DEPENDS ON: [list services/utilities]
    * MODIFIES: [what it changes]
    * SEARCH TAGS: [keywords for future discovery]
    */
   ```

#### 6. Self-Documentation Pattern

Every new feature MUST include:

```typescript
// 1. Feature flag/marker
export const FEATURE_CROSS_FILE_USAGE = true;

// 2. Capability declaration
interface PhaseCapabilities {
  crossFileTracking?: boolean;
  themeResolution?: 'shallow' | 'deep';
  variantProcessing?: 'basic' | 'full';
}

// 3. Runtime diagnostics
context.diagnostics.recordFeature('cross-file-usage', {
  enabled: true,
  coverage: 'partial',
  limitations: ['single-project-only']
});
```

#### 7. Remaining Features Implementation Guide

**Cross-file Usage Tracking**:
- Phase 3 enhancement
- Modify `UsageCollectionPhase`
- Add `CrossFileResolver` to infrastructure
- Update `ComponentUsage` type

**Deep Theme Resolution**:
- Phase 4 enhancement
- Extend `StyleResolver`
- Add `ThemeAnalyzer` utility
- Cache theme lookups

**Variant/State Processing**:
- Phase 2 & 4 changes
- Extend `ComponentDefinition`
- Add `VariantComputer` to Phase 4
- New result types

**Multi-file Scope**:
- Orchestrator-level change
- New `MultiFileContext`
- Batch processing logic
- Result aggregation

#### 8. Anti-Patterns to Avoid

❌ **Don't**:
- Add utilities without clear phase ownership
- Create circular dependencies between phases
- Mix phase logic with infrastructure
- Implement without proposal
- Skip documentation updates
- Add to wrong phase "because it's easier"

✅ **Do**:
- Keep phases independent
- Document capability limits
- Update architecture diagram
- Test with real Animus components
- Consider memory/performance impact
- Leave breadcrumbs for AI discovery

#### 9. Verification Checklist

- [ ] Proposal doc exists and is approved
- [ ] Types updated first
- [ ] Implementation in correct phase
- [ ] Tests with snapshots
- [ ] ARCHITECTURE.md updated
- [ ] Mermaid diagram current
- [ ] No circular dependencies
- [ ] Performance impact measured
- [ ] AI-readable documentation added

