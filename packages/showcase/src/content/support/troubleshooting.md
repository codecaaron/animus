# Troubleshooting & Debugging

## Reading class names

Generated class names follow a predictable pattern:

```
.animus-Card-x3k9f              <- base styles
.animus-Card-x3k9f--size-lg     <- variant: size="lg"
.animus-Card-x3k9f--disabled    <- state: disabled={true}
.animus-Card-x3k9f--compound-0  <- first compound condition
.animus-u-a1b2c3d4              <- system prop utility class
```

In devtools, the class list on an element tells you exactly which variants, states, and system props are active. Class names are derived from the component's file path and export name, not from style values -- changing a style doesn't change the class name.

## Identifying cascade layers

Open the Styles panel in Chrome or Firefox devtools. Each rule shows its `@layer`:

```
@layer base        -> .styles() output
@layer variants    -> .variant() output
@layer compounds   -> .compound() output
@layer states      -> .states() output
@layer system      -> .system() runtime props
@layer custom      -> .props() output
```

If a style isn't applying, check whether a later layer is overriding it. A state always beats a variant regardless of selector specificity -- that's the layer order, not a bug.

## Non-static values

When the extraction pipeline encounters a non-static value in `.styles()` (a variable, function call, or ternary), it skips that property and continues extracting the rest. Skipped properties are reported as warnings in the terminal, not build errors. The component still works -- only the dynamic property falls back to runtime handling.

### What causes per-property skips

These patterns inside `.styles()`, `.variant()`, `.states()`, or `.compound()` cause the individual property to be skipped:

| Pattern | Example | Reason |
|---------|---------|--------|
| Variable reference | `{ color: themeColor }` | Can't statically resolve an identifier |
| Function call | `{ bg: getColor('primary') }` | Return value unknown at build time |
| Template literal with expressions | `` { animation: `${name} 5s` } `` | Embedded expression is non-static |
| Member expression | `{ color: theme.colors.primary }` | Object property access can't be resolved |
| Arrow function (non-transform) | `{ scale: (v) => v * 2 }` | Functions aren't CSS values |

In each case, the rest of the style object is still extracted. The skipped property becomes a runtime-only style.

### What causes full object bails

These patterns bail the entire style object -- nothing is extracted:

| Pattern | Example | Reason |
|---------|---------|--------|
| Spread element | `{ ...baseStyles, color: 'red' }` | Can't statically enumerate spread keys |
| Computed property key | `{ [dynamicKey]: 'red' }` | Key is not statically known |
| Getter / setter | `{ get color() { return 'red' } }` | Not a static property |

### Terminal warnings

The Vite plugin reports extraction issues as always-on warnings (no `verbose` flag needed):

```
⚠ Card not extracted: spread element in style object
⚠ Button: skipped color (variable reference (non-static))
```

Bail warnings (`not extracted`) mean the entire component fell back to runtime. Skip warnings (`skipped property`) mean partial extraction -- most styles were extracted, one property wasn't.

### How to restructure

If extraction bails on a pattern you're using, restructure to keep values static:

```typescript
// ✗ Bails: spread merges an unknown object
const Card = ds.styles({ ...shared, p: 16 }).asElement('div');

// ✓ Extracts: define shared styles in .styles(), override with .extend()
const Base = ds.styles({ display: 'flex', bg: 'surface' }).asElement('div');
const Card = Base.extend().styles({ p: 16 }).asElement('div');
```

```typescript
// ✗ Skips color: variable reference
const Tag = ds.styles({ color: colorMap[type], p: 4 }).asElement('span');

// ✓ Extracts: use a variant instead
const Tag = ds
  .styles({ p: 4 })
  .variant({
    prop: 'type',
    variants: {
      info: { color: 'blue.500' },
      warn: { color: 'gold.500' },
      error: { color: 'red.500' },
    },
  })
  .asElement('span');
```

## Class name stability

Class names are derived from the file path and export binding name (`filename::binding`), not from style values. Editing a style value doesn't change the class name. This means:

- Snapshot tests remain stable through style changes
- HMR can match old and new CSS to the same DOM elements
- Only renaming the binding or moving the file changes the hash

## Common issues

| Symptom | Fix |
|---------|-----|
| Styles not updating in dev | Restart the dev server. The Vite plugin evaluates your system at `buildStart` and holds results in memory. |
| Token ref showing as raw text | The extraction transform failed. Check terminal output for `__TRANSFORM__` placeholder warnings. |
| System prop not resolving | Verify the component calls `.system({ groupName: true })` for the group containing the prop. |
| Stale transforms after pipeline changes | Run `bun run clean:light` to clear the Vite cache (`node_modules/.vite/`). |
| NAPI errors or wrong arity | Rebuild the Rust crate: `bun run rebuild`. |
| CSS present but styles missing in browser | Check that `virtual:animus/styles.css` is imported in your entry file and visible in devtools. |
