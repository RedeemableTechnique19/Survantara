import { handleApi } from './api';
import type { Env } from './types';

export type { Env };

// Static assets are served directly by the platform (see public/_headers for the
// security headers applied to them); the Worker only handles the API surface.
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
