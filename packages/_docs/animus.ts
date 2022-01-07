import { coreConfig } from '@animus-ui/core';

export const animus = coreConfig
  .addGroup('mode', {
    mode: {
      property: 'none',
      scale: 'mode',
    },
    vars: {
      property: 'variables',
    },
  })
  .build();
