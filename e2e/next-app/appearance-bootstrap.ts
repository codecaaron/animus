/**
 * Server-only, imported from `pages/_document.tsx` alone: the generator
 * reaches `node:crypto` and its snippet must stay out of client bundles.
 */
import { createAppearanceBootstrap } from '@animus-ui/system/bootstrap';

import { tokens } from './src/ds';

export const appearanceBootstrap = createAppearanceBootstrap(tokens);
