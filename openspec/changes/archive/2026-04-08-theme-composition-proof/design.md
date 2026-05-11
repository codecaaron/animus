## Context

`.from()` on `ThemeBuilder` (`createTheme.ts:206-234`) deep merges a built theme into a fresh builder state, preserving emitted scales, contextual vars, and manifest data. Same-name scales and colors merge (union of keys). The showcase already imports `referenceTokens` from `@animus-ui/test-ds` but doesn't demonstrate theme composition — the showcase builds its own theme from scratch in `ds.ts`.

The existing Examples page already has an "External Package Components" section showing test-ds `Button` and `Card` rendering against the showcase theme. The theme composition proof extends this pattern: show that a consumer can import a library's reference theme, extend it, and see the library's components render correctly.

## Goals / Non-Goals

**Goals:**
- Demonstrate `.from()` theme composition in the showcase with real code
- Document the three extension patterns (from, additive, selective spread) in a docs page
- Make the "second app" story visible and verifiable

**Non-Goals:**
- No new API surface (`.from()` already exists and works)
- No theme override/replace semantics (merge-only is the current behavior — documenting what IS, not designing what could be)
- No changes to test-ds (it already exports `referenceTokens`)

## Decisions

**1. Showcase section placement: extend existing Examples page, not new route**

The Examples page already has the "External Package Components" section. Adding a "Theme Composition" section immediately after creates a natural narrative: "here are external components" → "here's how you extend their theme." A separate route would fragment the story.

**2. Docs page location: `content/architecture/theme-extension.md`**

Theme extension is an architecture concern, not an authoring or reference topic. It sits alongside `system-setup.md`, `theming.md`, and `color-modes.md` in the architecture section.

**3. Show `.from()` in-page, not in `ds.ts`**

The showcase's `ds.ts` already builds a complete theme. Rather than restructuring it to use `.from()`, the Examples page will show a self-contained code example with explanatory prose. The actual running components already prove the integration — test-ds components render against the showcase theme because the showcase theme includes compatible color modes and scales.

## Risks / Trade-offs

- [Risk] The showcase theme and test-ds referenceTokens use different scale names (e.g., showcase uses `fire.*` colors, test-ds uses `blue.*`/`red.*`). → The `.from()` demo will show that both coexist after merge, not that they conflict.
- [Risk] Readers may confuse `.from()` (theme extension) with `.includes()` (system builder discovery). → The docs page will explicitly distinguish the two: `.from()` is for tokens/theme, `.includes()` is for system/components.
