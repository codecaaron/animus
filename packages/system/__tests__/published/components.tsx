import { forwardRef } from 'react';
import type {
  ComponentProps,
  ComponentPropsWithRef,
  ComponentPropsWithoutRef,
  ForwardRefExoticComponent,
  ReactNode,
  RefAttributes,
  RefObject,
} from 'react';

import { compose } from '@animus-ui/system';

import { ds } from './kit';

import type { Assert, Equal, IsAny } from './guards';

const Button = ds
  .styles({ display: 'inline-flex' })
  .variant({ prop: 'size', variants: { sm: {}, lg: {} } })
  .asElement('button');

interface LabelProps {
  label: string;
  tone?: 'info' | 'warn' | undefined;
  className?: string | undefined;
}
const Label = forwardRef<HTMLSpanElement, LabelProps>(function Label(
  { label, className },
  ref
) {
  return (
    <span ref={ref} className={className}>
      {label}
    </span>
  );
});
const Badge = ds
  .styles({ display: 'inline-block' })
  .variant({ prop: 'size', variants: { sm: {}, lg: {} } })
  .system({ space: true })
  .asComponent(Label);

type ButtonProps = ComponentPropsWithRef<typeof Button>;
type BadgeProps = ComponentProps<typeof Badge>;

// A terminal keeps its element's own props and ref, and adds what the builder
// admitted.
export type _Element = [
  Assert<Equal<IsAny<ButtonProps>, false>>,
  Assert<Equal<ButtonProps['type'], 'submit' | 'reset' | 'button' | undefined>>,
  Assert<Equal<ButtonProps['size'], 'sm' | 'lg' | undefined>>,
  Assert<Equal<ButtonProps['asChild'], boolean | undefined>>,
  Assert<
    RefObject<HTMLButtonElement | null> extends NonNullable<ButtonProps['ref']>
      ? true
      : false
  >,
];

// A wrapped component keeps its own props exactly, beside the admitted ones.
export type _Wrapped = [
  Assert<Equal<IsAny<BadgeProps>, false>>,
  Assert<Equal<BadgeProps['label'], string>>,
  Assert<Equal<BadgeProps['tone'], 'info' | 'warn' | undefined>>,
  Assert<Equal<BadgeProps['size'], 'sm' | 'lg' | undefined>>,
  Assert<Equal<'p' extends keyof BadgeProps ? true : false, true>>,
];

declare const maybeClass: string | undefined;
declare const maybeChild: boolean | undefined;
declare const maybeTag: 'a' | undefined;

export const accepted = (
  <>
    <Button as="a" href="/x" />
    <Button as={maybeTag} href="/x" />
    <Button asChild>
      <span>label</span>
    </Button>
    <Button asChild={maybeChild} className={maybeClass} />
    <Badge label="hi" tone="info" size="sm" p={4} className={maybeClass} />
  </>
);

export const rejected = (
  <>
    {/* @ts-expect-error — `as` selects its element's props: an anchor has no `disabled` */}
    <Button as="a" disabled />
    {/* @ts-expect-error — `as` names an element or a component */}
    <Button as="notATag" />
    {/* @ts-expect-error — asChild is boolean */}
    <Button asChild="yes" />
    {/* @ts-expect-error — className is a string */}
    <Button className={1} />
    {/* @ts-expect-error — the wrapped component's required prop stays required */}
    <Badge size="sm" />
    {/* @ts-expect-error — and its own props keep their types */}
    <Badge label="hi" tone="loud" />
    {/* @ts-expect-error — its props are closed */}
    <Badge label="hi" notAProp={1} />
  </>
);

// A target's own className type reaches its wrapper, since the runtime hands a
// callback through: one of Base UI's shape takes a callback of its state. A
// target without a callback, or without className, and an element take a
// string.
interface ToggleState {
  pressed: boolean;
}
interface ToggleProps {
  className?: string | ((state: ToggleState) => string | undefined) | undefined;
  children?: ReactNode;
}
declare const Toggle: ForwardRefExoticComponent<
  ToggleProps & RefAttributes<HTMLButtonElement>
>;
const Chip = ds.styles({ display: 'inline-flex' }).asComponent(Toggle);
const Chips = compose({ Root: Button, Chip }, { shared: { size: true } });
const Bare = ds
  .styles({})
  .asComponent((props: { label: string }) => <span>{props.label}</span>);

export type _TargetClassName = [
  Assert<
    Equal<
      ComponentProps<typeof Chip>['className'],
      string | ((state: ToggleState) => string | undefined) | undefined
    >
  >,
  Assert<
    Equal<
      ComponentProps<typeof Chips.Chip>['className'],
      string | ((state: ToggleState) => string | undefined) | undefined
    >
  >,
  Assert<Equal<BadgeProps['className'], string | undefined>>,
  Assert<Equal<ComponentProps<typeof Bare>['className'], string | undefined>>,
  Assert<Equal<ButtonProps['className'], string | undefined>>,
];

export const classNames = (
  <>
    <Chip className={(state) => (state.pressed ? 'on' : undefined)} />
    <Chip className={maybeClass} />
    {/* @ts-expect-error — the callback gets the target's own state */}
    <Chip className={(state) => (state.open ? 'on' : undefined)} />
    {/* @ts-expect-error — a target without a callback takes a string */}
    <Badge label="hi" className={() => 'on'} />
    {/* @ts-expect-error — and so does an element */}
    <Button className={() => 'on'} />
  </>
);

// Annotating with React's own prop types, as kits do.
export const AnnotatedBox: ForwardRefExoticComponent<
  ComponentPropsWithoutRef<'div'> & RefAttributes<HTMLDivElement>
> = ds.styles({}).asElement('div');
export const AnnotatedBadge: ForwardRefExoticComponent<
  LabelProps & RefAttributes<HTMLSpanElement>
> = ds.styles({}).asComponent(Label);

// asClass() resolves the props the builder admitted.
const buttonClass = ds
  .styles({ display: 'inline-flex' })
  .variant({ prop: 'size', variants: { sm: {}, lg: {} } })
  .states({ busy: {} })
  .system({ space: true })
  .asClass();
const extendedClass = Button.extend()
  .variant({ prop: 'tone', variants: { calm: {} } })
  .asClass();
export const classes = [
  buttonClass({ size: 'sm', busy: true, p: 4 }),
  buttonClass.attrs({ size: undefined }),
  extendedClass({ size: 'lg', tone: 'calm' }),
];
// @ts-expect-error — asClass keeps its options
export const badClass = buttonClass({ size: 'xl' });
// @ts-expect-error — and an extension's
export const badExtendedClass = extendedClass({ tone: 'loud' });
