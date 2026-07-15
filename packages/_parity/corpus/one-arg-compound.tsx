// Review F1 witness: a one-arg .compound(cond) contributes NEITHER a
// runtime compound config NOR CSS, and the positional --compound-N
// index counts styled compounds only (v1 lib.rs 536-554).
export const Toggle = ds
  .variant({ prop: 'size', defaultVariant: 'sm', variants: { sm: {}, lg: {} } })
  .compound({ size: 'sm' })
  .compound({ size: 'lg' }, { p: 8 })
  .asElement('button');
export const App = () => <Toggle size="lg" />;
