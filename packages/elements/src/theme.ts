import { theme } from '@animus/theme';

export type AnimusTheme = typeof theme;

declare module '@emotion/react' {
  export interface Theme extends AnimusTheme {}
}
