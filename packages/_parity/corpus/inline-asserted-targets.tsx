// Inline `as`/`satisfies`/non-null wrappers on a chain target must extract
// exactly like the bare form; a placeholder target throws in the browser.
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
