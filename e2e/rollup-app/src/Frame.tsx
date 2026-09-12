import type { ReactNode } from 'react';

// Stays free of animus styling: `<Frame>` is a component boundary the
// structural reader must not see through, so places behind it report as open.
export const Frame = ({ children }: { children?: ReactNode }) => (
  <section className="frame">{children}</section>
);
