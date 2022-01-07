import { Box } from '@animus/ui';
import { animus } from '~animus';
import { useColorModes } from '@animus/ui';
import { Link } from '@animus/ui';
import { useRouter } from 'next/dist/client/router';
import { useState } from 'react';
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
    display: 'flex',
    flexDirection: 'column',
    cursor: 'pointer',
    px: 12,
  })
  .asComponent('li');

const AccordionButton = animus
  .styles({
    border: 'none',
    boxShadow: 'none',
    fontWeight: 600,
    p: 0,
    bg: 'transparent',
    textAlign: 'left',
    color: 'inherit',
    cursor: 'pointer',
  })
  .asComponent('button');

const SidebarSection: React.FC<{
  text: string;
  pages: { text: string; href: string }[];
}> = ({ text, pages }) => {
  const { asPath } = useRouter();
  const isCurrentRoute = pages.some(({ href }) => `/docs${href}` === asPath);
  const [isOpen, setIsOpen] = useState(isCurrentRoute);

  return (
    <MenuItem key={text}>
      <AccordionButton onClick={() => setIsOpen((prev) => !prev)}>
        {text}
      </AccordionButton>
      {isOpen && (
        <Menu submenu>
          {pages.map(({ text, href }) => (
            <MenuItem key={text}>
              <Link fontSize={14} href={`/docs${href}`}>
                {text}
              </Link>
            </MenuItem>
          ))}
        </Menu>
      )}
    </MenuItem>
  );
};

export const Sidebar: React.FC = () => {
  const [mode] = useColorModes();
  return (
    <SideBarContainer>
      <Box
        fit
        maxHeight={1}
        bg={mode === 'dark' ? 'modifier-darken-100' : 'transparent'}
        borderRight={mode === 'light' ? 1 : 'none'}
        overflowY="auto"
      >
        <Menu>
          {links.map(({ text, pages }) => (
            <SidebarSection text={text} pages={pages} key={text} />
          ))}
        </Menu>
      </Box>
    </SideBarContainer>
  );
};
