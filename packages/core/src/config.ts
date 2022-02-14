import { createAnimus } from './createAnimus';
import { createScale } from './scales/createScale';
import { borderShorthand, gridItem, gridItemRatio, size } from './transforms';

export const color = {
  color: { property: 'color', scale: 'colors' },
  bg: { property: 'backgroundColor', scale: 'colors' },
  gradient: { property: 'backgroundImage', scale: 'gradients' },
  borderColor: { property: 'borderColor', scale: 'colors' },
  borderColorX: {
    property: 'borderColor',
    properties: ['borderLeftColor', 'borderRightColor'],
    scale: 'colors',
  },
  borderColorY: {
    property: 'borderColor',
    properties: ['borderTopColor', 'borderBottomColor'],
    scale: 'colors',
  },
  borderColorLeft: { property: 'borderLeftColor', scale: 'colors' },
  borderColorRight: { property: 'borderRightColor', scale: 'colors' },
  borderColorTop: { property: 'borderTopColor', scale: 'colors' },
  borderColorBottom: { property: 'borderBottomColor', scale: 'colors' },
  fill: { property: 'fill', scale: 'colors' },
  stroke: { property: 'stroke', scale: 'colors' },
} as const;

export const border = {
  border: {
    property: 'border',
    scale: 'borders',
    transform: borderShorthand,
  },
  borderX: {
    property: 'border',
    properties: ['borderLeft', 'borderRight'],
    scale: 'borders',
    transform: borderShorthand,
  },
  borderY: {
    property: 'border',
    properties: ['borderTop', 'borderBottom'],
    scale: 'borders',
    transform: borderShorthand,
  },
  borderTop: {
    property: 'borderTop',
    scale: 'borders',
    transform: borderShorthand,
  },
  borderRight: {
    property: 'borderRight',
    scale: 'borders',
    transform: borderShorthand,
  },
  borderBottom: {
    property: 'borderBottom',
    scale: 'borders',
    transform: borderShorthand,
  },
  borderLeft: {
    property: 'borderLeft',
    scale: 'borders',
    transform: borderShorthand,
  },
  // Width
  borderWidth: { property: 'borderWidth', scale: 'borderWidths' },
  borderWidthX: {
    property: 'borderWidth',
    properties: ['borderLeftWidth', 'borderRightWidth'],
    scale: 'borderWidths',
  },
  borderWidthY: {
    property: 'borderWidth',
    properties: ['borderTopWidth', 'borderBottomWidth'],
    scale: 'borderWidths',
  },
  borderWidthLeft: { property: 'borderLeftWidth', scale: 'borderWidths' },
  borderWidthRight: { property: 'borderRightWidth', scale: 'borderWidths' },
  borderWidthTop: { property: 'borderTopWidth', scale: 'borderWidths' },
  borderWidthBottom: { property: 'borderBottomWidth', scale: 'borderWidths' },
  // Radius
  borderRadius: {
    property: 'borderRadius',
    scale: 'radii',
    transform: size,
  },
  borderRadiusLeft: {
    property: 'borderRadius',
    properties: ['borderTopLeftRadius', 'borderBottomLeftRadius'],
    scale: 'radii',
    transform: size,
  },
  borderRadiusTop: {
    property: 'borderRadius',
    properties: ['borderTopLeftRadius', 'borderTopRightRadius'],
    scale: 'radii',
    transform: size,
  },
  borderRadiusBottom: {
    property: 'borderRadius',
    properties: ['borderBottomLeftRadius', 'borderBottomRightRadius'],
    scale: 'radii',
    transform: size,
  },
  borderRadiusRight: {
    property: 'borderRadius',
    properties: ['borderTopRightRadius', 'borderBottomRightRadius'],
    scale: 'radii',
    transform: size,
  },
  borderRadiusTopLeft: {
    property: 'borderTopLeftRadius',
    scale: 'radii',
    transform: size,
  },
  borderRadiusTopRight: {
    property: 'borderTopRightRadius',
    scale: 'radii',
    transform: size,
  },
  borderRadiusBottomRight: {
    property: 'borderBottomRightRadius',
    scale: 'radii',
    transform: size,
  },
  borderRadiusBottomLeft: {
    property: 'borderBottomLeftRadius',
    scale: 'radii',
    transform: size,
  },
  // Style
  borderStyle: { property: 'borderStyle' },
  borderStyleX: {
    property: 'borderStyle',
    properties: ['borderLeftStyle', 'borderRightStyle'],
  },
  borderStyleY: {
    property: 'borderStyle',
    properties: ['borderTopStyle', 'borderBottomStyle'],
  },
  borderStyleLeft: { property: 'borderLeftStyle' },
  borderStyleRight: { property: 'borderRightStyle' },
  borderStyleTop: { property: 'borderTopStyle' },
  borderStyleBottom: { property: 'borderBottomStyle' },
} as const;

const gaps = {
  gap: { property: 'gap', scale: 'space' },
  rowGap: { property: 'rowGap', scale: 'space' },
  columnGap: { property: 'columnGap', scale: 'space' },
} as const;

const selfAlignments = {
  justifySelf: { property: 'justifySelf' },
  alignSelf: { property: 'alignSelf' },
  gridArea: { property: 'gridArea' },
  area: { property: 'gridArea' },
} as const;

const alignments = {
  justifyContent: { property: 'justifyContent' },
  justifyItems: { property: 'justifyItems' },
  alignItems: { property: 'alignItems' },
  alignContent: { property: 'alignContent' },
  ...selfAlignments,
} as const;

const flexItems = {
  flexBasis: { property: 'flexBasis' },
  flexShrink: { property: 'flexShrink' },
  flexGrow: { property: 'flexGrow' },
  order: { property: 'order' },
} as const;

export const flex = {
  flexDirection: { property: 'flexDirection' },
  flexWrap: { property: 'flexWrap' },
  flex: { property: 'flex' },
  ...alignments,
  ...flexItems,
  ...gaps,
} as const;

const gridItems = {
  gridColumn: { property: 'gridColumn' },
  gridRow: { property: 'gridRow' },
  gridColumnStart: { property: 'gridColumnStart' },
  gridRowStart: { property: 'gridRowStart' },
  gridColumnEnd: { property: 'gridColumnEnd' },
  gridRowEnd: { property: 'gridRowEnd' },
} as const;

export const grid = {
  gridAutoColumns: { property: 'gridAutoColumns' },
  gridAutoRows: { property: 'gridAutoRows' },
  gridTemplateColumns: { property: 'gridTemplateColumns' },
  gridTemplateRows: { property: 'gridTemplateRows' },
  gridTemplateAreas: { property: 'gridTemplateAreas' },
  gridAutoFlow: { property: 'gridAutoFlow' },
  flow: {
    property: 'gridAutoFlow',
    scale: createScale<
      'row' | 'column' | 'dense' | `${'row' | 'column'} dense`
    >(),
  },
  cols: {
    property: 'gridTemplateColumns',
    transform: gridItemRatio,
    scale: createScale<string | number>(),
  },
  rows: {
    property: 'gridTemplateRows',
    transform: gridItemRatio,
    scale: createScale<string | number>(),
  },
  autoRows: {
    property: 'gridAutoRows',
    transform: gridItem,
  },
  autoCols: {
    property: 'gridAutoColumns',
    transform: gridItem,
  },
  alignAll: {
    property: 'justifyContent',
    properties: ['justifyContent', 'alignItems'],
  },
  ...alignments,
  ...gridItems,
  ...gaps,
} as const;

export const background = {
  background: { property: 'background' },
  backgroundImage: { property: 'backgroundImage' },
  backgroundSize: { property: 'backgroundSize' },
  backgroundRepeat: { property: 'backgroundRepeat' },
  backgroundPosition: { property: 'backgroundPosition' },
} as const;

export const positioning = {
  position: { property: 'position' },
  inset: {
    property: 'inset',
    properties: ['top', 'right', 'bottom', 'left'],
    transform: size,
  },
  top: { property: 'top', transform: size },
  right: { property: 'right', transform: size },
  bottom: { property: 'bottom', transform: size },
  left: { property: 'left', transform: size },
  zIndex: { property: 'zIndex', scale: 'zIndices' },
  opacity: { property: 'opacity', scale: 'opacities' },
} as const;

export const shadows = {
  boxShadow: { property: 'boxShadow', scale: 'shadows' },
  textShadow: { property: 'textShadow', scale: 'shadows' },
} as const;

export const layout = {
  display: { property: 'display' },
  overflow: { property: 'overflow' },
  overflowX: { property: 'overflowX' },
  overflowY: { property: 'overflowY' },
  size: {
    property: 'width',
    properties: ['width', 'height'],
    transform: size,
  },
  width: {
    property: 'width',
    transform: size,
  },
  minWidth: { property: 'minWidth', transform: size },
  maxWidth: { property: 'maxWidth', transform: size },
  height: { property: 'height', transform: size },
  minHeight: {
    property: 'minHeight',
    transform: size,
  },
  maxHeight: {
    property: 'maxHeight',
    transform: size,
  },
  verticalAlign: { property: 'verticalAlign' },
  ...selfAlignments,
  ...gridItems,
  ...flexItems,
} as const;

export const typography = {
  fontFamily: { property: 'fontFamily', scale: 'fonts' },
  fontWeight: {
    property: 'fontWeight',
    scale: 'fontWeights',
  },
  lineHeight: {
    property: 'lineHeight',
    scale: 'lineHeights',
    lineHeight: 'lineHeight',
  },
  fontSize: {
    property: 'fontSize',
    scale: 'fontSizes',
  },
  letterSpacing: { property: 'letterSpacing', scale: 'letterSpacings' },
  textAlign: { property: 'textAlign' },
  fontStyle: { property: 'fontStyle' },
  textDecoration: { property: 'textDecoration' },
  textTransform: { property: 'textTransform' },
  whiteSpace: { property: 'whiteSpace' },
} as const;

const margin = {
  m: { property: 'margin', scale: 'space' },
  mx: {
    property: 'margin',
    properties: ['marginLeft', 'marginRight'],
    scale: 'space',
  },
  my: {
    property: 'margin',
    properties: ['marginTop', 'marginBottom'],
    scale: 'space',
  },
  mt: { property: 'marginTop', scale: 'space' },
  mb: { property: 'marginBottom', scale: 'space' },
  mr: { property: 'marginRight', scale: 'space' },
  ml: { property: 'marginLeft', scale: 'space' },
} as const;

const padding = {
  p: { property: 'padding', scale: 'space' },
  px: {
    property: 'padding',
    properties: ['paddingLeft', 'paddingRight'],
    scale: 'space',
  },
  py: {
    property: 'padding',
    properties: ['paddingTop', 'paddingBottom'],
    scale: 'space',
  },
  pt: { property: 'paddingTop', scale: 'space' },
  pb: { property: 'paddingBottom', scale: 'space' },
  pr: { property: 'paddingRight', scale: 'space' },
  pl: { property: 'paddingLeft', scale: 'space' },
} as const;

export const space = {
  ...margin,
  ...padding,
} as const;

export const transitions = {
  transition: {
    property: 'transition',
    scale: 'transitions',
  },
  animation: {
    property: 'animation',
    scale: 'animations',
  },
  animationPlayState: {
    property: 'animationPlayState',
  },
} as const;

export const mode = {
  mode: { property: 'none', scale: 'mode' },
} as const;

export const vars = {
  vars: { property: 'variables' },
} as const;

export const config = createAnimus()
  .addGroup('flex', flex)
  .addGroup('grid', grid)
  .addGroup('mode', mode)
  .addGroup('vars', vars)
  .addGroup('space', space)
  .addGroup('color', color)
  .addGroup('layout', layout)
  .addGroup('borders', border)
  .addGroup('shadows', shadows)
  .addGroup('background', background)
  .addGroup('typography', typography)
  .addGroup('positioning', positioning)
  .addGroup('transitions', transitions);

export const animus = config.build();
