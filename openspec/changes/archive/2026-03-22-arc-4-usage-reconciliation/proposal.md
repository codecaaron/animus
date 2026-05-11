## Why

Arcs 1-3 built the ENUMERATE phase of the Finite Style Machine: the manifest contains every component, every variant option, every state, every utility class. But it emits CSS for ALL of them — including variants and states that are never used at any JSX callsite. Census of the doc site reveals 62% of variant and state CSS rules are dead code (28 of 45 rules defined but never activated). At production scale, design systems with hundreds of variant options would carry even more dead weight.

The Finite Style Machine's power is that the universe of styles is provably finite and enumerable. This means we can also provably determine the USED subset. The transact/reconcile model scans all JSX callsites, builds a usage ledger of which variant values and state names are actually activated, and eliminates CSS rules for everything that isn't. The result is a stylesheet that contains exactly the CSS the application needs — no more.

## What Changes

- **JSX usage scanner extended**: Beyond system prop values (Arc 2), the scanner now tracks variant prop values (`variant="fill"`), state prop activations (`loading`, `active`), and component-level usage (was this component rendered at all).
- **Usage ledger (new)**: A data structure mapping each component to its used variant options, used state names, and whether it's rendered. Built from scanning all files in the project.
- **CSS reconciliation (new)**: A phase in the project analyzer that filters ComponentCss based on the usage ledger before CSS generation. Unused variant option rules, unused state rules, and entire unused components are eliminated.
- **Extraction report (new)**: The manifest gains a `report` field summarizing what was extracted, what was eliminated, and what bailed. This is the developer's verification tool for understanding what the pipeline did.
- **Default variant awareness**: The scanner detects when a component is rendered WITHOUT an explicit variant prop, implicitly transacting IN the default variant option.

## Capabilities

### New Capabilities
- `usage-ledger`: Tracks which variant values, state names, and components are used at JSX callsites across the project. Handles default variants (implicit transaction) and dynamic state values (presence = used).
- `css-reconciler`: Filters the manifest's CSS output to eliminate rules for unused variant options, unused states, and entirely unused components. Produces the reconciled (minimal) CSS.
- `extraction-report`: Generates a structured report of extraction results: components extracted vs bailed, variant/state rules kept vs eliminated, CSS size before vs after reconciliation.

### Modified Capabilities
- `jsx-system-prop-scanner`: Extended to also collect variant prop values, state prop activations, and component render tracking alongside existing system prop value collection.
- `project-analyzer`: Gains a reconciliation phase between chain evaluation and CSS generation. The manifest includes usage data and extraction report.
- `rust-extraction-pipeline`: `analyze_project` return value (manifest) gains `usage` and `report` fields.

## Impact

- **`packages/extract/src/jsx_scanner.rs`**: Extended output types to include variant/state/component usage alongside system prop usages.
- **`packages/extract/src/project_analyzer.rs`**: New reconciliation phase. Manifest struct gains `usage` and `report` fields.
- **`packages/extract/src/css_generator.rs`**: No changes — reconciliation filters ComponentCss BEFORE passing to the generator.
- **`packages/extract/src/lib.rs`**: Manifest serialization includes usage and report data.
- **`packages/extract/tests/`**: New fixtures exercising dead variant elimination, Layer 4 concentric snapshot.
- **No changes to runtime shim or Vite plugin**: Reconciliation is purely a build-time optimization within the Rust pipeline.
