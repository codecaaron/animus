## Context

The Rust extraction crate already generates detailed diagnostics:
- **Bail reasons**: `chain_walker.rs` sets `bail_reason: Option<String>` when a chain can't be extracted
- **Skip warnings**: `lib.rs` collects per-property skip warnings (variable reference, function call, template literal)

But these are thrown away at two levels:
1. `project_analyzer.rs:288` — `_skip_warnings` is discarded (underscore prefix)
2. The Vite plugin never reads bail/skip data from the manifest

Meanwhile, elimination warnings from the reconciler ARE always-on (line 780 of plugin). The pattern for surfacing diagnostics already exists — we just need to extend it to bail and skip warnings.

## Goals / Non-Goals

**Goals:**
- Bail and skip warnings visible in console by default (not verbose-gated)
- Structured diagnostic data in manifest (machine-readable)
- Same UX pattern as existing elimination warnings

**Non-Goals:**
- Making diagnostics suppressible via plugin option (Vite's `logLevel` handles this)
- Changing bail/skip behavior — just surfacing what already exists
- Source locations / line numbers (would require threading span info through manifest — future enhancement)

## Decisions

### 1. Manifest gains `diagnostics` array

```json
{
  "components": { ... },
  "report": { ... },
  "diagnostics": [
    { "file": "src/Button.tsx", "component": "Button", "kind": "skip", "message": "property 'color': variable reference (non-static)" },
    { "file": "src/Dynamic.tsx", "component": "DynamicBox", "kind": "bail", "message": "function call in style object" }
  ]
}
```

Kinds: `bail` (entire chain not extracted), `skip` (individual property skipped, component still partially extracted).

### 2. Plugin prints diagnostics same as elimination warnings

```typescript
const diagnostics = storedManifest.diagnostics || [];
for (const d of diagnostics) {
  if (d.kind === 'bail') {
    warn(`⚠ ${d.component} not extracted: ${d.message}`);
  } else if (d.kind === 'skip') {
    warn(`⚠ ${d.component}: skipped ${d.message}`);
  }
}
```

Always-on. Uses existing `warn()` helper. Printed during `buildStart` alongside elimination warnings.

### 3. Rust changes are minimal

In `project_analyzer.rs`: stop discarding skip warnings. Collect them alongside bail reasons into a `Vec<Diagnostic>` struct. Serialize into the manifest JSON.

The per-file `extract()` function in `lib.rs` already returns errors (including skip warnings). The project analyzer just needs to not throw them away.

## Risks / Trade-offs

**Warning fatigue** → A large codebase with many dynamic expressions could produce hundreds of skip warnings. → Mitigated: consumers can set Vite `logLevel: 'error'` to suppress. Could also add a summary line: `"N properties skipped across M components"` instead of per-property detail (verbose mode gets the detail).

**Manifest size increase** → Each diagnostic is a small JSON object. 100 diagnostics adds ~5KB to the manifest. → Negligible.
