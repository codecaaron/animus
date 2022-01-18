import { animus } from '@animus-ui/core';
import { Link } from '@animus-ui/components';
import { useRouter } from 'next/dist/client/router';
import { FlowText } from 'components/FlowText';
import { links } from './constants';

export const SideBarContainer = animus
  .styles({
    area: 'sidebar',
    height: 1,
    position: 'sticky',
    top: '3.5rem',
    maxHeight: 'calc(100vh - 3.5rem)',
    bg: 'background-current',
    zIndex: 3,
  })
  .asComponent('div');

const Menu = animus
  .styles({
    p: 16,
    pl: 32,
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
    py: 4,
    display: 'flex',
    flexDirection: 'column',
    cursor: 'pointer',
    px: 12,
    pl: 0,
  })
  .asComponent('li');

const SidebarSection: React.FC<typeof links[number]> = ({ text, pages }) => {
  const { asPath } = useRouter();
  return (
    <MenuItem key={text}>
      <FlowText>{text}</FlowText>
      <Menu submenu>
        {pages.map(({ text, href }) => (
          <MenuItem key={text}>
            <Link
              color="tertiary-hover"
              fontFamily="monospace"
              fontSize={14}
              fontWeight={asPath === `/docs${href}` ? 700 : 600}
              href={`/docs${href}`}
            >
              {text}
            </Link>
          </MenuItem>
        ))}
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
