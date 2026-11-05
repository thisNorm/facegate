import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { useAdmin } from '../auth/Session';
import { PasswordField } from '../components/PasswordField';
import { timeText } from '../format';
import { LIGHT_COLORS } from '../labels';
import { useLoad } from '../useLoad';

type General = { duplicateWindowSec: number; photoRetentionDays: number };
type KeyInfo = { issued: boolean; hint: string | null; issuedAt: string | null };
type AdminRow = {
  adminKey: number;
  loginId: string;
  name: string;
  enabled: boolean;
  createdAt: string;
};
type Message = { text: string; error: boolean } | null;
const Note = ({ message }: { message: Message }) =>
  message ? (
    <p className={message.error ? 'error' : 'note'} role={message.error ? 'alert' : 'status'}>
      {message.text}
    </p>
  ) : null;

function AccessSettings() {
  const loaded = useLoad(() => api<General>('GET', '/api/admin/settings'), []);
  const [form, setForm] = useState<General | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    // 처음 불러온 서버 설정을 편집값으로 사용합니다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (loaded.data) setForm(loaded.data);
  }, [loaded.data]);
  if (!form)
    return (
      <div className="settings-section">
        <h2>출입 설정</h2>
        {loaded.loading ? (
          <p className="note" role="status">
            설정을 불러오는 중입니다.
          </p>
        ) : (
          <p className="error" role="alert">
            출입 설정을 불러오지 못했습니다.{' '}
            <button type="button" onClick={loaded.reload}>
              출입 설정 다시 불러오기
            </button>
          </p>
        )}
      </div>
    );
  async function save(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage(null);
    try {
      setForm(await api<General>('PUT', '/api/admin/settings', form));
      setMessage({ text: '저장했습니다.', error: false });
    } catch {
      setMessage({
        text: '저장하지 못했습니다. 중복 개방 간격은 1~60초, 보존 기간은 7~365일입니다.',
        error: true,
      });
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="settings-section" onSubmit={save}>
      <h2>출입 설정</h2>
      <fieldset className="row" disabled={pending}>
        <label>
          <span>중복 개방 간격 (초)</span>
          <input
            type="number"
            min={1}
            max={60}
            required
            value={form.duplicateWindowSec}
            onChange={(e) => setForm({ ...form, duplicateWindowSec: Number(e.target.value) })}
          />
        </label>
        <label>
          <span>출입 사진 보존 기간 (일)</span>
          <input
            type="number"
            min={7}
            max={365}
            required
            value={form.photoRetentionDays}
            onChange={(e) => setForm({ ...form, photoRetentionDays: Number(e.target.value) })}
          />
        </label>
        <div className="settings-actions">
          <button className="primary" type="submit" aria-label="출입 설정 저장">
            저장
          </button>
        </div>
      </fieldset>
      <Note message={message} />
    </form>
  );
}

function IngestKey() {
  const info = useLoad(() => api<KeyInfo>('GET', '/api/admin/settings/ingest-key'), []);
  const [issued, setIssued] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  async function issue() {
    if (pending || info.loading || info.error || !info.data) return;
    if (
      info.data?.issued &&
      !confirm(
        '새 키를 발급하면 지금 키는 바로 쓸 수 없게 됩니다. AI 서버 설정도 바꿔야 합니다. 발급할까요?',
      )
    )
      return;
    setIssued(null);
    setPending(true);
    setMessage(null);
    try {
      const { key } = await api<{ key: string }>('POST', '/api/admin/settings/ingest-key');
      setIssued(key);
      info.reload();
    } catch {
      setMessage({
        text: '발급 결과를 확인하지 못했습니다. 현재 키 상태와 AI 서버 설정을 확인한 뒤 다시 시도해 주세요.',
        error: true,
      });
      info.reload();
    } finally {
      setPending(false);
    }
  }
  const d = info.data;
  return (
    <section className="settings-section" aria-label="AI 연동 키">
      <h2>AI 연동 키</h2>
      {info.loading ? (
        <p className="note" role="status">
          연동 키 정보를 불러오는 중입니다.
        </p>
      ) : info.error ? (
        <p className="error" role="alert">
          연동 키 정보를 불러오지 못했습니다.{' '}
          <button type="button" onClick={info.reload}>
            연동 키 다시 불러오기
          </button>
        </p>
      ) : (
        <p className={d?.issued ? 'note' : 'error'}>
          {d?.issued
            ? `발급됨, 끝 4자리 ${d.hint}, ${timeText(d.issuedAt)}`
            : '발급된 키가 없습니다. AI 서버가 접속할 수 없습니다.'}
        </p>
      )}
      {issued && (
        <div>
          <code style={{ userSelect: 'all', wordBreak: 'break-all' }}>{issued}</code>
          <p className="error">
            이 키는 지금만 볼 수 있습니다. AI 서버 설정에 넣은 뒤 이 화면을 닫아 주세요.
          </p>
        </div>
      )}
      <button
        type="button"
        disabled={pending || info.loading || !!info.error || !d}
        onClick={issue}
      >
        새 키 발급
      </button>
      <Note message={message} />
    </section>
  );
}

function Admins() {
  const { admin: me } = useAdmin();
  const list = useLoad(() => api<AdminRow[]>('GET', '/api/admin/admins'), []);
  const [form, setForm] = useState({ loginId: '', name: '', password: '' });
  const [message, setMessage] = useState<Message>(null);
  const [adding, setAdding] = useState(false);
  const [toggling, setToggling] = useState<number | null>(null);
  const [toggleError, setToggleError] = useState('');
  async function toggle(a: AdminRow) {
    if (toggling !== null || a.adminKey === me.adminKey) return;
    setToggling(a.adminKey);
    setToggleError('');
    try {
      await api('PATCH', `/api/admin/admins/${a.adminKey}`, { enabled: !a.enabled });
    } catch {
      setToggleError(
        '변경 결과를 확인하지 못했습니다. 목록에서 현재 사용 상태를 다시 확인해 주세요.',
      );
    } finally {
      list.reload();
      setToggling(null);
    }
  }
  async function add(e: FormEvent) {
    e.preventDefault();
    if (adding) return;
    if (form.password === '') {
      setMessage({ text: '비밀번호를 입력해 주세요.', error: true });
      return;
    }
    setAdding(true);
    setMessage(null);
    try {
      await api('POST', '/api/admin/admins', form);
      setForm({ loginId: '', name: '', password: '' });
      setMessage({ text: '관리자를 추가했습니다.', error: false });
      list.reload();
    } catch (err) {
      const status = err instanceof ApiError ? err.status : undefined;
      setMessage({
        text:
          status === 409
            ? '이미 있는 아이디입니다.'
            : status === 400
              ? err instanceof ApiError && err.message === 'dev is reserved for development'
                ? '개발용 예약 아이디입니다. 다른 아이디를 입력해 주세요.'
                : '아이디는 영문 소문자, 숫자, . _ - 로 3~32자이며 이름과 비밀번호는 비울 수 없습니다.'
              : '추가하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        error: true,
      });
    } finally {
      setAdding(false);
    }
  }
  return (
    <section className="settings-section" aria-label="관리자 계정">
      <h2>관리자 계정</h2>
      {list.loading && (
        <p className="note" role="status">
          관리자 목록을 불러오는 중입니다.
        </p>
      )}
      {!list.loading && list.error && (
        <p className="error" role="alert">
          관리자 목록을 불러오지 못했습니다.{' '}
          <button type="button" onClick={list.reload}>
            관리자 목록 다시 불러오기
          </button>
        </p>
      )}
      {toggleError && (
        <p className="error" role="alert">
          {toggleError}
        </p>
      )}
      <div className="settings-admin-table">
        <table>
          <thead>
            <tr>
              <th>아이디</th>
              <th>이름</th>
              <th>상태</th>
              <th>만든 날</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.data?.map((a) => (
              <tr key={a.adminKey}>
                <td>{a.loginId}</td>
                <td>{a.name}</td>
                <td className={a.enabled ? 'ok' : 'problem'}>
                  {a.enabled ? '사용 중' : '사용 중지'}
                </td>
                <td>{a.createdAt.slice(0, 10)}</td>
                <td style={{ textAlign: 'right' }}>
                  {a.adminKey !== me.adminKey && (
                    <button
                      type="button"
                      disabled={toggling !== null || list.loading || !!list.error}
                      onClick={() => toggle(a)}
                    >
                      {a.enabled ? '사용 중지' : '다시 사용'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form aria-label="관리자 추가" onSubmit={add} style={{ marginTop: 12 }}>
        <fieldset className="row" disabled={adding}>
          <label>
            <span>아이디</span>
            <input
              value={form.loginId}
              onChange={(e) => setForm({ ...form, loginId: e.target.value })}
            />
          </label>
          <label>
            <span>이름</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <PasswordField
            label="비밀번호"
            name="new-admin-password"
            value={form.password}
            onChange={(password) => setForm({ ...form, password })}
            autoComplete="new-password"
          />
          <div className="settings-actions">
            <button type="submit">추가</button>
          </div>
        </fieldset>
      </form>
      <Note message={message} />
    </section>
  );
}

function MyPassword() {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [message, setMessage] = useState<Message>(null);
  const [pending, setPending] = useState(false);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function change(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (form.next === '') return setMessage({ text: '새 비밀번호를 입력해 주세요.', error: true });
    if (form.next !== form.confirm)
      return setMessage({ text: '새 비밀번호가 서로 다릅니다.', error: true });
    setPending(true);
    setMessage(null);
    try {
      await api('POST', '/api/admin/auth/password', {
        currentPassword: form.current,
        newPassword: form.next,
      });
      setMessage({ text: '비밀번호를 바꿨습니다. 다른 곳의 로그인은 끊어졌습니다.', error: false });
      setForm({ current: '', next: '', confirm: '' });
    } catch (err) {
      if (!active.current) return;
      const status = err instanceof ApiError ? err.status : undefined;
      if (err instanceof ApiError && status === 401 && err.message === 'login required') {
        window.dispatchEvent(new Event('facegate:logout'));
        return;
      }
      setMessage({
        text:
          status === 401
            ? '현재 비밀번호가 맞지 않습니다.'
            : status === 400
              ? '새 비밀번호를 입력해 주세요.'
              : '변경하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        error: true,
      });
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="settings-section" aria-label="내 비밀번호 변경" onSubmit={change}>
      <h2>내 비밀번호 변경</h2>
      <fieldset className="password-settings-fields" disabled={pending}>
        <PasswordField
          label="현재 비밀번호"
          name="current"
          value={form.current}
          onChange={(current) => setForm({ ...form, current })}
        />
        <PasswordField
          label="새 비밀번호"
          name="next"
          value={form.next}
          onChange={(next) => setForm({ ...form, next })}
          autoComplete="new-password"
        />
        <PasswordField
          label="새 비밀번호 확인"
          name="confirm"
          value={form.confirm}
          onChange={(confirm) => setForm({ ...form, confirm })}
          autoComplete="new-password"
        />
        <button type="submit">변경</button>
      </fieldset>
      <Note message={message} />
    </form>
  );
}

type FaceEngine = 'AI_SERVER' | 'TERMINAL';

/** 얼굴 인식을 PC의 AI 서버에서 할지 단말 안에서 할지 (D-63) */
function FaceEngineSettings() {
  const loaded = useLoad(
    () => api<{ engine: FaceEngine }>('GET', '/api/admin/settings/face-engine'),
    [],
  );
  const [engine, setEngine] = useState<FaceEngine | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [pending, setPending] = useState(false);
  const current = loaded.data?.engine;
  const chosen = engine ?? current ?? 'AI_SERVER';

  async function save(e: FormEvent) {
    e.preventDefault();
    if (pending || !current) return;
    setPending(true);
    setMessage(null);
    try {
      await api('PUT', '/api/admin/settings/face-engine', { engine: chosen });
      setEngine(null);
      loaded.reload();
      setMessage({ text: '저장했습니다. 단말에는 1분 안에 적용됩니다.', error: false });
    } catch {
      setMessage({ text: '저장하지 못했습니다.', error: true });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="settings-section" aria-label="얼굴 인식 위치" onSubmit={save}>
      <h2>얼굴 인식 위치</h2>
      <p className="note">
        단말을 고르면 단말이 등록 사진을 받아 스스로 얼굴을 알아봅니다. 이때 AI 서버 프로그램은
        끄세요. 둘 다 켜 두면 같은 사람이 두 번 기록될 수 있습니다.
      </p>
      <fieldset className="row" disabled={pending || !current}>
        <div className="radio-row" role="radiogroup" aria-label="인식하는 곳">
          <label>
            <input
              type="radio"
              checked={chosen === 'AI_SERVER'}
              onChange={() => setEngine('AI_SERVER')}
            />
            AI 서버
          </label>
          <label>
            <input
              type="radio"
              checked={chosen === 'TERMINAL'}
              onChange={() => setEngine('TERMINAL')}
            />
            단말
          </label>
        </div>
        <div className="settings-actions">
          <button className="primary" type="submit" aria-label="얼굴 인식 위치 저장">
            저장
          </button>
        </div>
      </fieldset>
      <Note message={message} />
    </form>
  );
}

type TerminalAdmin = { mode: 'ACCOUNT' | 'PIN'; pinSet: boolean };

/** 단말 설정 버튼에서 관리자를 어떻게 확인할지 (D-58) */
function TerminalAdminSettings() {
  const loaded = useLoad(() => api<TerminalAdmin>('GET', '/api/admin/settings/terminal-admin'), []);
  const [mode, setMode] = useState<TerminalAdmin['mode'] | null>(null);
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<Message>(null);
  const [pending, setPending] = useState(false);
  const current = loaded.data;
  const chosen = mode ?? current?.mode ?? 'ACCOUNT';

  async function save(e: FormEvent) {
    e.preventDefault();
    if (pending || !current) return;
    if (pin && !/^\d{4,8}$/.test(pin)) {
      setMessage({ text: '관리자 번호는 숫자 4~8자리입니다.', error: true });
      return;
    }
    if (chosen === 'PIN' && !pin && !current.pinSet) {
      setMessage({ text: '관리자 번호를 먼저 정해 주세요.', error: true });
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      await api('PUT', '/api/admin/settings/terminal-admin', { mode: chosen, ...(pin && { pin }) });
      setPin('');
      setMode(null);
      loaded.reload();
      setMessage({ text: '저장했습니다.', error: false });
    } catch {
      setMessage({ text: '저장하지 못했습니다.', error: true });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="settings-section" aria-label="단말 관리자 확인" onSubmit={save}>
      <h2>단말 관리자 확인</h2>
      <p className="note">
        단말의 설정 버튼을 누르면 관리자인지 확인합니다. 관리자 계정은 작업 이력에 이름이 남고,
        관리자 번호는 단말 번호로 남습니다.
      </p>
      <fieldset className="row" disabled={pending || !current}>
        <div className="radio-row" role="radiogroup" aria-label="확인 방식">
          <label>
            <input
              type="radio"
              checked={chosen === 'ACCOUNT'}
              onChange={() => setMode('ACCOUNT')}
            />
            관리자 계정
          </label>
          <label>
            <input type="radio" checked={chosen === 'PIN'} onChange={() => setMode('PIN')} />
            관리자 번호
          </label>
        </div>
      </fieldset>
      <fieldset className="row" disabled={pending || !current}>
        <PasswordField
          label={
            current?.pinSet ? '관리자 번호 바꾸기 (숫자 4~8자리)' : '관리자 번호 (숫자 4~8자리)'
          }
          name="terminal-admin-pin"
          value={pin}
          onChange={setPin}
          autoComplete="off"
        />
        <div className="settings-actions">
          <button className="primary" type="submit" aria-label="단말 관리자 확인 저장">
            저장
          </button>
        </div>
      </fieldset>
      {current && (
        <p className="note">
          {`지금: ${current.mode === 'PIN' ? '관리자 번호' : '관리자 계정'}, 관리자 번호 ${current.pinSet ? '정해짐' : '없음'}`}
        </p>
      )}
      <Note message={message} />
    </form>
  );
}

type LightColor = (typeof LIGHT_COLORS)[number]['value'];
type TerminalLight = { idle: LightColor; granted: LightColor; denied: LightColor };
const LIGHT_STATES: { key: keyof TerminalLight; label: string }[] = [
  { key: 'idle', label: '대기' },
  { key: 'granted', label: '통과' },
  { key: 'denied', label: '불통' },
];

/** 단말 외관 불빛 색. 저장하면 연결된 단말에 바로 적용 */
function TerminalLightSettings() {
  const loaded = useLoad(() => api<TerminalLight>('GET', '/api/admin/settings/terminal-light'), []);
  const [form, setForm] = useState<TerminalLight | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (loaded.data) setForm(loaded.data);
  }, [loaded.data]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (pending || !form) return;
    setPending(true);
    setMessage(null);
    try {
      setForm(await api<TerminalLight>('PUT', '/api/admin/settings/terminal-light', form));
      setMessage({ text: '저장했습니다. 연결된 단말에 바로 적용됩니다.', error: false });
    } catch {
      setMessage({ text: '저장하지 못했습니다.', error: true });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="settings-section" aria-label="단말 불빛" onSubmit={save}>
      <h2>단말 불빛</h2>
      {loaded.error && (
        <p className="error" role="alert">
          불빛 설정을 불러오지 못했습니다.{' '}
          <button type="button" onClick={loaded.reload}>
            불빛 설정 다시 불러오기
          </button>
        </p>
      )}
      <fieldset className="row light-row" disabled={pending || !form}>
        {LIGHT_STATES.map(({ key, label }) => (
          <label key={key}>
            <span>{label}</span>
            <select
              value={form?.[key] ?? ''}
              onChange={(e) => form && setForm({ ...form, [key]: e.target.value as LightColor })}
            >
              {LIGHT_COLORS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        <div className="settings-actions">
          <button className="primary" type="submit" aria-label="단말 불빛 저장">
            저장
          </button>
        </div>
      </fieldset>
      <Note message={message} />
    </form>
  );
}

type TerminalVoice = { granted: string; denied: string; unregistered: string };
// 출입 단말에서 흔히 쓰는 멘트. 누르면 칸에 들어가고, 직접 고쳐 써도 된다
const VOICE_LINES: { key: keyof TerminalVoice; label: string; presets: string[] }[] = [
  {
    key: 'granted',
    label: '통과',
    presets: ['인증되었습니다', '환영합니다', '출입이 확인되었습니다'],
  },
  {
    key: 'denied',
    label: '거부 (권한 없음, 퇴사, 게이트 오류)',
    presets: ['출입 권한이 없습니다', '다시 시도해 주세요', '관리자에게 문의해 주세요'],
  },
  {
    key: 'unregistered',
    label: '미등록 얼굴',
    presets: [
      '등록되지 않은 사용자입니다',
      '다시 시도해 주세요',
      '방문객은 호출 버튼을 눌러 주세요',
    ],
  },
];

/** 이 브라우저의 한국어 음성으로 미리 듣기. 단말 목소리(구글 음성 합성)와는 다르다 */
function speak(text: string) {
  if (!text.trim() || !('speechSynthesis' in window)) return;
  const line = new SpeechSynthesisUtterance(text);
  line.lang = 'ko-KR';
  speechSynthesis.cancel();
  speechSynthesis.speak(line);
}

/** 단말 음성 안내 문구. 확인음 뒤에 말한다. 비우면 확인음만 */
function TerminalVoiceSettings() {
  const loaded = useLoad(() => api<TerminalVoice>('GET', '/api/admin/settings/terminal-voice'), []);
  const [form, setForm] = useState<TerminalVoice | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (loaded.data) setForm(loaded.data);
  }, [loaded.data]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (pending || !form) return;
    setPending(true);
    setMessage(null);
    try {
      setForm(await api<TerminalVoice>('PUT', '/api/admin/settings/terminal-voice', form));
      setMessage({ text: '저장했습니다. 연결된 단말에 바로 적용됩니다.', error: false });
    } catch {
      setMessage({ text: '저장하지 못했습니다. 문구는 40자까지입니다.', error: true });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="settings-section" aria-label="단말 음성 안내" onSubmit={save}>
      <h2>단말 음성 안내</h2>
      <p className="note">
        판정 확인음 뒤에 단말이 읽어 줍니다. 비워 두면 확인음만 납니다. 이름은 읽지 않습니다.
      </p>
      {loaded.error && (
        <p className="error" role="alert">
          음성 안내를 불러오지 못했습니다.{' '}
          <button type="button" onClick={loaded.reload}>
            음성 안내 다시 불러오기
          </button>
        </p>
      )}
      <fieldset className="voice-lines" disabled={pending || !form}>
        {VOICE_LINES.map(({ key, label, presets }) => (
          <div key={key} className="voice-field">
            <div className="voice-line">
              <label>
                <span>{label}</span>
                <input
                  value={form?.[key] ?? ''}
                  maxLength={40}
                  placeholder="말하지 않음"
                  onChange={(e) => form && setForm({ ...form, [key]: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="voice-preview"
                aria-label={`${label.split(' ')[0]} 미리 듣기`}
                disabled={!form?.[key]?.trim()}
                onClick={() => speak(form?.[key] ?? '')}
              >
                미리 듣기
              </button>
            </div>
            <div className="voice-presets" aria-label={`${label.split(' ')[0]} 추천 멘트`}>
              {presets.map((text) => (
                <button
                  key={text}
                  type="button"
                  aria-pressed={form?.[key] === text}
                  onClick={() => form && setForm({ ...form, [key]: text })}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="settings-actions">
          <button className="primary" type="submit" aria-label="음성 안내 저장">
            저장
          </button>
        </div>
      </fieldset>
      <Note message={message} />
    </form>
  );
}

export function SettingsPage() {
  return (
    <>
      <div className="page-heading">
        <h1>설정</h1>
      </div>
      <div className="settings-body panel">
        <AccessSettings />
        <IngestKey />
        <FaceEngineSettings />
        <TerminalAdminSettings />
        <TerminalLightSettings />
        <TerminalVoiceSettings />
        <Admins />
        <MyPassword />
      </div>
    </>
  );
}
