import { Box, Text } from '@animus/elements';
import { animus } from '@animus/props';
import { Link } from '@animus/ui';

export const SideBarContainer = animus
  .styles({
    area: 'sidebar',
    height: 1,
    position: 'sticky',
    top: '4rem',
    maxHeight: 'calc(100vh - 4rem)',
    bg: 'background-current',
    zIndex: 3,
  })
  .asComponent('div');

const Menu = animus
  .styles({
    px: 12,
    py: 16,
    listStyleType: 'none',
  })
  .states({
    submenu: {
      px: 0,
      py: 4,
    },
  })
  .asComponent('ul');

const MenuItem = animus
  .styles({
    py: 4,
    px: 16,
  })
  .asComponent('li');

const menu = [
  {
    text: 'Getting Started',
    pages: [
      { text: 'Introduction', href: '/start/introduction' },
      { text: 'Installation', href: '/start/installation' },
    ],
  },
  {
    text: 'Usage',
    pages: [
      {
        text: 'animus',
        href: '/animus/builder',
      },
      {
        text: 'How it works',
        href: '/animus/how-it-works',
      },
    ],
  },
  {
    text: 'Theming',
    pages: [
      { text: 'createTheme', href: '/theming/createTheme' },
      { text: 'Theme Specification', href: '/theming/specification' },
    ],
  },
  {
    text: 'Components',
    pages: [
      { text: 'Box', href: '/components/Box' },
      { text: 'FlexBox', href: '/components/FlexBox' },
      { text: 'GridBox', href: '/components/GridBox' },
      { text: 'Text', href: '/components/Text' },
      { text: 'Link', href: '/components/Link' },
      { text: 'Image', href: '/components/Image' },
      { text: 'Svg', href: '/components/Svg' },
    ],
  },
  {
    text: 'Props',
    pages: [
      { text: 'Variants', href: '/props/variants' },
      { text: 'States', href: '/props/states' },
      { text: 'System', href: '/props/system' },
      { text: 'Custom', href: '/props/custom' },
      { text: 'Responsive Syntax', href: '/props/responsive' },
    ],
  },
  {
    text: 'Providers',
    pages: [
      { text: 'AnimusProvider', href: '/providers/animus' },
      { text: 'ComponentProvider', href: '/providers/component' },
      { text: 'MDXProvider', href: '/providers/mdx' },
    ],
  },
  {
    text: 'Packages',
    pages: [
      { text: '@animus/ui', href: '/packages/ui' },
      { text: '@animus/core', href: '/packages/core' },
      { text: '@animus/theming', href: '/packages/theming' },
      { text: '@animus/transforms', href: '/packages/transforms' },
      { text: '@animus/elements', href: '/packages/elements' },
      { text: '@animus/provider', href: '/packages/provider' },
    ],
  },
];

const SidebarSection: React.FC<{
  text: string;
  pages: { text: string; href: string }[];
}> = ({ text, pages }) => {
  return (
    <MenuItem key={text}>
      <Text fontWeight={700}>{text}</Text>
      <Menu submenu>
        {pages.map(({ text, href }) => {
          return (
            <MenuItem key={text}>
              <Link fontSize={14} href={href}>
                {text}
              </Link>
            </MenuItem>
          );
        })}
      </Menu>
    </MenuItem>
  );
};

export const Sidebar: React.FC = () => {
  return (
    <SideBarContainer>
      <Box fit maxHeight={1} bg="background-emphasized" overflowY="auto">
        <Menu>
          {menu.map(({ text, pages }) => {
            return <SidebarSection text={text} pages={pages} key={text} />;
          })}
        </Menu>
      </Box>
    </SideBarContainer>
  );
};
