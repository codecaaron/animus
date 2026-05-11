## ADDED Requirements

### Requirement: Doc component imports in MDX

MDX content files SHALL support importing and using documentation-specific components (LivePreview, TokenBadge, TypeSignature, ParamTable, MethodCard, ChainStep, TabGroup) from the showcase component barrel or relative paths. These components MUST render as interactive instances alongside markdown prose.

#### Scenario: LivePreview in MDX
- **WHEN** an MDX file imports LivePreview and renders `<LivePreview preview={<Component />} code={<SyntaxBlock>...</SyntaxBlock>} />`
- **THEN** a tabbed preview/code panel renders inline with the surrounding prose

#### Scenario: TokenBadge in MDX prose
- **WHEN** an MDX file uses `<TokenBadge variant="method">.styles()</TokenBadge>` inline
- **THEN** the semantic badge renders as an inline-flex element within the text flow

#### Scenario: Reference components in MDX
- **WHEN** an MDX file uses TypeSignature, ParamTable, or MethodCard
- **THEN** each renders as an interactive API reference component with full styling and behavior

#### Scenario: ChainStep visualization in MDX
- **WHEN** an MDX file wraps ChainStep in a client component with state management
- **THEN** the interactive chain visualization renders with clickable steps and active highlighting
