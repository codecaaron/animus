## ADDED Requirements

### Requirement: Narrative component families
The showcase SHALL define 8 purpose-built component families where the component name and API communicate narrative intent. Components SHALL be builder chain primitives defined via `ds.styles({...}).variant({...}).asElement()`. Thin React wrappers SHALL handle composition logic (stagger timing, children mapping) separately from CSS.

#### Scenario: VoidFrame family renders held silence
- **WHEN** `<VoidFrame>` is rendered
- **THEN** it SHALL display as a flex container centered both axes with `minHeight: '80vh'` and `bg: 'void'`
- **THEN** it SHALL animate with `void-pulse` (6s box-shadow breathing)

#### Scenario: VoidSignature renders breathing logo
- **WHEN** `<VoidSignature>` is rendered with text content
- **THEN** it SHALL render as an `h1` with `fontFamily: 'logo'`, `color: 'primary'`, and `ember` animation

#### Scenario: Indictment wrapper staggers burn-in
- **WHEN** `<Indictment delay={0.5} stagger={0.4}>` is rendered with an array of strings
- **THEN** each string SHALL render as an `IndictmentLine` with `burn-in` animation
- **THEN** each line's `animationDelay` SHALL be `delay + (index * stagger)` seconds

#### Scenario: ForgeBench renders asymmetric comparison
- **WHEN** `<ForgeBench>` is rendered with `<ForgeInput>`, `<ForgeScar>`, and `<ForgeOutput>`
- **THEN** it SHALL display as a 3-column grid (`1fr auto 1fr`)
- **THEN** `ForgeInput` SHALL have `opacity: 0.7` by default (the old world fading)
- **THEN** `ForgeScar` SHALL be a 2px vermilion line with glow

#### Scenario: SectionScar renders directional chapter marker
- **WHEN** `<SectionScar chapter="02" title="the forge">` is rendered
- **THEN** the chapter number SHALL appear left, followed by an ember line extending to the right
- **THEN** the line SHALL animate with `scar-draw` (0.8s width reveal)

#### Scenario: ProofSpecimen shows live component with extracted CSS
- **WHEN** `<ProofSpecimen hash="animus-Button--primary" layer="variants">` is rendered with children
- **THEN** it SHALL display the children (live component) in a stage area
- **THEN** it SHALL display the class hash, layer badge, and CSS output below the stage

#### Scenario: CodeAltar elevates code with intentional emptiness
- **WHEN** `<CodeAltar file="ds.ts" language="tsx">` is rendered
- **THEN** the code block SHALL be wrapped in a container with `borderLeft: 4` in vermilion
- **THEN** `AltarSurround` SHALL provide `py: { _: 48, md: 64 }` of intentional emptiness

#### Scenario: EmberGlyph renders with size and speed variants
- **WHEN** `<EmberGlyph size="xl" speed="slow">` is rendered
- **THEN** it SHALL display at the `xl` size (fontSize: 96) with `ember` animation at 6s duration
- **WHEN** `frozen` state is true
- **THEN** animation SHALL pause and opacity SHALL reduce to 0.3

#### Scenario: VerdictLine reveals via clip-path
- **WHEN** `<VerdictLine as="h1">` is rendered
- **THEN** it SHALL animate with `forge-reveal` (clip-path from `inset(0 100% 0 0)` to `inset(0 0% 0 0)`)
- **THEN** it SHALL render in `fontFamily: 'heading'`, `color: 'primary'`, `textAlign: 'center'`

### Requirement: Six-section narrative arc
App.tsx SHALL be structured as six sequential sections: The Void, The Indictment, What Remains, The Forge, The Proof, The Close. Sections SHALL be separated by `SectionScar` components with chapter numbers.

#### Scenario: Section ordering and markers
- **WHEN** the showcase page loads
- **THEN** sections SHALL appear in order with `SectionScar` separators numbered 01 through 05

#### Scenario: The Void section
- **WHEN** The Void section renders
- **THEN** it SHALL contain only a `VoidFrame` with `VoidSignature` ("animus") and optionally a `VoidWhisper`
- **THEN** no buttons, badges, feature cards, or descriptive text SHALL appear

#### Scenario: The Indictment section
- **WHEN** The Indictment section renders
- **THEN** it SHALL use the `Indictment` React wrapper with staggered burn-in lines
- **THEN** the copy SHALL use first-person plural voice ("we") and include self-accusation

#### Scenario: What Remains section
- **WHEN** What Remains renders
- **THEN** it SHALL contain a `CodeAltar` with the builder chain (no preceding label or heading)
- **THEN** commentary SHALL appear BELOW the code, not above

#### Scenario: The Forge section
- **WHEN** The Forge section renders
- **THEN** it SHALL contain a `ForgeBench` (TypeScript → CSS) and a `CodeAltar` for the fluid transform
- **THEN** the fluid transform SHALL show all 4 steps: define transform, register in system, use in JSX, compiled output

#### Scenario: The Proof section
- **WHEN** The Proof section renders
- **THEN** it SHALL contain at least 2 `ProofSpecimen` instances showing live components with extracted CSS

#### Scenario: The Close
- **WHEN** The Close section renders
- **THEN** it SHALL contain a `VerdictLine` and a closing `VoidFrame` with the logo breathing
- **THEN** no CTA buttons SHALL appear

### Requirement: Voice rules
All showcase copy SHALL follow voice rules: first-person plural for accusations ("we gave this up"), impersonal declarative for technical truths ("The method chain is the cascade"), second person sparingly for confrontation ("You already understand it"). Copy SHALL NEVER use third-person marketing voice ("Animus provides...").

#### Scenario: No marketing voice
- **WHEN** any text content is authored in the showcase
- **THEN** it SHALL NOT use constructions like "Animus provides", "Animus enables", "Animus offers"

### Requirement: Four code moments only
The showcase SHALL contain exactly 4 code examples: (1) the builder chain alone, (2) chain → @layer CSS side-by-side, (3) the fluid transform 4-step sequence, (4) color mode switching. No other code examples SHALL appear.

#### Scenario: Code moment count
- **WHEN** the full showcase is rendered
- **THEN** there SHALL be exactly 4 distinct code example areas (CodeAltar or ForgeBench instances with code)

### Requirement: Animation keyframes
global.css SHALL define keyframes: `void-pulse` (6s box-shadow breathing), `burn-in` (0.4s opacity+translate+blur reveal), `scar-draw` (0.8s width 0→100%), `forge-reveal` (0.6s clip-path inset reveal), `ember` (4s text-shadow breathing, existing).

#### Scenario: All keyframes present
- **WHEN** global.css is loaded
- **THEN** it SHALL contain `@keyframes` definitions for `void-pulse`, `burn-in`, `scar-draw`, `forge-reveal`, and `ember`

### Requirement: Infrastructure fixes
SyntaxBlock SHALL use `borderRadius: 0`. index.html SHALL load Barlow Condensed 800 via Google Fonts (replacing DM Serif Display and DM Sans). All narrative components SHALL be extractable by the Vite plugin.

#### Scenario: SyntaxBlock zero radius
- **WHEN** SyntaxBlock renders
- **THEN** the wrapper SHALL have `border-radius: 0`

#### Scenario: Correct fonts loaded
- **WHEN** index.html is parsed
- **THEN** Google Fonts link SHALL include `Barlow+Condensed:wght@800`
- **THEN** Google Fonts link SHALL NOT include `DM+Serif+Display` or `DM+Sans`

#### Scenario: Extraction succeeds
- **WHEN** `bun run build` is run in the showcase package
- **THEN** the build SHALL succeed with all narrative components extracted to CSS
