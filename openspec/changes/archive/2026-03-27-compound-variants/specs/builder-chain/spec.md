## MODIFIED Requirements

### Requirement: Progressive type accumulation via 8 generic parameters
The builder chain SHALL maintain the current generic parameter count (7 after T removal). The `.compound()` method SHALL NOT add a new generic parameter — it returns `this` and stores compound data at the value level. The chain ordering SHALL be:

```
Animus<PR, GR>
  → AnimusWithBase<PR, GR, BaseStyles>
    → AnimusWithVariants<PR, GR, BS, Variants>
      → (compound() returns this — same class)
      → AnimusWithStates<PR, GR, BS, V, States>
        → AnimusWithSystem<PR, GR, BS, V, S, ActiveGroups>
          → AnimusWithAll<PR, GR, BS, V, S, AG, CustomProps>
```

#### Scenario: Type parameters carry style values
- **WHEN** a component is created via `ds.styles({ color: 'primary', p: 8 })`
- **THEN** the BaseStyles generic SHALL capture the specific prop types, and theme-aware types SHALL constrain `'primary'` to be a valid scale key

#### Scenario: Variant types accumulate across multiple calls
- **WHEN** `.variant()` is called multiple times in an extension chain
- **THEN** variant types SHALL merge, and theme-aware types SHALL be preserved across all variant type accumulations

#### Scenario: Compound does not increase type depth
- **WHEN** `.compound()` is called one or more times after `.variant()`
- **THEN** the returned type SHALL be the same `AnimusWithVariants` instance type — no additional generic parameter or class instantiation
