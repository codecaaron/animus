import { animus } from '@animus-ui/core';

// .asComponent() is a bail condition — the chain walker cannot statically
// extract a component that wraps an arbitrary runtime component reference.
export const FlowLink = animus
  .styles({ fontWeight: 400 })
  .asComponent('a' as any);
