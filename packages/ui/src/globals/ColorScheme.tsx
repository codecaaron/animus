import React from 'react';
import { css, Global, useTheme } from '@emotion/react';

export const ColorScheme = () => {
  const theme = useTheme();
  return (
    <Global
      styles={css`
        body {
          color: ${theme?.colors?.text};
          background-color: ${theme?.colors?.background};
        }

        :root {
          scrollbar-width: thin;
          scrollbar-color: ${theme?.colors?.scrollbar} transparent;
        }

        ::-webkit-scrollbar-thumb {
          background-color: ${theme?.colors?.scrollbar};
        }

        ::-webkit-scrollbar-track,
        ::-webkit-scrollbar-corner {
          background-color: transparent;
        }
        ::-webkit-scrollbar {
          width: 0.5rem;
          height: 0.5rem;
        }
        ::-webkit-scrollbar-thumb {
          border-radius: 0;
        }
      `}
    />
  );
};
