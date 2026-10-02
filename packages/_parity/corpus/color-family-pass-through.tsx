// The system registers `bg`, not `backgroundColor`: unregistered color
// longhands such as `backgroundColor` and `outlineColor` must still reach the
// colors scale, and non-tokens on them stay literal.
export const PassThrough = ds
  .styles({
    backgroundColor: 'primary',
    outlineColor: 'rgb(1 2 3)',
    color: { _: 'primary', sm: 'secondary' },
  })
  .asElement('section');

export const App = () => <PassThrough />;
