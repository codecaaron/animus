export type { AnimusNextOptions } from './types';
export { withAnimus } from './with-animus';
// Named so consumers' inferred `withAnimus(...)({...})` types stay portable
// (TS2742) — see the rationale at their declarations.
export type {
  AnimusNextConfigBoundary,
  NextConfigInput,
  TurbopackNextConfig,
  WebpackNextConfig,
} from './with-animus';
