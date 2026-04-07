## Why

The showcase site is the primary proof that Animus works end-to-end. Currently it proves *component-level* extraction (31 components, compose patterns, color modes, asChild) but fails to prove *application-level* capability. The layout shell, navigation, and page structure are desktop-only, flat, and don't exercise the system's responsive, compositional, or state-driven features. Below ~1024px the three-column docs grid causes horizontal scroll, navigation is unreachable, and the Examples page is a 715-line wall with no discoverability.

The showcase should eat its own dog food comprehensively — the layout *itself* should be a composition exercise, not a React-with-inline-styles afterthought.

## What Changes

### New Components (expand the library)
- **Drawer** — a composed slide-out panel family (Root/Overlay/Panel/Header/Body) with shared `position` variant (left/right) and `open` state. Used for mobile sidebar, but general-purpose. Demonstrates compose() + states + portal + asChild trigger.
- **NavBar** — a composed responsive nav family (Root/Brand/Links/Actions/Trigger) with shared `collapse` variant. Renders inline links at `md+`, hides behind Drawer trigger below. Demonstrates compose() + responsive props + asChild.
- **ColorPalette** — a color mode selection component replacing the blind-cycle toggle. Grid of swatches with active state, preview on hover, current mode indicator. Demonstrates states + selector aliases (_hover, _focusVisible) + color scheme pattern.
- **ExampleNav** — in-page section navigation for the Examples page. Sticky horizontal tab strip or vertical list with IntersectionObserver-driven active state. Demonstrates states + sticky positioning + compose().
- **SkipLink** — accessible skip-to-content link. Demonstrates _focusVisible selector alias.

### Layout Changes
- **Shell.tsx** — replace flat nav with NavBar composed family. Add SkipLink. Wire Drawer for mobile sidebar.
- **DocsLayout.tsx** — make `collapse` responsive: `collapse={{ _: 'focused', sm: 'content', md: 'full' }}`. The compose() shared variant + responsive prop syntax makes this a one-line change.
- **Examples.tsx** — add ExampleNav component for section discovery. Add heading IDs for deep linking.

### Design System Tokens
- Add `drawerWidth` to sizes tokens (280px)
- Add `glow-edge` shadow token (`0 0 12px {colors.glow/15}, 0 0 4px {colors.glow/25}`) for drawer seam and palette active state

### Accessibility
- `prefers-reduced-motion` handling in RevealBlock and Logo animations
- `aria-label` on ColorPalette and NavBar trigger
- `aria-current` on PageToc active link
- `aria-expanded` on Drawer trigger

## Capabilities

### New Capabilities
- `responsive-shell-layout`: Responsive navigation shell — NavBar collapses to hamburger + Drawer on mobile, DocsLayout collapse responds to viewport, consistent content width rhythm across pages
- `color-mode-palette`: Enhanced color mode selection — grid of previewed swatches replacing blind cycle, active state indication, keyboard navigable
- `examples-page-navigation`: In-page section discovery for the Examples page — sticky nav with active tracking via IntersectionObserver, deep-linkable sections

### Modified Capabilities
- `markdown-renderer`: Add heading ID generation for deep linking (if not already present — needs verification)

## Impact

- **packages/showcase/** — all changes scoped here. No system package API changes.
- **New files**: ~5 new component files (Drawer, NavBar, ColorPalette, ExampleNav, SkipLink)
- **Modified files**: Shell.tsx, DocsLayout.tsx, Examples.tsx, ds.ts (tokens), index.ts (barrel exports)
- **Dependencies**: None new. All built with existing @animus-ui/system API.
- **Bundle impact**: Minimal — new components are small, extracted to static CSS.
- **Breaking changes**: None. All changes are additive or internal to showcase.
