// Contract: a sealed bundle admits exactly what the unsealed one does. The
// kit's registries sealed behind its own mapped aliases (`SealedBundle`)
// type every component, extension and rejection as the kit itself does;
// the type oracle's seventeen rejections are the witness. Compiled, never
// run.
import { createRef } from 'react';
import type { ComponentProps, ComponentPropsWithRef } from 'react';

import { createSystem } from '@animus-ui/system';

import { bundle, ds as kit, pulse } from './kit';

import type { Assert, Equal } from './guards';
import type {
  AnimusProps,
  ConditionsOf,
  GroupsOf,
  PropsOf,
  SealedBundle,
  SelectorsOf,
  SystemBundle,
  VariantPropsOf,
  VocabularyOf,
} from '@animus-ui/system';

type Props = PropsOf<typeof bundle>;
type Groups = GroupsOf<typeof bundle>;
export type KitProps = { [K in keyof Props]: Props[K] };
export type KitGroups = { [K in keyof Groups]: Groups[K] };
const sealedBundle: SealedBundle<typeof bundle, KitProps, KitGroups> = bundle;
const ds = sealedBundle.registerKeyframes({ pulse }).seal();
// Sealed after registering, the bundle keeps its vocabulary too.
const registered = bundle.registerKeyframes({ pulse });
const lateBundle: SealedBundle<typeof registered, KitProps, KitGroups> =
  registered;
const late = lateBundle.seal();

// A seal keeps the axes a bundle carries, a string or generic one too.
const anyCondition: SystemBundle<{}, {}, string, never> =
  createSystem().build();
const anySelector: SystemBundle<{}, {}, never, string> = createSystem().build();
type NoProps = PropsOf<typeof anyCondition>;
type NoGroups = GroupsOf<typeof anyCondition>;
export type EmptyProps = { [K in keyof NoProps]: NoProps[K] };
export type EmptyGroups = { [K in keyof NoGroups]: NoGroups[K] };
export const sealedAnyCondition: SealedBundle<
  typeof anyCondition,
  EmptyProps,
  EmptyGroups
> = anyCondition;
export const sealedAnySelector: SealedBundle<
  typeof anySelector,
  EmptyProps,
  EmptyGroups
> = anySelector;
export function forward<C extends string>(
  forwarded: SystemBundle<KitProps, KitGroups, C>
): SealedBundle<typeof forwarded, KitProps, KitGroups> {
  return forwarded;
}
export function forwardVocabulary<V extends string>(
  forwarded: SystemBundle<KitProps, KitGroups, never, never, V>
): SealedBundle<typeof forwarded, KitProps, KitGroups> {
  return forwarded;
}
export function forwardKeyframes<V extends string>(
  forwarded: SystemBundle<KitProps, KitGroups, never, never, V | 'pulse'>
): SealedBundle<typeof forwarded, KitProps, KitGroups> {
  return forwarded;
}

// A seal must hold the bundle's own registries.
// @ts-expect-error — a registry missing a prop seals nothing
const _short: SealedBundle<
  typeof bundle,
  Omit<KitProps, 'gutter'>,
  KitGroups
> = bundle;

const ProbeButton = ds
  .styles({ display: 'flex', p: 4 })
  .variant({
    prop: 'size',
    defaultVariant: 'md',
    variants: { sm: { p: 4 }, md: { p: 8 }, lg: { p: 16 } },
  })
  .states({ busy: { opacity: '0.5' } })
  .system({ space: true })
  .props({ rounding: { property: 'borderRadius' } })
  .asElement('button');
const KitButton = kit
  .styles({ display: 'flex', p: 4 })
  .variant({
    prop: 'size',
    defaultVariant: 'md',
    variants: { sm: { p: 4 }, md: { p: 8 }, lg: { p: 16 } },
  })
  .states({ busy: { opacity: '0.5' } })
  .system({ space: true })
  .props({ rounding: { property: 'borderRadius' } })
  .asElement('button');
const Target = (props: { label: string; className?: string }) => (
  <span className={props.className}>{props.label}</span>
);
const Wrapped = ds.styles({ display: 'flex' }).asComponent(Target);
const app = createSystem().extend({ system: ds }).build().seal();

type ProbeProps = AnimusProps<typeof ProbeButton>;
type Variants = VariantPropsOf<typeof ProbeButton>;

export type _Admits = [
  Assert<Equal<KitProps, Props>>,
  Assert<Equal<KitGroups, Groups>>,
  Assert<
    Equal<ComponentProps<typeof ProbeButton>, ComponentProps<typeof KitButton>>
  >,
  Assert<
    Equal<
      ComponentPropsWithRef<typeof ProbeButton>,
      ComponentPropsWithRef<typeof KitButton>
    >
  >,
  Assert<Equal<ProbeProps, AnimusProps<typeof KitButton>>>,
  Assert<Equal<Variants, VariantPropsOf<typeof KitButton>>>,
  Assert<Equal<typeof app.propRegistry, typeof kit.propRegistry>>,
  Assert<Equal<typeof app.groupRegistry, typeof kit.groupRegistry>>,
  Assert<Equal<ConditionsOf<typeof ds>, ConditionsOf<typeof kit>>>,
  Assert<Equal<SelectorsOf<typeof ds>, SelectorsOf<typeof kit>>>,
  Assert<Equal<VocabularyOf<typeof ds>, VocabularyOf<typeof kit>>>,
  Assert<Equal<VocabularyOf<typeof late>, 'pulse'>>,
];

export const admitted01 = <ProbeButton size="sm" />;
export const admitted02 = <ProbeButton busy />;
export const admitted03 = <ProbeButton as="a" href="/" />;
export const admitted04 = <ProbeButton ref={createRef<HTMLButtonElement>()} />;
export const admitted05 = (
  <ProbeButton onClick={(e) => e.currentTarget.disabled} />
);
export const admitted06 = <ProbeButton p={{ _: 4, md: 8 }} rounding="4px" />;
export const admitted07 = <Wrapped label="ok" />;
export const admittedOptional = <Wrapped label="ok" className={undefined} />;
export const admitted08 = app
  .styles({ _motionReduce: { gutter: 'tight' } })
  .asElement('div');

// @ts-expect-error — variant
export const rejected01 = <ProbeButton size="xl" />;
// @ts-expect-error — unknown prop
export const rejected02 = <ProbeButton nonExistent="x" />;
// @ts-expect-error — scale
export const rejected03 = ds.styles({ p: 999 });
// @ts-expect-error — theme token
export const rejected04 = ds.styles({ color: '{colors.missing}' });
// @ts-expect-error — selector
export const rejected05 = ds.styles({ _hovre: { color: 'red' } });
// @ts-expect-error — state
export const rejected06 = <ProbeButton busy="yes" />;
// @ts-expect-error — extend argument
export const rejected07 = ProbeButton.extend({});
// @ts-expect-error — as target
export const rejected08 = <ProbeButton as="not-a-tag" />;
// @ts-expect-error — as native prop
export const rejected09 = <ProbeButton as="button" href="/" />;
// @ts-expect-error — ref
export const rejected10 = <ProbeButton ref={createRef<HTMLDivElement>()} />;
// @ts-expect-error — a wrapped component's required prop
export const rejected11 = <Wrapped />;
export const rejected12 = (
  // @ts-expect-error — event target
  <ProbeButton as="a" onClick={(e) => e.currentTarget.disabled} />
);
export const rejectedOverload = (
  // @ts-expect-error — no element's props admit an anchor's disabled
  <ProbeButton as="a" disabled />
);
// @ts-expect-error — props variant
export const rejected13: ProbeProps = { size: 'xxl' };
// @ts-expect-error — variant props
export const rejected14: Variants = { size: 'huge' };
export const rejected15 = ds
  .styles({ display: 'flex' })
  // @ts-expect-error — group
  .system({ unknownGroup: true });
// @ts-expect-error — extend after registering
export const rejected16 = createSystem()
  .addProps({ aa: { property: 'display' } })
  .extend({ system: ds });
// @ts-expect-error — terminal tag
export const rejected17 = ds.styles({ display: 'flex' }).asElement('not-a-tag');
