/**
 * Default group definitions for Animus
 * These would typically come from a configuration file
 */
export const defaultGroupDefinitions = {
  space: {
    m: { property: 'margin', scale: 'space' },
    mt: { property: 'marginTop', scale: 'space' },
    mr: { property: 'marginRight', scale: 'space' },
    mb: { property: 'marginBottom', scale: 'space' },
    ml: { property: 'marginLeft', scale: 'space' },
    mx: { properties: ['marginLeft', 'marginRight'], scale: 'space' },
    my: { properties: ['marginTop', 'marginBottom'], scale: 'space' },
    p: { property: 'padding', scale: 'space' },
    pt: { property: 'paddingTop', scale: 'space' },
    pr: { property: 'paddingRight', scale: 'space' },
    pb: { property: 'paddingBottom', scale: 'space' },
    pl: { property: 'paddingLeft', scale: 'space' },
    px: { properties: ['paddingLeft', 'paddingRight'], scale: 'space' },
    py: { properties: ['paddingTop', 'paddingBottom'], scale: 'space' },
    gap: { property: 'gap', scale: 'space' },
  },
  color: {
    color: { property: 'color', scale: 'colors' },
    bg: { property: 'backgroundColor', scale: 'colors' },
    borderColor: { property: 'borderColor', scale: 'colors' },
    fill: { property: 'fill', scale: 'colors' },
    stroke: { property: 'stroke', scale: 'colors' },
  },
  typography: {
    fontSize: { property: 'fontSize', scale: 'fontSizes' },
    fontWeight: { property: 'fontWeight', scale: 'fontWeights' },
    lineHeight: { property: 'lineHeight', scale: 'lineHeights' },
    letterSpacing: { property: 'letterSpacing', scale: 'letterSpacings' },
    fontFamily: { property: 'fontFamily', scale: 'fonts' },
  },
  layout: {
    w: { property: 'width', scale: 'sizes' },
    h: { property: 'height', scale: 'sizes' },
    minW: { property: 'minWidth', scale: 'sizes' },
    maxW: { property: 'maxWidth', scale: 'sizes' },
    minH: { property: 'minHeight', scale: 'sizes' },
    maxH: { property: 'maxHeight', scale: 'sizes' },
    display: { property: 'display' },
    position: { property: 'position' },
  },
  borders: {
    border: { property: 'border', scale: 'borders' },
    borderWidth: { property: 'borderWidth', scale: 'borderWidths' },
    borderStyle: { property: 'borderStyle', scale: 'borderStyles' },
    borderRadius: { property: 'borderRadius', scale: 'radii' },
  },
  shadows: {
    boxShadow: { property: 'boxShadow', scale: 'shadows' },
    textShadow: { property: 'textShadow', scale: 'shadows' },
  },
};

/**
 * Get group definitions for enabled groups
 */
export function getGroupDefinitionsForComponent(
  enabledGroups: string[]
): Record<string, Record<string, any>> {
  const result: Record<string, Record<string, any>> = {};

  for (const groupName of enabledGroups) {
    if (groupName in defaultGroupDefinitions) {
      result[groupName] = (defaultGroupDefinitions as any)[groupName];
    }
  }

  return result;
}
