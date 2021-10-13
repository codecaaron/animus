import { ThemeProps } from '@animus/core';
import { serializeTokens } from '@animus/theming';
import { Theme, ThemeProvider, useTheme } from '@emotion/react';
import { mapValues, pick } from 'lodash';
import React, { ComponentProps, forwardRef, useMemo } from 'react';
import { VariableProvider } from './VariableProvider';

export type Colors = keyof Theme['colors'];
export type ColorModeConfig = Theme['modes'];
export type ColorModes = keyof ColorModeConfig;
export type ColorModeShape = ColorModeConfig[ColorModes];
export type ColorAlias = keyof ColorModeShape;

export const modeColorProps = ({
  theme,
  mode,
}: ThemeProps<{ mode?: ColorModes }>) => {
  if (!theme || !mode || mode === theme?.mode) return {};
  const { colors } = theme;
  return serializeTokens(
    mapValues(theme?.modes[mode], (color) => colors[color]),
    'color',
    theme
  ).variables;
};

export function useColorModes(): [
  ColorModes,
  ColorModeShape,
  ColorModeConfig,
  (color: Colors) => string
] {
  const { mode, modes, _getColorValue: getColorValue } = useTheme() || {};
  return [mode, modes?.[mode], modes, getColorValue];
}

export function useCurrentMode(mode?: ColorModes) {
  const [activeMode] = useColorModes();
  return mode ?? activeMode;
}
export interface ColorModeProps
  extends Omit<ComponentProps<typeof VariableProvider>, 'bg' | 'mode'> {
  alwaysSetVariables?: boolean;
  mode: ColorModes;
  bg?: Colors;
}

export const ColorMode = forwardRef<HTMLDivElement, ColorModeProps>(
  ({ mode, alwaysSetVariables, bg, ...rest }, ref) => {
    const theme = useTheme();
    const { modes, mode: active, colors } = theme;
    const contextBg = bg ? 'background-current' : undefined;

    /** Serialize color variables for the current mode
     * 1. If all variables are requried add all mode variables to the current context
     * 2. If the user has specified a background color - set that color to the current-bg
     * 3. If not
     */
    const { variables } = useMemo(() => {
      return serializeTokens(
        mapValues(modes[mode], (color, key) => {
          if (key === 'background-current' && typeof bg !== 'undefined') {
            return colors[bg];
          }
          return colors[color];
        }),
        'color',
        theme
      );
    }, [colors, mode, modes, theme, bg]);

    if (active === mode) {
      const vars = alwaysSetVariables
        ? variables
        : pick(variables, ['--color-background-current']);

      return (
        <VariableProvider {...rest} vars={vars} bg={contextBg} ref={ref} />
      );
    }

    return (
      <ThemeProvider theme={{ mode }}>
        <VariableProvider {...rest} vars={variables} bg={contextBg} ref={ref} />
      </ThemeProvider>
    );
  }
);
