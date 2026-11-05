import { useEffect, useRef, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { ApiError, api } from '../api';
import { Dialog } from '../components/Dialog';

type Code = { code: string; expiresAt: string; serverUrls: string[] };
type GateRef = { gateKey: number; name: string; terminals: { terminalKey: number }[] };

const POLL_MS = 2000;

/**
 * 단말이 QR로 읽는 내용: IGP1:<번호>:<포트>:<주소>/<주소>...
 * 대문자·숫자·:./만 써서 QR의 영숫자 모드(가장 성긴 모드)가 되게 한다. 칸이 커야 화면을 찍어도 읽힌다.
 * 서버 주소 후보는 모두 같은 포트(서버가 하나)
 */
export function pairUri(code: string, serverUrls: string[]) {
  const hosts = serverUrls.map((url) => new URL(url));
  return `IGP1:${code}:${hosts[0]?.port ?? ''}:${hosts.map((u) => u.hostname).join('/')}`;
}

const kstMs = (kst: string) => new Date(`${kst.replace(' ', 'T')}+09:00`).getTime();
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * 단말 추가 (D-57). 위는 QR(단말 → 서버), 아래는 단말 화면의 주소와 번호를 넣는 번호 연결(서버 → 단말).
 * 어느 쪽이든 이 게이트에 새 단말이 생기면 저절로 닫힌다.
 */
export function AddTerminalDialog({
  gate,
  onClose,
  onPaired,
}: {
  gate: GateRef;
  onClose: () => void;
  onPaired: (terminalKey: number) => void;
}) {
  const [code, setCode] = useState<Code | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [codeError, setCodeError] = useState(false);
  const [left, setLeft] = useState(0);
  const [address, setAddress] = useState('');
  const [pin, setPin] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const known = useRef(new Set(gate.terminals.map((t) => t.terminalKey)));
  const paired = useRef(onPaired);
  useEffect(() => {
    paired.current = onPaired;
  });

  async function issue() {
    setCodeError(false);
    setQr(null);
    try {
      const issued = await api<Code>('POST', `/api/admin/gates/${gate.gateKey}/pair-codes`);
      setCode(issued);
      setQr(
        await QRCode.toDataURL(pairUri(issued.code, issued.serverUrls), {
          margin: 4,
          width: 320,
          errorCorrectionLevel: 'L',
        }),
      );
    } catch {
      setCodeError(true);
    }
  }

  useEffect(() => {
    // 창을 열면 바로 코드를 발급해 QR을 보여 준다
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void issue();
  }, [gate.gateKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!code) return;
    const tick = () => setLeft(kstMs(code.expiresAt) - Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [code]);

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const gates = await api<GateRef[]>('GET', '/api/admin/gates');
        const now = gates.find((g) => g.gateKey === gate.gateKey)?.terminals ?? [];
        const added = now.find((t) => !known.current.has(t.terminalKey));
        if (added) paired.current(added.terminalKey);
      } catch {
        // 다음 주기에 다시 확인
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [gate.gateKey]);

  async function pairByNumber(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const { terminalKey } = await api<{ terminalKey: number }>(
        'POST',
        `/api/admin/gates/${gate.gateKey}/terminals`,
        { address: address.trim(), pin: pin.trim() },
      );
      paired.current(terminalKey);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      const body = err instanceof ApiError ? err.message : '';
      setError(
        status === 502
          ? '단말에 연결할 수 없습니다. 단말 주소와 같은 망인지 확인하세요.'
          : status === 400 && body.includes('WRONG_PIN')
            ? '연결 번호가 맞지 않습니다'
            : '단말 주소와 6자리 번호를 확인하세요.',
      );
    } finally {
      setPending(false);
    }
  }

  const expired = code !== null && left <= 0;
  return (
    <Dialog open title={`${gate.name} 단말 추가`} onClose={onClose}>
      <section className="pair-qr" aria-label="QR로 연결">
        {qr && !expired && <img src={qr} alt="단말 연결 QR" width={320} height={320} />}
        {!expired && <p className="note">단말 카메라에서 30~50cm 거리로 비춰 주세요.</p>}
        {code && !expired && <p className="note">남은 시간 {clock(left)}</p>}
        {(expired || codeError) && (
          <p className="error">
            {codeError ? '코드를 발급하지 못했습니다.' : '코드가 만료되었습니다.'}{' '}
            <button type="button" onClick={() => void issue()}>
              새 코드
            </button>
          </p>
        )}
      </section>
      <form className="pair-number" onSubmit={pairByNumber} aria-label="번호로 연결">
        <h3>QR을 쓸 수 없으면</h3>
        <p className="note">단말 화면에 표시된 단말 주소와 연결 번호를 입력하세요.</p>
        <fieldset className="row" disabled={pending}>
          <label>
            <span>단말 주소</span>
            <input
              value={address}
              required
              placeholder="192.168.0.59"
              onChange={(e) => setAddress(e.target.value)}
            />
          </label>
          <label>
            <span>연결 번호</span>
            <input
              value={pin}
              required
              inputMode="numeric"
              maxLength={7}
              placeholder="482913"
              onChange={(e) => setPin(e.target.value.replace(/\s/g, ''))}
            />
          </label>
          <button className="primary" type="submit">
            연결
          </button>
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
      <div className="actions">
        <button type="button" onClick={onClose}>
          닫기
        </button>
      </div>
    </Dialog>
  );
}
