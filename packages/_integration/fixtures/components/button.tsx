import { ds } from '../setup';

export const Button = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontWeight: 600,
    lineHeight: 'tight',
  })
  .variant({
    prop: 'size',
    variants: {
      small: { fontSize: 14, px: 8, py: 4 },
      medium: { fontSize: 16, px: 16, py: 8 },
      large: { fontSize: 20, px: 24, py: 16 },
    },
  })
  .variant({
    prop: 'intent',
    variants: {
      primary: { bg: 'primary', color: 'background' },
      secondary: { bg: 'secondary', color: 'background' },
      danger: { bg: 'danger', color: 'background' },
    },
  })
  .states({
    hover: { opacity: 0.9 },
    disabled: { opacity: 0.5, cursor: 'not-allowed' },
  })
  .asElement('button');

export const App = () => <Button size="medium" intent="primary" />;
