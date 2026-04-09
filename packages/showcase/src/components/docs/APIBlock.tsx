import type { ReactNode } from 'react';

import { ds } from '../../ds';

const APIContainer = ds
  .styles({
    border: 1,
    borderColor: 'border',
    overflow: 'hidden',
    '& > *': {
      border: 'none',
      borderRadius: '0',
    },
    '& > *:first-child': {
      borderBottom: 1,
      borderBottomColor: 'border',
    },
  })
  .asElement('div');

export function APIBlock({ children }: { children: ReactNode }) {
  return <APIContainer>{children}</APIContainer>;
}
