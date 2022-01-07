import { createScale } from '../scales/createScale';
import { gridItem, gridItemRatio, size } from '../transforms';

export const color = {
  color: { property: 'color', scale: 'colors' },
  textColor: { property: 'color', scale: 'colors' },
  bg: { property: 'backgroundColor', scale: 'colors' },
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
} as const;

export const border = {
  border: { property: 'border', scale: 'borders' },
  borderX: {
    property: 'border',
    properties: ['borderLeft', 'borderRight'],
    scale: 'borders',
  },
  borderY: {
    property: 'border',
    properties: ['borderTop', 'borderBottom'],
    scale: 'borders',
  },
  borderTop: { property: 'borderTop', scale: 'borders' },
  borderRight: { property: 'borderRight', scale: 'borders' },
  borderBottom: { property: 'borderBottom', scale: 'borders' },
  borderLeft: { property: 'borderLeft', scale: 'borders' },
  // Width
  borderWidth: { property: 'borderWidth' },
  borderWidthX: {
    property: 'borderWidth',
    properties: ['borderLeftWidth', 'borderRightWidth'],
  },
  borderWidthY: {
    property: 'borderWidth',
    properties: ['borderTopWidth', 'borderBottomWidth'],
  },
  borderWidthLeft: { property: 'borderLeftWidth' },
  borderWidthRight: { property: 'borderRightWidth' },
  borderWidthTop: { property: 'borderTopWidth' },
  borderWidthBottom: { property: 'borderBottomWidth' },
  // Radius
  borderRadius: { property: 'borderRadius', scale: 'radii' },
  borderRadiusLeft: {
    property: 'borderRadius',
    properties: ['borderTopLeftRadius', 'borderBottomLeftRadius'],
    scale: 'radii',
  },
  borderRadiusTop: {
    property: 'borderRadius',
    properties: ['borderTopLeftRadius', 'borderTopRightRadius'],
    scale: 'radii',
  },
  borderRadiusBottom: {
    property: 'borderRadius',
    properties: ['borderBottomLeftRadius', 'borderBottomRightRadius'],
    scale: 'radii',
  },
  borderRadiusRight: {
    property: 'borderRadius',
    properties: ['borderTopRightRadius', 'borderBottomRightRadius'],
    scale: 'radii',
  },
  borderRadiusTopLeft: { property: 'borderTopLeftRadius', scale: 'radii' },
  borderRadiusTopRight: { property: 'borderTopRightRadius', scale: 'radii' },
  borderRadiusBottomRight: {
    property: 'borderBottomRightRadius',
    scale: 'radii',
  },
  borderRadiusBottomLeft: {
    property: 'borderBottomLeftRadius',
    scale: 'radii',
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
  gap: { property: 'gap', scale: 'spacing' },
  rowGap: { property: 'rowGap', scale: 'spacing' },
  columnGap: { property: 'columnGap', scale: 'spacing' },
  flow: {
    property: 'gridAutoFlow',
    scale: {
      row: 'row',
      column: 'column',
      dense: 'dense',
      'column-dense': 'column dense',
      'row-dense': 'row dense',
    },
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
  zIndex: { property: 'zIndex' },
  opacity: { property: 'opacity' },
} as const;

export const shadows = {
  boxShadow: { property: 'boxShadow' },
  textShadow: { property: 'textShadow' },
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
  width: { property: 'width', transform: size },
  minWidth: { property: 'minWidth', transform: size },
  maxWidth: { property: 'maxWidth', transform: size },
  height: { property: 'height', transform: size },
  minHeight: { property: 'minHeight', transform: size },
  maxHeight: { property: 'maxHeight', transform: size },
  verticalAlign: { property: 'verticalAlign' },
  ...selfAlignments,
  ...gridItems,
  ...flexItems,
} as const;

export const typography = {
  fontFamily: { property: 'fontFamily', scale: 'fontFamily' },
  fontWeight: {
    property: 'fontWeight',
    scale: {
      400: 400,
      600: 600,
      700: 700,
    },
  },
  lineHeight: {
    property: 'lineHeight',
    scale: 'lineHeight',
    lineHeight: [1, 1.5],
  },
  fontSize: {
    property: 'fontSize',
    scale: {
      64: 64,
      44: 44,
      34: 34,
      26: 26,
      22: 22,
      20: 20,
      18: 18,
      16: 16,
      14: 14,
    },
  },
  letterSpacing: { property: 'letterSpacing' },
  textAlign: { property: 'textAlign' },
  fontStyle: { property: 'fontStyle' },
  textDecoration: { property: 'textDecoration' },
  textTransform: { property: 'textTransform' },
  whiteSpace: { property: 'whiteSpace' },
} as const;

const margin = {
  m: { property: 'margin', scale: 'spacing' },
  mx: {
    property: 'margin',
    properties: ['marginLeft', 'marginRight'],
    scale: 'spacing',
  },
  my: {
    property: 'margin',
    properties: ['marginTop', 'marginBottom'],
    scale: 'spacing',
  },
  mt: { property: 'marginTop', scale: 'spacing' },
  mb: { property: 'marginBottom', scale: 'spacing' },
  mr: { property: 'marginRight', scale: 'spacing' },
  ml: { property: 'marginLeft', scale: 'spacing' },
} as const;

const padding = {
  p: { property: 'padding', scale: 'spacing' },
  px: {
    property: 'padding',
    properties: ['paddingLeft', 'paddingRight'],
    scale: 'spacing',
  },
  py: {
    property: 'padding',
    properties: ['paddingTop', 'paddingBottom'],
    scale: 'spacing',
  },
  pt: { property: 'paddingTop', scale: 'spacing' },
  pb: { property: 'paddingBottom', scale: 'spacing' },
  pr: { property: 'paddingRight', scale: 'spacing' },
  pl: { property: 'paddingLeft', scale: 'spacing' },
} as const;

export const space = {
  ...margin,
  ...padding,
} as const;

export const mode = {
  mode: { property: 'none', scale: 'mode' },
  vars: { property: 'variables' },
} as const;