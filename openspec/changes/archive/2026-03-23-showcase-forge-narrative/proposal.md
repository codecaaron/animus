## Why

The showcase has forge-aesthetic tokens and ~30 generic components (Card, Badge, Button, Timeline), but the App.tsx assembles them like a product page — feature grids, component demos, pipeline visualizations. A previous attempt (archived: `showcase-narrative-redesign`) rewrote the copy but kept the same generic components. The result looked like a Tailwind template with different words. That's exactly the trap Animus exists to reject.

The components themselves and their APIs are the creative expression. The act of designing `<Indictment delay={2} stagger={0.4}>` instead of `<Text variant="quote">` is the voice. The showcase must prove that Animus can produce purpose-built components for a specific narrative — not generic parts shuffled into different arrangements.

Three inspiration streams: Genndy Tartakovsky's *Primal* (flat color fields, silhouette storytelling, held frames, no dialogue), Icecrown Citadel soul forges (creation through consuming, transformation as the central act), Dostoevsky's *Notes from Underground* (confessional, accusatory, self-aware — the narrator includes himself in the accusation).

## What Changes

- **Delete all existing showcase components** — `components.tsx` is replaced entirely with purpose-built narrative components
- **8 new narrative component families** designed specifically for this story:
  - `VoidFrame` / `VoidSignature` / `VoidWhisper` — the 80vh held silence
  - `IndictmentBlock` / `IndictmentLine` + `Indictment` React wrapper — burn-in text with stagger API
  - `ForgeBench` / `ForgeInput` / `ForgeOutput` / `ForgeScar` — asymmetric before/after transformation
  - `SectionScar` / `ScarLine` / `ScarChapter` — directional chapter separators
  - `ProofSpecimen` / `ProofStage` / `ProofEvidence` — live component + extracted CSS evidence
  - `CodeAltar` / `AltarHeader` / `AltarCaption` — code as sacred object with intentional emptiness
  - `EmberGlyph` — Primal silhouette punctuation with size/speed variants and frozen/flare states
  - `VerdictLine` — closing inscription revealed via clip-path
- **Complete App.tsx rewrite** — six-section narrative arc: Void → Indictment → What Remains → The Forge → The Proof → The Close
- **4 code moments** (ruthlessly cut from ~15 in previous version): the chain, the @layer revelation, the fluid transform ("oh shit"), color mode switching
- **New animation keyframes** — `void-pulse`, `forge-reveal`, updated `burn-in` and `scar-draw`
- **Infrastructure fixes** — Google Fonts link (Barlow Condensed 800), SyntaxBlock borderRadius: 0
- **Narrative copy** — Dostoevsky voice: "I wrote the blog posts", "You already understand it", "This is not a new idea. It is a recovered one.", "Take it or don't. But you know it's true."

## Capabilities

### New Capabilities
- `showcase-forge-narrative`: The narrative component system (8 component families), the six-section arc structure, voice rules, 4 code moments, and the design principle that component APIs ARE narrative voice

### Modified Capabilities

## Impact

- `packages/showcase/src/components.tsx` — complete replacement
- `packages/showcase/src/App.tsx` — complete rewrite
- `packages/showcase/src/global.css` — new/updated animation keyframes
- `packages/showcase/src/SyntaxBlock.tsx` — borderRadius fix
- `packages/showcase/index.html` — Google Fonts link update
- `packages/showcase/src/ds.ts` — preserved as-is (tokens are solid)
- No changes to core, system, extract, vite-plugin, runtime, or theming packages
- All new components must be extractable — the showcase is proof the pipeline works
