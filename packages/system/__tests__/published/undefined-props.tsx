import { compose } from '@animus-ui/system';

import { ds } from './kit';

import type { Assert, Equal } from './guards';
import type { VariantPropsOf } from '@animus-ui/system';

// A wrapper forwarding its own optional props: an explicit `undefined`
// is a prop left out, in both configs.
const Button = ds
  .styles({})
  .variant({ prop: 'size', defaultVariant: 'md', variants: { sm: {}, md: {} } })
  .states({ busy: {} })
  .system({ space: true, look: true })
  .asElement('button');
const Item = ds
  .styles({})
  .variant({ prop: 'size', defaultVariant: 'md', variants: { sm: {}, md: {} } })
  .asElement('span');
const Family = compose({ Root: Button, Item }, { shared: { size: true } });

interface WrapperProps {
  size?: 'sm' | 'md' | undefined;
  busy?: boolean | undefined;
  space?: 4 | 8 | undefined;
  look?: 'loud' | 'calm' | undefined;
}

export const Wrapper = ({ size, busy, space, look }: WrapperProps) => (
  <Family.Root size={size}>
    <Button size={size} busy={busy} p={space} />
    <Button m={{ _: space, sm: space, md: space }} />
    <Button _hover={space === undefined ? undefined : { p: space }} />
    <Button look={look} />
    <Button look={{ _: look, sm: look }} />
    <Family.Item size={size} />
  </Family.Root>
);

export type _VariantPropsOf = Assert<
  Equal<VariantPropsOf<typeof Button>, { size?: 'sm' | 'md' | undefined }>
>;

export const rejected = (
  <>
    {/* @ts-expect-error — only undefined is new: options stay closed */}
    <Button size="lg" />
    {/* @ts-expect-error — states stay boolean */}
    <Button busy="yes" />
    {/* @ts-expect-error — a declaration prop keeps its keys */}
    <Button look="quiet" />
    {/* @ts-expect-error — at every breakpoint */}
    <Button look={{ _: 'quiet' }} />
  </>
);
