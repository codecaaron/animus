import { Link } from '@animus-ui/components';
import { animus } from '@animus-ui/core';
import { FlowText } from 'components/FlowText';
import { useRouter } from 'next/dist/client/router';

import { links } from './constants';

export const SideBarContainer = animus
  .styles({
    area: 'sidebar',
    height: 1,
    position: 'sticky',
    top: '4rem',
    maxHeight: 'calc(100vh - 3.5rem)',
    overflowY: 'auto',
    zIndex: 3,
    '::-webkit-scrollbar': {
      display: 'none',
    },
  })
  .asComponent('div');

const Menu = animus
  .styles({
    p: 16,
    pl: 32,
    pr: 12,
    listStyleType: 'none',
  })
  .states({
    submenu: {
      px: 0,
      pt: 4,
      pb: 12,
    },
  })
  .asComponent('ul');

const MenuItem = animus
  .styles({
    p: 2,
    display: 'flex',
    flexDirection: 'column',
    cursor: 'pointer',
  })
  .asComponent('li');

const SidebarSection: React.FC<typeof links[number]> = ({ text, pages }) => {
  const { asPath } = useRouter();
  return (
    <MenuItem key={text}>
      <FlowText>{text}</FlowText>
      <Menu submenu>
        {pages.map(({ text, href }) => {
          const isActive = asPath === `/docs${href}`;
          return (
            <MenuItem key={text}>
              <Link
                color={isActive ? 'primary' : 'secondary'}
                fontFamily="mono"
                fontSize={14}
                href={`/docs${href}`}
              >
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
      <Menu>
        {links.map(({ text, pages }) => (
          <SidebarSection text={text} pages={pages} key={text} />
        ))}
      </Menu>
    </SideBarContainer>
  );
};
