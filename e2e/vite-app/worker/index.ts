const worker = {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return Response.json({
        app: 'animus-vite-canary',
        runtime: 'cloudflare-worker',
      });
    }

    return new Response(null, { status: 404 });
  },
};

export default worker;
