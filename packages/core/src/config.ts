import { createScale } from './scales/createScale';
import { gridItem, gridItemRatio, size } from './transforms';
import { createAnimus } from './createAnimus';

const transforms = {
  border: (val: string | number) => {
    const width = typeof val === 'number' ? `${val}px` : val;
    return `${width} solid currentColor`;
  },
  radii: (val: string | number) => {
    return typeof val === 'number' ? `${val}px` : val;
  },
};

export const scales = {
  dimensions: createScale<number | `${number}${'px' | 'rem' | '%'}`>(),
  spacing: [0, 4, 8, 12, 16, 24, 32, 40, 48, 64, 96],
  fontSize: [64, 44, 34, 26, 22, 20, 18, 16, 14],
  lineHeight: {
    base: 1.5,
    title: 1,
  },
  fontWeight: [400, 600, 700],
  fontFamily: {
    base: 'sans-serif',
    title: 'Lato, sans-serif',
    mono: 'monospace',
  },
  radii: [2, 4, 6, 8],
  borders: [1, 2, 3],
} as const;

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
  border: {
    property: 'border',
    scale: scales.borders,
    transform: transforms.border,
  },
  borderX: {
    property: 'border',
    properties: ['borderLeft', 'borderRight'],
    scale: scales.borders,
    transform: transforms.border,
  },
  borderY: {
    property: 'border',
    properties: ['borderTop', 'borderBottom'],
    scale: scales.borders,
    transform: transforms.border,
  },
  borderTop: {
    property: 'borderTop',
    scale: scales.borders,
    transform: transforms.border,
  },
  borderRight: {
    property: 'borderRight',
    scale: scales.borders,
    transform: transforms.border,
  },
  borderBottom: {
    property: 'borderBottom',
    scale: scales.borders,
    transform: transforms.border,
  },
  borderLeft: {
    property: 'borderLeft',
    scale: scales.borders,
    transform: transforms.border,
  },
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
  borderRadius: {
    property: 'borderRadius',
    scale: scales.radii,
    transform: transforms.radii,
  },
  borderRadiusLeft: {
    property: 'borderRadius',
    properties: ['borderTopLeftRadius', 'borderBottomLeftRadius'],
    scale: scales.radii,
    transform: transforms.radii,
  },
  borderRadiusTop: {
    property: 'borderRadius',
    properties: ['borderTopLeftRadius', 'borderTopRightRadius'],
    scale: scales.radii,
    transform: transforms.radii,
  },
  borderRadiusBottom: {
    property: 'borderRadius',
    properties: ['borderBottomLeftRadius', 'borderBottomRightRadius'],
    scale: scales.radii,
    transform: transforms.radii,
  },
  borderRadiusRight: {
    property: 'borderRadius',
    properties: ['borderTopRightRadius', 'borderBottomRightRadius'],
    scale: scales.radii,
    transform: transforms.radii,
  },
  borderRadiusTopLeft: {
    property: 'borderTopLeftRadius',
    scale: scales.radii,
    transform: transforms.radii,
  },
  borderRadiusTopRight: {
    property: 'borderTopRightRadius',
    scale: scales.radii,
    transform: transforms.radii,
  },
  borderRadiusBottomRight: {
    property: 'borderBottomRightRadius',
    scale: scales.radii,
    transform: transforms.radii,
  },
  borderRadiusBottomLeft: {
    property: 'borderBottomLeftRadius',
    scale: scales.radii,
    transform: transforms.radii,
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
  gap: { property: 'gap', scale: scales.spacing },
  rowGap: { property: 'rowGap', scale: scales.spacing },
  columnGap: { property: 'columnGap', scale: scales.spacing },
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
    scale: scales.dimensions,
  },
  width: {
    property: 'width',
    transform: size,
    scale: scales.dimensions,
  },
  minWidth: { property: 'minWidth', transform: size, scale: scales.dimensions },
  maxWidth: { property: 'maxWidth', transform: size, scale: scales.dimensions },
  height: { property: 'height', transform: size, scale: scales.dimensions },
  minHeight: {
    property: 'minHeight',
    transform: size,
    scale: scales.dimensions,
  },
  maxHeight: {
    property: 'maxHeight',
    transform: size,
    scale: scales.dimensions,
  },
  verticalAlign: { property: 'verticalAlign' },
  ...selfAlignments,
  ...gridItems,
  ...flexItems,
} as const;

export const typography = {
  fontFamily: { property: 'fontFamily', scale: scales.fontFamily },
  fontWeight: {
    property: 'fontWeight',
    scale: scales.fontWeight,
  },
  lineHeight: {
    property: 'lineHeight',
    scale: 'lineHeight',
    lineHeight: scales.lineHeight,
  },
  fontSize: {
    property: 'fontSize',
    scale: scales.fontSize,
  },
  letterSpacing: { property: 'letterSpacing' },
  textAlign: { property: 'textAlign' },
  fontStyle: { property: 'fontStyle' },
  textDecoration: { property: 'textDecoration' },
  textTransform: { property: 'textTransform' },
  whiteSpace: { property: 'whiteSpace' },
} as const;

const margin = {
  m: { property: 'margin', scale: scales.spacing },
  mx: {
    property: 'margin',
    properties: ['marginLeft', 'marginRight'],
    scale: scales.spacing,
  },
  my: {
    property: 'margin',
    properties: ['marginTop', 'marginBottom'],
    scale: scales.spacing,
  },
  mt: { property: 'marginTop', scale: scales.spacing },
  mb: { property: 'marginBottom', scale: scales.spacing },
  mr: { property: 'marginRight', scale: scales.spacing },
  ml: { property: 'marginLeft', scale: scales.spacing },
} as const;

const padding = {
  p: { property: 'padding', scale: scales.spacing },
  px: {
    property: 'padding',
    properties: ['paddingLeft', 'paddingRight'],
    scale: scales.spacing,
  },
  py: {
    property: 'padding',
    properties: ['paddingTop', 'paddingBottom'],
    scale: scales.spacing,
  },
  pt: { property: 'paddingTop', scale: scales.spacing },
  pb: { property: 'paddingBottom', scale: scales.spacing },
  pr: { property: 'paddingRight', scale: scales.spacing },
  pl: { property: 'paddingLeft', scale: scales.spacing },
} as const;

export const space = {
  ...margin,
  ...padding,
} as const;

export const mode = {
  mode: { property: 'none', scale: 'mode' },
} as const;

export const vars = {
  vars: { property: 'variables' },
} as const;

export const config = createAnimus()
  .addGroup('space', space)
  .addGroup('background', background)
  .addGroup('layout', layout)
  .addGroup('color', color)
  .addGroup('typography', typography)
  .addGroup('shadows', shadows)
  .addGroup('borders', border)
  .addGroup('positioning', positioning)
  .addGroup('flex', flex)
  .addGroup('grid', grid)
  .addGroup('mode', mode)
  .addGroup('vars', vars);

export const animus = config.build();

animus.styles({ width: '12rem' });
