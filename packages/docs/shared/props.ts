import { variance } from "@animus/core";
import { Theme } from "@emotion/react";

export const varia = variance.withTheme<Theme>();

export const padding = varia.create({
  p: {
    property: "padding",
    properties: ["paddingTop", "paddingBottom", "paddingLeft", "paddingRight"],
    scale: "space",
  },
  pX: {
    property: "padding",
    properties: ["paddingLeft", "paddingRight"],
    scale: "space",
  },
  pY: {
    property: "padding",
    properties: ["paddingTop", "paddingBottom"],
    scale: "space",
  },
  pT: { property: "paddingTop", scale: "space" },
  pB: { property: "paddingBottom", scale: "space" },
  pL: { property: "paddingLeft", scale: "space" },
  pR: { property: "paddingRight", scale: "space" },
});

export const margin = varia.create({
  m: {
    property: "margin",
    properties: ["marginTop", "marginBottom", "marginLeft", "marginRight"],
    scale: "space",
  },
  mX: {
    property: "margin",
    properties: ["marginLeft", "marginRight"],
    scale: "space",
  },
  mY: {
    property: "margin",
    properties: ["marginTop", "marginBottom"],
    scale: "space",
  },
  mT: { property: "marginTop", scale: "space" },
  mB: { property: "marginBottom", scale: "space" },
  mL: { property: "marginLeft", scale: "space" },
  mR: { property: "marginRight", scale: "space" },
});

export const space = varia.compose(margin, padding);

const typographyConfig = {
  font: { property: "fontFamily", scale: "fonts" },
  textTransform: { property: "textTransform" },
  weight: { property: "fontWeight" },
  fontStyle: { property: "fontStyle" },
  letterSpacing: { property: "letterSpacing" },
  fontSize: {
    property: "fontSize",
    scale: "fontSize",
    transform: (val: number) => `${val / 16}rem`,
  },
} as const;

export const typography = varia.create(typographyConfig);

const colorConfig = {
  bg: { property: "background", scale: "colors" },
  borderColor: { property: "borderColor", scale: "colors" },
  color: { property: "color", scale: "colors" },
} as const;

export const colors = varia.create(colorConfig);

export const animationConfig = {
  transition: { property: "transition" },
} as const;

export const animation = varia.create(animationConfig);

const layoutConfig = {
  display: { property: "display" },
  w: { property: "width" },
  maxW: { property: "maxWidth" },
  minW: { property: "minWidth" },
  h: { property: "height" },
  maxH: { property: "maxHeight" },
  minH: { property: "minHeight" },
  verticalAlign: { property: "verticalAlign" },
} as const;

export const layout = varia.create(layoutConfig);

export const { variant, css: themeCss } = varia.createStatic(
  {
    ...typographyConfig,
    ...colorConfig,
    ...animationConfig,
    ...layoutConfig,
  },
  { withBase: true }
);
