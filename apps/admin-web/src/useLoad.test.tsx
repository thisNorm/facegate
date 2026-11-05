import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useLoad } from './useLoad';

function pending() {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('useLoad', () => {
  it('keeps the latest request result when an older request finishes later', async () => {
    const older = pending();
    const newer = pending();
    const requests = [older, newer];
    let index = 0;
    const { result } = renderHook(() => useLoad(() => requests[index++].promise, []));
    act(() => result.current.reload());
    await act(async () => {
      newer.resolve('new result');
    });
    expect(result.current.data).toBe('new result');
    await act(async () => {
      older.resolve('old result');
    });
    expect(result.current.data).toBe('new result');
  });

  it('ignores an old failure while the newer request is still pending', async () => {
    const older = pending();
    const newer = pending();
    const requests = [older, newer];
    let index = 0;
    const { result } = renderHook(() => useLoad(() => requests[index++].promise, []));
    act(() => result.current.reload());
    await act(async () => {
      older.reject(new Error('obsolete failure'));
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeUndefined();
    await act(async () => {
      newer.resolve('new result');
    });
    expect(result.current.data).toBe('new result');
    expect(result.current.loading).toBe(false);
  });
});
