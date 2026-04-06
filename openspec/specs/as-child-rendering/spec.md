### Requirement: asChild delegates rendering to the single child element
When an Animus component receives `asChild={true}`, it SHALL NOT render its own element. Instead, it SHALL resolve its className and dynamic style as usual, then merge them onto the single child element via `cloneElement`.

#### Scenario: Basic asChild rendering
- **WHEN** `<Button kind="ghost" asChild><a href="/foo">Link</a></Button>` renders
- **THEN** the output SHALL be `<a href="/foo" class="animus-Button-xxx animus-Button-xxx--kind-ghost">Link</a>` — no `<button>` element rendered

#### Scenario: Child keeps its own props
- **WHEN** a child element has `href`, `target`, `onClick`, or any other props
- **THEN** those props SHALL be preserved on the rendered output — the parent does not strip or override them

#### Scenario: asChild requires exactly one element child
- **WHEN** `asChild={true}` is used with zero children, multiple children, or a non-element child (string, number, fragment)
- **THEN** the component SHALL throw a runtime error indicating that asChild requires a single React element

### Requirement: className merging with asChild
When `asChild` is active, the parent's resolved className SHALL be merged with the child's existing className.

#### Scenario: Merged className order
- **WHEN** the parent resolves to `"animus-Box-abc animus-Box-abc--size-sm"` and the child has `className="child-extra"`
- **THEN** the rendered element SHALL have `className="animus-Box-abc animus-Box-abc--size-sm child-extra"`

#### Scenario: Child has no className
- **WHEN** the child element has no className prop
- **THEN** the rendered element SHALL have only the parent's resolved className

### Requirement: Ref composition with asChild
When `asChild` is active, the parent's forwarded ref and the child's ref SHALL both receive the rendered DOM element.

#### Scenario: Both refs receive the element
- **WHEN** the parent has a forwarded ref and the child has its own ref
- **THEN** both refs SHALL be set to the same DOM element after mount

#### Scenario: Only parent ref exists
- **WHEN** the parent has a forwarded ref but the child has no ref
- **THEN** the parent ref SHALL receive the DOM element normally

### Requirement: Dynamic style merging with asChild
When `asChild` is active and the parent has dynamic CSS variable styles, they SHALL be merged with the child's existing inline style.

#### Scenario: Dynamic styles applied to child
- **WHEN** the parent has dynamic prop styles `{ '--animus-p': '16px' }` and the child has `style={{ color: 'red' }}`
- **THEN** the rendered element SHALL have `style={{ color: 'red', '--animus-p': '16px' }}`

#### Scenario: No dynamic styles
- **WHEN** the parent has no dynamic prop values and the child has `style={{ color: 'red' }}`
- **THEN** the child's style SHALL be preserved unchanged

### Requirement: asChild coexists with `as` prop
The `asChild` and `as` props SHALL coexist. When both are provided, `asChild` SHALL take precedence and `as` SHALL be ignored.

#### Scenario: asChild takes precedence over as
- **WHEN** `<Button as="a" asChild><span>text</span></Button>` renders
- **THEN** the output SHALL be `<span class="...">text</span>` — `asChild` wins, `as="a"` is ignored

#### Scenario: as prop works normally without asChild
- **WHEN** `<Button as="a" href="/foo">Link</Button>` renders without asChild
- **THEN** the output SHALL be `<a href="/foo" class="...">Link</a>` — existing behavior unchanged

### Requirement: asChild with composed families
The `asChild` prop SHALL work on slots within composed families. Composed variant classes (from CSS cascade or context propagation) SHALL merge onto the child element.

#### Scenario: Composed slot with asChild
- **WHEN** `<Card.Header asChild><Link href="/x">Title</Link></Card.Header>` renders inside `<Card.Root density="compact">`
- **THEN** Card.Header's resolved className (including any composed variant classes) SHALL merge onto the Link element

### Requirement: asChild prop is not forwarded to DOM
The `asChild` prop SHALL be filtered from DOM prop forwarding, same as variant props and system props.

#### Scenario: asChild absent from DOM attributes
- **WHEN** any component renders with `asChild={true}`
- **THEN** the rendered DOM element SHALL NOT have an `asChild` attribute
