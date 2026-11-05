import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { Dialog } from '../components/Dialog';
import { floorName } from '../floor';
import { timeText } from '../format';
import { useLoad } from '../useLoad';
import { AddTerminalDialog } from './AddTerminalDialog';

type Adapter =
  | { type: 'MOCK' }
  | {
      type: 'DRY_CONTACT';
      host: string;
      port: number;
      unitId: number;
      coil: number;
      pulseMs: number;
    };
type Terminal = {
  terminalKey: number;
  name: string;
  model: string | null;
  appVersion: string | null;
  ip: string;
  connected: boolean;
  lastSeenAt: string | null;
};
export type GateView = {
  gateKey: number;
  name: string;
  adapter: Adapter;
  /** 지하는 음수, 모르면 null */
  floor: number | null;
  /** 로비 등 모든 사람 통과 (D-59) */
  openToAll: boolean;
  terminals: Terminal[];
};
type Message = { text: string; error: boolean } | null;

const REFRESH_MS = 10_000;
const RELAY_DEFAULTS = { host: '', port: 502, unitId: 1, coil: 0, pulseMs: 500 };

const adapterText = (a: Adapter) => (a.type === 'MOCK' ? '가짜' : `릴레이 ${a.host}`);

const Note = ({ message }: { message: Message }) =>
  message ? (
    <p className={message.error ? 'error' : 'note'} role={message.error ? 'alert' : 'status'}>
      {message.text}
    </p>
  ) : null;

/** 게이트 추가·수정 창. 수정일 때만 삭제 버튼 */
function GateForm({
  gate,
  onDone,
  onCancel,
}: {
  gate: GateView | null;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(gate?.name ?? '');
  const [floor, setFloor] = useState(gate?.floor == null ? '' : String(gate.floor));
  const [openToAll, setOpenToAll] = useState(gate?.openToAll ?? false);
  const [relay, setRelay] = useState(gate?.adapter.type === 'DRY_CONTACT');
  const [fields, setFields] = useState(
    gate?.adapter.type === 'DRY_CONTACT' ? gate.adapter : RELAY_DEFAULTS,
  );
  const [message, setMessage] = useState<Message>(null);
  const [pending, setPending] = useState(false);
  const number = (key: 'port' | 'unitId' | 'coil' | 'pulseMs') => ({
    type: 'number',
    value: fields[key],
    onChange: (e: { target: { value: string } }) =>
      setFields({ ...fields, [key]: Number(e.target.value) }),
  });

  async function save(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage(null);
    const adapter = relay
      ? {
          type: 'DRY_CONTACT',
          host: fields.host.trim(),
          port: fields.port,
          unitId: fields.unitId,
          coil: fields.coil,
          pulseMs: fields.pulseMs,
        }
      : { type: 'MOCK' };
    const body = {
      name,
      floor: floor.trim() === '' ? null : Number(floor),
      openToAll,
      adapter,
    };
    try {
      if (gate) await api('PATCH', `/api/admin/gates/${gate.gateKey}`, body);
      else await api('POST', '/api/admin/gates', body);
      onDone(gate ? '게이트를 수정했습니다.' : '게이트를 추가했습니다.');
    } catch {
      setMessage({
        text: '입력을 확인해 주세요. 이름은 40자까지, 층은 -10~200 정수, 릴레이 IP는 192.168.0.50 같은 형식, 펄스는 100~5000ms입니다.',
        error: true,
      });
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!gate || pending) return;
    setPending(true);
    setMessage(null);
    try {
      await api('DELETE', `/api/admin/gates/${gate.gateKey}`);
      onDone('게이트를 삭제했습니다.');
    } catch (err) {
      setMessage({
        text:
          err instanceof ApiError && err.status === 409
            ? '단말을 먼저 옮기거나 연결 해제하세요.'
            : '삭제하지 못했습니다.',
        error: true,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={save}>
      <fieldset disabled={pending} className="gate-form">
        <label>
          <span>이름</span>
          <input value={name} maxLength={40} required onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span>층 (지하는 -1)</span>
          <input
            type="number"
            step={1}
            min={-10}
            max={200}
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={openToAll}
            onChange={(e) => setOpenToAll(e.target.checked)}
          />
          모든 사람 통과 (로비 등 공용)
        </label>
        <div className="radio-row" role="radiogroup" aria-label="개폐기">
          <label>
            <input type="radio" checked={!relay} onChange={() => setRelay(false)} />
            가짜
          </label>
          <label>
            <input type="radio" checked={relay} onChange={() => setRelay(true)} />
            릴레이
          </label>
        </div>
        {relay && (
          <div className="row">
            <label>
              <span>릴레이 IP</span>
              <input
                value={fields.host}
                required
                placeholder="192.168.0.50"
                onChange={(e) => setFields({ ...fields, host: e.target.value })}
              />
            </label>
            <label>
              <span>포트</span>
              <input {...number('port')} min={1} max={65535} />
            </label>
            <label>
              <span>유닛</span>
              <input {...number('unitId')} min={0} max={255} />
            </label>
            <label>
              <span>코일</span>
              <input {...number('coil')} min={0} max={65535} />
            </label>
            <label>
              <span>펄스 (ms)</span>
              <input {...number('pulseMs')} min={100} max={5000} />
            </label>
          </div>
        )}
        <div className="actions">
          {gate && (
            <button type="button" className="danger-text" onClick={() => void remove()}>
              삭제
            </button>
          )}
          <button type="button" onClick={onCancel}>
            취소
          </button>
          <button className="primary" type="submit">
            저장
          </button>
        </div>
      </fieldset>
      <Note message={message} />
    </form>
  );
}

type TerminalAction = {
  kind: 'rename' | 'move' | 'unpair';
  terminal: Terminal;
  gateKey: number;
} | null;

/** 단말 이름 바꾸기, 게이트 옮기기, 연결 해제 */
function TerminalForm({
  action,
  gates,
  onDone,
  onCancel,
}: {
  action: NonNullable<TerminalAction>;
  gates: GateView[];
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const { kind, terminal } = action;
  const [name, setName] = useState(terminal.name);
  const [gateKey, setGateKey] = useState(action.gateKey);
  const [message, setMessage] = useState<Message>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage(null);
    const path = `/api/admin/terminals/${terminal.terminalKey}`;
    try {
      if (kind === 'unpair') await api('DELETE', path);
      else await api('PATCH', path, kind === 'rename' ? { name } : { gateKey });
      onDone(
        kind === 'unpair'
          ? `${terminal.name} 연결을 해제했습니다.`
          : kind === 'rename'
            ? '단말 이름을 바꿨습니다.'
            : '단말을 옮겼습니다.',
      );
    } catch {
      setMessage({ text: '바꾸지 못했습니다. 다시 시도해 주세요.', error: true });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <fieldset disabled={pending}>
        {kind === 'rename' && (
          <label>
            <span>단말 이름</span>
            <input value={name} maxLength={40} required onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        {kind === 'move' && (
          <label>
            <span>옮길 게이트</span>
            <select value={gateKey} onChange={(e) => setGateKey(Number(e.target.value))}>
              {gates.map((g) => (
                <option key={g.gateKey} value={g.gateKey}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === 'unpair' && (
          <p>
            {terminal.name} 연결을 해제할까요? 단말은 연결 대기 화면으로 돌아가고, 다시 쓰려면 새로
            연결해야 합니다.
          </p>
        )}
        <div className="actions">
          <button type="button" onClick={onCancel}>
            취소
          </button>
          <button className="primary" type="submit">
            {kind === 'unpair' ? '연결 해제' : '저장'}
          </button>
        </div>
      </fieldset>
      <Note message={message} />
    </form>
  );
}

export function GatesPage() {
  const gates = useLoad(() => api<GateView[]>('GET', '/api/admin/gates'), []);
  const [editing, setEditing] = useState<GateView | 'new' | null>(null);
  const [terminalAction, setTerminalAction] = useState<TerminalAction>(null);
  const [adding, setAdding] = useState<GateView | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [testing, setTesting] = useState<number | null>(null);

  useEffect(() => {
    const timer = setInterval(gates.reload, REFRESH_MS);
    return () => clearInterval(timer);
  }, [gates.reload]);

  const done = (text: string) => {
    setEditing(null);
    setTerminalAction(null);
    setMessage({ text, error: false });
    gates.reload();
  };

  // 결과는 다른 작업처럼 위쪽 안내 문구로. 표 칸에 넣으면 그 줄만 높아져 표가 어긋난다
  async function testOpen(gate: GateView) {
    if (testing !== null) return;
    setTesting(gate.gateKey);
    setMessage(null);
    try {
      await api('POST', `/api/admin/gates/${gate.gateKey}/open`, {
        reason: 'OTHER',
        note: '개방 시험',
      });
      setMessage({ text: `${gate.name}에 개방 신호를 보냈습니다`, error: false });
    } catch {
      setMessage({ text: `${gate.name} 게이트가 응답하지 않습니다`, error: true });
    } finally {
      setTesting(null);
    }
  }

  const list = gates.data ?? [];
  return (
    <>
      <div className="page-heading">
        <h1>게이트</h1>
        <button type="button" className="primary" onClick={() => setEditing('new')}>
          게이트 추가
        </button>
      </div>
      <Note message={message} />
      {gates.error && <p className="error">게이트를 불러오지 못했습니다. ({gates.error})</p>}
      <section className="panel gates-table" aria-label="게이트 목록">
        <table>
          <thead>
            <tr>
              <th>층</th>
              <th>게이트</th>
              <th>개폐기</th>
              <th>단말</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((gate) => (
              <tr key={gate.gateKey}>
                <td className="muted">{floorName(gate.floor)}</td>
                <td>
                  {gate.name}
                  {gate.openToAll && <span className="muted gate-open"> 모든 사람</span>}
                </td>
                <td className="muted">{adapterText(gate.adapter)}</td>
                <td>
                  {gate.terminals.length === 0 && <span className="muted">없음</span>}
                  {gate.terminals.map((t) => (
                    <div key={t.terminalKey} className="terminal-line">
                      <span>{t.name}</span>
                      <span className={t.connected ? 'muted' : 'problem'}>
                        {t.connected ? '연결' : '끊김'}
                      </span>
                      <span className="muted">{t.ip}</span>
                      {t.appVersion && <span className="muted">앱 {t.appVersion}</span>}
                      {t.lastSeenAt && <span className="muted">{timeText(t.lastSeenAt)}</span>}
                      <span className="terminal-actions">
                        {(['rename', 'move', 'unpair'] as const).map((kind) => (
                          <button
                            key={kind}
                            type="button"
                            aria-label={`${t.name} ${{ rename: '이름 바꾸기', move: '옮기기', unpair: '연결 해제' }[kind]}`}
                            onClick={() =>
                              setTerminalAction({ kind, terminal: t, gateKey: gate.gateKey })
                            }
                          >
                            {{ rename: '이름', move: '옮기기', unpair: '연결 해제' }[kind]}
                          </button>
                        ))}
                      </span>
                    </div>
                  ))}
                </td>
                <td>
                  <div className="gate-actions">
                    <button
                      type="button"
                      aria-label={`${gate.name} 단말 추가`}
                      onClick={() => setAdding(gate)}
                    >
                      단말 추가
                    </button>
                    <button
                      type="button"
                      aria-label={`${gate.name} 수정`}
                      onClick={() => setEditing(gate)}
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      aria-label={`${gate.name} 개방 시험`}
                      disabled={testing !== null}
                      onClick={() => void testOpen(gate)}
                    >
                      개방 시험
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!gates.loading && list.length === 0 && (
          <p className="empty-state">등록된 게이트가 없습니다. 게이트 추가를 눌러 시작하세요.</p>
        )}
      </section>
      <Dialog
        open={editing !== null}
        title={editing === 'new' ? '게이트 추가' : '게이트 수정'}
        onClose={() => setEditing(null)}
      >
        {editing !== null && (
          <GateForm
            key={editing === 'new' ? 'new' : editing.gateKey}
            gate={editing === 'new' ? null : editing}
            onDone={done}
            onCancel={() => setEditing(null)}
          />
        )}
      </Dialog>
      <Dialog
        open={terminalAction !== null}
        title={
          terminalAction?.kind === 'unpair'
            ? '단말 연결 해제'
            : terminalAction?.kind === 'move'
              ? '단말 옮기기'
              : '단말 이름 바꾸기'
        }
        onClose={() => setTerminalAction(null)}
      >
        {terminalAction && (
          <TerminalForm
            action={terminalAction}
            gates={list}
            onDone={done}
            onCancel={() => setTerminalAction(null)}
          />
        )}
      </Dialog>
      {adding && (
        <AddTerminalDialog
          gate={adding}
          onClose={() => setAdding(null)}
          onPaired={(terminalKey) => {
            setAdding(null);
            setMessage({ text: `단말 ${terminalKey}이 연결되었습니다.`, error: false });
            gates.reload();
          }}
        />
      )}
    </>
  );
}
