import { Box, FlexBox } from '@my-ui/components';

import { ds } from '../test-system';

export const Card = ds
  .styles({ borderRadius: 4, bg: 'background-current' })
  .asElement('div');

export function App() {
  return (
    <FlexBox p={16}>
      <Box p={8} mt={{ _: 8, sm: 16 }}>
        <Card />
      </Box>
    </FlexBox>
  );
}
