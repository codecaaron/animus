import { animus } from '@animus-ui/core';
import { forwardRef } from 'react';

// A real component that asComponent would wrap
const InnerLink = forwardRef<
  HTMLAnchorElement,
  React.ComponentPropsWithRef<'a'>
>(function InnerLink(props, ref) {
  return <a ref={ref} {...props} />;
});

// .asComponent() on a primary chain — wraps a React component with extracted styles.
export const FlowLink = animus
  .styles({ fontWeight: 400, color: 'blue' })
  .asComponent(InnerLink);
