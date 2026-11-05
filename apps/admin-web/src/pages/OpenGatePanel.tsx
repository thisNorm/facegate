import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { TerminalVideo, type VideoState } from '../components/TerminalVideo';

type Reason = 'RECOGNITION_FAILED' | 'VISITOR' | 'OTHER';
const REASONS: [Reason, string][] = [
  ['VISITOR', '방문객'],
  ['RECOGNITION_FAILED', '직원 인증 불가'],
  ['OTHER', '기타'],
];

export function OpenGatePanel({
  gate,
  videoActive = true,
  onOpened,
  onVideoState,
}: {
  gate: { gateKey: number; name: string; terminals: { terminalKey: number }[] };
  videoActive?: boolean;
  onOpened: () => void;
  onVideoState?: (state: VideoState) => void;
}) {
  const [reason, setReason] = useState<Reason>('VISITOR');
  const [visitor, setVisitor] = useState({ name: '', company: '' });
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const ready =
    reason === 'VISITOR'
      ? visitor.name.trim() !== ''
      : reason === 'OTHER'
        ? note.trim() !== ''
        : true;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || pending) return;
    const body: Record<string, unknown> = { reason };
    if (reason === 'VISITOR')
      body.visitor = {
        name: visitor.name.trim(),
        ...(visitor.company.trim() && { company: visitor.company.trim() }),
      };
    if (note.trim()) body.note = note.trim();
    setPending(true);
    setMessage(null);
    try {
      await api('POST', `/api/admin/gates/${gate.gateKey}/open`, body);
      setMessage({ text: `${gate.name} 개방 신호를 보냈습니다.`, error: false });
      setVisitor({ name: '', company: '' });
      setNote('');
      onOpened();
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setMessage({
        text:
          status === 400
            ? '열지 못했습니다. 입력을 확인해 주세요.'
            : status === 502
              ? '게이트가 응답하지 않습니다. 릴레이 연결을 확인해 주세요.'
              : '결과를 확인하지 못했습니다. 오늘 원격 개방 이력을 확인해 주세요.',
        error: true,
      });
      // 열렸을 수도 있으니 이력을 다시 불러와 두 번 누르지 않게 한다.
      if (status !== 400) onOpened();
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="open-gate-form" aria-label={`${gate.name} 개방`} onSubmit={submit}>
      <div className="gate-video">
        <TerminalVideo
          terminalKeys={gate.terminals.map((t) => t.terminalKey)}
          active={videoActive}
          onState={onVideoState}
        />
      </div>
      <div className="open-gate-fields">
        <fieldset className="open-reasons">
          <legend className="note">사유</legend>
          <div className="reason-options">
            {REASONS.map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name={`reason-${gate.gateKey}`}
                  checked={reason === value}
                  onChange={() => setReason(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        {reason === 'RECOGNITION_FAILED' && (
          <p className="note">얼굴과 NFC로 출입할 수 없는 경우에 사용합니다.</p>
        )}
        {reason === 'VISITOR' && (
          <div className="row">
            <label>
              <span>방문객 이름</span>
              <input
                value={visitor.name}
                onChange={(e) => setVisitor((v) => ({ ...v, name: e.target.value }))}
              />
            </label>
            <label>
              <span>회사</span>
              <input
                value={visitor.company}
                onChange={(e) => setVisitor((v) => ({ ...v, company: e.target.value }))}
              />
            </label>
          </div>
        )}
        <label>
          <span>메모</span>
          <input value={note} maxLength={100} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="open-result" aria-live="polite">
          {message && <p className={message.error ? 'error' : 'note'}>{message.text}</p>}
        </div>
        <div className="actions">
          <button className="primary" type="submit" disabled={!ready || pending}>
            {gate.name} 1회 개방
          </button>
        </div>
      </div>
    </form>
  );
}
