import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { byFloor, floorName } from '../floor';
import { timeText, todayKst } from '../format';
import { RESULT_LABEL, REASON_LABEL } from '../labels';
import { useLoad } from '../useLoad';
import type { VideoState } from '../components/TerminalVideo';
import { VisitorCalls } from '../components/VisitorCalls';
import { OpenGatePanel } from './OpenGatePanel';

type Gate = {
  gateKey: number;
  name: string;
  /** 지하는 음수, 모르면 null */
  floor: number | null;
  /** 단말 = 카메라 달린 안드로이드 기기. aiRtspOk는 AI가 그 영상을 받는지 */
  terminals: { terminalKey: number; connected: boolean; aiRtspOk: boolean | null }[];
};
type Status = { ai: { online: boolean; lastStatusAt: string | null }; gates: Gate[] };
type Log = {
  eventKey: number;
  gateKey: number;
  result: string;
  receivedAt: string;
  employeeName: string | null;
  visitorName: string | null;
  remoteReason?: string | null;
};
type Page = { items: Log[] };

const REFRESH_MS = 10_000;
// 층마다 게이트 약 3대 (D-59). 영상은 고른 층만 받는다. 서버는 영상 캡처를 8개까지 띄운다
const FLOOR_KEY = 'status.floor';

/** 마지막으로 본 층 (브라우저 저장). 없거나 막혀 있으면 undefined */
function savedFloor(): number | null | undefined {
  try {
    const v = localStorage.getItem(FLOOR_KEY);
    return v === null ? undefined : v === 'none' ? null : Number(v);
  } catch {
    return undefined;
  }
}

/** 단말이 게이트 서버에 접속해 있는지 */
function terminalText(terminals: Gate['terminals']) {
  if (terminals.length === 0) return { text: '없음', ok: true };
  const lost = terminals.filter((t) => !t.connected).length;
  if (lost === 0) return { text: '연결', ok: true };
  return {
    text: lost === terminals.length ? '끊김' : `${terminals.length}대 중 ${lost}대 끊김`,
    ok: false,
  };
}

/** 게이트 서버가 지금 보여주는 단말 영상을 받고 있는지 */
function videoText(terminals: Gate['terminals'], state: VideoState | undefined) {
  if (terminals.length === 0) return { text: '없음', ok: true };
  if (state === 'live') return { text: '연결', ok: true };
  if (state === 'lost') return { text: '끊김', ok: false };
  return { text: '확인 중', ok: true };
}

/** AI가 상태 보고로 알린, 이 게이트 단말 영상 수신 여부 */
function aiText(online: boolean, terminals: Gate['terminals']) {
  if (terminals.length === 0) return { text: '없음', ok: true };
  if (!online) return { text: '응답 없음', ok: false };
  if (terminals.some((t) => t.aiRtspOk === false)) return { text: '영상 못 받음', ok: false };
  if (terminals.some((t) => t.aiRtspOk === null)) return { text: '확인 안 됨', ok: false };
  return { text: '정상', ok: true };
}

export function StatusPage() {
  const [picked, setPicked] = useState(savedFloor);
  const [videoStates, setVideoStates] = useState<Record<number, VideoState>>({});
  const status = useLoad(() => api<Status>('GET', '/api/admin/status'), []);
  const recent = useLoad(() => api<Page>('GET', '/api/admin/access-logs?limit=20'), []);
  const today = todayKst();
  const remote = useLoad(
    () =>
      api<Page>('GET', `/api/admin/access-logs?method=REMOTE&from=${today}&to=${today}&limit=50`),
    [today],
  );
  const gates = status.data?.gates ?? [];
  const floors = byFloor(gates);
  const floor = floors.some((f) => f.floor === picked) ? picked : floors[0]?.floor;
  const pick = (next: number | null) => {
    setPicked(next);
    try {
      localStorage.setItem(FLOOR_KEY, next === null ? 'none' : String(next));
    } catch {
      // 저장이 막혀도 화면은 그대로
    }
  };

  useEffect(() => {
    const timer = setInterval(() => {
      status.reload();
      recent.reload();
      remote.reload();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [status.reload, recent.reload, remote.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const gateName = (key: number) =>
    status.data?.gates.find((g) => g.gateKey === key)?.name ?? String(key);
  const ai = status.data?.ai;

  return (
    <>
      <div className="page-heading">
        <h1>현황</h1>
        {ai && (
          <p className={ai.online ? 'note' : 'error'}>
            {`얼굴인식 서버 ${ai.online ? '정상' : '응답 없음'}, 마지막 응답 ${ai.lastStatusAt ? ai.lastStatusAt.slice(11, 19) : '없음'}`}
          </p>
        )}
      </div>
      <VisitorCalls
        gateName={gateName}
        onShowGate={(gateKey) => {
          const gate = gates.find((g) => g.gateKey === gateKey);
          if (gate) pick(gate.floor);
        }}
      />
      {status.error && <p className="error">상태를 불러오지 못했습니다. ({status.error})</p>}
      <section className="panel gate-status" aria-label="게이트 상태">
        <div className="section-heading">
          <h2>게이트 상태</h2>
        </div>
        {floors.length > 1 && (
          <div className="floor-tabs" role="group" aria-label="층">
            {floors.map((f) => {
              const bad = f.items.filter((g) => !terminalText(g.terminals).ok).length;
              return (
                <button
                  key={String(f.floor)}
                  type="button"
                  className={f.floor === floor ? 'primary' : undefined}
                  aria-pressed={f.floor === floor}
                  aria-label={bad ? `${floorName(f.floor)} 문제 ${bad}` : floorName(f.floor)}
                  onClick={() => pick(f.floor)}
                >
                  {floorName(f.floor)}
                  {bad > 0 && <span className="floor-badge">{bad}</span>}
                </button>
              );
            })}
          </div>
        )}
        {status.data && gates.length === 0 && (
          <p className="empty-state">
            등록된 게이트가 없습니다. <Link to="/gates">게이트 화면에서 게이트를 추가하세요</Link>
          </p>
        )}
        <div className="gate-operations">
          {gates.map((gate) => {
            // 다른 층 카드는 숨겨 두기만 해서 입력하던 방문객 정보가 남는다
            const visible = floors.length <= 1 || gate.floor === floor;
            const terminal = terminalText(gate.terminals);
            const video = videoText(gate.terminals, videoStates[gate.gateKey]);
            const face = aiText(ai?.online ?? false, gate.terminals);
            return (
              <section
                key={gate.gateKey}
                className="gate-operation"
                aria-label={gate.name}
                hidden={!visible}
              >
                <h3>{gate.name}</h3>
                <dl className="gate-connections">
                  <div>
                    <dt>단말</dt>
                    <dd className={terminal.ok ? undefined : 'problem'}>{terminal.text}</dd>
                  </div>
                  <div>
                    <dt>영상</dt>
                    <dd className={video.ok ? undefined : 'problem'}>{video.text}</dd>
                  </div>
                  <div>
                    <dt>얼굴인식</dt>
                    <dd className={face.ok ? undefined : 'problem'}>{face.text}</dd>
                  </div>
                </dl>
                <OpenGatePanel
                  gate={gate}
                  videoActive={visible}
                  onVideoState={(state) =>
                    setVideoStates((prev) =>
                      prev[gate.gateKey] === state ? prev : { ...prev, [gate.gateKey]: state },
                    )
                  }
                  onOpened={() => {
                    recent.reload();
                    remote.reload();
                  }}
                />
              </section>
            );
          })}
        </div>
        {!status.error && gates.length === 0 && (
          <p className="empty-state">
            {status.loading ? '불러오는 중입니다.' : '등록된 게이트가 없습니다.'}
          </p>
        )}
      </section>
      <div className="history-grid">
        <section className="panel" aria-label="최근 출입">
          <div className="section-heading">
            <h2>최근 출입</h2>
            <Link to="/access-logs">출입 기록 보기</Link>
          </div>
          <div className="history-body">
            <table>
              <thead>
                <tr>
                  <th>시각</th>
                  <th>게이트</th>
                  <th>이름</th>
                  <th>결과</th>
                </tr>
              </thead>
              <tbody>
                {recent.data?.items.map((log) => (
                  <tr
                    key={log.eventKey}
                    className={log.result === 'GRANTED' ? undefined : 'problem'}
                  >
                    <td>{timeText(log.receivedAt)}</td>
                    <td>{gateName(log.gateKey)}</td>
                    <td>{log.employeeName ?? log.visitorName ?? ''}</td>
                    <td className={log.result === 'GRANTED' ? 'ok' : 'problem'}>
                      {RESULT_LABEL[log.result] ?? log.result}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!recent.loading && !recent.error && recent.data?.items.length === 0 && (
              <p className="empty-state">최근 출입 기록이 없습니다.</p>
            )}
            {recent.error && <p className="error">출입 기록을 불러오지 못했습니다.</p>}
          </div>
        </section>
        <section className="panel" aria-label="오늘 원격 개방">
          <div className="section-heading">
            <h2>오늘 원격 개방</h2>
          </div>
          <div className="history-body">
            <table>
              <thead>
                <tr>
                  <th>시각</th>
                  <th>게이트</th>
                  <th>사유</th>
                  <th>결과</th>
                  <th>방문객</th>
                </tr>
              </thead>
              <tbody>
                {remote.data?.items.map((log) => (
                  <tr
                    key={log.eventKey}
                    className={log.result === 'GRANTED' ? undefined : 'problem'}
                  >
                    <td>{timeText(log.receivedAt)}</td>
                    <td>{gateName(log.gateKey)}</td>
                    <td>{log.remoteReason ? REASON_LABEL[log.remoteReason] : ''}</td>
                    <td className={log.result === 'GRANTED' ? 'ok' : 'problem'}>
                      {RESULT_LABEL[log.result] ?? log.result}
                    </td>
                    <td>{log.visitorName ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!remote.loading && !remote.error && remote.data?.items.length === 0 && (
              <p className="empty-state">오늘 원격으로 연 기록이 없습니다.</p>
            )}
            {remote.error && <p className="error">개방 이력을 불러오지 못했습니다.</p>}
          </div>
        </section>
      </div>
    </>
  );
}
