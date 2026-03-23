## Context

The showcase (`packages/showcase/`) has forge-aesthetic tokens and ~30 components already implemented (vermilion/void palette, Barlow Condensed 800 headings, JetBrains Mono body, zero border-radius, ember/pulse/burn-in/strike animations). The infrastructure works. What's missing is narrative content — App.tsx is a generic product page that doesn't use the aesthetic vocabulary to tell a story.

The existing components in `components.tsx` and primitives in `ds.ts` are sufficient — no new component definitions are needed. The redesign is a content and composition change, not a component architecture change.

## Goals / Non-Goals

**Goals:**
- Rewrite App.tsx as a six-part narrative polemic
- Establish a voice (Underground Man: confessional, accusatory, self-aware)
- Use temperature-driven composition (cold → cold → EXPLOSION → quiet)
- Make code blocks the hero elements — no captions, Tartakovsky silence
- Fix infrastructure mismatches (wrong fonts loaded, borderRadius on SyntaxBlock)
- Every component remains extractable — the showcase still proves the pipeline

**Non-Goals:**
- New component definitions (use existing ~30 components)
- Token or color palette changes (forge tokens are final)
- Light mode polish (defer to follow-up)
- Scroll-triggered animations or intersection observer (CSS animation-delay on mount is sufficient)
- Mobile-specific layout work beyond existing responsive breakpoints

## Decisions

### 1. Six-Part Narrative Arc over Feature-Grid Layout

The app follows a narrative arc, not a feature index:

| Section | Thermal State | Content Strategy |
|---------|--------------|-----------------|
| **The Void** | Frozen | Logo breathing in 80vh of darkness. No tagline, no CTA. |
| **What We Lost** | Cold, cracking | Accusatory text only. No code. Burn-in animation with staggered delays. |
| **What Remains** | Warming | A single code block alone in the void. No label. Then quiet commentary. |
| **The Forge** | EXPLOSION | Input (TypeScript) → Output (@layer CSS). Timeline reframed as Soul → Forge → Weapon. |
| **The Proof** | Hot, controlled | Live extracted components as evidence, not demos. `[extracted]` chips. |
| **The Question** | Cooling to ember | Return to void. Logo breathing. "The forge is lit." |

**Why over feature grid:** A feature grid says "look what it does." A narrative says "look what we lost and what we can reclaim." The polemic structure creates emotional investment that a product page cannot.

### 2. Staggered Burn-In for the Indictment

The "What We Lost" section uses the existing `burn-in` CSS animation (clip-path reveal from left) with inline `animationDelay` values on each line. This creates the effect of lines appearing one after another, like a typewriter in the dark.

```
Line 1: "We had names for things."     delay: 0.2s
Line 2: "We gave them up."             delay: 0.6s
Line 3: "We had composition."          delay: 1.2s
Line 4: "We gave it up."               delay: 1.6s
Line 5: "We had zero runtime."         delay: 2.2s
Line 6: "We gave it up."               delay: 2.6s
Line 7: "And we called it progress."   delay: 3.4s (extra gap = verdict)
```

**Why burn-in over fade-up:** burn-in already exists in global.css, and the clip-path left-to-right reveal is more aggressive — it reads like text being etched, not floating in. Consistent with the forge/scar motif.

**Alternative considered:** Intersection Observer for scroll-triggered reveals. Rejected — adds runtime complexity, and the showcase should prove zero-runtime extraction. CSS animation on mount is sufficient.

### 3. Code-in-Silence (Tartakovsky Principle)

Key code blocks appear with NO labels, NO section markers, NO captions above them. The code block sits alone in generous negative space (py: 96 minimum). Commentary appears BELOW the code, smaller, quieter — like a whisper after a shout.

**Why:** Tartakovsky's Primal demonstrates that the most devastating moments are held frames with no dialogue. A builder chain floating in darkness IS the statement. Adding a label like "Here's how you define a button" domesticates it.

### 4. Inline Animation Styles over New Components

Staggered delays and animation properties are applied via inline `style` props on existing components rather than creating new "animated" component variants.

```tsx
<Heading style={{
  animation: 'burn-in 0.6s ease-out forwards',
  animationDelay: '0.2s',
  opacity: 0,
}}>We had names for things.</Heading>
```

**Why:** Creating AnimatedHeading, AnimatedText etc. would bloat the component surface. Inline style for animation-delay is the minimal intervention — the base component handles all other styling through extraction.

### 5. Voice Rules Encoded in Copy

| Context | Voice | Example |
|---------|-------|---------|
| Accusation | First person plural | "We gave them up." |
| Confession | First person singular | Avoided in v1 — too intimate for a showcase |
| Confrontation | Second person | "You know what ships." (considered, may be too aggressive) |
| Technical truth | Impersonal declarative | "The method chain order is the cascade order." |
| Marketing | NEVER | ~~"Animus provides..."~~ |

**Decision:** v1 uses primarily first-person plural and impersonal declarative. Second person used sparingly. First person singular reserved — if used at all, only in the closing.

## Risks / Trade-offs

**[Long initial load perception]** → The 80vh void opening means content is below the fold. Visitors might think the page is broken. **Mitigation:** The ember animation on the logo provides life — it's not a blank page, it's a held frame. The mode toggle in the corner signals interactivity.

**[Polemic alienates pragmatists]** → Some visitors want feature lists, not philosophy. **Mitigation:** The Proof section still demonstrates real capabilities (variants, transforms, responsive, extraction). The narrative is the wrapper, not a replacement for substance.

**[Copy tone risks pretension]** → "Notes from Underground" energy can read as try-hard if not executed precisely. **Mitigation:** Keep lines SHORT. Tartakovsky's Primal works because of economy. Every word earns its place. The moment a line sounds literary, cut it.

**[Burn-in animations on slow connections]** → Staggered delays mean the full indictment takes ~4s to reveal. On slow initial paint, this might not start when expected. **Mitigation:** Set `animation-fill-mode: forwards` with `opacity: 0` initial state so lines stay hidden until their animation fires. Worst case, all lines appear at once after fonts load.
