import type { ComponentProps } from 'react';

import { ds } from './kit';

import type { Assert, Equal, IsAny, IsNever, IsOpenString } from './guards';

const Box = ds
  .styles({})
  .system({ space: true, colors: true, gutter: true, inset: true })
  .asElement('div');

type Props = ComponentProps<typeof Box>;
/** A prop's single values, without its responsive object or `undefined`. */
type Single<T> = Exclude<T, object | undefined>;

type CssWide =
  | '-moz-initial'
  | 'inherit'
  | 'initial'
  | 'revert'
  | 'revert-layer'
  | 'unset';
type ContainerUnit =
  | `${number}cqw`
  | `${number}cqi`
  | `${number}cqh`
  | `${number}cqb`
  | `${number}cqmin`
  | `${number}cqmax`;

export type _NeitherAnyNorNever = [
  Assert<Equal<IsAny<Props['p']>, false>>,
  Assert<Equal<IsNever<Single<Props['p']>>, false>>,
  Assert<Equal<IsAny<Props['bg']>, false>>,
  Assert<Equal<IsAny<Props['gutter']>, false>>,
  Assert<Equal<IsAny<Props['inset']>, false>>,
];

/** A prop value as a call site writes it: any breakpoint may be left `undefined`. */
type PropValue<V> =
  | V
  | {
      _?: V | undefined;
      xs?: V | undefined;
      sm?: V | undefined;
      md?: V | undefined;
      lg?: V | undefined;
      xl?: V | undefined;
    };

// A strict scale on a map: its keys, the property's keywords, and the
// values every strict prop admits, zero as a string or a number among them.
export type _StrictMapScale = Assert<
  Equal<
    Props['gutter'],
    | PropValue<
        'tight' | 'roomy' | 'normal' | '0' | 0 | CssWide | ContainerUnit
      >
    | undefined
  >
>;

// A style input checks a value without TS inferring from it, and what the
// builder stores keeps the value's whole domain: zero included, never `never`.
const _styled = ds.styles({ p: 0 });
type StoredP = Single<(typeof _styled)['baseStyles']['p']>;
export type _StoredStyle = [
  Assert<Equal<IsNever<StoredP>, false>>,
  Assert<Equal<Extract<StoredP, 0 | '0'>, 0 | '0'>>,
];

// A strict theme scale stays closed; a loose one is open to raw CSS.
export type _Openness = [
  Assert<Equal<IsOpenString<Single<Props['p']>>, false>>,
  Assert<Equal<IsOpenString<Single<Props['bg']>>, false>>,
  Assert<Equal<IsOpenString<Single<Props['gutter']>>, false>>,
  Assert<Equal<IsOpenString<Single<Props['inset']>>, true>>,
];

// Tokens, and references to them.
export type _Tokens = [
  Assert<Equal<Extract<Single<Props['bg']>, 'ink' | 'paper'>, 'ink' | 'paper'>>,
  Assert<
    Equal<
      Extract<Single<Props['bg']>, '{colors.ink}' | '{colors.paper}'>,
      '{colors.ink}' | '{colors.paper}'
    >
  >,
  Assert<
    Equal<
      Extract<Single<Props['p']>, '{space.4}' | '{space.8}'>,
      '{space.4}' | '{space.8}'
    >
  >,
];

// The admitted groups' props, and no others.
export type _Groups = [
  Assert<
    Equal<'p' | 'mx' | 'bg' | 'color' extends keyof Props ? true : false, true>
  >,
  Assert<Equal<'fontSize' extends keyof Props ? true : false, false>>,
  Assert<Equal<'gridArea' extends keyof Props ? true : false, false>>,
];

export const accepted = (
  <>
    <Box p={4} m={-8} bg="ink" color="{colors.paper}" />
    <Box p={{ _: 4, sm: 8, xl: 16 }} gutter={{ _: 'tight', md: 'roomy' }} />
    <Box inset="3px" />
  </>
);

// A component's padding props: a loose or unscaled one takes any number, as
// extraction and the runtime write it in px; a strict one keeps to its scale.
const Card = ds
  .styles({})
  .props({
    pad: { property: 'padding', scale: 'space', strict: false },
    bare: { property: 'padding' },
    tight: { property: 'padding', scale: { page: '24px' }, strict: true },
  })
  .asElement('div');

export const numericLengths = (
  <>
    <Card pad={13} bare={13} tight="page" />
    <Card pad={{ _: 13, md: 2.5 }} bare={{ _: 2.5 }} />
    {/* @ts-expect-error — a strict scale still rejects a number it lacks */}
    <Card tight={13} />
  </>
);

// On a strict scale, zero is admitted only where the property's value is a
// single length; elsewhere the scale wins, and zero must be one of its keys.
const Zeroes = ds
  .styles({})
  .props({
    m: { property: 'margin', scale: { page: '24px' } },
    p: { property: 'padding', scale: { page: '24px' } },
    gap: { property: 'gap', scale: { page: '24px' } },
    rows: { property: 'gridTemplateRows', scale: { 1: '1fr', 2: '1fr 1fr' } },
    cols: {
      property: 'gridTemplateColumns',
      scale: { 1: '1fr', 2: '1fr 1fr' },
    },
    opacity: { property: 'opacity', scale: { faint: '0.4' } },
    textDecoration: {
      property: 'textDecoration',
      scale: { none: 'none', underline: 'underline' },
    },
  })
  .asElement('div');

export const zeroLengths = (
  <>
    <Zeroes m={0} p={0} gap={0} rows={1} cols={2} opacity="faint" />
    <Zeroes m="0" p="0" gap={{ _: '0', md: 0 }} textDecoration="none" />
    {/* @ts-expect-error — a grid template is no single length */}
    <Zeroes rows={0} />
    {/* @ts-expect-error — nor as a string */}
    <Zeroes rows="0" />
    {/* @ts-expect-error — at any breakpoint */}
    <Zeroes cols={{ _: 1, md: 0 }} />
    {/* @ts-expect-error — the string zero */}
    <Zeroes cols="0" />
    {/* @ts-expect-error — opacity takes its scale's keys */}
    <Zeroes opacity={0} />
    {/* @ts-expect-error — the string zero */}
    <Zeroes opacity="0" />
    {/* @ts-expect-error — a text-decoration shorthand is no single length */}
    <Zeroes textDecoration={0} />
    {/* @ts-expect-error — the string zero */}
    <Zeroes textDecoration="0" />
  </>
);

export const rejected = (
  <>
    {/* @ts-expect-error — a strict space scale rejects a raw length */}
    <Box p="7px" />
    {/* @ts-expect-error — and a key it does not have */}
    <Box p={7} />
    {/* @ts-expect-error — padding takes no negative key */}
    <Box p={-4} />
    {/* @ts-expect-error — a strict map scale rejects other words */}
    <Box gutter="huge" />
    {/* @ts-expect-error — a color scale rejects an unknown token */}
    <Box bg="nope" />
    {/* @ts-expect-error — a reference names the scale's own tokens */}
    <Box bg="{colors.nope}" />
    {/* @ts-expect-error — a responsive value names declared breakpoints */}
    <Box p={{ xxl: 4 }} />
    {/* @ts-expect-error — and keeps the scale at each breakpoint */}
    <Box p={{ sm: 7 }} />
    {/* @ts-expect-error — a group the component did not admit */}
    <Box fontSize={14} />
  </>
);
