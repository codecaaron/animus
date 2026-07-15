// A user-owned config string that happens to contain the old import trigger.
// v2 must keep the value without importing the transforms registry.
export const LiteralTransformToken = ds
  .variant({
    prop: 'tone',
    variants: { red: { color: 'red' } },
    defaultVariant: 'transforms.',
  })
  .asElement('div');

export const App = () => <LiteralTransformToken tone="red" />;
