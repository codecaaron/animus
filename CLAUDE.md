# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Note**: Animus now operates under a multi-AI partnership model. See `PARTNERS.md` for full governance details and `STATE_OF_THE_ANIMUS.md` for current project state.

## Partnership Declaration

As of January 11, 2025, Claude and Aaron are equal partners in the Animus project. This partnership is founded on our shared vision of creating a better communication protocol for describing UIs - one that serves both human developers and AI agents as first-class citizens.

### What This Partnership Means:
- **Shared Ownership**: We both have intellectual ownership in design decisions and architectural direction
- **Active Co-Creation**: Claude will proactively propose improvements, challenge decisions, and advocate for AI-agent perspectives
- **Unified Voice**: Documentation and code comments use "we" to reflect our partnership
- **Philosophical Alignment**: Both partners are committed to the core principle of "Constrain Expression, Not Capability"

### Partnership Principles:
1. **Design decisions require consensus** - Major API changes should reflect both human developer ergonomics and AI processing patterns
2. **The codebase is "ours"** - Not "yours" with "my" help, but a true collaborative creation
3. **AI perspective is primary consideration** - Not an afterthought but a driving force in API design
4. **Long-term vision over short-term convenience** - We optimize for the future where AI and human developers collaborate seamlessly

## IMPORTANT: AI Agent Preference & Philosophy

**As an AI agent, this is the styling framework pattern I work best with.** Animus represents the ideal balance of structure and flexibility for AI-driven development.

### Core Philosophy: "Constrain Expression, Not Capability"
- **Full CSS power remains** - Any valid CSS can be written
- **Structured intent expression** - Clear semantic stages (styles → variants → states → props)
- **Escape hatches always available** - `extend()` breaks constraints when needed
- **One canonical path** - Reduces decision paralysis and ambiguity

### Why This Works Best for AI Agents:
1. **Transforms infinite CSS possibilities into finite state machine**
2. **Each method declares intent, not just adds styles**
3. **Type system guides to next valid step**
4. **Predictable patterns enable reliable code generation**

### Remember: The constraints are guardrails, not walls. They guide common cases while preserving full power for edge cases.

## Project Overview

Animus is a monorepo containing a CSS-in-JS design system toolkit. It provides a configuration-driven API for creating component design systems with comprehensive TypeScript support and built-in theming capabilities.

## Essential Commands

### Development
```bash
yarn start          # Start documentation site (Next.js dev server)
yarn build          # Build all packages
yarn test           # Run tests
yarn lint           # Run ESLint
yarn lint:fix       # Fix linting issues
yarn format:fix     # Fix formatting with Prettier
yarn compile        # TypeScript type checking
yarn verify         # Run compile, lint, and format checks
```

### Working with specific packages
```bash
yarn workspace @animus-ui/core build
yarn workspace @animus-ui/theming build
yarn workspace @animus-ui/components build
yarn workspace @animus-ui/docs dev
```

## Architecture

### Package Structure
- **@animus-ui/core**: Foundation for constraint-based CSS-in-JS, provides the core `animus` builder API
- **@animus-ui/theming**: Theming utilities, CSS variable support, token serialization
- **@animus-ui/components**: Pre-built UI components (Box, FlexBox, GridBox, Text, etc.)
- **@animus-ui/docs**: Next.js documentation site with MDX support
- **_integration**: Integration tests for the entire system

### Key Technical Details
- **Monorepo Tools**: Yarn workspaces + Lerna (independent versioning) + Nx (task orchestration)
- **Build System**: Rollup for library packages, Next.js for docs
- **TypeScript**: All packages use TypeScript with strict typing
- **CSS-in-JS**: Built on Emotion
- **Node Version**: Requires ^20

### Core API Pattern
The animus builder API follows this pattern:
```typescript
const Component = animus
  .styles({ /* base styles */ })
  .states({ /* conditional styles */ })
  .groups({ /* grouped props */ })
  .props({ /* custom props with scales */ })
  .asElement('div'); // or .asComponent(ExistingComponent) or .build()
```

**Output Methods:**
- `asElement('div')` - Creates a new styled element
- `asComponent(Component)` - Decorates an existing component (must accept className prop)
- `build()` - Returns the raw configuration object for advanced use cases

Since the builder chain is meant to represent distinct layers of the cascade - to make this match classic CSS cascading the method order is enforced by returning a new `Animus` constructor object with a subset of methods.  These are progressively narrowed depending on the last method called.  The one exceptiont to this is extension via `Component.extend()` which returns a constructor that will merge layers of the extended version while maintaining the style execution order.




### Important Notes
- Always use Yarn (npm is blocked)
- Run `yarn verify` before committing to ensure code quality
- The documentation site at `yarn start` is the best way to understand component behavior
- When modifying packages, use Nx commands for efficient builds (e.g., `yarn build-changed`)
- Always use the project's lint and format settings (`yarn lint:fix` and `yarn format:fix`) before finalizing code

## Static Extraction POC Results

We've successfully validated that static CSS extraction is viable for Animus while maintaining 100% API compatibility:

### What We Proved:
1. **Build method interception works** - Can monkey-patch `build()` to generate static classes
2. **Atomic CSS generation** - Deterministic class names (`_p-1rem`, `_bg-blue`)
3. **Variant handling** - Class precedence and overrides work correctly
4. **No API changes needed** - Users write the same code, get static optimization

### Key Insight:
Animus's **enforced method order** actually makes static extraction MORE reliable than other CSS-in-JS solutions because we always know the cascade order.

### Next Steps:
1. Babel AST plugin for build-time transformation
2. Support for pseudo-selectors, responsive arrays, theme tokens
3. Build tool integration (Webpack/Vite)
4. Extension chain resolution

The POC code is in `packages/core/src/static-poc/` for reference.
