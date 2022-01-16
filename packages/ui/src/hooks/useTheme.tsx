import { AbstractTheme } from '@animus-ui/core';
import { Theme, useTheme as useEmotionTheme } from '@emotion/react';

export interface ModeCompatibleTheme extends AbstractTheme {
  colors: {};
  modes: { light: {}; dark: {} };
  mode: 'light' | 'dark';
  _getColorValue: (arg: any) => any;
}

type CompatibleTheme<T> = keyof T extends 'mode' ? Theme : ModeCompatibleTheme;

export const useTheme = (): CompatibleTheme<Theme> => {
  const emotionTheme: any = useEmotionTheme();
  return emotionTheme;
};
