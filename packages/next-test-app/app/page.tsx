import { Badge, Box, Button, Card, Stack } from '../src/components';
import { ds } from '../src/ds';

const Heading = ds.styles({ 
  fontSize: 48,
  fontWeight: 700
}).asElement('h1')

const Subheading = ds.styles({
  color: 'text.muted'
}).asElement('p')

export default function Home() {
  return (
    <Stack p={32} gap={24}>
      <Stack gap={8}>
        <Heading>Next.js Test App</Heading>
        <Subheading>
          Extraction proof for webpack plugin
        </Subheading>
      </Stack>

      <Stack direction="row" gap={8} flexWrap="wrap">
        <Button size="small" intent="primary">
          Small Primary
        </Button>
        <Button size="medium" intent="secondary">
          Medium Secondary
        </Button>
        <Button size="large" intent="danger">
          Large Danger
        </Button>
        <Button size="medium" intent="ghost">
          Ghost
        </Button>
      </Stack>

      <Stack direction="row" gap={16}>
        <Card elevation="flat" sizing="200px">
          <span>Flat</span>
        </Card>
        <Card elevation="raised" sizing="200px">
          <span>Raised</span>
        </Card>
        <Card elevation="floating" sizing="200px">
          <strong>Floating</strong>
        </Card>
      </Stack>

      <Box gap={8} flexWrap="wrap">
        <Badge size="small" intent="info">
          Info
        </Badge>
        <Badge size="large" intent="info">
          Large Info
        </Badge>
        <Badge size="small" intent="danger">
          Compound (small+danger=bold)
        </Badge>
        <Badge size="large" intent="danger">
          Large Danger
        </Badge>
      </Box>

      <Box p={16} gap={8}>
        <Badge size="large" intent="info">
          RSC Page — no compose() here
        </Badge>
      </Box>
    </Stack>
  );
}
