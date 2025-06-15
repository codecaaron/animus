import { animus } from '@syzygos/core';
import { FlowLink } from 'elements/FlowLink';
import { useRouter } from 'next/dist/client/router';

const LINKS = [
  { text: 'Introduction', href: '/start' },
  { text: 'Configure', href: '/configure' },
  { text: 'Properties', href: '/properties' },
  { text: 'Variants', href: '/variants' },
  { text: 'States', href: '/states' },
  { text: 'Components', href: '/component' },
  { text: 'Styling Philosophy', href: '/styling' },
  { text: 'Responsive', href: '/responsive' },
  { text: 'Theming', href: '/theming' },
];

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
  .asElement('ul');

const MenuItem = animus
  .styles({
    p: 4,
    fontSize: 18,
    lineHeight: 'base',
  })
  .asElement('li');

export const Sidebar: React.FC = () => {
  const { asPath } = useRouter();
  return (
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
  );
};
