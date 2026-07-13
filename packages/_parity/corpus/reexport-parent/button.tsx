export const Button = ds
  .variant({ prop: 'size', defaultVariant: 'sm', variants: { sm: { p: 4 }, lg: { p: 8 } } })
  .asElement('button');
export const A = () => <Button />;
