import { Box } from '@animus-ui/components';
import { ComponentProps } from 'react';

export const Code = (props: ComponentProps<typeof Box>) => (
  <Box
    as="code"
    color="primary"
    fontWeight={400}
    fontFamily="monospace"
    {...props}
  />
);
