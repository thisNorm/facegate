import { useEffect, useRef, useState } from 'react';

const POLL_MS = 150;
/** 이보다 오래된 장면은 감춘다 (D-49) */
const STALE_MS = 2000;
const REQUEST_TIMEOUT_MS = 5000;

/** 단말 영상 연결 상태 */
export type VideoState = 'checking' | 'live' | 'lost';

/** 게이트에 붙은 단말(= 카메라 달린 안드로이드 기기)의 영상. 단말이 여럿이면 고른다 */
export function TerminalVideo({
  terminalKeys,
  active = true,
  onState,
}: {
  terminalKeys: number[];
  active?: boolean;
  onState?: (state: VideoState) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  if (!active) return <p className="note">영상 대기</p>;
  if (terminalKeys.length === 0) return <p className="note">연결된 단말이 없습니다.</p>;
  const terminalKey =
    selected !== null && terminalKeys.includes(selected) ? selected : terminalKeys[0];
  return (
    <section className="terminal-video" aria-label="단말 영상">
      {terminalKeys.length > 1 && (
        <label>
          <span>단말</span>
          <select value={terminalKey} onChange={(event) => setSelected(Number(event.target.value))}>
            {terminalKeys.map((key) => (
              <option key={key} value={key}>
                단말 {key}
              </option>
            ))}
          </select>
        </label>
      )}
      <VideoFrames key={terminalKey} terminalKey={terminalKey} onState={onState} />
    </section>
  );
}

/** 최근 장면을 0.15초마다 한 장씩 받아 보여준다. 요청은 한 번에 하나, 숨은 탭에서는 멈춘다 */
function VideoFrames({
  terminalKey,
  onState,
}: {
  terminalKey: number;
  onState?: (state: VideoState) => void;
}) {
  const report = useRef(onState);
  const [view, setView] = useState<{ state: VideoState; src: string | null }>({
    state: 'checking',
    src: null,
  });
  useEffect(() => {
    report.current = onState;
  });
  useEffect(() => {
    const path = `/api/admin/terminals/${terminalKey}/frame`;
    let stopped = false;
    let inFlight = false;
    let shown: string | null = null;
    let next: ReturnType<typeof setTimeout> | undefined;
    let stale: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    const show = (state: VideoState, src: string | null = null) => {
      clearTimeout(stale);
      if (shown) URL.revokeObjectURL(shown);
      shown = src;
      setView({ state, src });
      report.current?.(state);
    };
    const poll = async () => {
      clearTimeout(next);
      if (stopped || inFlight || document.hidden) return;
      inFlight = true;
      request = new AbortController();
      const timeout = setTimeout(() => request?.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(path, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: request.signal,
        });
        const age = Number(res.headers.get('X-Frame-Age-Ms') ?? NaN);
        if (res.status === 200 && age <= STALE_MS) {
          const blob = await res.blob();
          if (stopped) return;
          show('live', URL.createObjectURL(blob));
          stale = setTimeout(() => show('lost'), STALE_MS - age);
        } else if (!stopped) {
          show(res.status === 204 ? 'checking' : 'lost');
        }
      } catch {
        if (!stopped) show('lost');
      } finally {
        clearTimeout(timeout);
        inFlight = false;
      }
      if (!stopped && !document.hidden) next = setTimeout(() => void poll(), POLL_MS);
    };
    const onVisibility = () => void poll();
    document.addEventListener('visibilitychange', onVisibility);
    void poll();
    return () => {
      stopped = true;
      clearTimeout(next);
      clearTimeout(stale);
      request?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
      if (shown) URL.revokeObjectURL(shown);
    };
  }, [terminalKey]);

  return (
    <div className={`video-stream video-stream--${view.state}`}>
      {view.src && <img src={view.src} alt={`단말 ${terminalKey} 실시간 영상`} />}
      {view.state === 'checking' && <p className="note">영상 확인 중</p>}
      {view.state === 'live' && <p className="note">실시간 영상</p>}
      {view.state === 'lost' && <p className="error">영상 끊김</p>}
    </div>
  );
}
