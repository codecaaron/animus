# Visual Design: "Forged"

## Concept

A forge in darkness. Precision tools, no ornament. The only light comes from heated metal. The void is the workspace; ember is the signal. Everything unnecessary has been burned away.

The editorial serif era is dead. What's left is the terminal that grew up — monospace for structure, clean sans for readability, fire only where it matters.

## Typography

### Font Stack Changes

| Role | Before | After | Rationale |
|------|--------|-------|-----------|
| Display/Headings | Instrument Serif (editorial) | IBM Plex Mono Bold (already loaded) | Monospace headings tie to code blocks. Everything feels forged from the same metal. |
| Body | Newsreader (editorial serif) | Geist Sans | Clean, modern, designed for developer tools. Excellent readability at body sizes. |
| Logo | Major Mono Display | Major Mono Display | **SACROSANCT.** No change. |
| Code | IBM Plex Mono | IBM Plex Mono | Already perfect. No change. |

### Token Updates (`ds.ts` fonts scale)

```typescript
fonts: {
  display: "'IBM Plex Mono', monospace",     // was Instrument Serif
  logo: "'Major Mono Display', monospace",    // unchanged
  body: "'Geist', sans-serif",               // was Newsreader
  mono: "'IBM Plex Mono', monospace",         // unchanged
}
```

### Heading Treatment

- **h2**: IBM Plex Mono, 500 weight, 20px, `letterSpacing: '-0.01em'`, `color: text`. Clean, no decoration. The monospace IS the decoration.
- **h3**: IBM Plex Mono, 500 weight, 16px, `color: textMuted`. Subtler weight, recedes slightly.
- Anchor links: on hover, a subtle `color: primary` transition on a `#` symbol to the left (positioned absolutely, appears on hover).

### Body Text

- Geist Sans, 400 weight, 15px, line-height 1.7, `color: textMuted`.
- Body text is intentionally muted — the code examples are the real content. Prose supports but doesn't compete.

### Code Typography

- Inline code: IBM Plex Mono, 13px, `bg: coal`, `color: spark`, `px: 6px`, `py: 2px`. The spark-on-coal treatment: gold code on dark surface. Sharp, readable, stands out in body text.
- Code blocks: IBM Plex Mono, 13px, line-height 1.7, `bg: carbon`, full-width with `px: 24, py: 20`. No border. The darkness IS the container.

## Color Application

### Unchanged

All color tokens and color modes remain exactly as defined. The palette is already the forge.

### Design Principles

1. **Ember is reserved for signal.** Primary actions, active states, the logo, critical emphasis. Never decorative.
2. **Spark for code.** Inline code tokens, syntax highlights, values that matter. Gold on coal.
3. **Void is negative space.** The background is not empty — it's the darkness of the forge. Don't fill it.
4. **Ash for structure.** Borders, dividers, rules. Barely there. The 1px border at `ash` color is a hairline crack in the void.
5. **Smoke for secondary text.** Readable but receded. Descriptions, labels, metadata.

### Nav Bar

- `bg: background` (void in dark mode, cream in light)
- Bottom border: 1px solid ash — hairline. Not prominent.
- Brand: `color: primary` in Major Mono Display. The only fire in the nav.
- Nav links: IBM Plex Mono 12px, uppercase, `letterSpacing: 0.1em`, `color: textMuted`.
- Active link: `color: primary`. No underline, no background. Just the color shift.
- ColorModeToggle: right-aligned in nav. Minimal — a small monospace label ("dark" / "light") that toggles.

### Sidebar

- Width: 200px fixed. Sticky, top offset accounting for nav height.
- No background. No border-right. Just links floating in the void.
- Links: IBM Plex Mono 13px, `color: textMuted`. Stacked vertically with 8px gap.
- Active link: `color: primary`, plus a 2px left border in ember (`borderLeft: '2px solid'`, `borderColor: 'primary'`). The ember mark — a thin line of fire indicating position.
- Hover: `color: text`. Subtle warmth.

### Code Examples (Input/Output)

- **Container**: No visible border. Two blocks stacked or split, separated by a 1px ash line or a labeled gap.
- **Labels**: "surface" / "substrate" (from the existing showcase metaphor) — IBM Plex Mono 11px, uppercase, `letterSpacing: 0.3em`, `color: textMuted`. Whisper-level labels.
- **Code blocks**: `bg: carbon` (not coal — slightly lighter than void for depth). Spark (#FFB627) for string values, ember (#FF2800) for keywords would be ideal but syntax highlighting is handled by prism-react-renderer's theme.
- **Split layout**: On wide screens (md+), input left, output right, equal width. 1px ash vertical divider or 16px gap.

### Tables

- No outer border. No zebra striping.
- Header row: `borderBottom: '2px solid'`, `borderColor: 'ash'`. IBM Plex Mono 12px, 500 weight, uppercase, `letterSpacing: 0.05em`, `color: textMuted`.
- Body rows: `borderBottom: '1px solid'`, `borderColor: 'ash'` (the hairline). Geist 14px, `color: text`.
- Cell padding: `py: 12, px: 16`. Generous but not loose.
- InlineCode within cells inherits the spark-on-coal treatment.

### Lists

- Unordered: no bullets. Instead, an `ember` colored dash (`—`) as list marker via `::marker { color: var(--color-primary); content: '— '; }` or custom `list-style`.
- Ordered: numbers in `color: primary`. The fire marks the count.
- Item spacing: `mb: 8`. Tight but breathable.

## Page-Level Design

### Home (`/`)

- Full-viewport hero with centered logo (sacrosanct — GlowText + gradient animation).
- Below hero: The input/output CodeExample. Large, prominent, the centerpiece.
- Key differentiators: a simple grid of 3-5 items. Each item: a monospace label in ember + one line of Geist body text. No cards, no icons, no decoration. Just facts.
- CTA: A text link in ember. "Get started →". No button. Buttons are for apps. This is a document.

### Docs Pages

- Two-column layout: 200px sidebar + fluid content area.
- Content max-width: 48rem (768px). Generous but bounded.
- Section spacing: 64px between major sections, 32px between subsections.
- The content area is where Geist body text lives. The sidebar and headings are monospace. Two type worlds, one forge.

## Motion

- **Page transitions**: None. Route changes are instant. Docs sites should never animate between pages.
- **Reveal animations**: Keep existing `RevealBlock` for the Home page hero. Not used on docs pages — content should be immediately readable.
- **Hover states**: `transition: color 0.15s ease` on nav links and sidebar links. That's it. No scale, no glow, no drama. The fire metaphor is in the color, not the motion.
- **Logo effects**: GlowText gradient animation (`flow 5s linear infinite`) and ember glow (`ember 3s ease-in-out infinite`) — SACROSANCT. These are the only animations on the site that matter.

## Film Grain

The existing `body::after` film grain overlay (fractal noise at 0.04 opacity) STAYS. It's the texture of darkness — the forge atmosphere. It's barely visible but subconsciously adds depth.

## Font Loading

Add Geist via Google Fonts or self-hosted. It's available at `https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;700` or from the Vercel CDN.

Update the showcase's `index.html` to load Geist alongside the existing font imports.

## Color Mode Toggle

- Position: right side of nav bar, after nav links.
- Visual: monospace text label showing current mode. IBM Plex Mono 11px, uppercase, `letterSpacing: 0.15em`.
- Dark mode shows "dark" in textMuted, light mode shows "light" in textMuted.
- Hover: `color: primary`. Click toggles.
- No icon (sun/moon). Text only. The monospace label IS the interface.
- Separator: a 1px vertical line in ash between the nav links and the toggle, 16px margin on each side.

## Summary

The design removes all editorial warmth (serifs, decorative flourishes) and replaces it with forge precision. Monospace headings ground everything in the code world. Clean sans body text recedes to let code examples speak. Fire (ember, spark) is used surgically — only for signal. Everything else is void, ash, and smoke.

The logo's fire effects remain the emotional peak of the site. Everything else serves them by contrast.
