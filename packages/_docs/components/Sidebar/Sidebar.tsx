import { animus } from '@animus-ui/core';
import { Link } from '@animus-ui/components';
import { links } from './constants';
import { useRouter } from 'next/dist/client/router';
import { keyframes } from '@emotion/react';

const slide = keyframes`
  0% {
    background-size: 300px 100px;
		background-position: 0% 50%;
	}
	100% {
		background-position: 300px 50%;
    background-size: 300px 100px;
	}
`;

export const SideBarContainer = animus
  .styles({
    area: 'sidebar',
    height: 1,
    position: 'sticky',
    top: '3.5rem',
    maxHeight: 'calc(100vh - 3.5rem)',
    bg: 'background-current',
    zIndex: 3,
    counterReset: 'menu',
  })
  .asComponent('div');

const Menu = animus
  .styles({
    p: 16,
    pl: 32,
    listStyleType: 'none',
    counterReset: 'menu',
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

const FlowButton = animus
  .styles({
    border: 'none',
    boxShadow: 'none',
    fontWeight: 700,
    fontSize: 18,
    p: 0,
    bg: 'transparent',
    textAlign: 'left',
    cursor: 'pointer',
    fontFamily: 'monospace',
    letterSpacing: '1px',
    transition: 'text-shadow 200ms ease',
    textShadow: ({ colors }) =>
      `2px -2px ${colors.text}, 2px -2px 4px ${colors['background']}`,
    backgroundImage: ({ colors }) =>
      `linear-gradient(90deg, ${colors.tertiary} 0%, ${colors.primary} 50%, ${colors.tertiary} 100%)`,
    backgroundSize: '300px 100px',
    animation: ` ${slide} 5s linear infinite`,
    backgroundClip: 'text',
    textFillColor: 'transparent' as any,
  })
  .asComponent('button');

const SidebarSection: React.FC<typeof links[number]> = ({
  text,
  pages,
  isOpen,
}) => {
  const { asPath } = useRouter();

  return (
    <MenuItem key={text}>
      <FlowButton>{text}</FlowButton>
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
