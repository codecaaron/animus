## MODIFIED Requirements

### Requirement: Source replacement
The source replacer SHALL replace the entire chain expression (from `animus.` root to terminal) with a `createComponent()` call importing from `@animus-ui/system`, and add a CSS import for the extracted stylesheet. When ALL named bindings from an import statement have been replaced by extraction, the replacer SHALL remove that import statement from the output.

#### Scenario: Replace asElement chain
- **WHEN** source has `export const Button = animus.styles({...}).variant({...}).asElement('button')`
- **THEN** the transformed source SHALL contain an import of `createComponent` from `@animus-ui/system`, an import of the CSS file, and `export const Button = createComponent('button', 'animus-Button-hash', { variants: { variant: { options: ['fill', 'stroke'], default: undefined } } })`

#### Scenario: Preserve non-chain code
- **WHEN** source contains code that is not an Animus builder chain
- **THEN** that code SHALL remain unchanged in the transformed output
