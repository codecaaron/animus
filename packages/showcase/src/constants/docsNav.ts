export interface NavItem {
  label: string;
  path: string;
}

export interface NavSection {
  label: string;
  path: string;
  children: NavItem[];
}

export type NavEntry = NavItem | NavSection;

export function hasChildren(entry: NavEntry): entry is NavSection {
  return 'children' in entry && entry.children.length > 0;
}

export const DOCS_NAV: NavEntry[] = [
  { label: 'Why Animus', path: '/docs' },
  { label: 'Getting Started', path: '/docs/start' },
  {
    label: 'Core Concepts',
    path: '/docs/concepts',
    children: [
      { label: 'The Builder Chain', path: '/docs/concepts/builder-chain' },
      {
        label: 'The Cascade Contract',
        path: '/docs/concepts/cascade-contract',
      },
      { label: 'Design Tokens', path: '/docs/concepts/design-tokens' },
      { label: 'Responsive Props', path: '/docs/concepts/responsive-props' },
      { label: 'Variants & States', path: '/docs/concepts/variants-states' },
      {
        label: 'Slot Composition',
        path: '/docs/concepts/slot-composition',
      },
    ],
  },
  {
    label: 'API Reference',
    path: '/docs/api',
    children: [
      { label: 'createTheme()', path: '/docs/api/create-theme' },
      { label: 'createSystem()', path: '/docs/api/create-system' },
      { label: 'Builder Chain', path: '/docs/api/builder-chain' },
      { label: 'createTransform()', path: '/docs/api/create-transform' },
      { label: 'Prop Groups', path: '/docs/api/prop-groups' },
      { label: 'Vite Plugin', path: '/docs/api/vite-plugin' },
    ],
  },
  { label: 'Examples', path: '/docs/examples' },
];
