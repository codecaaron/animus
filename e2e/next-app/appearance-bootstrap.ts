/**
 * Server-only, imported from `pages/_document.tsx` alone: the generator
 * reaches `node:crypto` and its snippet must stay out of client bundles.
 * `code` and `cspHash` must come from this one call: a theme edit that
 * renames a mode changes the snippet, and a copied hash then blocks it.
 */
import { createAppearanceBootstrap } from '@animus-ui/system/bootstrap';

import { tokens } from './src/ds';

export const appearanceBootstrap = createAppearanceBootstrap(tokens);
