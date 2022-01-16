import { CompatTheme } from '@animus-ui/core';
import { Theme, useTheme as useEmotionTheme } from '@emotion/react';

export interface CompatTheme extends Theme, Omit<CompatTheme, keyof Theme> {
  _getColorValue: (arg: any) => any;
}

export const useTheme = () => {
  const emotionTheme = useEmotionTheme();

  return emotionTheme as CompatTheme;
};
