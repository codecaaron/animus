import { createRequestHandler } from 'react-router';

const requestHandler = createRequestHandler(
  () => import('virtual:react-router/server-build'),
  import.meta.env.MODE
);

const worker = {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return Response.json({
        app: 'animus-react-router-canary',
        runtime: 'cloudflare-worker',
      });
    }
    return requestHandler(request);
  },
};

export default worker;
