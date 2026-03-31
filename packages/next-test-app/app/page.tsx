import { Badge, Box, Button, Card, Stack } from '../src/components';

export default function Home() {
  return (
    <Stack p={16}>
      <Box p={8}>
        <Button size="medium" intent="primary">
          Primary
        </Button>
        <Button size="small" intent="danger">
          Danger
        </Button>
      </Box>
      <Card sizing="300px" />
      <Box p={8}>
        <Badge size="small" intent="info">
          Info
        </Badge>
        <Badge size="small" intent="danger">
          Compound
        </Badge>
      </Box>
    </Stack>
  );
}
