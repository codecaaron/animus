## Why

The showcase app (`packages/showcase/`) currently functions as a generic product page — feature grids, component demos, pipeline visualizations. It answers "what can it do?" but never "why does it exist?" or "what was lost?" The name Animus means fury, spirit, animating force. The showcase should embody that etymology: a polemic about the state of CSS-in-JS, not a marketing page.

Three inspiration streams drive the redesign: Genndy Tartakovsky's *Primal* (flat color fields, silhouette storytelling, held frames, no dialogue), Icecrown Citadel soul forges (creation requires consuming something — every CSS framework consumed developer agency), and Dostoevsky's *Notes from Underground* (confessional, accusatory, painfully self-aware first-person voice).

## What Changes

- **Complete rewrite of App.tsx** — from product-page sections to a six-part narrative arc: The Void → What We Lost → What Remains → The Forge → The Proof → The Question
- **Narrative voice** — first-person plural accusation ("we gave this up"), first-person singular confession, second-person confrontation. Never third-person marketing speak.
- **Temperature-driven composition** — sections follow a thermal pattern inspired by Primal: cold → cold → cold → EXPLOSION → quiet. Not a gradual warmth.
- **New CSS animations** — `fade-up` (entrance reveal) and `scar` (horizontal slash divider) added to global.css
- **SyntaxBlock fix** — remove `borderRadius: '8px'` (violates zero-radius design rule)
- **index.html font update** — replace DM Serif Display / DM Sans with Barlow Condensed 800 (tokens already reference it, but the font isn't loaded)
- **Code blocks as heroes** — code blocks sit alone in the void with no captions. The code IS the statement. Tartakovsky's no-dialogue principle applied to technical communication.

## Capabilities

### New Capabilities
- `showcase-narrative`: The narrative arc structure, voice rules, temperature-driven section composition, and copy for the six-part polemic

### Modified Capabilities

## Impact

- `packages/showcase/src/App.tsx` — complete rewrite
- `packages/showcase/src/global.css` — new animation keyframes
- `packages/showcase/src/SyntaxBlock.tsx` — borderRadius fix
- `packages/showcase/index.html` — Google Fonts link update
- No API changes, no package changes, no extraction pipeline changes
- All existing components from `components.tsx` and `ds.ts` are reused — no new component definitions needed
