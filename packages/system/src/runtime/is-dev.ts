// Module-local so reading the token never widens a global; no host is
// required to supply it, and a bare `typeof` cannot throw where it is absent.
declare const __ANIMUS_DEV__: boolean | undefined;

/**
 * The define token is tested as the initializer's own conditional, never from
 * inside the fallback: only there can a minifier fold it. Dev-only work tests
 * the token in place as well, `typeof __ANIMUS_DEV__ === 'boolean' ?
 * __ANIMUS_DEV__ : IS_DEV`: esbuild inlines no module-level constant into a
 * chunk that starts with an import, so a gate on `IS_DEV` alone survives a
 * production bundle.
 */
export const IS_DEV =
  typeof __ANIMUS_DEV__ === 'boolean'
    ? __ANIMUS_DEV__
    : (() => {
        try {
          // No `env` on a shimmed `process` means no production signal. The
          // bare token read stays separate so define rewriting still finds it.
          if (
            typeof process !== 'undefined' &&
            typeof process.env === 'undefined'
          ) {
            return true;
          }
          return process.env.NODE_ENV !== 'production';
        } catch {
          return false;
        }
      })();
