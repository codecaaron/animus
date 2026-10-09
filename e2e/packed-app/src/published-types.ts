import type { ComponentProps } from 'react';

// The packed declarations as an installed consumer reads them, under the
// strict pass's exactOptionalPropertyTypes: each axis keeps its exact options,
// and an explicit `undefined` is a prop left out. Types only: extraction
// reads this directory.
import type { Box, Button, Stack } from './components';

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

type ButtonProps = ComponentProps<typeof Button>;

export type PublishedTypes = [
  Assert<
    Equal<
      ComponentProps<typeof Stack>['direction'],
      'column' | 'row' | undefined
    >
  >,
  Assert<Equal<ButtonProps['size'], 'small' | 'medium' | 'large' | undefined>>,
  Assert<
    Equal<ButtonProps['intent'], 'primary' | 'secondary' | 'danger' | undefined>
  >,
  Assert<Equal<ButtonProps['hover'], boolean | undefined>>,
  Assert<
    Equal<string extends ComponentProps<typeof Box>['p'] ? true : false, false>
  >,
];

export const forwarded: ButtonProps = {
  size: undefined,
  intent: 'primary',
  hover: undefined,
  className: undefined,
};

// @ts-expect-error — an axis keeps its options
export const unknownOption: ButtonProps = { size: 'huge' };
