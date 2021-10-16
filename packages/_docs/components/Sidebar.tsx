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
      { text: 'Introduction', href: '/introduction' },
      { text: 'Installation', href: '/' },
    ],
  },
  {
    text: 'Theming',
    pages: [
      { text: 'createTheme', href: '/' },
      { text: 'Patterns', href: '/' },
      { text: 'Theme Specification', href: '/' },
    ],
  },
  {
    text: 'Component Builder',
    pages: [
      {
        text: 'animus',
        href: '/animus',
      },
      {
        text: 'How it works',
        href: '/animus',
      },
      {
        text: 'Recipes',
        href: '/animus',
      },
    ],
  },
  {
    text: 'Props',
    pages: [
      { text: 'System Props', href: '/' },
      { text: 'Custom Props', href: '/' },
      { text: 'Responsive Syntax', href: '/' },
    ],
  },
  {
    text: 'Providers',
    pages: [
      { text: 'AnimusProvider', href: '/' },
      { text: 'ComponentProvider', href: '/' },
      { text: 'MDXProvider', href: '/' },
    ],
  },
  {
    text: 'Packages',
    pages: [
      { text: '@animus/ui', href: '/' },
      { text: '@animus/core', href: '/' },
      { text: '@animus/theming', href: '/' },
      { text: '@animus/transforms', href: '/' },
      { text: '@animus/elements', href: '/' },
      { text: '@animus/provider', href: '/' },
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
