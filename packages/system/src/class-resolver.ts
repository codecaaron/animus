/**
 * Excludes the React component runtime so non-React consumers can bundle
 * class resolvers without installing React.
 */
export {
  type ClassResolver,
  type ClassResolverAttributes,
  createClassResolver,
} from './runtime/createClassResolver.js';
