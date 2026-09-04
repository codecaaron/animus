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

// The written guides were removed until the system-definition API settles
// (vocabulary-registration); restore sections here when they return.
export const DOCS_NAV: NavEntry[] = [
  { label: 'Overview', path: '/docs' },
  { label: 'Examples', path: '/docs/examples' },
];
