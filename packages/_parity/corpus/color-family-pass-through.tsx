// ANI-009 witness: raw CSS color-property names resolve semantic tokens via
// COLOR_FAMILY_PASS_THROUGH — the DS registers `bg`, not `backgroundColor`,
// yet the longhand must reach the colors scale at top level and in
// responsive slots, while non-token values pass through literally.
export const PassThrough = ds
  .styles({
    backgroundColor: 'primary',
    borderTopColor: 'rgb(1 2 3)',
    color: { _: 'primary', sm: 'secondary' },
  })
  .asElement('section');

export const App = () => <PassThrough />;
