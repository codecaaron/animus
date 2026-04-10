/**
 * Hook-free runtime entry — safe for React Server Components.
 *
 * Extracted components import from this subpath instead of the barrel
 * so they don't pull in compose() (which uses createContext/useContext).
 */
export { createComponent } from './runtime';
export { createClassResolver } from './runtime/createClassResolver';
export { createComposedFamily } from './runtime/createComposedFamily';
