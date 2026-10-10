/**
 * Excludes the React component runtime so non-React consumers can bundle
 * class resolvers without installing React.
 */
export {
  type ClassResolver,
  type ClassResolverAttributes,
  type ClassResolverProps,
  createClassResolver,
} from './runtime/createClassResolver.js';
