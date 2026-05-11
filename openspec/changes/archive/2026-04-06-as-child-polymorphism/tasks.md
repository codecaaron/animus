## 1. Runtime Implementation

- [x] 1.1 Add `composeRefs` utility function in `packages/system/src/runtime/index.ts` — merges two refs (callback or object) into a single callback ref
- [x] 1.2 Add `'asChild'` to the `filterProps` set in `createComponent`
- [x] 1.3 Add asChild rendering branch in `createComponent`: after `resolveClasses`, before `createElement` — when `props.asChild` is truthy, call `Children.only`, merge className/ref/style onto child via `cloneElement`
- [x] 1.4 Handle dynamic style merging in asChild path: merge `prevDynStyle` with child's existing `style` and parent's `props.style`

## 2. Type System

- [x] 2.1 Add `asChild?: boolean` to `AnimusConsumerProps` in `packages/system/src/types/component.ts`
- [x] 2.2 Add type test: `asChild={true}` accepted, `asChild="yes"` rejected (ts-expect-error)

## 3. Runtime Tests

- [x] 3.1 Test: asChild renders child element with parent's className merged
- [x] 3.2 Test: asChild preserves child's own props (href, onClick, etc.)
- [x] 3.3 Test: asChild merges className (parent classes + child className)
- [x] 3.4 Test: asChild throws on non-element children (string, fragment, multiple)
- [x] 3.5 Test: asChild with variant props — variant classes appear on child
- [x] 3.6 Test: asChild ignores `as` prop when both provided
- [x] 3.7 Test: without asChild, existing behavior unchanged (renders own element)

## 4. Showcase

- [x] 4.1 Add asChild example to Examples page — Button asChild with anchor, demonstrating type-safe polymorphism
