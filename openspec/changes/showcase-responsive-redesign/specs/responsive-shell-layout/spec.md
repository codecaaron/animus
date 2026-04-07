## ADDED Requirements

### Requirement: NavBar renders as composed family with shared mode variant
The NavBar SHALL be implemented as a `compose()` family with slots: Root, Brand, Links, Actions, MobileTrigger. A shared `mode` variant SHALL control visibility of Links (visible in `inline`, hidden in `compact`) and MobileTrigger (hidden in `inline`, visible in `compact`).

#### Scenario: Desktop viewport renders inline navigation
- **WHEN** NavBar renders with `mode="inline"`
- **THEN** Links slot SHALL be visible and MobileTrigger slot SHALL be hidden

#### Scenario: Mobile viewport renders compact navigation
- **WHEN** NavBar renders with `mode="compact"`
- **THEN** Links slot SHALL be hidden and MobileTrigger slot SHALL be visible

#### Scenario: Responsive mode via breakpoint prop
- **WHEN** NavBar Root receives `mode={{ _: 'compact', md: 'inline' }}`
- **THEN** the extraction pipeline SHALL emit breakpoint-specific classes that toggle slot visibility at the `md` breakpoint (1024px)

### Requirement: Drawer component provides slide-out panel with overlay
The Drawer SHALL be implemented as a `compose()` family with slots: Root, Overlay, Panel, Header, Body. A shared `position` variant (left/right) SHALL control the slide direction of Panel. An `open` state SHALL control visibility.

#### Scenario: Drawer opens from left
- **WHEN** Drawer Root has `position="left"` and `open={true}`
- **THEN** the Panel SHALL slide in from the left edge of the viewport and Overlay SHALL cover the remaining viewport area

#### Scenario: Drawer closes on overlay click
- **WHEN** user clicks the Overlay while Drawer is open
- **THEN** the Drawer SHALL close (open state becomes false)

#### Scenario: Drawer closes on Escape key
- **WHEN** user presses Escape while Drawer is open
- **THEN** the Drawer SHALL close and focus SHALL return to the trigger element

#### Scenario: Drawer trigger uses asChild
- **WHEN** MobileTrigger is configured with `asChild`
- **THEN** the trigger's className and aria attributes SHALL merge onto the child element via cloneElement

### Requirement: DocsLayout responds to viewport width
The DocsLayout SHALL use responsive prop values on the `collapse` shared variant to adapt the grid layout to the viewport width.

#### Scenario: Mobile viewport shows content only
- **WHEN** viewport width is below the `sm` breakpoint (768px)
- **THEN** DocsLayout SHALL render in `focused` mode (single column, sidebar and TOC hidden)

#### Scenario: Tablet viewport shows sidebar and content
- **WHEN** viewport width is between `sm` (768px) and `md` (1024px) breakpoints
- **THEN** DocsLayout SHALL render in `content` mode (sidebar + content, TOC hidden)

#### Scenario: Desktop viewport shows all three columns
- **WHEN** viewport width is at or above the `md` breakpoint (1024px)
- **THEN** DocsLayout SHALL render in `full` mode (sidebar + content + TOC)

### Requirement: Mobile sidebar accessible via Drawer
When DocsLayout is in `focused` mode, the sidebar navigation SHALL be accessible via a Drawer triggered from the NavBar's MobileTrigger.

#### Scenario: Mobile user opens sidebar
- **WHEN** viewport is below `sm` breakpoint and user activates the MobileTrigger
- **THEN** a Drawer SHALL open containing the Sidebar component with full navigation

#### Scenario: Sidebar navigation closes drawer
- **WHEN** user clicks a navigation link inside the Drawer sidebar
- **THEN** the Drawer SHALL close and the page SHALL navigate to the selected route

### Requirement: SkipLink provides keyboard shortcut to main content
A SkipLink component SHALL render as the first focusable element in the page. It SHALL be visually hidden until focused.

#### Scenario: SkipLink appears on focus
- **WHEN** user presses Tab from the browser chrome (first focusable element)
- **THEN** the SkipLink SHALL become visually visible with text "Skip to content"

#### Scenario: SkipLink activates
- **WHEN** user activates the focused SkipLink (Enter key)
- **THEN** focus SHALL move to the main content area, bypassing navigation

### Requirement: Content width is consistent across pages
All page content containers SHALL use a consistent maximum width value.

#### Scenario: Home page content width matches docs
- **WHEN** Home page sections render
- **THEN** content containers SHALL use the same `maxWidth` as DocsLayout content (48rem)

#### Scenario: Examples page content width matches docs
- **WHEN** Examples page sections render
- **THEN** code sections and intro text SHALL use the same `maxWidth` as DocsLayout content (48rem)

### Requirement: Animations respect reduced-motion preference
All animated components SHALL include `@media (prefers-reduced-motion: reduce)` styles that disable or reduce motion.

#### Scenario: RevealBlock with reduced motion
- **WHEN** user has `prefers-reduced-motion: reduce` set in OS preferences
- **THEN** RevealBlock SHALL render immediately without opacity/transform transition

#### Scenario: Logo animation with reduced motion
- **WHEN** user has `prefers-reduced-motion: reduce` set
- **THEN** Logo flow animation SHALL not play

### Requirement: Drawer implements keyboard focus management
The Drawer Panel SHALL trap focus when open. Tab cycling SHALL wrap within the panel. Escape SHALL close the drawer.

#### Scenario: Focus moves to panel on open
- **WHEN** Drawer opens
- **THEN** focus SHALL move to the first focusable element inside Panel

#### Scenario: Tab wraps within panel
- **WHEN** user presses Tab on the last focusable element in Panel
- **THEN** focus SHALL wrap to the first focusable element in Panel

#### Scenario: Shift+Tab wraps within panel
- **WHEN** user presses Shift+Tab on the first focusable element in Panel
- **THEN** focus SHALL wrap to the last focusable element in Panel

### Requirement: NavBar trigger has proper ARIA attributes
The MobileTrigger element SHALL communicate its state to assistive technology.

#### Scenario: Trigger indicates closed state
- **WHEN** Drawer is closed
- **THEN** MobileTrigger SHALL have `aria-expanded="false"` and `aria-label="Open navigation"`

#### Scenario: Trigger indicates open state
- **WHEN** Drawer is open
- **THEN** MobileTrigger SHALL have `aria-expanded="true"`
