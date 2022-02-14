import { createContext } from 'react';

export const ThemeControlContext = createContext<{ onChangeMode?: () => void }>(
  {}
);
