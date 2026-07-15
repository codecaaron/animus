/**
 * Type surface for the `@animus-ui/extract/engine-v2` subpath.
 *
 * The runtime entry (`index-v2.js`) is a hand-written CJS loader that assigns
 * the whole napi binary to `module.exports` (`module.exports = loadNative()`)
 * so it can fail loud with an actionable message when the binary is absent
 * (extraction-diagnostics §V2 boundary error reporting). Because that whole-
 * object assignment is opaque to `cjs-module-lexer`, the *value* has no
 * statically-detectable named exports — so the value is typed opaquely here
 * (`unknown`). Declaring the napi functions/class as named value exports would
 * make `attw` report every one as missing at runtime ("Named exports").
 *
 * The napi-generated declarations at `crates/extract-v2/index.d.ts` describe
 * the real shape; they are re-exposed as *type-only* members so consumers can
 * still name the engine's types. The subpath is consumed via CJS `require`
 * (see vite-plugin's `requireEngine`), which returns the full binding object.
 *
 * No `types` export condition is used for `./engine-v2` (root CLAUDE.md § Key
 * Rules: bun's createRequire matches `types` as a runtime target and loads
 * `.d.ts` as JS); TypeScript sibling-declaration substitution supplies these
 * types from the `.js` entry instead.
 */
import type * as ExtractV2 from './crates/extract-v2/index';

declare namespace engineV2 {
  export type ExtractEngine = ExtractV2.ExtractEngine;
  export type EngineOptions = ExtractV2.EngineOptions;
  export type NapiSystemConfig = ExtractV2.NapiSystemConfig;
}

declare const engineV2: unknown;

export = engineV2;
