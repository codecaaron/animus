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
  { label: 'Introduction', path: '/docs' },
  { label: 'Getting Started', path: '/docs/start' },
  {
    label: 'Integrations',
    path: '/docs/compiler',
    children: [
      { label: 'Vite Plugin', path: '/docs/compiler/vite-plugin' },
      { label: 'Next.js & Remix', path: '/docs/compiler/nextjs-remix' },
    ],
  },
  {
    label: 'Architecture & Theming',
    path: '/docs/architecture',
    children: [
      { label: 'Theming & Tokens', path: '/docs/architecture/theming' },
      { label: 'Color Modes', path: '/docs/architecture/color-modes' },
      { label: 'System Setup', path: '/docs/architecture/system-setup' },
    ],
  },
  {
    label: 'Component Authoring',
    path: '/docs/authoring',
    children: [
      { label: 'Base Styling', path: '/docs/authoring/base-styling' },
      { label: 'Variants & States', path: '/docs/authoring/variants-states' },
      { label: 'System Props', path: '/docs/authoring/system-props' },
      { label: 'Composition', path: '/docs/authoring/composition' },
    ],
  },
  {
    label: 'Advanced',
    path: '/docs/advanced',
    children: [
      { label: 'TypeScript', path: '/docs/advanced/typescript' },
      { label: 'Framework Agnostic', path: '/docs/advanced/framework-agnostic' },
    ],
  },
  {
    label: 'Reference',
    path: '/docs/reference',
    children: [
      { label: 'Builder Chain', path: '/docs/reference/builder-chain' },
      { label: 'createTheme()', path: '/docs/reference/create-theme' },
      { label: 'createSystem()', path: '/docs/reference/create-system' },
      { label: 'compose()', path: '/docs/reference/compose' },
    ],
  },
  {
    label: 'Support',
    path: '/docs/support',
    children: [
      { label: 'Troubleshooting', path: '/docs/support/troubleshooting' },
    ],
  },
  { label: 'Examples', path: '/docs/examples' },
];
