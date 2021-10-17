import { theme } from '@animus/theme';

type AnimusTheme = typeof theme;

declare module '@emotion/react' {
  export interface Theme extends AnimusTheme {}
}

export * from './AnimusProvider';
export * from './components';
export * from './ComponentProvider';
