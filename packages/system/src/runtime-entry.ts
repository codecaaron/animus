/** Hook-free entry: extracted components import it from server components. */
export { createComponent, renderAsChild } from './runtime';
export {
  type ClassResolver,
  type ClassResolverAttributes,
  type ClassResolverObjectAttributes,
  createClassResolver,
} from './runtime/createClassResolver';
export { createComposedFamily } from './runtime/createComposedFamily';
