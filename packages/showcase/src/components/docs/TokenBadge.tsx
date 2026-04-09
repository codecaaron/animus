import type { ComponentProps } from 'react';

import { ds } from '../../ds';

const TokenBadgeBase = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    px: 10,
    py: 2,
    fontSize: 12,
    fontFamily: 'mono',
    lineHeight: 'snug',
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
    border: 1,
  })
  .variant({
    prop: 'variant',
    defaultVariant: 'method',
    variants: {
      method: {
        bg: '{colors.fire.500/12}',
        borderColor: '{colors.fire.700}',
        color: '{colors.fire.500}',
      },
      layer: {
        bg: '{colors.forest.500/12}',
        borderColor: '{colors.forest.700}',
        color: '{colors.forest.500}',
      },
      type: {
        bg: '{colors.violet.400/12}',
        borderColor: '{colors.violet.700}',
        color: '{colors.violet.400}',
      },
      prop: {
        bg: '{colors.gold.300/12}',
        borderColor: '{colors.gold.700}',
        color: '{colors.gold.300}',
      },
      tag: {
        bg: '{colors.ocean.500/12}',
        borderColor: '{colors.ocean.700}',
        color: '{colors.ocean.500}',
      },
      danger: {
        bg: '{colors.fire.500/8}',
        borderColor: '{colors.fire.700}',
        color: '{colors.fire.500}',
      },
      success: {
        bg: '{colors.forest.500/8}',
        borderColor: '{colors.forest.700}',
        color: '{colors.forest.500}',
      },
    },
  })
  .asElement('span');

type TokenBadgeVariant =
  | 'method'
  | 'layer'
  | 'type'
  | 'prop'
  | 'tag'
  | 'danger'
  | 'success';

export function TokenBadge({
  variant = 'method',
  children,
  ...props
}: {
  variant?: TokenBadgeVariant;
  children: React.ReactNode;
} & Omit<ComponentProps<typeof TokenBadgeBase>, 'variant'>) {
  return (
    <TokenBadgeBase variant={variant} {...props}>
      {children}
    </TokenBadgeBase>
  );
}
