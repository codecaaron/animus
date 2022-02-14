import { Box, FlexBox } from '@animus-ui/components';
import { FlowLink } from 'components/FlowLink';

import { Logo } from '../components/Logo/Logo';
import HomePage from '../snippets/homepage.mdx';

export default function Home() {
  return (
    <FlexBox center py={64} column gap={32}>
      <Logo logoSize={{ _: 'lg', lg: 'xxl' }}>Animus</Logo>
      <FlexBox gap={64}>
        <FlowLink href="/docs/start/introduction" fontSize={28} raised>
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
      <Box maxWidth={800}>
        <HomePage />
      </Box>
    </FlexBox>
  );
}
