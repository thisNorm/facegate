import { describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api';
import { mockApi } from './test/mockApi';

describe('api', () => {
  it('passes an AbortSignal so a superseded search can cancel its request', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async (_path: string, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      return new Response('{}');
    });
    vi.stubGlobal('fetch', fetcher);
    await api('GET', '/api/admin/access-logs', undefined, controller.signal);
  });
  it('sends JSON and returns JSON', async () => {
    const calls = mockApi({ 'POST /api/admin/gates/1/open': { eventKey: 3, result: 'GRANTED' } });
    expect(await api('POST', '/api/admin/gates/1/open', { reason: 'OTHER' })).toEqual({
      eventKey: 3,
      result: 'GRANTED',
    });
    expect(calls).toEqual([
      { method: 'POST', path: '/api/admin/gates/1/open', body: { reason: 'OTHER' } },
    ]);
  });

  it('throws ApiError with the server message', async () => {
    mockApi({
      'GET /api/admin/x': () => ({
        status: 409,
        json: { error: 'employee number already exists' },
      }),
    });
    await expect(api('GET', '/api/admin/x')).rejects.toEqual(
      new ApiError(409, 'employee number already exists'),
    );
  });

  it('announces logout on 401 outside the auth API', async () => {
    const listener = vi.fn();
    window.addEventListener('facegate:logout', listener);
    mockApi({
      'GET /api/admin/status': () => ({ status: 401, json: { error: 'login required' } }),
    });
    await expect(api('GET', '/api/admin/status')).rejects.toBeInstanceOf(ApiError);
    expect(listener).toHaveBeenCalledTimes(1);
    mockApi({
      'POST /api/admin/auth/login': () => ({ status: 401, json: { error: 'invalid login' } }),
    });
    await expect(api('POST', '/api/admin/auth/login', {})).rejects.toBeInstanceOf(ApiError);
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('facegate:logout', listener);
  });
});
