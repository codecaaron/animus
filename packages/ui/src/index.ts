import { theme } from '@animus/theme';

export * from '@animus/core';
export * from '@animus/props';
export * from '@animus/provider';
export * from '@animus/elements';
export { theme } from '@animus/theme';
export * from './components/ComponentProvider';

export type AnimusTheme = typeof theme;

declare module '@emotion/react' {
  export interface Theme extends AnimusTheme {}
}
