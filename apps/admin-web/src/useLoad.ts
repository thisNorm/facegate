import { useCallback, useEffect, useRef, useState } from 'react';

export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({
    loading: true,
  });
  const generation = useRef(0);
  // 호출자가 정한 의존성으로 요청 함수를 고정합니다.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/use-memo
  const run = useCallback(load, deps);
  const reload = useCallback(() => {
    const current = ++generation.current;
    setState((s) => ({ ...s, loading: true }));
    run().then(
      (data) => {
        if (current === generation.current) setState({ data, loading: false });
      },
      (error: Error) => {
        if (current === generation.current)
          setState((s) => ({ ...s, error: error.message, loading: false }));
      },
    );
  }, [run]);
  useEffect(() => {
    // 의존성이 바뀌면 요청 시작 상태를 먼저 표시합니다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
    return () => {
      generation.current += 1;
    };
  }, [reload]);
  return { ...state, reload };
}
