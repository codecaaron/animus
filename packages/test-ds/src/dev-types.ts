/**
 * Theme type augmentation for library development only (the reference
 * dev-only augmentation convention documented by the
 * library-definition-contract capability, openspec: first-class-extension
 * D11).
 *
 * This file is part of the library's own compilation so authors get
 * type-checked token names (bg: 'primary', numeric scale literals, etc.).
 * It stays out of the published declaration surface two ways: nothing
 * reachable from the definition entry references it, and `build:ts`
 * removes the emitted `dist/dev-types.d.ts` after declaration emit — so
 * consumers never receive this augmentation and their own compilation-
 * global `Theme` cannot be intersection-narrowed by the library.
 * (It cannot simply be excluded from tsconfig.build.json: declaration
 * emit type-checks the components, and their token literals only check
 * against an augmented Theme.)
 */
import type { referenceTokens } from './theme';

type ReferenceTheme = typeof referenceTokens;

declare module '@animus-ui/system' {
  interface Theme extends ReferenceTheme {}
}
