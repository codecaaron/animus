import type { ReactNode } from 'react';

import { compose } from '@animus-ui/system';

import { ds } from '../../ds';

const CalloutContainer = ds
  .styles({
    borderLeft: 3,
    borderRadius: '0 8px 8px 0',
    p: 16,
    my: 16,
  })
  .variant({
    prop: 'variant',
    defaultVariant: 'info',
    variants: {
      info: {
        borderLeftColor: 'ocean.500',
        bg: '{colors.ocean.500/6}',
      },
      tip: {
        borderLeftColor: 'forest.500',
        bg: '{colors.forest.500/6}',
      },
      warn: {
        borderLeftColor: 'gold.300',
        bg: '{colors.gold.300/6}',
      },
      danger: {
        borderLeftColor: 'fire.500',
        bg: '{colors.fire.500/6}',
      },
      deprecated: {
        borderLeftColor: 'violet.400',
        borderLeftStyle: 'dashed',
        bg: '{colors.violet.400/6}',
      },
    },
  })
  .asElement('div');

const CalloutHeader = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    mb: 6,
  })
  .asElement('div');

const CalloutIcon = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 14,
    fontWeight: 700,
  })
  .variant({
    prop: 'variant',
    defaultVariant: 'info',
    variants: {
      info: { color: 'ocean.500' },
      tip: { color: 'forest.500' },
      warn: { color: 'gold.300' },
      danger: { color: 'fire.500' },
      deprecated: { color: 'violet.400' },
    },
  })
  .asElement('span');

const CalloutTitle = ds
  .styles({
    fontFamily: 'display',
    fontSize: 13,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  })
  .variant({
    prop: 'variant',
    defaultVariant: 'info',
    variants: {
      info: { color: 'ocean.500' },
      tip: { color: 'forest.500' },
      warn: { color: 'gold.300' },
      danger: { color: 'fire.500' },
      deprecated: { color: 'violet.400' },
    },
  })
  .asElement('span');

const CalloutBody = ds
  .styles({
    fontFamily: 'body',
    fontSize: 14,
    lineHeight: 'base',
    color: 'text.muted',
  })
  .asElement('div');

// ─── Composed Family ────────────────────────────────────────────

const CalloutFamily = compose(
  {
    Root: CalloutContainer,
    Header: CalloutHeader,
    Icon: CalloutIcon,
    Title: CalloutTitle,
    Body: CalloutBody,
  },
  { shared: { variant: true } }
);

// ─── Convenience Wrapper ────────────────────────────────────────

const ICONS: Record<string, string> = {
  info: '\u2139',
  tip: '\u2192',
  warn: '\u26A0',
  danger: '\u2715',
  deprecated: '\u29B8',
};

type CalloutVariant = 'info' | 'tip' | 'warn' | 'danger' | 'deprecated';

export function Callout({
  variant = 'info',
  title,
  children,
}: {
  variant?: CalloutVariant;
  title?: string;
  children: ReactNode;
}) {
  return (
    <CalloutFamily.Root variant={variant}>
      {(title || ICONS[variant]) && (
        <CalloutFamily.Header>
          <CalloutFamily.Icon>{ICONS[variant]}</CalloutFamily.Icon>
          {title && <CalloutFamily.Title>{title}</CalloutFamily.Title>}
        </CalloutFamily.Header>
      )}
      <CalloutFamily.Body>{children}</CalloutFamily.Body>
    </CalloutFamily.Root>
  );
}
