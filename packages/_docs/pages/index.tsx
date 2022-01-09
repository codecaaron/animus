import { Box, FlexBox } from '@animus-ui/components';
import { Link } from '@animus-ui/components';
import { Logo } from '../components/Logo/Logo';
import HomePage from '../snippets/homepage.mdx';

export default function Home() {
  return (
    <FlexBox center py={64} column gap={32}>
      <Logo logoSize={{ _: 'lg', lg: 'xxl' }}>Animus</Logo>
      <FlexBox gap={32}>
        <Link href="/docs/start/introduction" fontWeight={600} fontSize={22}>
          Documentation
        </Link>
        <Link href="/docs/start/introduction" fontWeight={600} fontSize={22}>
          Github
        </Link>
      </FlexBox>
      <Box maxWidth={800}>
        <HomePage />
      </Box>
    </FlexBox>
  );
}
