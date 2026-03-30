import { ds } from '../setup';

export const Badge = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: 4,
  })
  .variant({
    prop: 'size',
    variants: {
      small: { fontSize: 14, px: 4, py: 0 },
      large: { fontSize: 16, px: 8, py: 4 },
    },
  })
  .variant({
    prop: 'intent',
    variants: {
      info: { bg: 'primary', color: 'background' },
      danger: { bg: 'danger', color: 'background' },
    },
  })
  .compound({ size: 'small', intent: 'danger' }, { fontWeight: 700 })
  .compound({ size: 'large', intent: 'info' }, { borderRadius: 8 })
  .asElement('span');

export const App = () => (
  <>
    <Badge size="small" intent="danger" />
    <Badge size="large" intent="info" />
  </>
);
