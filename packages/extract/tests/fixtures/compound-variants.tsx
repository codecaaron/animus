import { ds } from '../test-system';

export const CompoundBtn = ds
  .styles({
    display: 'inline-flex',
  })
  .variant({
    prop: 'size',
    variants: {
      sm: { fontSize: 14 },
      lg: { fontSize: 18 },
    },
  })
  .variant({
    variants: {
      fill: { fontWeight: 700 },
      ghost: { fontWeight: 400 },
    },
  })
  .compound({ size: 'sm', variant: 'ghost' }, { fontSize: 14 })
  .compound({ size: 'lg', variant: 'fill' }, { fontSize: 26 })
  .asElement('button');

// Array condition: match when variant is 'fill' OR 'ghost'
export const CompoundArrayBtn = ds
  .styles({
    display: 'inline-flex',
  })
  .variant({
    prop: 'size',
    variants: {
      sm: { fontSize: 14 },
      lg: { fontSize: 18 },
    },
  })
  .variant({
    variants: {
      fill: { fontWeight: 700 },
      ghost: { fontWeight: 400 },
    },
  })
  .compound({ variant: ['fill', 'ghost'], size: 'sm' }, { letterSpacing: '2px' })
  .asElement('button');

export const App = () => (
  <>
    <CompoundBtn size="sm" variant="ghost" />
    <CompoundArrayBtn size="sm" variant="fill" />
  </>
);
