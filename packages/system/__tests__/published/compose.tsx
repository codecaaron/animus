import type { ComponentProps } from 'react';

import { compose } from '@animus-ui/system';

import { ds } from './kit';

import type { Assert, Equal, IsAny } from './guards';

const Root = ds
  .styles({ display: 'flex' })
  .variant({
    prop: 'size',
    defaultVariant: 'md',
    variants: { sm: {}, md: {}, lg: {} },
  })
  .variant({ prop: 'tone', variants: { calm: {}, loud: {} } })
  .asElement('div');
const Item = ds
  .styles({ display: 'block' })
  .variant({
    prop: 'size',
    defaultVariant: 'md',
    variants: { sm: {}, md: {}, lg: {} },
  })
  .system({ space: true })
  .asElement('span');

const Family = compose({ Root, Item }, { shared: { size: true } });

type RootProps = ComponentProps<typeof Family.Root>;
type ItemProps = ComponentProps<typeof Family.Item>;

export type _Members = [
  Assert<Equal<IsAny<RootProps>, false>>,
  Assert<Equal<IsAny<ItemProps>, false>>,
  Assert<Equal<RootProps['size'], 'sm' | 'md' | 'lg' | undefined>>,
  Assert<Equal<RootProps['tone'], 'calm' | 'loud' | undefined>>,
  Assert<Equal<ItemProps['size'], 'sm' | 'md' | 'lg' | undefined>>,
  Assert<Equal<ItemProps['className'], string | undefined>>,
  Assert<Equal<'p' extends keyof ItemProps ? true : false, true>>,
];

declare const maybeSize: 'sm' | 'lg' | undefined;

export const accepted = (
  <Family.Root size="lg" tone="calm">
    <Family.Item size={maybeSize} p={4} />
  </Family.Root>
);

export const rejected = (
  <>
    {/* @ts-expect-error — a member keeps its options */}
    <Family.Item size="xl" />
    {/* @ts-expect-error — Root's own axis stays Root's */}
    <Family.Item tone="calm" />
  </>
);

// @ts-expect-error — a composed member is sealed
export const sealed = Family.Root.extend;

// @ts-expect-error — shared names a Root variant axis
export const badShared = compose({ Root, Item }, { shared: { p: true } });
