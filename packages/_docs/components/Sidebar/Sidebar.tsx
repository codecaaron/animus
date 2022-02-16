import { Text } from '@animus-ui/components';
import { animus } from '@animus-ui/core';
import { FlowLink } from 'components/FlowLink';
import { useRouter } from 'next/dist/client/router';

import { links, short } from './constants';

export const SideBarContainer = animus
  .styles({
    bg: 'background-current',
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

export const SidebarSection: React.FC<typeof links[number]> = ({
  text,
  pages,
}) => {
  const { asPath } = useRouter();
  return (
    <MenuItem key={text}>
      <Text fontWeight={700} fontSize={18}>
        {text}
      </Text>
      <Menu submenu>
        {pages.map(({ text, href }) => {
          const isActive = asPath === `/docs${href}`;
          return (
            <MenuItem key={text}>
              <FlowLink active={isActive} href={`/docs${href}`}>
                {text}
              </FlowLink>
            </MenuItem>
          );
        })}
      </Menu>
    </MenuItem>
  );
};

export const Sidebar: React.FC = () => {
  const { asPath } = useRouter();
  return (
    <SideBarContainer>
      <Menu>
        {short.map(({ text, href }) => {
          const isActive = asPath === `/docs${href}`;
          return (
            <MenuItem key={text}>
              <FlowLink fontSize={18} active={isActive} href={`/docs${href}`}>
                {text}
              </FlowLink>
            </MenuItem>
          );
        })}
      </Menu>
    </SideBarContainer>
  );
};
