/**
 * The runtime's dev-build signal, shared by every development-only path
 * (drop diagnostic, reachability witness). Three hosts have to be satisfied
 * at once, and they force this exact shape:
 *
 * - **Browser bundles.** `process.env.NODE_ENV` is a define token that Vite
 *   and Next rewrite to a string literal; `typeof process` is not rewritten
 *   by anything, so guarding the token with it strands every dev branch in a
 *   browser (no `process` global → the conjunction is false in dev too).
 *   The token must therefore be read bare.
 * - **QuickJS (the Rust system-loader).** It evaluates the system dist with
 *   no `process` and no define pass, so the bare read throws ReferenceError
 *   at module scope — caught here, and not-dev is the correct answer for a
 *   loader that only reads config. `import.meta` is unavailable there (a
 *   script-context eval makes it a syntax error), so it is never used.
 * - **Node (SSR, tests).** Reads the real `process.env.NODE_ENV`.
 *
 * Evaluated once, at module load: in every host the answer is fixed for the
 * lifetime of the bundle.
 *
 * The try/catch IIFE is deliberately NOT foldable by a minifier, so production
 * bundles retain the (gated-off, never-executed) diagnostic strings — that
 * bundle weight is the accepted price of a diagnostic that actually fires in
 * a browser dev build. Rewriting this into a foldable-looking guard —
 * `typeof process`, or optional chaining on the token, anything that survives
 * define-replacement as a runtime check — recreates the dead-gate defect this
 * file exists to fix: no bundler rewrites those, so the branch is false in
 * dev too and materially wrong layout ships with zero signal. The sanctioned
 * way to restore dead-code elimination is a dedicated build-time define. No
 * such token exists today and neither plugin emits one: the Vite plugin would
 * need a `config` hook returning `define` (it has only `configResolved`, where
 * it already derives `isProd`), and the Next plugin would need a DefinePlugin
 * entry pushed from its `webpack()` hook (which already receives Next's dev
 * flag). Never restore it by changing how this module reads the environment.
 */
export const IS_DEV = (() => {
  try {
    return process.env.NODE_ENV !== 'production';
  } catch {
    return false;
  }
})();
