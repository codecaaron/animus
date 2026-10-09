import type { ComponentProps } from 'react';

import { createSystem } from '@animus-ui/system';

import { ds as kit, pulse } from './kit';

import type { Assert, Equal } from './guards';
import type {
  ConditionsOf,
  SelectorsOf,
  VocabularyOf,
} from '@animus-ui/system';

// A sealed kit consumed through typed extend(): registries and vocabulary
// carry over exactly.
const app = createSystem().extend({ system: kit }).build().seal();

export type _Carried = [
  Assert<Equal<typeof app.propRegistry, typeof kit.propRegistry>>,
  Assert<Equal<typeof app.groupRegistry, typeof kit.groupRegistry>>,
  Assert<Equal<ConditionsOf<typeof app>, '_motionReduce'>>,
  Assert<Equal<SelectorsOf<typeof app>, '_childHover'>>,
  Assert<Equal<VocabularyOf<typeof app>, 'pulse'>>,
];

const AppBox = app
  .styles({ _motionReduce: { gutter: 'tight' }, _childHover: { p: 4 } })
  .system({ space: true, gutter: true })
  .asElement('div');
const KitBox = kit
  .styles({})
  .system({ space: true, gutter: true })
  .asElement('div');

export type _SameProps = [
  Assert<
    Equal<
      ComponentProps<typeof AppBox>['p'],
      ComponentProps<typeof KitBox>['p']
    >
  >,
  Assert<
    Equal<
      ComponentProps<typeof AppBox>['gutter'],
      ComponentProps<typeof KitBox>['gutter']
    >
  >,
];

export const accepted = <AppBox p={{ _: 4, md: 8 }} gutter="roomy" />;

export const rejected = (
  <>
    {/* @ts-expect-error — the inherited strict scale stays strict */}
    <AppBox gutter="huge" />
    {/* @ts-expect-error — and its breakpoints stay the kit's */}
    <AppBox p={{ xxl: 4 }} />
  </>
);

const inherited = createSystem().extend(kit);
export const twice = inherited
  .build()
  // @ts-expect-error — the inherited vocabulary is not registered twice
  .registerKeyframes({ pulse });
export const renamed = inherited.addSelectors({
  // @ts-expect-error — an inherited condition name cannot become a selector
  _motionReduce: '&:hover',
});
