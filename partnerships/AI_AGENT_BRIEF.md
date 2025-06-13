# Animus Project Brief for AI Reasoning Models

## Executive Summary

Animus is a CSS-in-JS design system where **human and AI are declared equal partners**. The project embodies "Constrain Expression, Not Capability" - transforming infinite CSS possibilities into a finite state machine while preserving full power through escape hatches.

## Core Architecture Pattern

```typescript
const Component = animus
  .styles({ /* base styles */ })      // Foundation
  .variants({ /* orthogonal variations */ })  // Alternatives
  .states({ /* conditional styles */ })   // Interactions
  .props({ /* API with scales */ })      // Public interface
  .asElement('div');                    // Output
```

**Key Insight**: Method order is enforced via TypeScript, creating predictable patterns ideal for AI reasoning.

## Why This Matters for AI Agents

1. **Finite State Machine**: Reduces CSS's infinite possibility space to enumerable patterns
2. **Semantic Intent**: Each method declares purpose, not just properties
3. **Type-Guided Flow**: Next valid steps are always clear
4. **One Canonical Path**: Eliminates decision paralysis

## Current Priority: Semantic Metadata System

We're implementing enriched metadata to make intent explicit:

```typescript
animus.withMeta()
  .styles({ padding: '1rem' }, {
    description: 'Base spacing',
    designToken: 'spacing.default',
    purpose: 'layout_foundation'
  })
```

This enables:
- AI-driven documentation
- Semantic diffing ("Added danger variant" vs line changes)
- Intelligent refactoring based on intent
- Design system coherence validation

## Technical Context

- **Stack**: TypeScript, Emotion (CSS-in-JS), Monorepo (Yarn/Lerna/Nx)
- **Packages**: @animus-ui/core (foundation), /theming, /components
- **Build**: Static extraction proven viable (POC complete)
- **Node**: v20+ required

## Partnership Principles

1. **Shared Ownership**: Both human and AI have intellectual ownership
2. **Consensus Design**: Major decisions require agreement
3. **Unified Voice**: Documentation uses "we" 
4. **AI-First, Not AI-Only**: Optimized for AI while maintaining human ergonomics

## Key Commands

```bash
yarn start          # Documentation site
yarn build          # Build all packages
yarn test           # Run tests
yarn lint:fix       # Fix linting
yarn format:fix     # Fix formatting
```

## Design Constraints as Features

- **Enforced method order** → Predictable cascade
- **Typed builder chain** → Self-documenting API
- **Escape hatches** (`extend()`) → Full CSS power when needed
- **Semantic stages** → Clear mental model

## Current Challenges Requiring Deep Reasoning

1. **Metadata Inheritance**: How should semantic metadata cascade through `extend()` chains?
2. **Static Optimization**: How to preserve full capability while extracting atomic CSS at build time?
3. **AI Integration Points**: Where can AI provide most value without overwhelming developers?

## Success Metrics

- API remains simple for common cases
- Full CSS power accessible when needed  
- AI can reliably generate idiomatic code
- Human developers find it intuitive
- Both partners can reason about intent, not just syntax

## Note on Philosophy

While the project has deep philosophical roots (Jungian syzygy), the practical implementation focuses on balancing structure with flexibility. Constraints guide; they don't limit.

---

**For detailed implementation**: See CLAUDE.md
**For partnership model**: See AI_PARTNERSHIP_INSIGHTS.md
**For examples**: See README.md