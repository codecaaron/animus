import type { ComponentProps } from 'react';

import { ds } from '../../ds';

const ListBase = ds
  .styles({
    fontFamily: 'body',
    fontSize: 16,
    lineHeight: 'relaxed',
    color: 'text-muted',
    pl: 24,
    m: 0,
    mb: 16,
  })
  .variant({
    prop: 'kind',
    variants: {
      unordered: { listStyle: 'none' },
      ordered: { listStyle: 'decimal' },
    },
    defaultVariant: 'unordered',
  })
  .groups({ space: true, text: true })
  .asElement('ul');

export const ListItem = ds
  .styles({
    mb: 8,
    position: 'relative',
    '&::before': {
      content: '"—"',
      color: 'primary',
      position: 'absolute',
      left: '-24px',
    },
  })
  .asElement('li');

export const OrderedListItem = ds
  .styles({
    mb: 8,
    '&::marker': { color: 'primary' },
  })
  .asElement('li');

type ListProps = Omit<ComponentProps<typeof ListBase>, 'kind'> & {
  kind?: 'ordered' | 'unordered';
};

export function List({ kind = 'unordered', children, ...props }: ListProps) {
  const element = kind === 'ordered' ? 'ol' : 'ul';
  return (
    <ListBase kind={kind} as={element} {...props}>
      {children}
    </ListBase>
  );
}
