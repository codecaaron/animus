import { createRequestHandler } from 'react-router';

const requestHandler = createRequestHandler(
  () => import('virtual:react-router/server-build'),
  import.meta.env.MODE
);

const worker = {
  async fetch(request: Request): Promise<Response> {
    return requestHandler(request);
  },
};

export default worker;
