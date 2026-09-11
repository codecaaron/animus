// The system registers `bg`, not `backgroundColor`: unregistered color
// longhands must still reach the colors scale, and non-tokens stay literal.
export const PassThrough = ds
  .styles({
    backgroundColor: 'primary',
    borderTopColor: 'rgb(1 2 3)',
    color: { _: 'primary', sm: 'secondary' },
  })
  .asElement('section');

export const App = () => <PassThrough />;
