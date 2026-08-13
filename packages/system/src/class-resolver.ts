/**
 * Framework-neutral runtime for `.asClass()` output.
 *
 * This entry intentionally excludes the React component runtime so non-React
 * consumers can install and bundle class resolvers without React.
 */
export {
  type ClassResolver,
  type ClassResolverAttributes,
  createClassResolver,
} from './runtime/createClassResolver.js';
