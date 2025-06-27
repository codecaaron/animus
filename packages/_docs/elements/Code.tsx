import { ComponentProps } from 'react';

import { Box } from '@animus-ui/components';

export const Code = (props: ComponentProps<typeof Box>) => (
  <Box
    as="code"
    color="primary"
    fontWeight={400}
    fontFamily="mono"
    {...props}
  />
);
