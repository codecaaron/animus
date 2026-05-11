## 1. Infrastructure Fixes

- [x] 1.1 Update `index.html` Google Fonts link: replace DM Serif Display + DM Sans with Barlow Condensed 800 (keep JetBrains Mono + Major Mono Display)
- [x] 1.2 Fix `SyntaxBlock.tsx`: change `borderRadius: '8px'` to `borderRadius: 0` in wrapStyle
- [x] 1.3 Add `fade-up` and `scar` animation keyframes to `global.css`

## 2. App.tsx Narrative Rewrite

- [x] 2.1 Write Section I: The Void — Logo centered in 80vh container, ember animation, mode toggle in nav, nothing else
- [x] 2.2 Write Section II: What We Lost — Indictment text with burn-in animation and staggered delays ("We had names for things. / We gave them up." pattern). Final line "And we called it progress." in vermilion with extra delay gap.
- [x] 2.3 Write Section III: What Remains — Single code block (Button builder chain) alone in void, no label. Commentary text below: "The method chain order is the cascade order. This is not a metaphor."
- [x] 2.4 Write Section IV: The Forge — "What you write." + TypeScript code block, "What ships." + @layer CSS code block, "Nothing else." Pipeline timeline reframed (intent → pipeline → output).
- [x] 2.5 Write Section V: The Proof — "Every component on this page was extracted at build time." Button variants, fluid transform, ratio transform, responsive compilation, @layer declaration. Components marked with `[extracted]` chips.
- [x] 2.6 Write Section VI: The Question — Return to void. Logo breathing. "The forge is lit." Footer: "Built with the extraction pipeline it demonstrates."

## 3. Verification

- [ ] 3.1 Run `bun run dev` in showcase and verify all six sections render correctly in dark mode
- [ ] 3.2 Verify burn-in animations stagger correctly in What We Lost section
- [ ] 3.3 Verify light mode renders with warm paper palette (toggle mode)
- [ ] 3.4 Run `bun run build` in showcase and verify extraction succeeds with no errors
