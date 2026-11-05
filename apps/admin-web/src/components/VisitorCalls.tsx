import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { timeText } from '../format';

type Call = {
  callKey: number;
  gateKey: number;
  terminalKey: number;
  hasPhoto: boolean;
  createdAt: string;
};

const POLL_MS = 3000;

/** 짧은 알림음 두 번. 소리 파일 없이 브라우저 기본 기능으로 */
function chime() {
  try {
    const audio = new AudioContext();
    [0, 0.25].forEach((at) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.2, audio.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + at + 0.2);
      osc.connect(gain).connect(audio.destination);
      osc.start(audio.currentTime + at);
      osc.stop(audio.currentTime + at + 0.2);
    });
  } catch {
    // 브라우저가 소리를 막으면 화면 알림만
  }
}

/** 단말 방문객 호출 (D-58). 3초마다 확인하고, 새 호출이면 알림음 */
export function VisitorCalls({
  gateName,
  onShowGate,
}: {
  gateName: (gateKey: number) => string;
  /** 그 게이트가 있는 층으로 현황을 넘긴다 */
  onShowGate?: (gateKey: number) => void;
}) {
  const [calls, setCalls] = useState<Call[]>([]);
  const seen = useRef<Set<number> | null>(null);

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const next = await api<Call[]>('GET', '/api/admin/visitor-calls');
        if (stopped) return;
        // 처음 불러온 호출에는 소리를 내지 않는다
        if (seen.current && next.some((c) => !seen.current!.has(c.callKey))) chime();
        seen.current = new Set(next.map((c) => c.callKey));
        setCalls(next);
      } catch {
        // 다음 주기에 다시
      }
    };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  async function ack(callKey: number) {
    setCalls((list) => list.filter((c) => c.callKey !== callKey));
    await api('POST', `/api/admin/visitor-calls/${callKey}/ack`).catch(() => {});
  }

  if (!calls.length) return null;
  return (
    <section className="visitor-calls" aria-label="방문객 호출" role="alert">
      {calls.map((c) => (
        <div key={c.callKey} className="visitor-call">
          {c.hasPhoto && (
            <img
              src={`/api/admin/visitor-calls/${c.callKey}/photo`}
              alt={`${gateName(c.gateKey)} 방문객 사진`}
            />
          )}
          <div className="visitor-call-text">
            <strong>{gateName(c.gateKey)} 방문객 호출</strong>
            <span className="note">{`${timeText(c.createdAt)}  단말 ${c.terminalKey}`}</span>
            <span className="note">아래 게이트 영상을 보고 1회 개방으로 열어 주세요.</span>
          </div>
          {onShowGate && (
            <button type="button" onClick={() => onShowGate(c.gateKey)}>
              게이트 보기
            </button>
          )}
          <button type="button" onClick={() => void ack(c.callKey)}>
            확인
          </button>
        </div>
      ))}
    </section>
  );
}
