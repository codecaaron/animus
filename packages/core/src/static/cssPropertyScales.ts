import { PROPERTY_MAPPINGS } from "./propertyMappings";

/**
 * Default CSS property to theme scale mappings
 * Only properties listed here will attempt theme resolution
 */
export const cssPropertyScales: Record<string, string> = {
  // Colors
  color: 'colors',
  backgroundColor: 'colors',
  borderColor: 'colors',
  borderTopColor: 'colors',
  borderRightColor: 'colors',
  borderBottomColor: 'colors',
  borderLeftColor: 'colors',
  outlineColor: 'colors',
  fill: 'colors',
  stroke: 'colors',

  // Space
  margin: 'space',
  marginTop: 'space',
  marginRight: 'space',
  marginBottom: 'space',
  marginLeft: 'space',
  padding: 'space',
  paddingTop: 'space',
  paddingRight: 'space',
  paddingBottom: 'space',
  paddingLeft: 'space',
  gap: 'space',
  rowGap: 'space',
  columnGap: 'space',
  top: 'space',
  right: 'space',
  bottom: 'space',
  left: 'space',

  // Typography
  fontSize: 'fontSizes',
  fontWeight: 'fontWeights',
  lineHeight: 'lineHeights',
  letterSpacing: 'letterSpacings',
  fontFamily: 'fonts',

  // Layout
  width: 'sizes',
  height: 'sizes',
  minWidth: 'sizes',
  maxWidth: 'sizes',
  minHeight: 'sizes',
  maxHeight: 'sizes',

  // Borders
  borderRadius: 'radii',
  borderTopLeftRadius: 'radii',
  borderTopRightRadius: 'radii',
  borderBottomRightRadius: 'radii',
  borderBottomLeftRadius: 'radii',
  borderWidth: 'borderWidths',
  borderTopWidth: 'borderWidths',
  borderRightWidth: 'borderWidths',
  borderBottomWidth: 'borderWidths',
  borderLeftWidth: 'borderWidths',

  // Effects
  boxShadow: 'shadows',
  textShadow: 'shadows',
  opacity: 'opacities',

  // Animation
  transition: 'transitions',
  animation: 'animations',

  // Layering
  zIndex: 'zIndices',
};


const unifiedPropertyMappings: Record<string, string> = {
  ...cssPropertyScales
};
Object.entries(PROPERTY_MAPPINGS).forEach(([shorthand, propertyNames]) => {
   if (typeof propertyNames === 'string' && propertyNames in unifiedPropertyMappings) {
     unifiedPropertyMappings[shorthand] = unifiedPropertyMappings[propertyNames];
   } else if (Array.isArray(propertyNames) && propertyNames.every(prop => prop in unifiedPropertyMappings)) {
     unifiedPropertyMappings[shorthand] = unifiedPropertyMappings[propertyNames[0]];
   }
});

export { unifiedPropertyMappings }

