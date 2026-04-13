## Why

MDX prose containing inline code with nested backticks and `${expression}` syntax causes runtime `ReferenceError`. At `theming.mdx:358`, the MDX compiler interprets `` `Record<name, \`var(--${string})\`>` `` as a JavaScript template literal rather than markdown inline code, making `${string}` a live expression that references the undefined variable `string`.

## What Changes

- Replace the single problematic inline code span in `theming.mdx:358` with an explicit `<code>{'...'}</code>` JSX element that is unambiguous to the MDX compiler.

## Capabilities

### New Capabilities
- `mdx-safe-inline-code`: Pattern for rendering inline code in MDX prose when content contains backticks and template literal syntax (`${...}`). Use `<code>{'content'}</code>` instead of backtick delimiters.

### Modified Capabilities

(none)

## Impact

- `packages/showcase/src/content/architecture/theming.mdx` — single line change at line 358
- Fixes runtime crash on the theming docs page
