import type { ComponentProps } from 'react';

import { Alert, Badge, Button, ContainerCard } from '@animus-ui/test-ds';

import type { Assert, Equal } from '../../../system/__tests__/published/guards';
import type { referenceTokens } from '@animus-ui/test-ds';

// A kit's own declaration build prints its variant configs as
// `prop?: X | undefined`; a consumer with exactOptionalPropertyTypes still
// reads each axis's exact options.
type ReferenceTheme = typeof referenceTokens;

declare module '@animus-ui/system' {
  interface Theme extends ReferenceTheme {}
}

type AlertProps = ComponentProps<typeof Alert>;
type BadgeProps = ComponentProps<typeof Badge>;
type ButtonProps = ComponentProps<typeof Button>;
type CardRootProps = ComponentProps<typeof ContainerCard.Root>;
type CardMediaProps = ComponentProps<typeof ContainerCard.Media>;

export type _Axes = [
  Assert<Equal<AlertProps['variant'], 'filled' | 'outline' | undefined>>,
  Assert<
    Equal<AlertProps['intent'], 'info' | 'danger' | 'success' | undefined>
  >,
  Assert<Equal<BadgeProps['color'], 'neutral' | 'danger' | undefined>>,
  Assert<Equal<BadgeProps['disabled'], boolean | undefined>>,
  Assert<
    Equal<ButtonProps['variant'], 'primary' | 'secondary' | 'ghost' | undefined>
  >,
  Assert<Equal<CardRootProps['size'], 'md' | 'lg' | undefined>>,
  Assert<Equal<CardMediaProps['size'], 'md' | 'lg' | undefined>>,
];

// An extension the consumer writes on a kit component.
const LoudButton = Button.extend()
  .variant({ prop: 'tone', variants: { loud: {}, quiet: {} } })
  .asElement('button');
export type _Extended = [
  Assert<
    Equal<
      ComponentProps<typeof LoudButton>['tone'],
      'loud' | 'quiet' | undefined
    >
  >,
  Assert<
    Equal<
      ComponentProps<typeof LoudButton>['variant'],
      'primary' | 'secondary' | 'ghost' | undefined
    >
  >,
];

export const accepted = (
  <>
    <Alert variant="outline" intent="danger" />
    <Badge color="neutral" disabled />
    <Button variant="ghost" px={8} />
    <ContainerCard.Root size="lg">
      <ContainerCard.Media />
    </ContainerCard.Root>
    <LoudButton tone="loud" variant="primary" />
  </>
);

export const rejected = (
  <>
    {/* @ts-expect-error — the kit's axis keeps its options */}
    <Alert variant="ghost" />
    {/* @ts-expect-error — so does a compose member's */}
    <ContainerCard.Media size="xl" />
    {/* @ts-expect-error — and the consumer's own extension axis */}
    <LoudButton tone="medium" />
  </>
);
