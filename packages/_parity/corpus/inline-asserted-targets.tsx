// ANI-015 witness: inline type assertions on terminal targets extract
// exactly like their bare forms — the walker unwraps as/satisfies/non-null
// wrappers and the emitter compiles the unwrapped identifier or tag, never
// a placeholder (`createComponent(unknown, …)` was a browser ReferenceError
// before the chain_walk fix).
const Plain = (props: { className?: string }) => <a {...props} />;

export const AssertedBox = ds
  .styles({ display: 'flex', p: 8 })
  .asElement('div' as const);

export const AssertedLink = ds
  .styles({ fontWeight: 600 })
  .asComponent(Plain as typeof Plain);

export const App = () => (
  <AssertedBox>
    <AssertedLink />
  </AssertedBox>
);
