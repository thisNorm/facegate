import { vi } from 'vitest';

type Reply = { status?: number; json?: unknown };
type Route =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null
  | ((body: unknown, url: URL) => Reply | Response | Promise<Reply | Response>);

/** 키는 'GET /api/admin/status' 형식. 함수면 응답을 직접 만든다 (Response도 그대로 돌려줌) */
export function mockApi(routes: Record<string, Route>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: url.pathname + url.search, body });
      const route = routes[`${method} ${url.pathname}`];
      if (route === undefined)
        return new Response(JSON.stringify({ error: `not mocked: ${method} ${url.pathname}` }), {
          status: 404,
        });
      const reply = typeof route === 'function' ? await route(body, url) : { json: route };
      if (reply instanceof Response) return reply;
      return new Response(reply.json === undefined ? null : JSON.stringify(reply.json), {
        status: reply.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return calls;
}
