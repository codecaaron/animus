import { AbstractTheme } from '@animus-ui/core';

type Colors<T = {}> = {
  primary: T;
  'primary-hover': T;
  secondary: T;
  'secondary-hover': T;
  scrollbar: T;
  text: T;
  background: T;
  'background-current': T;
};

export interface ModeCompatibleTheme extends AbstractTheme {
  colors: Colors;
  modes: {
    light: Colors<keyof Colors>;
    dark: Colors<keyof Colors>;
  };
  mode: 'light' | 'dark';
  _getColorValue: (arg: keyof Colors) => string;
}
declare module '@emotion/react' {
  export interface Theme extends ModeCompatibleTheme {}
}
