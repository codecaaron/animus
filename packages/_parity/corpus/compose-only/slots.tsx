export const Root = ds.styles({ display: 'flex' }).asElement('div');
export const Body = ds.styles({ p: 8 }).asElement('div');
export const A = () => (
  <div>
    <Root />
    <Body />
  </div>
);
