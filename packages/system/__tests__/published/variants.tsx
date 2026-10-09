import type { ComponentProps } from 'react';

import { ds } from './kit';

import type { Assert, Equal } from './guards';
import type { VariantPropsOf } from '@animus-ui/system';

const Base = ds
  .styles({ display: 'flex' })
  .variant({ prop: 'size', variants: { sm: { p: 4 }, lg: { p: 16 } } })
  .variant({
    prop: 'tone',
    defaultVariant: 'calm',
    variants: { calm: {}, loud: {} },
  })
  .variant({ prop: 'corner', variants: { square: {}, round: {} } })
  .variant({
    prop: 'weight',
    defaultVariant: 'light',
    variants: { light: {}, heavy: {} },
  })
  .compound({ size: 'sm', tone: ['calm', 'loud'] }, { p: 0 })
  .states({ busy: { opacity: 0.5 } })
  .asElement('button');

// `size` and `tone` are inherited as declared; `corner` and `weight` are
// redeclared; `density` and `emphasis` are new on the extension.
const Extended = Base.extend()
  .variant({ prop: 'corner', variants: { pill: {} } })
  .variant({ prop: 'weight', defaultVariant: 'heavy', variants: { bold: {} } })
  .variant({ prop: 'density', variants: { tight: {}, roomy: {} } })
  .variant({
    prop: 'emphasis',
    defaultVariant: 'strong',
    variants: { strong: {}, soft: {} },
  })
  .compound({ density: 'tight', corner: 'pill' }, { p: 4 })
  .states({ pressed: { opacity: 0.8 } })
  .asElement('button');

type BaseProps = ComponentProps<typeof Base>;
type ExtendedProps = ComponentProps<typeof Extended>;

export type _BaseAxes = [
  Assert<Equal<BaseProps['size'], 'sm' | 'lg' | undefined>>,
  Assert<Equal<BaseProps['tone'], 'calm' | 'loud' | undefined>>,
  Assert<Equal<BaseProps['corner'], 'square' | 'round' | undefined>>,
  Assert<Equal<BaseProps['weight'], 'light' | 'heavy' | undefined>>,
  Assert<Equal<BaseProps['busy'], boolean | undefined>>,
];

export type _ExtendedAxes = [
  Assert<Equal<ExtendedProps['size'], 'sm' | 'lg' | undefined>>,
  Assert<Equal<ExtendedProps['tone'], 'calm' | 'loud' | undefined>>,
  Assert<
    Equal<ExtendedProps['corner'], 'square' | 'round' | 'pill' | undefined>
  >,
  Assert<
    Equal<ExtendedProps['weight'], 'light' | 'heavy' | 'bold' | undefined>
  >,
  Assert<Equal<ExtendedProps['density'], 'tight' | 'roomy' | undefined>>,
  Assert<Equal<ExtendedProps['emphasis'], 'strong' | 'soft' | undefined>>,
  Assert<Equal<ExtendedProps['busy'], boolean | undefined>>,
  Assert<Equal<ExtendedProps['pressed'], boolean | undefined>>,
];

export type _VariantPropsOf = Assert<
  Equal<
    VariantPropsOf<typeof Extended>,
    {
      size?: 'sm' | 'lg' | undefined;
      tone?: 'calm' | 'loud' | undefined;
      corner?: 'square' | 'round' | 'pill' | undefined;
      weight?: 'light' | 'heavy' | 'bold' | undefined;
      density?: 'tight' | 'roomy' | undefined;
      emphasis?: 'strong' | 'soft' | undefined;
    }
  >
>;

export const accepted = (
  <>
    <Base size="sm" tone="loud" corner="round" weight="heavy" busy />
    <Extended size="lg" corner="pill" weight="bold" density="roomy" pressed />
  </>
);

export const rejected = (
  <>
    {/* @ts-expect-error — a base axis without a default */}
    <Base size="xl" />
    {/* @ts-expect-error — a base axis with a default */}
    <Base tone="quiet" />
    {/* @ts-expect-error — an inherited axis without a default */}
    <Extended size="xl" />
    {/* @ts-expect-error — an inherited axis with a default */}
    <Extended tone="quiet" />
    {/* @ts-expect-error — a redeclared axis without a default */}
    <Extended corner="star" />
    {/* @ts-expect-error — a redeclared axis with a default */}
    <Extended weight="thin" />
    {/* @ts-expect-error — an axis the extension adds, without a default */}
    <Extended density="loose" />
    {/* @ts-expect-error — an axis the extension adds, with a default */}
    <Extended emphasis="loud" />
    {/* @ts-expect-error — a state is boolean */}
    <Extended pressed="yes" />
  </>
);

ds.styles({})
  .variant({ prop: 'size', variants: { sm: {}, lg: {} } })
  // @ts-expect-error — a compound names declared options only
  .compound({ size: 'xl' }, { p: 0 });

Base.extend()
  .variant({ prop: 'density', variants: { tight: {} } })
  // @ts-expect-error — the same holds for an axis an extension adds
  .compound({ density: 'loose' }, { p: 0 });

ds.styles({}).variant({
  prop: 'size',
  // @ts-expect-error — a default names one of the axis's options
  defaultVariant: 'xl',
  variants: { sm: {}, lg: {} },
});

Base.extend().variant({
  prop: 'density',
  // @ts-expect-error — so does an extension's, for an axis it adds
  defaultVariant: 'loose',
  variants: { tight: {} },
});
