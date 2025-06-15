import { css, Global, useTheme } from '@emotion/react';
import { serializeTokens } from '@syzygos/theming';
import { isEmpty, mapValues } from 'lodash';
import React, { useMemo } from 'react';

import { ColorModes } from '../components/ColorMode';

const EMPTY_THEME = {};

export const ColorScheme = ({ mode }: { mode?: ColorModes }) => {
  const theme = useTheme() ?? EMPTY_THEME;

  const modeVars = useMemo(() => {
    const { modes, colors } = theme;
    if (isEmpty(colors)) {
      return { light: { variables: {} }, dark: { variables: {} } };
    }

    const light = serializeTokens(
      mapValues(modes.light, (color) => colors[color]),
      'color',
      theme
    );

    const dark = serializeTokens(
      mapValues(modes.dark, (color) => colors[color]),
      'color',
      theme
    );
    return { light, dark };
  }, [theme]);

  const { colors } = theme;

  const rootColors = useMemo(() => {
    if (mode) {
      return { ':root': modeVars[mode].variables };
    }
    return {
      ':root': {
        '@media (prefers-color-scheme: dark)': modeVars.dark.variables,
        '@media (prefers-color-scheme: light)': modeVars.light.variables,
      },
    };
  }, [mode, modeVars]);

  return (
    <>
      <Global
        styles={css`
          ${rootColors}

          body {
            color: ${colors?.text ?? 'black'};
            background-color: ${colors?.background ?? 'white'};
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
