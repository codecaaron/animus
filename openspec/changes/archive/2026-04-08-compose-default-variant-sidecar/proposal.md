## Why

When a compose child slot has `defaultVariant`, the parent's shared variant cannot override it. The root cause is a CSS specificity tie: the compose inheritance rule (`.Root.Root--var-opt .Child`, specificity 0,3,0) ties with the compose override rule for the child's default option (`.Root .Child.Child--var-default`, also 0,3,0). The override rule wins by source order, making the child's default always beat the parent's explicit setting. This makes `defaultVariant` on compose children effectively break slot inheritance.

## What Changes

- **Sidecar default class**: When a variant value comes from `defaultVariant` fallback (not an explicit prop), the runtime applies a dedicated `--{prop}-default` class instead of the option-specific variant class (e.g., `--density-default` instead of `--density-comfortable`). The extractor emits a sidecar CSS rule at specificity (0,1,0) carrying the default option's styles.
- **Compose specificity preserved**: Compose inheritance and override rules stay at (0,3,0). The sidecar class at (0,1,0) never competes — compose rules always win. Override rules only match when a child has an explicit variant prop, preserving the "explicit child override" semantic.
- **Runtime class resolution**: `resolveClasses()` distinguishes default-fallback from explicit prop and emits the appropriate class name.

## Capabilities

### New Capabilities

- `variant-default-sidecar`: Sidecar CSS class and runtime resolution for `defaultVariant` fallback values, preventing specificity conflicts with compose inheritance.

### Modified Capabilities

- `compose-css-propagation`: Compose inheritance now correctly overrides child `defaultVariant` classes. No rule shape change — the fix is in which class the child receives at runtime.
- `css-reconciler`: Reconciler must treat `--{prop}-default` as a used class for components with `defaultVariant`, ensuring the sidecar rule is not pruned.

## Impact

- **Rust crate** (`css_generator.rs`): Emit sidecar `--{prop}-default` rule when variant has `defaultVariant`
- **Rust crate** (`project_analyzer.rs`): Include default class info in component manifest for runtime consumption
- **Runtime** (`resolveClasses.ts`): Branch on default-vs-explicit when building variant class name
- **Runtime** (`createComponent` / transform emitter): Pass `defaultVariant` metadata through to runtime config
- **Canary tests**: New test for sidecar class emission and compose + defaultVariant interaction
