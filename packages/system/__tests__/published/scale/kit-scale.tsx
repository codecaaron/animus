import { forwardRef } from 'react';
import type {
  ComponentProps,
  ComponentPropsWithoutRef,
  ForwardRefExoticComponent,
  ReactNode,
  RefAttributes,
} from 'react';

import { ds } from './kit';

import type { ResponsiveProp, ThemedScale } from '@animus-ui/system';

// Shapes that have overflowed (TS2590) in real kits: a component annotated
// with a prop contract read off the registry (Gamut UI's Column and Form), an
// element whose child is another component (Geist ui-kit's button), and a
// many-group component's props. Each must keep checking on both compilers.
type Builder = ReturnType<typeof ds.styles>;
type Registry = Builder['propRegistry'];
type Groups = Builder['groupRegistry'];
type GroupProps<G extends keyof Groups & string> = {
  [K in Groups[G][number] as K extends string ? K : never]?: ThemedScale<
    Registry[K & keyof Registry]
  >;
};
type NamedProps<K extends keyof Registry & string> = {
  [P in K]?: ThemedScale<Registry[P]>;
};
type LayoutName = Exclude<Groups['layout'][number] & string, 'size'>;

export type ColumnProps = Omit<ComponentPropsWithoutRef<'div'>, 'color'> &
  NamedProps<LayoutName> &
  GroupProps<'space' | 'grid' | 'flexbox'> & {
    span?: ResponsiveProp<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12>;
    fitContent?: 'true' | 'false';
  };

export const Column: ForwardRefExoticComponent<
  ColumnProps & RefAttributes<HTMLDivElement>
> = ds
  .styles({ gridColumnEnd: 'span 12' })
  .variant({
    prop: 'fitContent',
    defaultVariant: 'true',
    variants: { true: { display: 'grid' }, false: {} },
  })
  .system({ space: true, grid: true, flexbox: true, layout: true })
  .props({
    span: {
      property: 'gridColumnEnd',
      scale: {
        1: 1,
        2: 2,
        3: 3,
        4: 4,
        5: 5,
        6: 6,
        7: 7,
        8: 8,
        9: 9,
        10: 10,
        11: 11,
        12: 12,
      },
    },
  })
  .asElement('div');

type FormAttributes = Omit<ComponentPropsWithoutRef<'form'>, 'color'>;
const FormShell = ds
  .styles({})
  .system({
    space: true,
    borders: true,
    layout: true,
    positioning: true,
    flexbox: true,
    grid: true,
  })
  .asElement('form');
const FormTarget = forwardRef<HTMLFormElement, FormAttributes>(
  function FormTarget(props, ref) {
    return <form {...props} ref={ref} />;
  }
);
export const Form: ForwardRefExoticComponent<
  FormAttributes &
    GroupProps<
      'space' | 'borders' | 'layout' | 'positioning' | 'flexbox' | 'grid'
    > &
    RefAttributes<HTMLFormElement>
> = FormShell.extend().styles({}).asComponent(FormTarget);

const Text = ds.styles({}).asElement('span');
const ButtonElement = ds
  .styles({})
  .props({ customWidth: { property: 'width' } })
  .asElement('button');
type ButtonInput = { children?: ReactNode } & Pick<
  ComponentProps<typeof ButtonElement>,
  'customWidth'
>;
export function Button({ customWidth, children }: ButtonInput) {
  return (
    <ButtonElement customWidth={customWidth}>
      <Text>{children}</Text>
    </ButtonElement>
  );
}

const Panel = ds
  .styles({})
  .system({
    space: true,
    colors: true,
    layout: true,
    gutter: true,
    inset: true,
  })
  .asElement('section');
export type PanelProps = ComponentProps<typeof Panel>;
