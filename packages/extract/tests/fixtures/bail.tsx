import { forwardRef } from 'react';

import { ds } from '../test-system';

// A real component that asComponent would wrap
const InnerLink = forwardRef<
  HTMLAnchorElement,
  React.ComponentPropsWithRef<'a'>
>(function InnerLink(props, ref) {
  return <a ref={ref} {...props} />;
});

// .asComponent() on a primary chain — wraps a React component with extracted styles.
export const FlowLink = ds
  .styles({ fontWeight: 400, color: 'blue' })
  .asComponent(InnerLink);
