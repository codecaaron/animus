import { compose } from '@animus-ui/system';

import { ds } from '../system';

const ContainerCardRoot = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    p: 16,
    borderRadius: '8px',
    bg: 'surface',
    color: 'text',
    containerType: 'inline-size',
    containerName: 'card',
  })
  .variant({
    prop: 'size',
    defaultVariant: 'md',
    variants: {
      md: {},
      lg: { p: 24 },
    },
  })
  .asElement('article');

const ContainerCardMedia = ds
  .styles({
    display: 'block',
    width: '100%',
    minHeight: '64px',
    borderRadius: '4px',
    background: 'var(--current-bg)',
    '@container card (min-width: 400px)': {
      minHeight: '120px',
      width: '50cqw',
    },
  })
  .variant({
    prop: 'size',
    defaultVariant: 'md',
    variants: {
      md: {},
      lg: {},
    },
  })
  .asElement('div');

const ContainerCardBody = ds
  .styles({
    fontSize: 14,
    lineHeight: '1.5',
    color: 'text',
    '@container card (min-width: 400px)': {
      fontSize: 16,
    },
  })
  .asElement('div');

export const ContainerCard = compose(
  {
    Root: ContainerCardRoot,
    Media: ContainerCardMedia,
    Body: ContainerCardBody,
  },
  { shared: { size: true }, name: 'ContainerCard' }
);
