import { vi } from 'vitest';

export async function loadUnderNodeEnv(nodeEnv: string) {
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.resetModules();
  return {
    ...(await import('../src/runtime/resolveClasses')),
    ...(await import('../src/runtime/witness')),
  };
}
