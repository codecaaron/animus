/**
 * Theme type augmentation for library development only.
 *
 * This file is included in the dev tsconfig so library authors get
 * type-checked token names (bg: 'primary', etc.), but it is excluded
 * from tsconfig.build.json so consumers never receive this augmentation
 * in the published .d.ts files — preventing intersection narrowing of
 * the consumer's own Theme declaration.
 */
import type { referenceTokens } from './theme';

type ReferenceTheme = typeof referenceTokens;

declare module '@animus-ui/system' {
  interface Theme extends ReferenceTheme {}
}
