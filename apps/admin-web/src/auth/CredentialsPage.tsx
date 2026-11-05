import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { PasswordField } from '../components/PasswordField';
import type { Admin } from './Session';

const MESSAGES: Record<number, string> = {
  400: '아이디 형식과 비밀번호 입력을 확인해 주세요.',
  401: '현재 비밀번호가 맞지 않습니다. 다시 입력해 주세요.',
  409: '이미 있는 아이디입니다. 다른 아이디를 입력해 주세요.',
};

export function CredentialsPage({
  admin,
  onDone,
}: {
  admin: Admin;
  onDone: (admin: Admin) => void;
}) {
  const [form, setForm] = useState({
    loginId: admin.loginId,
    currentPassword: '',
    newPassword: '',
    confirm: '',
  });
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [round, setRound] = useState(0);
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function save(keep: boolean) {
    if (pending) return;
    setRound((value) => value + 1);
    setError('');
    if (!form.currentPassword) {
      setError('현재 비밀번호를 입력해 주세요.');
      return;
    }
    if (!keep && !/^[a-z0-9._-]{3,32}$/.test(form.loginId)) {
      setError('아이디는 영문 소문자, 숫자, . _ - 로 3~32자여야 합니다.');
      return;
    }
    if (!keep && form.newPassword !== form.confirm) {
      setError('새 비밀번호가 서로 다릅니다.');
      return;
    }
    const body = {
      currentPassword: form.currentPassword,
      ...(!keep && form.loginId !== admin.loginId ? { loginId: form.loginId } : {}),
      ...(!keep && form.newPassword !== '' ? { newPassword: form.newPassword } : {}),
    };
    setPending(true);
    try {
      const result = await api<{ admin: Admin }>('POST', '/api/admin/auth/credentials', body);
      onDone(result.admin);
    } catch (err) {
      setError(
        (err instanceof ApiError ? MESSAGES[err.status] : undefined) ??
          '확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      );
    } finally {
      setPending(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void save(false);
  }

  return (
    <form className="narrow" onSubmit={submit} key={round} aria-label="계정 정보 확인">
      <h1>계정 정보 확인</h1>
      <p className="note">
        아이디와 비밀번호를 바꾸거나 그대로 사용할 수 있습니다. 현재 비밀번호로 확인해 주세요.
      </p>
      <label>
        <span>아이디</span>
        <input
          value={form.loginId}
          onChange={(e) => set('loginId')(e.target.value)}
          autoComplete="username"
        />
      </label>
      <PasswordField
        label="현재 비밀번호"
        name="currentPassword"
        value={form.currentPassword}
        onChange={set('currentPassword')}
      />
      <PasswordField
        label="새 비밀번호"
        name="newPassword"
        value={form.newPassword}
        onChange={set('newPassword')}
        autoComplete="new-password"
      />
      <PasswordField
        label="새 비밀번호 확인"
        name="confirm"
        value={form.confirm}
        onChange={set('confirm')}
        autoComplete="new-password"
      />
      <p className="note">새 비밀번호를 비우면 현재 비밀번호를 유지합니다.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button className="primary" type="submit" disabled={pending}>
          변경하고 계속
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            void save(true);
          }}
        >
          그대로 쓰기
        </button>
      </div>
    </form>
  );
}
