import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { PasswordField } from '../components/PasswordField';
import type { AdminSession } from './Session';

export function LoginPage({ onDone }: { onDone: (session: AdminSession) => void }) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [round, setRound] = useState(0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setRound((value) => value + 1);
    try {
      const { admin, mustChangeCredentials, appEnv } = await api<
        AdminSession & { expiresAt: string }
      >('POST', '/api/admin/auth/login', { loginId, password });
      onDone({ admin, mustChangeCredentials, appEnv });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : undefined;
      setPassword('');
      setError(
        status === 423
          ? '비밀번호를 5번 틀려 잠겼습니다. 10분 뒤 다시 시도해 주세요.'
          : status === 401
            ? '아이디 또는 비밀번호가 맞지 않습니다.'
            : '로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      );
    }
  }

  return (
    <form className="narrow" onSubmit={submit} key={round}>
      <h1>로그인</h1>
      <label>
        <span>아이디</span>
        <input
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          autoComplete="username"
        />
      </label>
      <PasswordField label="비밀번호" name="password" value={password} onChange={setPassword} />
      {error && <p className="error">{error}</p>}
      <button className="primary" type="submit">
        로그인
      </button>
    </form>
  );
}
