import { describe, expect, it } from 'vitest';

import worker from '../workers/app';

describe('React Router Worker', () => {
  it('returns an exact health response before framework delegation', async () => {
    const response = await worker.fetch(
      new Request('https://example.test/api/health')
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      app: 'animus-react-router-canary',
      runtime: 'cloudflare-worker',
    });
  });
});
