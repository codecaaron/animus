import { Box, FlexBox, Text } from '@animus-ui/components';
import { FlowLink } from 'elements/FlowLink';
import { FlowText } from 'elements/FlowText';

import { Logo } from '../components/Logo/Logo';
import HomePage from '../snippets/homepage.mdx';

export default function Home() {
  return (
    <FlexBox center py={64} column>
      <FlexBox center py={64} pb={64}>
        <Logo logoSize={{ _: 'lg', sm: 'xl', lg: 'xxl' }}>Animus</Logo>
      </FlexBox>
      <Box maxWidth={720}>
        <Text
          as="h2"
          fontSize={{ _: 18, xs: 20, md: 26 }}
          fontWeight={400}
          textAlign="center"
        >
          Animus is a configuration driven toolkit for creating component
          languages as <FlowText bare>expressive</FlowText> as the UIs they
          describe.
        </Text>
      </Box>
      <Box
        width={[0.9, 0.7, 0.5, 0.3]}
        my={48}
        gradient="flowBgX"
        height="1px"
      />
      <Box maxWidth={1} width={640} fontSize={18}>
        <HomePage />
      </Box>

      <FlexBox gap={24} my={32} center>
        <FlowLink href="/docs/start" fontSize={26} raised>
          Docs
        </FlowLink>
        <Box width={2} bg="scrollbar" height={24} ml={4} />
        <FlowLink
          href="https://github.com/codecaaron/animus"
          fontSize={26}
          raised
        >
          Github
        </FlowLink>
      </FlexBox>
    </FlexBox>
  );
}
