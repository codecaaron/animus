## Purpose

Requirements for the `as-child-rendering` capability: asChild delegates rendering to the single child element; className merging with asChild; Ref composition with asChild; and 5 more.

## Requirements

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

### Requirement: Parent behavioral props forward to the child

When `asChild` is active, the parent's own non-Animus behavioral props (event handlers, `role`, `aria-*`, `data-*`, `id`, `tabIndex`, and so on) SHALL be forwarded to the child element through the SAME prop filter used on the normal element render path — variant props, system props, and `asChild` itself are filtered out exactly as they are for a rendered DOM element. `children`, `className`, `style`, and `ref` SHALL be EXCLUDED from this forwarding: each keeps its dedicated behavior (the child keeps its own children, and className / style / ref use the merge and composition rules defined above). On any key collision the CHILD's own prop SHALL win, consistent with "Child keeps its own props" — the parent's props are applied beneath the child's. Handler composition or chaining SHALL NOT be performed: a colliding handler is replaced, not called in sequence.

#### Scenario: Parent handler reaches a child that has none

- **WHEN** `<Button onClick={parentHandler} aria-label="Save" asChild><a href="/x">Save</a></Button>` renders and the child declares no `onClick`
- **THEN** the rendered `<a>` SHALL receive `onClick={parentHandler}` and `aria-label="Save"` alongside its own `href`

#### Scenario: Child handler wins over parent handler

- **WHEN** the parent has `onClick={parentHandler}` and the child element also declares `onClick={childHandler}`
- **THEN** the rendered element SHALL have `onClick={childHandler}` only — the child's prop replaces the parent's, and the two are NOT chained

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
