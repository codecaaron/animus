## Context

`compose()` was refactored in session 48 to use CSS-only shared variant propagation — two rules per shared variant option per child slot at specificity (0,3,0) within `@layer variants`. React context (createContext, Provider, useContext) was removed entirely. This works for all composed families where children render inside Root's DOM subtree.

Portal-mounted children (Radix Dialog.Content, Tooltip.Content, Popover.Content) render into `document.body` via `createPortal`, physically outside Root's DOM subtree. CSS descendant selectors (`.Root.Root--size-sm .Child`) cannot reach them. React context DOES cross portal boundaries. The portal fallback was deferred as no portal-using composed families existed.

Current code:
- `compose.ts`: 60 lines, thin `forwardRef` wrappers, no hooks, RSC-compatible
- `jsx_scanner.rs`: `ComposeFamilyInfo { root_binding, slots, shared_keys }` — no `context` field
- `transform_emitter.rs`: preserves existing `"use client"` directives but does not inject them
- `project_analyzer.rs`: threads `ComposeFamilyInfo` through reconciler and CSS generator

## Goals / Non-Goals

**Goals:**
- Opt-in React context propagation for composed families with portal-mounted slots
- Automatic `"use client"` directive injection when context mode requires it
- CSS two-rule emission unchanged — context is additive fallback, not replacement
- Minimal runtime cost for default (context-free) families — zero added code paths
- Type system accepts `context?: boolean` without affecting SharedConfig or ComposedFamily

**Non-Goals:**
- Changing default compose behavior — `context: false` is the default, no behavioral change for existing families
- Per-slot portal annotation — ALL children get context in `context: true` families (simplicity over precision)
- Runtime portal detection — no Intersection Observer or MutationObserver to detect portaling dynamically
- Stripping user-authored `"use client"` directives — only injection, never removal
- Context for non-variant shared state — only shared variant prop values flow through context

## Decisions

### 1. `context` as the option name

`context: true` rather than `client: true` or `portal: true`. It names the mechanism (React context propagation) rather than the deployment concern (RSC boundary) or the use case (portals). If context is ever needed for non-portal reasons, the name still fits. The deployment consequence (`"use client"`) is an automatic side effect, not the primary concern.

```typescript
compose(
  { Root: DialogRoot, Content: DialogContent },
  { shared: { size: true }, context: true }
)
```

### 2. Context passes shared prop VALUES, not className strings

Children receive shared variant prop values (e.g., `{ size: 'lg' }`) through context, not pre-resolved className strings. Each child's variant runtime resolves props to classes through its own `createComponent` config — the same resolution path as direct props. One code path, no special cases, no knowledge of child internals needed at the Root level.

The old compose (pre-session-48) used this exact approach. The difference: now it's opt-in.

### 3. Root wraps children in Provider, children merge context with own props

When `context: true`:
- Root creates a context value object containing only the shared prop values from its own props
- Root renders `<FamilyContext.Provider value={sharedValues}>{children}</FamilyContext.Provider>` inside its own output
- Each non-Root child calls `useContext(FamilyContext)`, spreads context values under its own direct props (direct props win via object spread ordering: `{ ...contextProps, ...directProps }`)

This means direct props on a child override context-provided values at the JS level, mirroring the CSS source-order override behavior for in-DOM children. Both mechanisms agree on semantics.

**Why Root wraps children, not the other way around:** The Provider must be INSIDE Root's rendered output (inside the component's DOM), not wrapping Root externally. Root renders its element, and the Provider wraps `props.children` within that element. This way portaled children (which are still React children even though they escape the DOM) receive the context.

### 4. Conditional context creation in compose.ts

compose.ts conditionally creates context machinery based on the `context` option:

```typescript
export function compose(slots, options) {
  const familyName = options.name ?? 'Composed';
  const useCtx = options.context ?? false;
  
  const FamilyCtx = useCtx ? createContext<Record<string, unknown>>({}) : null;
  const sharedKeySet = useCtx ? new Set(Object.keys(options.shared)) : null;

  for (const [name, Source] of Object.entries(slots)) {
    if (name === 'Root' && FamilyCtx && sharedKeySet) {
      // Root wrapper: extract shared props, provide via context
      const Wrapper = forwardRef((props, ref) => {
        const shared: Record<string, unknown> = {};
        for (const key of sharedKeySet) {
          if (key in props) shared[key] = props[key];
        }
        return createElement(Source, { ...props, ref },
          createElement(FamilyCtx.Provider, { value: shared }, props.children)
        );
      });
      // ...
    } else if (FamilyCtx) {
      // Child wrapper: read context, merge under direct props
      const Wrapper = forwardRef((props, ref) => {
        const inherited = useContext(FamilyCtx);
        return createElement(Source, { ...inherited, ...props, ref });
      });
      // ...
    } else {
      // Default: current thin wrapper, no hooks
    }
  }
}
```

When `context` is false/absent, the code path is identical to current — no createContext import, no hooks, no overhead. The conditional is evaluated once at compose() call time, not per render.

### 5. ComposeFamilyInfo gains `context: bool`

`jsx_scanner.rs` extracts `context: true/false` from the compose options AST alongside shared keys. The extraction logic mirrors `extract_shared_keys` — look for a `context` property in the options object, check if its value is `true`.

```rust
pub struct ComposeFamilyInfo {
    pub root_binding: String,
    pub slots: Vec<(String, String)>,
    pub shared_keys: Vec<String>,
    pub context: bool,  // NEW
}
```

The `context` field is consumed by:
1. `project_analyzer.rs` — threads it to transform_emitter for `"use client"` injection decisions
2. CSS generation is NOT affected — composed CSS rules are always emitted regardless of `context`

### 6. `"use client"` injection in transform_emitter

`apply_replacements` gains a `needs_use_client: bool` parameter. When true AND the source does not already start with `'use client'` or `"use client"`, the function prepends the directive.

The injection point is in `apply_replacements` at the existing directive-handling block (line 401-414). The current logic preserves existing directives. Extended logic:
1. If source already has `"use client"` → preserve it (existing behavior)
2. If source lacks directive AND `needs_use_client` is true → inject `'use client';\n` before import lines
3. If source lacks directive AND `needs_use_client` is false → no change (existing behavior)

`needs_use_client` is true when ANY compose family in the file has `context: true`. Determined by `project_analyzer.rs` when building the transform manifest for that file.

### 7. No directive stripping

The pipeline will NOT strip `"use client"` directives that the user added manually, even if no compose family needs context. Stripping is unsafe — the user may have `"use client"` for non-Animus reasons (other hooks, event handlers, browser APIs). Injection is safe because it's additive. Stripping is destructive.

## Risks / Trade-offs

- **[Risk] Children prop collision**: Context spreads shared props onto children. If a child has a non-variant prop with the same name as a shared key, context overwrites it. → **Mitigation**: Direct props win via spread ordering (`{ ...context, ...direct }`). Only shared VARIANT keys flow through context, and these are already variant props on the child by definition (enforced by SharedConfig type constraint).

- **[Risk] Provider adds a React tree node**: Root's children are wrapped in `<Provider>`. This adds one component to the React tree per family. → **Mitigation**: Acceptable — this is ONE node per family, only for `context: true` families. The pre-refactor compose had this for ALL families. Provider is a lightweight React primitive.

- **[Risk] `"use client"` injection surprises user**: Pipeline adds `"use client"` to a file the user expected to be server-rendered. → **Mitigation**: The user explicitly opted in by writing `context: true`. The directive is a direct consequence of their choice. If surprising, the connection is traceable.

- **[Trade-off] All children get context, not just portaled ones**: In a `context: true` family, every child reads useContext, even in-DOM children where CSS cascade already handles it. → **Accept**: The CSS rules still apply for in-DOM children and produce correct styles. The context read is redundant but harmless — it provides the same prop values the CSS cascade already handles. Selective per-slot annotation would add API complexity for negligible runtime savings.

- **[Trade-off] `context: true` families are not RSC-compatible**: useContext requires a client component. → **Accept**: This is inherent — portals are client-only by nature (createPortal requires DOM). Any file using portal-based headless primitives is already a client boundary.
