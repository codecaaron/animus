import { Box, FlexBox, Text } from '@animus-ui/components';
import { Button } from 'elements/Button';
import { FlowText } from 'elements/FlowText';
import { useRouter } from 'next/router';

import { Logo } from '../components/Logo/Logo';
import HomePage from '../snippets/homepage.mdx';

export default function Home() {
  const { push } = useRouter();
  return (
    <FlexBox center py={{ _: 32, sm: 64 }} column>
      <FlexBox center py={64} pb={64}>
        <Logo logoSize={{ _: 'md', xs: 'lg', sm: 'xl', lg: 'xxl' }}>
          Animus
        </Logo>
      </FlexBox>
      <Box maxWidth={720}>
        <Text
          as="h2"
          fontSize={{ _: 18, xs: 22, md: 26 }}
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
      <Box maxWidth={1} width={640}>
        <HomePage />
      </Box>

      <FlexBox gap={24} my={32} center>
        <Button onClick={() => push('/docs/start')} size="lg">
          Get Started
        </Button>
      </FlexBox>
    </FlexBox>
  );
}
