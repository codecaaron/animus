# createTransform()

`createTransform(name: string, fn: TransformFn): NamedTransform`

Registers a named value transform applied during extraction. The function runs in the subprocess and the result is written as a static CSS value.

| Type | Definition |
|------|------------|
| `TransformFn` | `(value: string \| number, property?: string, props?: AbstractProps) => string \| number \| CSSObject` |

```typescript
import { createTransform } from '@animus-ui/system';

// Usage: fontSize: fluid(16) → clamp(16px, 1.5vw, 24px)
export const fluid = createTransform('fluid', (value) => {
  const min = Number(value);
  const max = Math.round(min * 1.5);
  return `clamp(${min}px, ${(min / 16).toFixed(3)}vw * 10, ${max}px)`;
});

// Register it on a prop:
// props.addGroup('text', { fontSize: { property: 'fontSize', transform: fluid } })
```
