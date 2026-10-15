import { STYLESHEET_SLICES } from '@animus-ui/extract/pipeline';
import { FONT_PRELOADS_MODULE_ID } from '@animus-ui/extract/session';

import type { StylesheetSlice } from '@animus-ui/extract/pipeline';

/**
 * The namespace every virtual module here lives under; the `transform` guard
 * matches on this same string so a rename cannot strand it.
 */
export const VIRTUAL_PREFIX = 'virtual:animus/';

export const VIRTUAL_CSS_ID = `${VIRTUAL_PREFIX}styles.css`;
export const RESOLVED_CSS_ID = `\0${VIRTUAL_CSS_ID}`;

/** A slice of the stylesheet, which `stylesheets: 'split'` builds emit as
 *  a file of its own. */
export const sliceStylesheetId = (slice: StylesheetSlice): string =>
  `${VIRTUAL_PREFIX}styles.${slice}.css`;
export const RESOLVED_SLICE_IDS: ReadonlyMap<string, StylesheetSlice> = new Map(
  STYLESHEET_SLICES.map((slice) => [`\0${sliceStylesheetId(slice)}`, slice])
);

/**
 * What the stylesheet module holds in a split build: one rule that keeps
 * the stylesheet's place in Vite's CSS, where the page's links to the
 * slices then go. Its own property, so no minifier merges or drops it.
 */
export const SPLIT_STYLESHEET_MARKER =
  '.animus-split-stylesheet{--animus-split-stylesheet:1}';
/** The marker as a built stylesheet spells it, minified or not. */
export const SPLIT_STYLESHEET_MARKER_RE =
  /\.animus-split-stylesheet\s*\{\s*--animus-split-stylesheet\s*:\s*1\s*;?\s*\}\n?/;

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

/** The faces this build preloads, with the URL each file is preloaded at:
 *  the module every host serves under this id. */
export const VIRTUAL_FONT_PRELOADS_ID = FONT_PRELOADS_MODULE_ID;
export const RESOLVED_FONT_PRELOADS_ID = `\0${VIRTUAL_FONT_PRELOADS_ID}`;

// The default exclusion set is owned by the shared pipeline core; this is a
// re-export, not a second authority.
export { DEFAULT_EXCLUDE } from '@animus-ui/extract/pipeline';
