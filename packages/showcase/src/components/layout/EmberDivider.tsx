import type { ComponentPropsWithRef } from 'react';
import { forwardRef } from 'react';

import { ds } from '../../ds';
import { GradientBar } from '../decorative/GradientBar';

const EmberDividerInner = forwardRef<
  HTMLDivElement,
  ComponentPropsWithRef<'div'>
>(function EmberDividerInner({ children, ...props }, ref) {
  return (
    <div ref={ref} {...props}>
      <GradientBar />
      {children}
    </div>
  );
});

export const EmberDivider = ds
  .styles({
    width: '100%',
    maxWidth: '48rem',
    mx: 'auto',
    py: 48,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  })
  .asComponent(EmberDividerInner);
