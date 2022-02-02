import { css, Global, useTheme } from '@emotion/react';
import React from 'react';

export const ColorScheme = () => {
  const { colors } = useTheme() ?? {};
  return (
    <>
      <Global
        styles={css`
          body {
            color: ${colors?.text ?? 'black'};
            background-color: ${colors?.background ?? 'white'};
            transition: 100ms linear background-color;
          }
        `}
      />
      {colors.scrollbar && (
        <Global
          styles={css`
            :root {
              scrollbar-width: thin;
              scrollbar-color: ${colors?.scrollbar ?? 'grey'} transparent;
            }

            ::-webkit-scrollbar-thumb {
              background-color: ${colors?.scrollbar ?? 'gr'};
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
      )}
    </>
  );
};
