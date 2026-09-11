// A one-arg `.compound(cond)` contributes no runtime config and no CSS, and
// the positional `--compound-N` index counts styled compounds only.
export const Toggle = ds
  .variant({ prop: 'size', defaultVariant: 'sm', variants: { sm: {}, lg: {} } })
  .compound({ size: 'sm' })
  .compound({ size: 'lg' }, { p: 8 })
  .asElement('button');
export const App = () => <Toggle size="lg" />;
