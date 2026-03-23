import { Box, Card, Text, Button, FlexBox } from './components';

export function App() {
  return (
    <Box p={32}>
      <FlexBox column gap={16}>
        <Text as="h1" color="primary">
          Animus Extraction Smoke Test
        </Text>
        <Text as="p" color="text" mb={16}>
          If you can read this with correct styling, the extraction pipeline works.
        </Text>

        <FlexBox gap={8}>
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button disabled>Disabled</Button>
        </FlexBox>

        <Box
          p={{ _: 16, sm: 32 }}
          mt={24}
          bg="background-muted"
          display="flex"
        >
          <Text as="small" color="text">
            Responsive padding: 16px default, 32px at sm breakpoint
          </Text>
        </Box>

        <Card elevated data-testid="card">
          <Text as="p" color="text">
            Card using .asComponent() — className forwarded to StyledWrapper
          </Text>
        </Card>
      </FlexBox>
    </Box>
  );
}
