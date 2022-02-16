import { Box, FlexBox, Text } from '@animus-ui/components';
import { FlowLink } from 'components/FlowLink';
import { FlowText } from 'components/FlowText';

import { Logo } from '../components/Logo/Logo';
import HomePage from '../snippets/homepage.mdx';

export default function Home() {
  return (
    <FlexBox center py={64} column>
      <Logo logoSize={{ _: 'lg', lg: 'xxl' }}>Animus</Logo>
      <FlexBox gap={64}>
        <FlowLink href="/docs/start" fontSize={28} raised>
          Docs
        </FlowLink>
        <FlowLink
          href="https://github.com/codecaaron/animus"
          fontSize={28}
          raised
        >
          Github
        </FlowLink>
      </FlexBox>
      <Box maxWidth={600} mt={32}>
        <Text as="h2" fontSize={22} mb={32} fontWeight={400} textAlign="center">
          Animus is a configuration driven toolkit for creating component
          languages as <FlowText bare>expressive</FlowText> as the UIs they
          describe.
        </Text>
      </Box>
      <Box maxWidth={720}>
        <HomePage />
      </Box>
    </FlexBox>
  );
}
