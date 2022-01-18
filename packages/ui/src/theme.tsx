import { AbstractTheme } from '@animus-ui/core';

type Colors<T = {}> = {
  primary: T;
  secondary: T;
  scrollbar: T;
  text: T;
  background: T;
};

export interface ModeCompatibleTheme extends AbstractTheme {
  colors: Colors;
  modes: {
    light: Colors<keyof Colors>;
    dark: Colors<keyof Colors>;
  };
  mode: 'light' | 'dark';
  _getColorValue: (arg: any) => any;
}
declare module '@emotion/react' {
  export interface Theme extends ModeCompatibleTheme {}
}
