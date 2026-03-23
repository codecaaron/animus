## Context

The showcase (`packages/showcase/`) has a working design system instance (`ds`) with vermilion/void tokens, dark+light color modes, custom transforms (fluid, ratio), and a SyntaxBlock for code highlighting. The extraction pipeline is verified end-to-end. What's missing is a component layer and narrative that uses the system to tell a story rather than display a catalog.

An earlier attempt (archived) kept generic components and rewrote only the copy. The result was a product page with different words — proving that narrative voice requires purpose-built components, not just content changes.

## Goals / Non-Goals

**Goals:**
- Replace all showcase components with purpose-built narrative components
- Each component API communicates narrative intent (the name is the voice)
- 6-section arc: Void → Indictment → What Remains → Forge → Proof → Close
- 4 code moments only (chain, @layer output, fluid transform, color modes)
- Dostoevsky/Tartakovsky voice: confessional, accusatory, held silences, no marketing
- Every component extractable — the showcase proves the pipeline

**Non-Goals:**
- Light mode polish (dark is the primary mode, light works via tokens but isn't optimized)
- Scroll-triggered animations (CSS animation on mount + stagger delays is sufficient)
- Mobile-specific layouts beyond existing responsive breakpoints
- Documentation or API reference (the showcase is a polemic, not docs)
- Performance benchmarks (the code moments make the case, not numbers)

## Decisions

### 1. Component APIs as Narrative Grammar

Component names carry intent. The API is part of the voice.

| Generic (rejected) | Narrative (chosen) | Why |
|---|---|---|
| `<Hero>` | `<VoidFrame>` | A hero has CTAs and content slots. The void has nothing. |
| `<QuoteBlock variant="dark">` | `<Indictment delay={2}>` | `delay` is a stage cue. `stagger` is rhythm of testimony. |
| `<ComparisonTable>` | `<ForgeBench>` | A comparison gives equal weight. The forge dims the "before." |
| `<Divider label="02">` | `<SectionScar chapter="02">` | A divider is symmetric. A scar points forward. |
| `<ComponentPreview>` | `<ProofSpecimen layer="variants">` | Preview shows components. Specimen shows evidence. |
| `<CodeBlock>` inside `<Card>` | `<CodeAltar file="ds.ts">` | A card is furniture. An altar has intentional emptiness. |
| `<Icon size="lg">` | `<EmberGlyph speed="slow">` | Icons have no emotional register. Glyphs have pulse. |
| `<Heading>` | `<VerdictLine>` | A heading fades in. A verdict is cut from stone. |

### 2. Builder Chain Primitives + React Wrappers

Each narrative component has two layers:
1. **Builder chain primitives** — static, extractable, defined via `ds.styles({...}).variant({...}).asElement()`
2. **React wrappers** — thin composition logic for stagger timing, children mapping, conditional rendering

Example: `Indictment` has `IndictmentBlock` and `IndictmentLine` (builder chains) plus an `Indictment` React function that maps children strings to staggered `IndictmentLine` elements.

**Why:** The builder chain handles all CSS (extractable). The React wrapper handles composition (runtime). Clean separation.

### 3. Four Code Moments (Ruthless Cut)

| Moment | Position | What it proves | Presentation |
|---|---|---|---|
| 1. The Chain | "What Remains" section | The API reads like a sentence | CodeAltar, no output, silence |
| 2. The Revelation | "The Forge" section | Chain maps to @layer CSS 1:1 | ForgeBench, asymmetric split |
| 3. The Differentiator | "The Forge" section | User-defined build-time computation | CodeAltar with 4-step sequence |
| 4. The Quiet Close | Before verdict | Color modes = one attribute mutation | CodeAltar, minimal |

**Cut:** Extension chains (too abstract), responsive compilation (parity not differentiator), architecture diagrams (for contributors not consumers), @layer ordering details (implicit in Moment 2), Vite config (infrastructure).

### 4. Animation Strategy

New keyframes in `global.css`:

```
void-pulse    — 6s box-shadow breathing on VoidFrame
burn-in       — 0.4s opacity+translate+blur reveal (update existing)
scar-draw     — 0.8s width 0→100% for SectionScar lines
forge-reveal  — 0.6s clip-path inset reveal for VerdictLine
ember         — 4s text-shadow breathing (keep existing)
```

All timing controlled via inline `animationDelay` style prop on builder chain primitives. No Intersection Observer. No scroll libraries. CSS animation on mount.

### 5. ForgeBench Layout

3-column CSS grid: `1fr auto 1fr`. The center column is a 2px ember scar with glow. Left pane (`ForgeInput`) starts at `opacity: 0.7` — the old world is fading. Right pane (`ForgeOutput`) is full brightness. Hover on left pane brings it to full opacity.

**Why asymmetric:** A neutral comparison table says "pick whichever." The forge says: one of these is dying and one is being born.

### 6. ProofSpecimen as Evidence

Each `ProofSpecimen` shows a live rendered component AND the exact CSS class + layer it extracted to. Layout: top half is a "stage" (dark surface, component rendered live), bottom half is a 2-column grid (left: class hash + layer badge, right: extracted CSS).

This communicates: the component you see and the CSS you inspect are the SAME object, bifurcated by the pipeline.

### 7. File Organization

```
packages/showcase/src/
  ds.ts              — preserved (tokens, system)
  components.tsx     — REPLACED: narrative components (builder chain primitives)
  narrative.tsx      — NEW: React wrappers (Indictment, ProofSpecimen, CodeAltar, SectionScar)
  SyntaxBlock.tsx    — preserved (borderRadius fix)
  App.tsx            — REPLACED: six-section narrative arc
  global.css         — UPDATED: new keyframes
  reset.css          — preserved
  main.tsx           — preserved
```

## Risks / Trade-offs

**[Specificity = non-reusable]** → Components like `VoidFrame` and `Indictment` are useless outside this showcase. **Mitigation:** That IS the point. The showcase proves Animus can create purpose-built components for any context. Generic reusability is the Tailwind mindset.

**[Copy tone risks pretension]** → "Notes from Underground" voice can read as try-hard. **Mitigation:** The narrative agent tested multiple variations. The strongest lines are short, specific, and include the narrator in the accusation. "I wrote the blog posts" is not pretentious — it's confessional.

**[Too few code moments]** → 4 code examples may feel thin. **Mitigation:** Each moment is a self-contained argument. The technical proof agent confirmed these 4 cover the full differentiator surface. More would dilute.

**[ForgeBench responsive behavior]** → 3-column grid doesn't work on mobile. **Mitigation:** Stack to single column at `sm` breakpoint with scar becoming horizontal between panes.
