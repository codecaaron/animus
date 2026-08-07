/**
 * The namespace every virtual module this plugin owns lives under. Exported so
 * the `transform` guard that keeps those modules out of source-file handling
 * matches on the same string the ids are built from — a rename of the
 * namespace cannot leave the guard behind.
 */
export const VIRTUAL_PREFIX = 'virtual:animus/';

export const VIRTUAL_CSS_ID = `${VIRTUAL_PREFIX}styles.css`;
export const RESOLVED_CSS_ID = `\0${VIRTUAL_CSS_ID}`;

export const VIRTUAL_COMPONENTS_ID = `${VIRTUAL_PREFIX}components.js`;
export const RESOLVED_COMPONENTS_ID = `\0${VIRTUAL_COMPONENTS_ID}`;

export const VIRTUAL_BRIDGE_ID = `${VIRTUAL_PREFIX}hmr-bridge.js`;
export const RESOLVED_BRIDGE_ID = `\0${VIRTUAL_BRIDGE_ID}`;

/**
 * Browser-addressable URL for the bridge, used as the `src` of the dev
 * `<script type="module">` (see index-html.ts). THE explanation of the `/@id/`
 * convention lives here; everything else points at it.
 *
 * Vite reserves `/@id/` for module ids that are not file paths. Its transform
 * middleware normalizes such a URL before serving it (`unwrapId`): strip the
 * prefix, then decode the `__x00__` placeholder back to a NUL byte. The
 * UNPREFIXED specifier is what travels here — `resolveVirtualId` is the hook
 * that answers it, and it answers with the `\0` form. (Vite's own `wrapId`
 * encodes an already-`\0`-prefixed id as `__x00__`; that form resolves too, but
 * it leans on the placeholder convention rather than on this plugin's own
 * `resolveId` contract.)
 */
export const BRIDGE_SCRIPT_SRC = `/@id/${VIRTUAL_BRIDGE_ID}`;

export const VIRTUAL_SYSTEM_PROPS_ID = `${VIRTUAL_PREFIX}system-props`;
export const RESOLVED_SYSTEM_PROPS_ID = `\0${VIRTUAL_SYSTEM_PROPS_ID}`;

export const DEFAULT_EXCLUDE = ['node_modules', 'dist', '.test.', '.spec.'];
