// The build-time define token, declared module-locally so reading it never
// widens a global. Nothing is required to provide it: a bare `typeof` on an
// undeclared identifier is the one read that cannot throw in any host.
declare const __ANIMUS_DEV__: boolean | undefined;

/**
 * The runtime's dev-build signal, shared by every development-only path
 * (drop diagnostic, reachability witness). Several hosts have to be satisfied
 * at once, and they force this exact shape:
 *
 * - **Bundles built through an Animus plugin.** `__ANIMUS_DEV__` is a
 *   build-time define supplied by the Vite plugin's `config` hook and by the
 *   Next plugin's DefinePlugin entry, each keyed on its bundler's own
 *   dev/build signal. It is tested FIRST, and as the CONDITIONAL OF THE
 *   INITIALIZER ITSELF — not as an early return inside the IIFE below. That
 *   distinction is the whole point: define-replacement turns the test into
 *   `typeof false === 'boolean'`, and only in this position does the
 *   production minifier propagate the resulting constant into every `IS_DEV`
 *   reference, so the gated branches and their diagnostic strings leave the
 *   bundle entirely. Hidden inside the IIFE, the same guard collapses to a
 *   variable the minifier keeps, and every diagnostic string ships. Never
 *   "tidy" this ternary into the fallback.
 * - **Browser bundles without the define.** `process.env.NODE_ENV` is a define
 *   token that Vite and Next rewrite to a string literal; `typeof process` is
 *   not rewritten by anything, so guarding the token with it strands every dev
 *   branch in a browser (no `process` global → the conjunction is false in dev
 *   too). The token must therefore be read bare.
 * - **Next under Turbopack.** The Next plugin supplies the define from its
 *   `webpack()` hook, and a Turbopack-active run never calls that hook (the
 *   Turbopack path wires rules and aliases instead), so those builds carry no
 *   token and land on the `process.env.NODE_ENV` fallback below — correct
 *   answer, no elimination.
 * - **QuickJS (the Rust system-loader).** It evaluates the system dist with no
 *   define pass and no `process`, so the `typeof` test is simply false and the
 *   bare read then throws ReferenceError at module scope — caught here, and
 *   not-dev is the correct answer for a loader that only reads config.
 *   `import.meta` is unavailable there (a script-context eval makes it a syntax
 *   error), so it is never used.
 * - **Node (SSR, tests).** Reads the real `process.env.NODE_ENV`.
 *
 * Evaluated once, at module load: in every host the answer is fixed for the
 * lifetime of the bundle.
 *
 * The define is the sanctioned foldable path, and the only one. The try/catch
 * fallback is deliberately NOT foldable — a host that supplies no token keeps
 * its (gated-off, never-executed) diagnostic strings, which is the accepted
 * price of a diagnostic that actually fires in a browser dev build. Rewriting
 * the fallback into a foldable-looking guard — `typeof process`, or optional
 * chaining on the token, anything that survives define-replacement as a
 * runtime check — recreates the dead-gate defect this file exists to fix: no
 * bundler rewrites those, so the branch is false in dev too and materially
 * wrong layout ships with zero signal. Restore elimination by supplying the
 * define from a bundler plugin, never by changing how this module reads the
 * environment.
 */
export const IS_DEV =
  typeof __ANIMUS_DEV__ === 'boolean'
    ? __ANIMUS_DEV__
    : (() => {
        try {
          return process.env.NODE_ENV !== 'production';
        } catch {
          return false;
        }
      })();
