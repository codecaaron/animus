import { describe, expect, it } from 'vitest';

import worker from '../worker/index';

describe('Vite canary Worker', () => {
  it('serves the health contract from workerd code', async () => {
    const response = await worker.fetch(
      new Request('https://animus-vite-canary.example/api/health')
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      app: 'animus-vite-canary',
      runtime: 'cloudflare-worker',
    });
  });

  it('does not claim non-API paths', async () => {
    const response = await worker.fetch(
      new Request('https://animus-vite-canary.example/not-an-api')
    );
    expect(response.status).toBe(404);
  });
});
