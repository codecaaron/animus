## REMOVED Requirements

### Requirement: Transform placeholder resolution
**Reason:** The `resolveTransformPlaceholders` function and `__TRANSFORM__{name}__{value}__` protocol are eliminated. Transform functions are evaluated in-process by the Rust extraction crate via boa_engine. CSS values are fully resolved before leaving Rust — no placeholder patterns exist in the output CSS.
**Migration:** No consumer or plugin action needed. The bin file subprocess, SPLIT_MARKER protocol, and transform placeholder regex are all internal implementation details removed together. Plugins receive fully resolved CSS from the Rust manifest.
