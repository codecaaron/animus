import { Box, Button, Family } from '../src/components';

export default function LegacyPage() {
  return (
    <Box p={16}>
      <Button size="medium" intent="primary">
        Primary
      </Button>
      <Button size="large" intent="secondary">
        Secondary
      </Button>
      <Family.Root size="small">
        <Family.Child size="small" intent="primary">
          Child
        </Family.Child>
      </Family.Root>
    </Box>
  );
}
