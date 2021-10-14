import { FlexBox } from '@animus/elements';
import { Layout } from '../components/Layout';

export default function Home() {
  return (
    <Layout>
      <FlexBox p={24} center borderBottom={1} gridArea="header">
        Hello
      </FlexBox>
      <FlexBox p={24} center borderRight={1} gridArea="sidebar">
        Sidebar
      </FlexBox>
      <FlexBox p={24} center gridArea="content">
        Content
      </FlexBox>
    </Layout>
  );
}
