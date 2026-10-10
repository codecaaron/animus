/**
 * Excludes the React component runtime so non-React consumers can bundle
 * class resolvers without installing React.
 */
export {
  type ClassResolver,
  type ClassResolverAttributes,
  type ClassResolverObjectAttributes,
  createClassResolver,
} from './runtime/createClassResolver.js';
