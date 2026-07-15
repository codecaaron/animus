import { Box, Button, Fade, Pulse, Stack } from './components';
import { ds } from './ds';

const Heading = ds.styles({ fontSize: 24, fontWeight: 700 }).asElement('h1');
const Subheading = ds.styles({ color: 'text.muted' }).asElement('p');

const INTENTS = ['primary', 'secondary', 'danger'] as const;

export function App() {
  // Runtime-selected variant: the variant prop value is not statically
  // resolvable at the call site, so class resolution happens at runtime
  // against the extracted variant classes.
  const rotation = Date.now() % INTENTS.length;

  return (
    <Stack p={32} gap={24}>
      <Stack gap={8}>
        <Heading>Packed Consumer App</Heading>
        <Subheading>Distribution proof for the published tarballs</Subheading>
      </Stack>

      <Stack direction="row" gap={8}>
        <Button size="small" intent="primary">
          Small Primary
        </Button>
        <Button size="medium" intent="secondary">
          Medium Secondary
        </Button>
        <Button size="large" intent="danger">
          Large Danger
        </Button>
      </Stack>

      <Stack direction="row" gap={8}>
        {INTENTS.map((intent, index) => (
          <Button
            key={intent}
            size="medium"
            intent={INTENTS[(rotation + index) % INTENTS.length]}
          >
            Dynamic {intent}
          </Button>
        ))}
      </Stack>

      <Box p={16} gap={8}>
        <Pulse>Pulse</Pulse>
        <Fade>Fade In</Fade>
      </Box>
    </Stack>
  );
}
