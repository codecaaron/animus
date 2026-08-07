import { vi } from 'vitest';

/**
 * The dev gate is read once per bundle, at module load — so a production build
 * has to be simulated by loading a FRESH module instance under a production
 * env, not by mutating the env of an already-loaded one.
 *
 * Both dev-gated runtime surfaces come back together (the drop diagnostic lives
 * in resolveClasses, the reachability witness in witness), so a caller reads
 * whichever it is testing off the one returned namespace.
 */
export async function loadUnderNodeEnv(nodeEnv: string) {
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.resetModules();
  return {
    ...(await import('../src/runtime/resolveClasses')),
    ...(await import('../src/runtime/witness')),
  };
}
