/**
 * Dev-only Theme augmentation; `build:ts` strips it from dist so consumers
 * never receive it. Excluding it from tsconfig.build breaks declaration emit.
 */
import type { referenceTokens } from './theme';

type ReferenceTheme = typeof referenceTokens;

declare module '@animus-ui/system' {
  interface Theme extends ReferenceTheme {}
}
