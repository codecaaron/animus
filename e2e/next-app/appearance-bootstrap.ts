/**
 * Build/server-side appearance bootstrap artifact (openspec: system-color-scheme, D6).
 *
 * The Next plugin deliberately injects NOTHING — Next delivery is
 * application-owned. This module is the app's config-time seam: it runs in a
 * Node context (imported only by `pages/_document.tsx`, which Next renders on
 * the server and never ships to the browser) and hands `_document` the
 * pre-generated `{ code, cspHash }` pair.
 *
 * It must never be imported from a client component. The generator reaches
 * `node:crypto` and embeds the storage-access snippet as a string; either one
 * inside a client bundle would violate "Bootstrap entry-point isolation".
 * `scripts/assert-build.ts` pins the isolation as a build-output fact by
 * scanning `.next/static` for the storage keys.
 *
 * `cspHash` is exported alongside `code` because the two must be derived from
 * the SAME generation: any theme edit that changes the declared mode names
 * changes `code` and therefore the hash, and a hand-copied literal in a CSP
 * header would silently block the script — which is exactly the flash the
 * bootstrap exists to prevent.
 */
import { createAppearanceBootstrap } from '@animus-ui/system/bootstrap';

import { tokens } from './src/ds';

export const appearanceBootstrap = createAppearanceBootstrap(tokens);
