# Animus Technical Overview

This document serves as the canonical technical reference for the Animus/Syzygos project. All partners should refer to this for architecture, commands, and technical implementation details.

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
yarn workspace @syzygos/core build
yarn workspace @syzygos/theming build
yarn workspace @syzygos/components build
yarn workspace @syzygos/docs dev
```

### Nx Commands for Efficiency
```bash
yarn build-changed  # Build only changed packages
yarn affected:test  # Test only affected packages
```

## Architecture

### Package Structure
- **@syzygos/core**: Foundation for constraint-based CSS-in-JS, provides the core `animus` builder API
- **@syzygos/theming**: Theming utilities, CSS variable support, token serialization
- **@syzygos/components**: Pre-built UI components (Box, FlexBox, GridBox, Text, etc.)
- **@syzygos/docs**: Next.js documentation site with MDX support
- **_integration**: Integration tests for the entire system

### Technology Stack
- **Monorepo Tools**: Yarn workspaces + Lerna (independent versioning) + Nx (task orchestration)
- **Build System**: Rollup for library packages, Next.js for docs
- **TypeScript**: All packages use TypeScript with strict typing
- **CSS-in-JS**: Built on Emotion
- **Node Version**: Requires ^20
- **Testing**: Jest for unit tests, integration tests in `_integration`

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

**Method Chaining Architecture:**
The builder chain represents distinct layers of the cascade. To match classic CSS cascading, the method order is enforced by returning a new `Animus` constructor object with a subset of methods. These are progressively narrowed depending on the last method called. The one exception is extension via `Component.extend()` which returns a constructor that will merge layers of the extended version while maintaining the style execution order.

## Development Guidelines

### Code Quality
- Always use Yarn (npm is blocked via `.npmrc`)
- Run `yarn verify` before committing to ensure code quality
- Use the project's lint and format settings (`yarn lint:fix` and `yarn format:fix`)
- All code must pass TypeScript strict mode

### Testing
- Unit tests live alongside source files as `*.test.ts`
- Integration tests live in `_integration` package
- Run `yarn test` for all tests or `yarn affected:test` for changed packages

### Documentation
- The documentation site at `yarn start` is the best way to understand component behavior
- API documentation should be inline with TSDoc comments
- Examples should be in MDX files in the docs package

## Static Extraction Feature

### POC Status
We've successfully validated that static CSS extraction is viable for Animus while maintaining 100% API compatibility.

### Technical Achievements:
1. **Build method interception** - Can monkey-patch `build()` to generate static classes
2. **Atomic CSS generation** - Deterministic class names (`_p-1rem`, `_bg-blue`)
3. **Variant handling** - Class precedence and overrides work correctly
4. **No API changes needed** - Users write the same code, get static optimization

### Implementation Path:
1. Babel AST plugin for build-time transformation
2. Support for pseudo-selectors, responsive arrays, theme tokens
3. Build tool integration (Webpack/Vite)
4. Extension chain resolution

The POC code is in `packages/core/src/static-poc/` for reference.

## Repository Structure

See `DOCUMENTATION_STRUCTURE.md` for complete documentation organization. Key technical locations:
- `/packages/*` - Source code for all packages
- `/docs/architecture/` - Architecture documentation
- `/decisions/` - Architecture Decision Records
- `/.github/workflows/` - CI/CD configuration