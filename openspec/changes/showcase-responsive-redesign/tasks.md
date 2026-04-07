## 1. Foundation — Tokens & Primitives

- [x] 1.1 Add `drawerWidth` size token (280px) and `glow-edge` shadow token (`0 0 12px {colors.glow/15}, 0 0 4px {colors.glow/25}`) to ds.ts
- [x] 1.2 Create SkipLink component (`components/layout/SkipLink.tsx`) — visually hidden, visible on `_focusVisible` with install-badge styling (bg: surface, border: 1, mono 12px, text: `SKIP TO CONTENT →`), links to `#main-content`
- [x] 1.3 Add `id="main-content"` to Main element in Shell.tsx
- [x] 1.4 Add `prefers-reduced-motion: reduce` media query to RevealBlock styles (transition: none, opacity: 1, transform: none)
- [x] 1.5 Add `prefers-reduced-motion: reduce` media query to Logo animation styles (animation: none)

## 2. Drawer Component

- [x] 2.1 Create Drawer slot components (Root, Overlay, Panel, Header, Body) in `components/layout/Drawer.tsx` with shared `position` variant (left/right) and `open` state
- [x] 2.2 Overlay: `bg: 'bg/85'`, `backdrop-filter: blur(2px)`. Panel: `bg: 'bg.muted'`, width: `{sizes.drawerWidth}`. Panel edge: vertical FireLine gradient border with `glow-edge` shadow on the seam
- [x] 2.3 Panel entry animation: `cubic-bezier(0.16, 1, 0.3, 1)` spring curve, ~300ms duration. Panel contents stagger in with delay variants (0.15s increments)
- [x] 2.4 Compose Drawer slots via `compose({ Root, Overlay, Panel, Header, Body }, { shared: { position: true } })`
- [x] 2.5 Create behavioral Drawer wrapper that manages open state, renders Overlay + Panel via portal, handles Escape key close, overlay click close
- [x] 2.6 Implement focus trap in Drawer Panel — Tab/Shift+Tab wrapping, focus first element on open, return focus to trigger on close
- [x] 2.7 Add ARIA attributes: `aria-modal="true"` on Panel, `role="dialog"`, focus management
- [x] 2.8 Header slot: optional close affordance — thin `←` in IBM Plex Mono 11px, uppercase, letter-spaced, matching nav item style
- [x] 2.9 Add Drawer to barrel export in `components/index.ts`

## 3. NavBar Component

- [x] 3.1 Create NavBar slot components (Root, Brand, Links, Actions, MobileTrigger) in `components/layout/NavBar.tsx` with shared `mode` variant (inline/compact)
- [x] 3.2 Links slot: `display: 'flex'` in inline mode, `display: 'none'` in compact mode. MobileTrigger: inverse visibility
- [x] 3.3 MobileTrigger content: single `{` character in IBM Plex Mono 16px, `color: 'primary'` — the Animus brand glyph, not a hamburger icon
- [x] 3.4 All nav items: 12px IBM Plex Mono, uppercase, 0.1em letter-spacing. Four-step interactive ramp: text.dim → text.muted → text → primary
- [x] 3.5 Root: sticky, 1px `borderBottom: 'border'`, `bg: 'bg'` (opaque). Mobile layout clusters Brand + Trigger left, Actions (color toggle) right
- [x] 3.6 Compose NavBar slots via `compose({ Root, Brand, Links, Actions, MobileTrigger }, { shared: { mode: true } })`
- [x] 3.7 Add NavBar to barrel export in `components/index.ts`

## 4. Shell Integration

- [x] 4.1 Replace Shell.tsx inline nav with NavBar composed family. Wire `mode={{ _: 'compact', md: 'inline' }}` responsive prop
- [x] 4.2 Wire MobileTrigger to open a left-positioned Drawer containing the Sidebar. Add `aria-expanded` and `aria-label="Open navigation"` to trigger
- [x] 4.3 Add SkipLink as first element in Shell before NavBar
- [x] 4.4 Move ColorModeToggle into NavBar.Actions slot — wire it to open a right-positioned Drawer containing ColorPalette
- [x] 4.5 Ensure Drawer closes on NavLink click (sidebar link navigation)

## 5. Responsive DocsLayout

- [x] 5.1 Change DocsLayout.tsx `collapse="full"` to `collapse={{ _: 'focused', sm: 'content', md: 'full' }}`
- [x] 5.2 Conditionally render Sidebar in Layout.Sidebar only when collapse !== 'focused' (it moves to Drawer on mobile)
- [x] 5.3 Verify compose() shared variant works with responsive prop objects at extraction — run `bun run verify:showcase`

## 6. ColorPalette Component

- [x] 6.1 Create ColorPalette swatch component in `components/docs/ColorPalette.tsx` — miniature mode landscape swatches (~48x64px) showing bg band (60%), 2px primary line, text band (40%)
- [x] 6.2 Swatch `active` state: `glow-edge` elevation using that mode's primary as glow source. Swatch `_hover`: `transform: scale(1.06)` with spring curve. `_focusVisible`: 2px outline matching Button pattern
- [x] 6.3 Layout: 2x5 grid, 4px gaps, 1px borders between cells. Mode name labels below each swatch in 9px uppercase IBM Plex Mono
- [x] 6.4 Hardcode preview colors for each of the 10 modes (bg, primary, text hex values from ds.ts color mode definitions)
- [x] 6.5 Implement `role="radiogroup"` container with `role="radio"` swatches, `aria-checked`, arrow key navigation
- [x] 6.6 Wire click/Enter/Space to call `setMode()` — apply `data-color-mode` on document element and persist to localStorage
- [x] 6.7 Integrate into right-positioned Drawer triggered from NavBar Actions. Current mode name text stays visible in nav as trigger
- [x] 6.8 Add ColorPalette to barrel export in `components/index.ts`

## 7. Examples Page Navigation

- [x] 7.1 Add stable kebab-case `id` attributes to all Section headings in Examples.tsx (e.g., `id="slot-composition"`)
- [x] 7.2 Create ExampleNav component (`components/docs/ExampleNav.tsx`) — monospaced index strip: 11px IBM Plex Mono, uppercase, 0.05em letter-spacing
- [x] 7.3 Active indicator: `borderBottom: 2` in `primary` (matching SidebarItem/TocLink 2px border pattern). Inactive: `color: 'text.dim'`. Hover: `color: 'text.muted'`
- [x] 7.4 Separators: 1px vertical lines in `border` color between items. No backgrounds, no pills, no rounded corners
- [x] 7.5 Sticky below NavBar with 1px `borderTop: 'border'` docking line. `bg: 'bg'` opaque
- [x] 7.6 Implement IntersectionObserver active section tracking (pattern mirrors PageToc)
- [x] 7.7 Implement click-to-scroll with smooth scrolling and URL hash update
- [x] 7.8 Handle initial load with hash — scroll to section if URL contains fragment
- [x] 7.9 Make strip horizontally scrollable on narrow viewports (`overflow-x: auto`, hide scrollbar via `scrollbar-width: none` + webkit pseudo)
- [x] 7.10 Add ExampleNav to Examples.tsx as first child after PageWrapper, sticky below NavBar
- [x] 7.11 Implement `role="tablist"` container with `role="tab"` items, `aria-selected`, `aria-label="Example sections"`

## 8. Content Width Normalization

- [x] 8.1 Update Home.tsx Scene content containers from `maxWidth="44rem"` to `maxWidth="48rem"`
- [x] 8.2 Update Examples.tsx CodeSection/Intro from `maxWidth="40rem"` to `maxWidth="48rem"`
- [x] 8.3 Visual review — verify content rhythm feels consistent across Home, Docs, Examples

## 9. Verification

- [x] 9.1 Run `bun run verify:showcase` — full pipeline build + showcase build passes
- [ ] 9.2 Manual viewport testing — resize through 400px → 768px → 1024px → 1440px, verify layout transitions
- [ ] 9.3 Keyboard navigation test — Tab through entire site, verify skip link, drawer focus trap, color palette arrow keys
- [ ] 9.4 Reduced motion test — enable `prefers-reduced-motion: reduce` in OS/browser, verify animations disabled
