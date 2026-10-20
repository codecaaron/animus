import { createTheme } from '@animus-ui/system';
import { describe, expect, it } from 'vitest';

import { createAnimusTokens } from '../src/host/animus/tokens';

const colors = {
  ink: '#101014',
  bone: '#f5f2ea',
  ash: '#8a8a8a',
  slate: '#3a3f4b',
} as const;

const light = { bg: 'bone', fg: 'ink', muted: 'ash' };
const dark = { bg: 'ink', fg: 'bone', muted: 'ash' };
const dim = { bg: 'slate', fg: 'bone', muted: 'ash' };

const themeCss = (
  initial: string,
  modes: Record<string, Record<string, string>>,
  systemPreference: { light: string; dark: string }
) =>
  createTheme()
    .addColors(colors)
    .addColorModes(initial, modes, { systemPreference })
    .build()
    .serialize().variableCss;

// Contract: the oracle's default mode is the mode an attributeless root
// shows, whatever order the stylesheet writes its mode rules in, and the
// modes keep one order whether or not the emitter folded its initial mode.
describe('the default mode is the mode an attributeless root shows', () => {
  it.each([
    [
      'a folded light initial mode',
      'light',
      { light, dark },
      { light: 'light', dark: 'dark' },
    ],
    [
      "an initial mode that is the other preference's",
      'dim',
      { light, dark, dim },
      { light: 'light', dark: 'dim' },
    ],
    [
      'an initial mode with fewer properties',
      'light',
      { light: { bg: 'bone', fg: 'ink' }, dark },
      { light: 'light', dark: 'dark' },
    ],
    [
      'an unmapped initial mode',
      'dim',
      { light, dark, dim },
      { light: 'light', dark: 'dark' },
    ],
  ] as const)('%s', (_theme, initial, modes, systemPreference) => {
    const tokens = createAnimusTokens(
      themeCss(initial, modes, systemPreference)
    );
    expect(tokens.defaultMode()).toBe(initial);
    expect(tokens.modes()).toEqual(Object.keys(modes).sort());
  });
});
