export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** 같은 출처라 쿠키 세션이 그대로 붙는다. 로그인 밖에서 401이면 로그인 화면으로 */
export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    signal,
  });
  if (res.status === 401 && !path.startsWith('/api/admin/auth/'))
    window.dispatchEvent(new Event('facegate:logout'));
  if (!res.ok) {
    const error = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, error.error ?? res.statusText);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
