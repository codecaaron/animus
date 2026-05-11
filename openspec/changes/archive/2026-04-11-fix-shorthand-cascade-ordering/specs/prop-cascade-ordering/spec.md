## ADDED Requirements

### Requirement: Shorthand props emit before longhand props
The style resolver SHALL sort DS props by cascade tier before generating CSS declarations. Props whose `property` field matches a CSS shorthand (e.g., `padding`, `margin`, `border`) SHALL emit before props targeting individual longhands (e.g., `paddingLeft`, `marginRight`).

#### Scenario: px before pl in base styles
- **WHEN** a component's base styles contain `{ px: 3, pl: 8 }`
- **THEN** the emitted CSS SHALL contain `padding-left` from `px` before `padding-left` from `pl`, so `pl`'s value wins by cascade

#### Scenario: p before px before pl
- **WHEN** a component's base styles contain `{ pl: 8, px: 3, p: 2 }` in any source order
- **THEN** the emitted CSS SHALL order declarations as: `p`'s `padding` first, then `px`'s `padding-left` + `padding-right`, then `pl`'s `padding-left` — most general to most specific

#### Scenario: margin shorthands follow same ordering
- **WHEN** a component's base styles contain `{ ml: 4, mx: 2 }`
- **THEN** the emitted CSS SHALL contain `mx`'s `margin-left` before `ml`'s `margin-left`

### Requirement: Cascade ordering applies to all style contexts
The cascade-tier sorting SHALL apply uniformly across all style resolution contexts, not only base styles.

#### Scenario: Ordering in pseudo-selector blocks
- **WHEN** a pseudo-selector block (e.g., `_hover`) contains `{ px: 3, pl: 8 }`
- **THEN** the emitted CSS within that pseudo-selector SHALL order `px` before `pl`

#### Scenario: Ordering in variant styles
- **WHEN** a variant style object contains shorthand and longhand props for the same CSS property family
- **THEN** the shorthand prop's declarations SHALL emit before the longhand prop's declarations

### Requirement: Source order preserved within cascade tiers
Within the same cascade tier, props SHALL maintain their source definition order as a tiebreaker.

#### Scenario: Two longhands preserve source order
- **WHEN** a style object contains `{ pl: 8, pr: 4 }` (both tier-2 longhands)
- **THEN** `padding-left` SHALL emit before `padding-right`, matching source order

#### Scenario: Two multi-target shorthands preserve source order
- **WHEN** a style object contains `{ py: 2, px: 3 }` (both tier-1 multi-target)
- **THEN** `py`'s declarations SHALL emit before `px`'s declarations, matching source order

### Requirement: JSON object key ordering uses insertion order
The `serde_json` dependency SHALL use the `preserve_order` feature so that `serde_json::Map` uses `IndexMap` (insertion-ordered) instead of `BTreeMap` (alphabetical).

#### Scenario: Style evaluator preserves AST source order
- **WHEN** the style evaluator converts `{ px: 3, py: 2, pl: 8 }` from AST to `serde_json::Value`
- **THEN** iterating the resulting object's keys SHALL yield `px`, `py`, `pl` in that order (not alphabetical `pl`, `px`, `py`)
