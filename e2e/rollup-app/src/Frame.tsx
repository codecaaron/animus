import type { ReactNode } from 'react';

// Deliberately opaque wrapper for the oracle's many-place witnesses
// (packages/oracle/PLACES.md §4): a plain React component with no animus
// styling. From a consumer file, `<Frame>` is a component boundary the
// structural reader must not see through — whatever element or attributes
// this renders (or doesn't) is exactly the knowledge a place behind it
// must report as open, never inferred.
export const Frame = ({ children }: { children?: ReactNode }) => (
  <section className="frame">{children}</section>
);
