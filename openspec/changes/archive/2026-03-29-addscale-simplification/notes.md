## Related: `--current-bg` local CSS variable

Not part of addScale, but surfaced during this discussion and needs capturing.

### The Pattern

The original core had a provision where any time `bg` / `backgroundColor` is set on a component, the system also emits a local CSS variable `--current-bg` (or similar) set to the same resolved value.

```css
/* When bg: 'surface' is set */
.animus-Card-abc {
  background: var(--color-surface);
  --current-bg: var(--color-surface);  /* auto-emitted */
}
```

### Why It Matters

The variable cascades through the DOM. Any child component can reference `var(--current-bg)` to know what background it's sitting on — without prop drilling or context.

Use cases:
- **Overlay transparency:** `border-color: color-mix(in srgb, var(--current-bg) 80%, transparent)`
- **Scrollbar matching:** scrollbar track color matches the nearest ancestor's background
- **Seamless borders:** borders that blend with the background rather than contrast
- **Focus rings:** outline-offset backgrounds that match the surface beneath

### Status

Believed to be in the original `@animus-ui/core` but NOT preserved in the `@animus-ui/system` extraction pipeline. Needs investigation:
1. Check if `core` had this behavior
2. Determine where it should live in the extraction pipeline (CSS generator? prop group definition?)
3. The prop group `bg` entry could have a `sideEffect` that also emits the CSS variable declaration
