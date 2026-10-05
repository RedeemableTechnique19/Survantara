/** Error carrying an explicit HTTP status so the router never has to sniff message text. */
export class HttpError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const json = (data: unknown, status = 200, headers: HeadersInit = {}): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

export const fail = (message: string, status = 400): Response => json({ error: message }, status);

export async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    return await request.json<Record<string, unknown>>();
  } catch {
    throw new HttpError('Data permintaan tidak valid.');
  }
}
