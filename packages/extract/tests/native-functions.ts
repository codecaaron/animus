import { requireNativeEngine } from '../pipeline/native-resolution';

/** The native functions a test's fake engine passes through: the engine's
 *  own, naming no build, so no system load it makes is cached. */
export function nativeFunctions() {
  return { ...requireNativeEngine(), engineBuildId: () => '' };
}
