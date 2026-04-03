## Context

`compose()` creates a sealed component family from independently-authored Animus components. Root provides shared variant values via React context; child slots consume from context with direct-prop override. The output is `ComposedFamily<Slots>` — a record of `ForwardRefExoticComponent` entries.

Current implementation: ~100 lines in `compose.ts`, types in `component.ts`. Integration tests in `_integration/__tests__/composition.test.ts`. The Rust extractor handles compose through the pipeline for slot CSS and shared variant analysis.

## Goals / Non-Goals

**Goals:**
- Eliminate the extra Provider wrapper element in the React tree
- Make Root convention explicit and literal (`"Root"` key only)
- Derive family name from slot keys, not fragile displayName parsing
- Ensure React keys propagate through forwardRef wrappers
- Keep compose() API signature unchanged: `compose(slots, { shared })` → `ComposedFamily`

**Non-Goals:**
- Changing the shared variant propagation model (context-based, Root provides, children consume)
- Adding new compose features (nested composition, dynamic slot injection, etc.)
- Modifying how the Rust extractor detects compose calls in the AST (if the wrapper structure change doesn't affect extraction, leave extractor alone)
- Changing the sealing behavior (composed output has no `.extend()`)

## Decisions

### D1: Fragment-based context injection via children wrapping

Instead of wrapping Root in a Provider element:
```jsx
// BEFORE: Provider → Root (extra element)
createElement(Provider, { value }, createElement(Source, props))

// AFTER: Root renders, children wrapped in Provider
createElement(Source, { ...props, children: createElement(Provider, { value }, props.children) })
```

Wait — this is wrong. Root's children ARE the composed children. The context needs to be available to child slots, not just Root's own children.

Better approach: Root's forwardRef wrapper renders Provider around the Source output:
```jsx
// Root wrapper
return createElement(Provider, { value: sharedValues },
  createElement(Source, { ...props, ref })
);
```

This is actually what we already have. The "extra element" IS the Provider — you can't provide context without a Provider element. The improvement is that the Provider should use a Fragment-like approach where it doesn't create a DOM node.

Actually, `Context.Provider` already doesn't create a DOM node. It's a React internal. The tree depth is Provider (no DOM) → Root (DOM). This is fine. The real issue was the perception of extra wrapping, but `Provider` is invisible in the DOM.

**Revised decision:** Keep the Provider wrapping pattern (it's correct — Provider doesn't create DOM nodes). Focus the redesign on the other three issues which are the real structural problems.

### D2: Strict `"Root"` key convention

Replace `name.toLowerCase() === 'root'` with `name === 'Root'` at runtime. Update `RootSlot` type from:
```typescript
type RootSlot<Slots> = {
  [K in keyof Slots]: Lowercase<K & string> extends 'root' ? Slots[K] : never;
}[keyof Slots];
```
To:
```typescript
type RootSlot<Slots> = 'Root' extends keyof Slots ? Slots['Root'] : never;
```

**Rationale:** Explicit convention is better than magic matching. `"Root"` is the natural PascalCase key for a component slot. Case-insensitive matching adds complexity without value — no consumer intentionally names a slot `"rOOt"`.

**Breaking:** `compose({ root: RootComp, ... })` no longer works. Must be `Root`.

### D3: Family name from first slot key or explicit option

Replace `rootSlot.displayName.replace(/[-_].*$/, '')` with derivation from slot keys:
- Family name = `"Root"` slot's source component displayName (before any extraction mangling), OR
- Simply use a stable generated name like `"ComposedFamily"` and let each slot have `Slot.displayName = "Family.SlotName"`

Better: accept an optional `name` in the options:
```typescript
compose(slots, { shared, name: 'Card' })
```
If not provided, derive from Root's displayName with a more robust regex that strips the `animus-` prefix and hash suffix but preserves the component name.

### D4: Key propagation verification

React keys on JSX elements (`<Root key="x">`) propagate through `forwardRef` automatically — the key stays on the outer wrapper, which is the element React tracks. This is already correct behavior. The concern may be about keys set INSIDE the wrapper via `createElement`.

Verify with a test case: rendering a list of composed Root components with keys should maintain React reconciliation identity.

## Risks / Trade-offs

- **[Breaking: lowercase root]** → Migration is a find-replace: `root:` → `Root:` in compose calls. Low risk in practice — most code already uses PascalCase for component slots.
- **[Provider is already DOM-invisible]** → The "extra element" concern resolves to a non-issue upon investigation. `Context.Provider` doesn't create DOM nodes. The redesign should not introduce a different context injection pattern just to eliminate an invisible wrapper.
- **[Extraction interaction]** → The Rust extractor reads AST structure for compose detection. If we change how compose() wraps components, the extractor's compose-related logic may need updating. Need to verify extraction still works after changes.
