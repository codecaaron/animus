import { requireNativeEngine } from '../pipeline/native-resolution';

import type { EngineApi } from '../pipeline/engine-adapter';

/** The native functions a test's fake engine passes through: the engine's
 *  own, naming no build, so no system load it makes is cached. */
export function nativeFunctions() {
  return { ...requireNativeEngine(), engineBuildId: () => '' };
}

/** An engine API over `nativeFunctions` whose analysis, transform and cache
 *  clear throw: a test's fake spreads it and sets what it reads, and a call
 *  it does not set fails as calling a member a partial fake lacks does. */
export function fakeEngineApi(): EngineApi {
  const unset = (name: string) => (): never => {
    throw new TypeError(`the test's engine API sets no ${name}`);
  };
  return {
    ...nativeFunctions(),
    analyzeProject: unset('analyzeProject'),
    transformFile: unset('transformFile'),
    clearAnalysisCache: unset('clearAnalysisCache'),
  };
}
