## Context

The showcase site proves Animus extraction works at the component level (31 components, compose patterns, 10 color modes). But the shell — navigation, layout, page structure — is desktop-only React with no responsive behavior, no mobile navigation, and no compositional structure. The `collapse` variant on DocsLayout exists but is hardcoded to `"full"`. The Examples page is a flat 715-line wall. The color mode toggle cycles blindly through 10 modes.

The site needs to prove Animus works at the *application* level: responsive layouts, composed navigation, state-driven drawers, accessible controls — all built with the builder chain and extraction pipeline.

**Current token infrastructure (verified):**
- Breakpoints: 2xs(400), xs(480), sm(768), md(1024), lg(1200), xl(1440)
- Sizes: navHeight(48px), sidebarWidth(200px), tocWidth(180px)
- Color modes: 10 (dark, light, midnight, ember, ocean, forest, violet, rose, terra, adobe)
- Responsive prop syntax: `{ _: default, sm: value, md: value }` — working on Home.tsx

## Goals / Non-Goals

**Goals:**
- Mobile-usable navigation and docs layout (< 768px)
- Every new layout component built as an Animus composition exercise
- Color mode selection with preview and direct access
- Examples page with navigable section structure
- Accessibility baseline (skip-to-content, reduced-motion, ARIA)
- Consistent content width rhythm across all pages

**Non-Goals:**
- Changing the system package API (all work scoped to showcase)
- Server-side rendering or SSG (showcase is a client SPA)
- Adding new Animus system features (this consumes existing features only)
- Responsive behavior on the Home page (already works via breakpoint props)
- Touch gestures (swipe-to-close drawer, etc.) — keyboard + click only
- Dark/light mode *detection* (prefers-color-scheme) — users choose explicitly

## Decisions

### Decision 1: Drawer as a composed family with portal overlay

**Choice:** Build `Drawer` as `compose({ Root, Overlay, Panel, Header, Body }, { shared: { position: true } })` where `Root` renders Overlay + Panel via portal, Panel slides in from left/right based on `position` variant.

**Why over inline implementation:** The Drawer is the highest-value new component for proving compose() at the layout level. It exercises: compose() shared variants (position flows to Panel slide direction and Overlay positioning), states (open/closed), portal rendering (Overlay covers viewport), and asChild (trigger element delegation).

**Why not context: true:** Drawer renders into a portal, but the Panel is a *direct child* of Root in the React tree — Root controls what renders. There's no case where a child slot escapes Root's React subtree. CSS cascade works fine here.

**Visual identity — "The Seam":**

The drawer should feel like *cracking open* the interface — a threshold reveal, not a generic slide panel.

- **Overlay:** `bg: 'bg/85'` — the same void as the page background but denser. Add `backdrop-filter: blur(2px)` to push the content away. The existing SVG noise texture bleeds through at the body level naturally.
- **Panel edge:** The seam between panel and overlay gets a vertical FireLine-style gradient border: `borderRight` with `linear-gradient(180deg, transparent, {colors.primary}, {colors.accent}, {colors.primary}, transparent)` and `glow-edge` shadow. The seam *glows*.
- **Panel background:** `bg: 'bg.muted'` — same depth as page but slightly darker. Not `surface` (too bright, breaks the void feel).
- **Entry animation:** The RevealBlock spring curve — `cubic-bezier(0.16, 1, 0.3, 1)` — not the default `ease`. Panel slides in with this curve. Panel *contents* (header, nav items) cascade in with staggered delay variants (0.15s increments), the same reveal pattern from the Home page.
- **Close affordance:** No `X` button. The overlay is the close target. Optionally, a thin `←` arrow in IBM Plex Mono (11px, uppercase, letter-spaced) in the Header slot — matching the nav item style.

```
┌──────────────────────────────────────────────┐
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│░░┌───────────╮░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│░░│            ▌░░░░░░░ noise-textured ░░░░░░░│
│░░│  ← CLOSE  ▌░░░░░░░ overlay at 85% ░░░░░░░│
│░░│            ▌░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│░░│  NAV       ▌░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│░░│  ITEMS     ▌◄── glowing seam edge ────────│
│░░│  CASCADE   ▌░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│░░│  IN        ▌░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│░░└────────────╯░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
└──────────────────────────────────────────────┘
```

**Alternatives considered:**
- CSS-only drawer with `:target` or checkbox hack — too brittle, no state management
- Dialog element — correct semantically but doesn't compose with Animus builder chain naturally (dialog has its own backdrop, sizing)
- Headless library (Radix Dialog) — adds dependency, defeats "prove Animus can do this" goal

### Decision 2: Responsive DocsLayout via responsive prop value

**Choice:** Change `collapse="full"` to `collapse={{ _: 'focused', sm: 'content', md: 'full' }}` — a one-line change that makes the 3-column layout responsive using existing infrastructure.

**Why this works:** DocsLayout already uses compose() with `shared: { collapse: true }`. The `collapse` variant already defines `full`, `content`, and `focused` modes with correct display/grid behavior. Responsive prop objects generate breakpoint-specific classes at extraction time. No new components needed — just use what exists.

**Mobile (< 768px):** `focused` mode — content only, sidebar in Drawer, no TOC.
**Tablet (768-1024px):** `content` mode — sidebar visible, no TOC.
**Desktop (1024+):** `full` mode — sidebar + content + TOC.

### Decision 3: NavBar as a composed family replacing Shell nav

**Choice:** Build `NavBar` as `compose({ Root, Brand, Links, Actions, MobileTrigger }, { shared: { mode: true } })` where `mode` variant controls desktop (inline links) vs mobile (hidden links, visible trigger).

**Why composed:** The nav has multiple slots that need coordinated visibility behavior — exactly what compose() shared variants solve. `mode` variant with `inline` (show links, hide trigger) and `compact` (hide links, show trigger) values, driven by responsive prop: `mode={{ _: 'compact', md: 'inline' }}`.

**Visual identity — "The Reduction":**

On mobile, the nav doesn't *collapse* — it *distills*. Maximum reduction.

- **Mobile trigger:** Not a hamburger icon. A single `{` character in IBM Plex Mono, 16px, `color: 'primary'`. The opening brace is literally the Animus brand mark (the `{` pillar from the Home page feature section). Tap to open the sidebar drawer.
- **Desktop layout:** `ANIMUS    home    docs              ─  dark` — five elements with flex spacer.
- **Mobile layout:** `ANIMUS  {                              dark` — three elements. Brand, trigger, mode. Everything else is in the drawer.
- **Brand position:** Left-anchored always. Trigger clusters next to brand on mobile, not far right.
- **Nav border:** Keep the 1px `borderBottom: 'border'` in both modes. The thin line grounds the nav to the page. `bg: 'bg'` — opaque, not transparent.
- **Typography:** All nav items 12px IBM Plex Mono, uppercase, 0.1em letter-spacing — matching existing NavItem style. No Geist in structural chrome.

```
DESKTOP:  ANIMUS    home    docs              ─  dark
MOBILE:   ANIMUS  {                              dark
```

**Why not media queries in CSS:** Using responsive props keeps the pattern consistent with DocsLayout and demonstrates that Animus responsive props work for layout-level concerns, not just component-level spacing.

### Decision 4: ColorPalette as grid of stateful swatches

**Choice:** Build a `ColorPalette` component with a grid of color mode swatches. Each swatch previews its mode's primary/bg/surface colors. Active mode gets a visual indicator (ring, border). Clicking selects. Keyboard navigable via arrow keys on a listbox/radiogroup pattern.

**Architecture:** The palette lives in a Drawer panel (right-positioned), triggered from the nav's Actions slot. Each swatch is an Animus component with states (active, hover) and the color scheme pattern (each swatch rebinds `--preview-*` variables to show that mode's colors).

**Visual identity — "Modes as Worlds":**

Each color mode isn't a color — it's an *atmosphere*. The palette should preview that atmosphere.

- **Swatch design:** Not circles or dots. Each swatch is a miniature **mode landscape** (~48x64px) — a tiny rectangle showing three horizontal bands: background color at top (60%), a thin 2px line in primary color across the middle, text color at bottom (40%). Three layers. A tiny slice of what that world looks like.
- **Active indicator:** Not a ring. The active swatch gets `glow-edge` elevation — `boxShadow: '0 0 12px {colors.glow/15}, 0 0 4px {colors.glow/25}'` using *that mode's* primary as the glow source, not the current mode's primary. It glows in its own color.
- **Layout:** 2x5 grid with 4px gaps and 1px borders between cells. Dense, like a typesetter's case. The whole grid has the technical density of the existing UI.
- **Labels:** Each swatch has its mode name below in 9px uppercase IBM Plex Mono. Always visible, no tooltip needed.
- **Hover:** `_hover` scales swatch slightly (`transform: scale(1.06)`) with glow intensification. Spring curve: `cubic-bezier(0.16, 1, 0.3, 1)`.
- **Focus:** `_focusVisible` shows 2px outline in `primary` with 2px offset — matching Button focus style.
- **Placement:** Right-positioned Drawer (reusing the Drawer component). Current mode name stays in NavBar Actions as text trigger.

```
┌──────┬──────┐
│▓▓▓▓▓▓│░░░░░░│
│──────│──────│  bg / primary-line / text
│ dark │ lite │
├──────┼──────┤
│▓▓▓▓▓▓│▓▓▓▓▓▓│
│──────│──────│
│ mid  │ embr │
├──────┼──────┤
│▓▓▓▓▓▓│▓▓▓▓▓▓│
│──────│──────│
│ ocea │ frst │
├──────┼──────┤
│▓▓▓▓▓▓│▓▓▓▓▓▓│
│──────│──────│
│ viol │ rose │
├──────┼──────┤
│▓▓▓▓▓▓│▓▓▓▓▓▓│
│──────│──────│
│ tera │ adob │
└──────┴──────┘
```

**Why not keep the cycle button:** 10 modes with no preview means users can't find what they want. The palette makes the color system *discoverable* — which is the point of the showcase.

**Alternatives considered:**
- Dropdown select — functional but boring, doesn't showcase Animus
- Carousel — interaction complexity without payoff
- Keep cycle + add a label — still no preview, still sequential

### Decision 5: ExampleNav via IntersectionObserver + sticky positioning

**Choice:** Add a sticky section navigator to the Examples page. Horizontal tab strip at the top of the page that highlights the current section as user scrolls. Clicking a tab scrolls to that section. Pattern mirrors PageToc but oriented horizontally.

**Visual identity — "The Index":**

Not tabs — a monospaced index strip. Like the line numbers in a text editor, but horizontal and showing section names.

- **Typography:** 11px IBM Plex Mono, uppercase, 0.05em letter-spacing — matching the existing RowLabel/ColHeader pattern exactly.
- **Active indicator:** `borderBottom: 2` in `primary` — the same 2px border pattern from SidebarItem and TocLink, rotated 90 degrees. Consistency across all navigation surfaces.
- **Inactive items:** `color: 'text.dim'` — the faintest text tone. Active: `color: 'primary'`. Hover: `color: 'text.muted'`. The four-step ramp.
- **Separators:** Between items, a thin vertical 1px line in `border` color — matching NavDivider.
- **Sticky behavior:** Sticks below nav with a top border (1px `borderTop: 'border'`) creating a visual "docking" effect. `bg: 'bg'` — opaque so content scrolls behind it. The noise texture bleeds through at the body level.
- **Overflow on mobile:** `overflow-x: auto` with `scrollbar-width: none` (`::-webkit-scrollbar { display: none }`). Strip scrolls horizontally without visible scrollbar. Thin separators between items create natural peek affordance at edges.
- **No rounded corners, no pill backgrounds, no colored fills** on items. Just text, color, and thin lines. Maximum reduction.

```
──────────────────────────────────────────────────
  MATRIX │ USAGE │ EXTERNAL │ TRANSFORMS │ ALIASES │ COMPOSE │ ...
  ═══════                                            
──────────────────────────────────────────────────
   ↑ 2px primary border on active item
```

**Why sticky horizontal:** The Examples page already lives inside DocsLayout on mobile-tablet, so a vertical sidebar nav would compete with the docs sidebar. Horizontal sticky strip sits above the content and doesn't require layout changes.

**Section IDs:** Add `id` attributes to each Section's Heading in Examples.tsx for scroll targeting and deep linking.

### Decision 6: Content width normalization

**Choice:** Standardize all content containers to `maxWidth: '48rem'` (the DocsLayout value). Remove the `44rem` and `40rem` variants from Home.tsx and Examples.tsx.

**Why 48rem:** It's already the DocsLayout standard. Wide enough for code examples. Narrow enough for comfortable reading. One value = one rhythm.

### Decision 7: Accessibility as component-level concerns, not a separate layer

**Choice:** Embed accessibility into each new component rather than building a separate accessibility wrapper layer.

- **SkipLink:** Single component, `_focusVisible` selector alias for visible-on-focus. When visible, styled like the install badge from Home CTA — `bg: 'surface'`, `border: 1`, `borderColor: 'border'`, mono font 12px. Text: `SKIP TO CONTENT →`. Feels like a keyboard shortcut hint, not a banner.
- **Drawer:** `aria-expanded` on trigger, `aria-modal` on panel, focus trap via `onKeyDown` handler (not a library)
- **ColorPalette:** `role="radiogroup"` with `role="radio"` swatches, `aria-checked`, arrow key navigation
- **RevealBlock:** Wrap `transform`/`opacity` transitions in `@media (prefers-reduced-motion: reduce)` variant — the extraction pipeline emits this as a standard media query in the CSS
- **NavBar MobileTrigger:** `aria-label="Open navigation"`, `aria-expanded`

**Why not a library (focus-trap-react, etc.):** The Drawer's focus trap is simple — tab cycles between panel children, Escape closes. A 15-line `onKeyDown` handler suffices. Adding a library for one component defeats the "built with Animus" narrative.

### Decision 8: Reduced-motion via media query in styles, not runtime detection

**Choice:** Add `@media (prefers-reduced-motion: reduce)` styles directly in component style objects using the `@media` nesting syntax that the extraction pipeline already supports.

```typescript
// In RevealBlock, Logo, or any animated component
ds.styles({
  transition: 'opacity 0.6s ease, transform 0.6s ease',
  '@media (prefers-reduced-motion: reduce)': {
    transition: 'none',
    transform: 'none',
    opacity: '1',
  },
})
```

**Why:** This is purely a CSS concern — no JavaScript `matchMedia` needed. The extraction pipeline emits it as a standard `@media` block in the CSS output. Zero runtime cost.

### Decision 9: Cross-cutting visual language for all new components

**Choice:** All new structural/chrome components share a consistent visual vocabulary derived from the existing showcase DNA. This isn't a style guide — it's a set of constraints that ensure new components feel *born from* the existing site.

**Typography in chrome:** IBM Plex Mono everywhere in structural UI (nav, drawer, palette, example nav). Geist is for *content* only (Prose, markdown body). No mixing. Sizes: 9-13px for chrome elements, uppercase with letter-spacing for labels.

**Border vocabulary:** 1-2px only. Never thicker. Never rounded on structural elements. The existing site uses `border: 1` (1px solid) and `borderLeft: 2` (2px for active indicators). New components follow the same.

**Motion signature:** `cubic-bezier(0.16, 1, 0.3, 1)` — the spring-out ease from RevealBlock — is the *only* entry animation curve. Stagger cascading items with 0.15s increments (delay variants 0-4). Transitions use `0.15s ease` for state changes (hover, focus, active).

**Color ramp for interactive states:** `text.dim` (resting) → `text.muted` (available) → `text` (hover) → `primary` (active/selected). This four-step ramp is already used in NavItem, SidebarItem, TocLink. New components must follow it.

**Elevation = glow, not shadow:** Elevation is expressed through primary-tinted glow (`boxShadow` with `{colors.glow/N}` opacity), never through black drop-shadow. Add `glow-edge` shadow token: `'0 0 12px {colors.glow/15}, 0 0 4px {colors.glow/25}'` for the drawer seam and palette active state.

**Density:** Tight. The existing UI is 11-13px type, 4-8px padding, 2px borders. New components match this density. The showcase should feel like a *tool*, not a marketing page.

## Risks / Trade-offs

**[Risk] Drawer focus trap is hand-rolled** → Mitigation: Keep it minimal (tab cycling + Escape). Test with VoiceOver. If edge cases emerge, the trap can be extracted to a utility without changing the component API.

**[Risk] Responsive prop on compose() shared variant is untested at this scale** → Mitigation: DocsLayout already uses compose() with collapse. The responsive prop syntax is proven on Home.tsx. This just combines them. Write a test case.

**[Risk] ColorPalette swatch preview requires reading another mode's token values** → Mitigation: Each swatch can hardcode its mode's bg/primary/surface colors since the 10 modes are known and static. No dynamic theme reading needed.

**[Risk] ExampleNav IntersectionObserver duplicates PageToc pattern** → Mitigation: Both are small (~50 lines). Extracting a shared hook would be premature abstraction for two call sites. If a third appears, consolidate then.

**[Risk] Content width change (44rem → 48rem on Home) may affect visual balance** → Mitigation: Review after implementation. The Scene component's maxWidth is a system prop — easy to adjust.

**[Trade-off] No swipe gestures on Drawer** — Mobile users expect swipe-to-close. Accepted for v1 — click/tap the overlay or press Escape. Swipe can be added later without API changes.

**[Trade-off] No prefers-color-scheme detection** — Users must manually select their color mode. This is intentional — the showcase demonstrates the 10-mode system, not OS integration.
