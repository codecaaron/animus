import { animus } from '@animus-ui/core';
import { Link } from '@animus-ui/components';
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
    pl: 24,
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

const SidebarSection: React.FC<typeof links[number]> = ({
  text,
  isOpen,
  pages,
}) => {
  const [menuOpen, setMenuOpen] = useState(isOpen);

  return (
    <MenuItem key={text}>
      <AccordionButton onClick={() => setMenuOpen((prev) => !prev)}>
        {text}
      </AccordionButton>
      {menuOpen && (
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
  return (
    <SideBarContainer>
      <Menu>
        {links.map(({ text, isOpen, pages }) => (
          <SidebarSection
            text={text}
            isOpen={isOpen}
            pages={pages}
            key={text}
          />
        ))}
      </Menu>
    </SideBarContainer>
  );
};
