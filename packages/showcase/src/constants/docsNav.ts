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
  {
    label: 'Component Authoring',
    path: '/docs/authoring',
    children: [
      { label: 'Selectors & Nesting', path: '/docs/authoring/selectors' },
      { label: 'Conditions', path: '/docs/authoring/conditions' },
      {
        label: 'Custom Props & Transforms',
        path: '/docs/authoring/custom-props',
      },
    ],
  },
  {
    label: 'Architecture & Theming',
    path: '/docs/architecture',
    children: [
      { label: 'Theming & Tokens', path: '/docs/architecture/theming' },
      { label: 'System Setup', path: '/docs/architecture/system-setup' },
      {
        label: 'Theme Extension',
        path: '/docs/architecture/theme-extension',
      },
      {
        label: 'Library Authoring',
        path: '/docs/architecture/library-authoring',
      },
    ],
  },
  {
    label: 'Advanced',
    path: '/docs/advanced',
    children: [
      { label: 'TypeScript', path: '/docs/advanced/typescript' },
      {
        label: 'Framework Agnostic',
        path: '/docs/advanced/framework-agnostic',
      },
      { label: 'Svelte', path: '/docs/advanced/svelte' },
    ],
  },
  {
    label: 'Reference',
    path: '/docs/reference',
    children: [
      { label: 'createTheme()', path: '/docs/reference/create-theme' },
      { label: 'createSystem()', path: '/docs/reference/create-system' },
    ],
  },
  { label: 'Examples', path: '/docs/examples' },
];
