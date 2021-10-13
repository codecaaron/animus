import { parseToHsl, hsla, darken, lighten } from "polished";
import { colors } from "./colors";

const createColorMode = <
  T extends { text: string; background: string; [key: string]: string }
>(
  type: "dark" | "light",
  config: T
) => {
  const backgroundHsl = parseToHsl(config["text"]);

  const backgrounds = {
    emphasizeBackground: hsla({
      ...backgroundHsl,
      alpha: 0.05,
    }),
    muteBackground: hsla({ ...backgroundHsl, alpha: 0.1 }),
  };
  const theme = {} as Record<
    keyof T | (keyof T extends string ? `${keyof T}Muted` : never),
    string
  >;

  for (const key in config) {
    const isLight = type === "light";
    const isDark = key === "background" ? !isLight : isLight;
    let method = darken;
    let opacity = key === "text" ? 0.5 : 0.15;

    if (!isDark) {
      method = darken;
    } else if (isDark) {
      method = lighten;
    }

    const muted = `${key}Muted` as `${typeof key}Muted`;
    theme[key] = config[key];
    theme[muted] = method(opacity, config[key]);
  }

  return { ...backgrounds, ...theme };
};

export const theme = {
  breakpoints: {
    xs: "@media screen and (min-width: 480px)",
    md: "@media screen and (min-width: 767px)",
    sm: "@media screen and (min-width: 1024px)",
    lg: "@media screen and (min-width: 1248px)",
    xl: "@media screen and (min-width: 1440px)",
  },
  space: {
    0: 0,
    4: 4,
    8: 8,
    12: 12,
    16: 16,
    24: 24,
    32: 32,
    48: 48,
    96: 96,
  },
  fontSize: {
    14: 14,
    16: 16,
    18: 18,
    22: 22,
    26: 26,
    32: 32,
    48: 48,
    64: 64,
  },
  grids: {
    12: 12,
  },
  columns: {
    1: 1,
    2: 2,
    3: 3,
    4: 4,
    5: 5,
    6: 6,
    7: 7,
    8: 8,
    9: 9,
    10: 10,
    11: 11,
    12: 12,
  },
  timings: {
    fast: "150ms",
  },
  fonts: {
    base: "Apercu, Arial, Helvetica",
    accent: "Suisse",
  },
  colors: {
    text: "var(--text)",
    textMuted: "var(--textMuted)",
    background: "var(--background)",
    backgroundMuted: "var(--backgroundMuted)",
    primary: "var(--primary)",
    primaryMuted: "var(--primaryMuted)",
    secondary: "var(--secondary)",
    secondaryMuted: "var(--secondaryMuted)",
    muteBackground: "var(--muteBackground)",
    emphasizeBackground: "var(--emphasizeBackground)",
  },
  colorModes: {
    activeMode: "light",
    modes: {
      dark: createColorMode("dark", {
        text: colors.white,
        background: colors.navy,
        primary: colors.yellow,
        secondary: colors.white,
      }),
      stark: createColorMode("dark", {
        text: colors.white,
        background: colors.hyper,
        primary: colors.yellow,
        secondary: colors.white,
      }),
      light: createColorMode("light", {
        text: colors.navy,
        background: colors.white,
        primary: colors.hyper,
        secondary: colors.navy,
      }),
      pale: createColorMode("light", {
        text: colors.black,
        background: colors.paleBlue,
        primary: colors.red,
        secondary: colors.blue,
      }),
    },
  },
} as const;

type Local = typeof theme;

declare module "@emotion/react" {
  export interface Theme extends Local {
    colorModes: {
      activeMode: keyof Local["colorModes"]["modes"];
      modes: Local["colorModes"]["modes"];
    };
  }
}
