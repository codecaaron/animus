## 1. Infrastructure

- [x] 1.1 Update `index.html` Google Fonts link: replace DM Serif Display + DM Sans with Barlow Condensed 800 (keep JetBrains Mono 400/500/700 + Major Mono Display)
- [x] 1.2 Fix `SyntaxBlock.tsx`: change `borderRadius: '8px'` to `borderRadius: 0`
- [x] 1.3 Update `global.css` animation keyframes: update `burn-in` (add translate+blur), add `void-pulse` (6s box-shadow breathing), add `scar-draw` (0.8s width reveal), add `forge-reveal` (0.6s clip-path inset reveal)

## 2. Narrative Components — Builder Chain Primitives

- [x] 2.1 Write `VoidFrame`, `VoidSignature`, `VoidWhisper` — the held silence (80vh flex center, void bg, ember animation logo, smoke whisper text)
- [x] 2.2 Write `IndictmentBlock`, `IndictmentLine`, `IndictmentEmphasis`, `IndictmentVerdict` — the burn-in accusation (blockquote with 4px vermilion left border, individual lines with burn-in animation)
- [x] 2.3 Write `ForgeBench`, `ForgeInput`, `ForgeOutput`, `ForgeScar`, `ForgeScarGlyph`, `ForgeLabel` — the asymmetric transformation (3-column grid, dimmed input pane, ember scar divider, output pane)
- [x] 2.4 Write `SectionScar` primitives: `ScarContainer`, `ScarLine`, `ScarChapter`, `ScarTitle` — the directional chapter separator (chapter number → ember line → optional title)
- [x] 2.5 Write `ProofSpecimen`, `ProofStage`, `ProofMeta`, `ProofHash`, `ProofLayer` — the evidence component (live component stage + hash + layer badge)
- [x] 2.6 Write `CodeAltarFrame`, `AltarHeader`, `AltarFile`, `AltarLang`, `AltarSurround`, `AltarCaption` — code as sacred object (4px vermilion left border, header with file/lang, 48px intentional emptiness, caption below)
- [x] 2.7 Write `EmberGlyph` — Primal silhouette punctuation (size variants sm/md/lg/xl)
- [x] 2.8 Write `VerdictLine` — the closing inscription (heading font, vermilion, forge-reveal clip-path animation, responsive size variants)

## 3. React Wrappers

- [x] 3.1 Write `Indictment` wrapper in `narrative.tsx` — accepts `lines: IndictmentEntry[]`, `baseDelay`, `stagger`; maps each entry to staggered IndictmentLine/EmphasisCode/Verdict
- [x] 3.2 Write `SectionScar` wrapper in `narrative.tsx` — accepts `chapter`, `title`, `delay`; composes ScarContainer + ScarChapter + ScarLine + optional ScarTitle
- [x] 3.3 Write `CodeAltar` wrapper in `narrative.tsx` — accepts `file`, `language`, `caption`, `children: string`; composes AltarSurround + CodeAltarFrame + AltarHeader + CodeBlock + AltarCaption
- [x] 3.4 Write `ProofSpecimenBlock` wrapper in `narrative.tsx` — accepts `title`, `hash`, `layer`, `css`, `children: ReactNode`; composes stage + meta + hash + layer + code

## 4. App.tsx — The Narrative

- [x] 4.1 Write Section I: The Void — `VoidFrame` with `VoidSignature` ("animus"), no CTA, no tagline, mode toggle in nav corner
- [x] 4.2 Write Section II: The Indictment — `Indictment` with the "I wrote the blog posts" copy, staggered burn-in, SectionScar chapter marker
- [x] 4.3 Write Section III: What Remains — Code Moment 1: `CodeAltar` with the builder chain, no label above, "You already understand it" caption below
- [x] 4.4 Write Section IV: The Forge — Code Moment 2: `ForgeBench` (chain → @layer CSS), Code Moment 3: `CodeAltar` with fluid transform 4-step sequence
- [x] 4.5 Write Section V: The Proof — 2 `ProofSpecimenBlock` instances (Button variants, Button states), "They work" copy
- [x] 4.6 Write Section VI: The Close — Code Moment 4: color mode switching, `VerdictLine` ("Take it or don't."), closing `VoidFrame` with logo, footer

## 5. Verification

- [x] 5.1 Run `bun run build` in showcase — verify extraction succeeds with all narrative components
- [x] 5.2 Run `bun run dev` — verify all six sections render, animations fire correctly
- [x] 5.3 Verify light mode renders (toggle mode toggle)
- [x] 5.4 Visual review — take full-page screenshot, verify narrative arc reads correctly
