## ADDED Requirements

### Requirement: Six-part narrative arc structure
App.tsx SHALL be structured as six sequential sections in this exact order: The Void, What We Lost, What Remains, The Forge, The Proof, The Question. Each section SHALL have a distinct thermal state (frozen → cold → warming → explosion → hot → cooling) that drives its visual composition.

#### Scenario: Section ordering
- **WHEN** the showcase page loads
- **THEN** sections appear in order: void (logo), indictment (text), code-in-silence (builder chain), forge (input/output), proof (extracted components), question (closing)

#### Scenario: Thermal state drives background density
- **WHEN** rendering The Void or What We Lost sections
- **THEN** background SHALL be `background` (carbon) with minimal vermilion (logo ember only in Void, final line only in Lost)
- **WHEN** rendering The Forge section
- **THEN** vermilion SHALL dominate through code block accents, border-left highlights, and glow effects

### Requirement: The Void opening
The opening section SHALL display only the `animus` logo with ember animation, centered in a minimum 80vh container. No tagline, no CTA buttons, no navigation links SHALL appear in the hero area. The mode toggle SHALL be positioned in the navigation bar but no other interactive elements SHALL appear.

#### Scenario: Void renders minimal content
- **WHEN** the page loads
- **THEN** the Void section SHALL show only the Logo component (ember-animated) and a mode toggle
- **THEN** the section height SHALL be at least 80vh
- **THEN** no Heading, Text, Button, or Badge components SHALL appear in this section

### Requirement: Indictment text with staggered burn-in
The "What We Lost" section SHALL display accusatory text lines that animate in sequentially using the `burn-in` CSS animation with staggered `animationDelay` values. Lines SHALL appear in pairs (statement + "We gave it up") with increasing delay. The final line ("And we called it progress.") SHALL have an extended delay gap and SHALL render in the `primary` (vermilion) color while preceding lines render in `text` color.

#### Scenario: Burn-in timing
- **WHEN** the What We Lost section renders
- **THEN** each text line SHALL have `animation: burn-in 0.6s ease-out forwards` with `opacity: 0` initial state
- **THEN** lines SHALL stagger with ~400ms between pairs and ~800ms extra before the final verdict line

#### Scenario: Final line vermilion
- **WHEN** all indictment lines have animated in
- **THEN** "And we called it progress." SHALL be colored `primary` (vermilion)
- **THEN** all preceding lines SHALL be colored `text` (bone in dark mode)

### Requirement: Code-in-silence presentation
Key code blocks SHALL appear in the void with NO labels, NO section markers, and NO captions above them. Commentary text, when present, SHALL appear BELOW the code block in a smaller, quieter typographic treatment. The code block SHALL be surrounded by generous negative space (minimum py: 96 on containing section).

#### Scenario: What Remains section
- **WHEN** the What Remains section renders
- **THEN** a CodeBlock SHALL appear with no Label or Heading preceding it
- **THEN** commentary text SHALL appear below the code, not above

### Requirement: Forge input/output reveal
The Forge section SHALL show the transformation from TypeScript builder chain to extracted @layer CSS. It SHALL present "What you write." followed by the builder chain code block, then "What ships." followed by the @layer CSS output, then "Nothing else." The pipeline timeline SHALL be reframed with labels: step 1 = the intent, step 2 = the pipeline, step 3 = the output.

#### Scenario: Forge section content
- **WHEN** the Forge section renders
- **THEN** it SHALL contain two code blocks (TypeScript input, CSS output)
- **THEN** the text "What you write." SHALL precede the TypeScript block
- **THEN** the text "What ships." SHALL precede the CSS block
- **THEN** the text "Nothing else." SHALL follow the CSS block

### Requirement: Proof section shows extracted components
The Proof section SHALL display live components (buttons, badges, transforms, responsive demos) as evidence of extraction, not as feature demos. Each component group SHALL be marked with a `[extracted]` Chip component. The section SHALL open with "Every component on this page was extracted at build time."

#### Scenario: Components as evidence
- **WHEN** the Proof section renders
- **THEN** it SHALL include Button variant demos, transform demos (fluid, ratio), and the @layer declaration
- **THEN** each subsection SHALL have a Chip reading "extracted"

### Requirement: Closing returns to void
The Question section SHALL return to minimal content — the Logo breathing with ember animation and a single line of text. No CTA buttons, no navigation, no feature lists. The footer SHALL state "Built with the extraction pipeline it demonstrates."

#### Scenario: Closing minimal
- **WHEN** the Question section renders
- **THEN** it SHALL contain only the Logo, one line of text, and a footer attribution
- **THEN** no Button components SHALL appear

### Requirement: Voice rules
All copy in the showcase SHALL follow voice rules: first-person plural for accusations ("we gave this up"), impersonal declarative for technical truths ("The method chain order is the cascade order"), and NEVER third-person marketing speak ("Animus provides..."). Second person MAY be used sparingly for confrontation.

#### Scenario: No marketing voice
- **WHEN** any Text or Heading content is authored
- **THEN** it SHALL NOT use third-person constructions like "Animus provides", "Animus enables", "Animus offers"

### Requirement: Infrastructure fixes
SyntaxBlock SHALL use `borderRadius: 0` (not `'8px'`). index.html SHALL load Barlow Condensed 800 via Google Fonts (replacing DM Serif Display and DM Sans which are no longer referenced by tokens). global.css SHALL include `fade-up` and `scar` animation keyframes.

#### Scenario: SyntaxBlock zero radius
- **WHEN** SyntaxBlock renders a code block
- **THEN** the wrapper element SHALL have `border-radius: 0`

#### Scenario: Correct fonts loaded
- **WHEN** index.html is parsed
- **THEN** Google Fonts link SHALL include `Barlow+Condensed:wght@800`
- **THEN** Google Fonts link SHALL NOT include `DM+Serif+Display` or `DM+Sans`
