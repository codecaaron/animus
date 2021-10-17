import { Text } from '@animus/elements';
import { animus } from '@animus/props';
import { Link } from '@animus/ui';

export const SideBarContainer = animus
  .styles({
    area: 'sidebar',
    borderRight: 1,
    borderColor: 'pink-200',
    height: 1,
    overflowY: 'auto',
    bg: 'background-emphasized',
  })
  .asComponent('div');

const Menu = animus
  .styles({
    px: 0,
    py: 16,
    listStyleType: 'none',
  })
  .states({
    submenu: {
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
      { text: 'Introduction', href: '/get-started/introduction' },
      { text: 'Installation', href: '/get-started/installation' },
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
    ],
  },
  {
    text: 'Props',
    pages: [
      { text: 'System Props', href: '/props/system' },
      { text: 'Custom Props', href: '/props/custom' },
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

export const Sidebar: React.FC = () => {
  return (
    <SideBarContainer>
      <Menu>
        {menu.map(({ text, pages }) => {
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
        })}
      </Menu>
    </SideBarContainer>
  );
};
