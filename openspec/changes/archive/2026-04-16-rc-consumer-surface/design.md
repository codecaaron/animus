## Context

Five packages are published to npm: `system`, `extract`, `vite-plugin`, `next-plugin`, `properties`. None have READMEs. The root README references Emotion features, uses the old `animus.styles()` API, and calls `.groups()` (renamed to `.system()`). The showcase docs site has the same `.groups()` staleness in its markdown content (TSX files are already correct).

Draft READMEs already exist in the working tree from initial exploration. They need a review pass for: happy-path accuracy, keyword selection, and scope appropriateness (consumer-facing vs internal).

## Goals / Non-Goals

**Goals:**
- Every publishable package has a README visible on npm and GitHub
- Root README tells the current story (zero-runtime extraction, not Emotion)
- Code examples use current API (`ds.styles()`, `.system()`, pre-built groups from `@animus-ui/system/groups`)
- Showcase markdown content matches current API naming
- Package.json metadata enables npm discovery

**Non-Goals:**
- Full documentation site (that's a separate effort)
- Comprehensive API reference in READMEs (keep them as entry points, not exhaustive docs)
- Next test app enrichment (deferred — separate change, different scope)
- Showcase visual/component changes (only fixing stale API names in content)

## Decisions

### 1. README scope per package type

**Consumer-facing packages** (system, vite-plugin, next-plugin): Install → setup → working example → link to further docs. The system README is the longest because it's the primary consumer entry point — show theme setup, group composition, and a complete component.

**Internal packages** (extract, properties): One paragraph explaining what it does and that consumers don't install it directly. No usage examples — the API is consumed by the plugins, not by end users.

**Why not equal depth for all?** A consumer who lands on `@animus-ui/extract` on npm and sees a Rust NAPI function signature will bounce. "This is used internally by the plugins" is the correct message. The consumer never touches extract directly.

### 2. Happy-path example: pre-built groups composed into semantic groups

The README examples must show the ACTUAL recommended pattern from the showcase:

```tsx
import { space, color, typography, border, shadows, background } from '@animus-ui/system/groups';

export const { system: ds } = createSystem()
  .addGroup('surface', { ...color, ...border, ...shadows, ...background })
  .addGroup('space', space)
  .build();
```

Not the raw property definition syntax (`{ property: 'padding', scale: 'space' }`). That syntax exists and works, but composing pre-built groups is the happy path.

**Why this matters:** The raw syntax is what you'd use to ADD a custom prop to a group, not to define the group from scratch. Showing it first makes the framework look low-level. Showing group composition first makes it look batteries-included.

### 3. Keywords: search intent, not architecture

Keywords should reflect what npm users search for: `css-in-js`, `react`, `design-system`, `zero-runtime`, `static-css`, `typescript`. NOT internal terms like `css-layers`, `napi`, `static-analysis`.

Exception: `extract` keeps `rust` and `napi` because developers who find that package are looking for the native addon specifically.

### 4. Showcase docs: targeted text replacement only

The markdown content files use `.groups()` in prose and code examples. Fix these to `.system()`. Don't restructure pages, rewrite narratives, or change component examples — that's a separate content refresh.

Files to audit:
- `getting-started.md` — builder chain description, code examples
- `api/builder-chain.md` — method table, code examples
- `api/create-system.md` — `.addGroup()` references (these are correct — it's `createSystem().addGroup()`, the rename was on the component builder side: `.groups()` → `.system()`)

## Risks / Trade-offs

- **[Risk] Examples diverge from showcase**: README examples are simplified versions of the showcase patterns. If the showcase changes, READMEs could become stale. → **Mitigation**: READMEs link to showcase as the canonical reference. Keep examples minimal — less surface area to rot.
- **[Risk] Token refs in examples may confuse newcomers**: `'{colors.primary}'` syntax is unfamiliar. → **Mitigation**: Show it in context with a comment explaining it resolves to `var(--color-primary)`. Don't over-explain — the docs site handles the full mental model.
- **[Trade-off] No next-plugin setup verification**: The next-plugin README shows a `withAnimus()` config wrapper, but we're not running the next test app to verify the exact API matches. → **Accept**: The config wrapper API is stable and tested in CI.
