// ANI-015 witness: inline type assertions on terminal targets extract
// exactly like their bare forms — the walker unwraps as/satisfies/non-null
// wrappers and the emitter compiles the unwrapped identifier or tag, never
// a placeholder (`createComponent(unknown, …)` was a browser ReferenceError
// before the chain_walk fix).
const Plain = (props: { className?: string }) => <span {...props} />;

export const AssertedBox = ds
  .styles({ display: 'flex', p: 8 })
  .asElement('div' as const);

export const AssertedLink = ds
  .styles({ fontWeight: 600 })
  .asComponent(Plain as typeof Plain);

const Item = ds.styles({ padding: '4px' }).asElement('i');
export const Compound = { Item };

export const MemberWrapped = ds
  .styles({ display: 'inline-grid' })
  .asComponent(Compound.Item as unknown as typeof Compound.Item);

export const App = () => (
  <AssertedBox>
    <AssertedLink />
    <MemberWrapped />
  </AssertedBox>
);
