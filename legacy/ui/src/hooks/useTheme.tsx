import { Theme, useTheme as useEmotionTheme } from '@emotion/react';

export const useTheme = (): Theme => {
  const emotionTheme = useEmotionTheme();
  return emotionTheme;
};
