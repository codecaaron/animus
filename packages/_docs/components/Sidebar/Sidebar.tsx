import { animus } from '@animus-ui/core';
import { FlowLink } from 'elements/FlowLink';
import { useRouter } from 'next/dist/client/router';

const LINKS = [
  { text: 'Introduction', href: '/start' },
  { text: 'Configure', href: '/configure' },
  { text: 'Components', href: '/component' },
  { text: 'Properties', href: '/properties' },
  { text: 'Variants', href: '/variants' },
  { text: 'States', href: '/states' },
  { text: 'Styling Philosophy', href: '/styling' },
  { text: 'Responsive', href: '/responsive' },
  { text: 'Theming', href: '/theming' },
];

export const SideBarContainer = animus
  .styles({
    bg: 'background-current',
    area: 'sidebar',
    height: 1,
    top: '4rem',
    maxHeight: 'calc(100vh - 3.5rem)',
    overflowY: 'auto',
    zIndex: 3,
    position: {
      _: 'absolute',
      sm: 'static',
    },
    right: 1,
    '::-webkit-scrollbar': {
      display: 'none',
    },
  })
  .asComponent('div');

const Menu = animus
  .styles({
    p: 32,
    py: 12,
    listStyleType: 'none',
  })
  .states({
    submenu: {
      px: 0,
      pt: 8,
      pb: 12,
    },
  })
  .asComponent('ul');

const MenuItem = animus
  .styles({
    p: 4,
    fontSize: 18,
    lineHeight: 'base',
  })
  .asComponent('li');

export const Sidebar: React.FC = () => {
  const { asPath } = useRouter();
  return (
    <SideBarContainer>
      <Menu>
        {LINKS.map(({ text, href }) => {
          const url = `/docs${href}`;
          const isActive = asPath === url;
          return (
            <MenuItem key={text}>
              <FlowLink fontSize={18} active={isActive} href={url}>
                {text}
              </FlowLink>
            </MenuItem>
          );
        })}
      </Menu>
    </SideBarContainer>
  );
};
