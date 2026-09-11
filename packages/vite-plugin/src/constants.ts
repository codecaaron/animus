/**
 * The namespace every virtual module here lives under; the `transform` guard
 * matches on this same string so a rename cannot strand it.
 */
export const VIRTUAL_PREFIX = 'virtual:animus/';

export const VIRTUAL_CSS_ID = `${VIRTUAL_PREFIX}styles.css`;
export const RESOLVED_CSS_ID = `\0${VIRTUAL_CSS_ID}`;

export const VIRTUAL_COMPONENTS_ID = `${VIRTUAL_PREFIX}components.js`;
export const RESOLVED_COMPONENTS_ID = `\0${VIRTUAL_COMPONENTS_ID}`;

export const VIRTUAL_BRIDGE_ID = `${VIRTUAL_PREFIX}hmr-bridge.js`;
export const RESOLVED_BRIDGE_ID = `\0${VIRTUAL_BRIDGE_ID}`;

/**
 * Vite reserves `/@id/` for module ids that are not file paths and strips the
 * prefix before `resolveId`, so the unprefixed specifier travels here.
 */
export const BRIDGE_SCRIPT_SRC = `/@id/${VIRTUAL_BRIDGE_ID}`;

export const VIRTUAL_SYSTEM_PROPS_ID = `${VIRTUAL_PREFIX}system-props`;
export const RESOLVED_SYSTEM_PROPS_ID = `\0${VIRTUAL_SYSTEM_PROPS_ID}`;

// The default exclusion set is owned by the shared pipeline core; this is a
// re-export, not a second authority.
export { DEFAULT_EXCLUDE } from '@animus-ui/extract/pipeline';
