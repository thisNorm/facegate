import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, api } from '../api';
import { LoginPage } from './LoginPage';
import { CredentialsPage } from './CredentialsPage';

export type Admin = { adminKey: number; loginId: string; name: string };
export type AppEnv = 'development' | 'production';
export type AdminSession = { admin: Admin; mustChangeCredentials: boolean; appEnv: AppEnv };

const AdminContext = createContext<{
  admin: Admin;
  appEnv: AppEnv;
  logout: () => Promise<void>;
} | null>(null);

export function useAdmin() {
  const value = useContext(AdminContext);
  if (!value) throw new Error('useAdmin outside Session');
  return value;
}

export function Session({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'checking' | 'login' | 'error' | AdminSession>('checking');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    api<AdminSession>('GET', '/api/admin/auth/me').then(
      (session) => {
        if (active) setState(session);
      },
      (error: unknown) => {
        if (active) setState(error instanceof ApiError && error.status === 401 ? 'login' : 'error');
      },
    );
    const onLogout = () => {
      active = false;
      setState('login');
    };
    window.addEventListener('facegate:logout', onLogout);
    return () => {
      active = false;
      window.removeEventListener('facegate:logout', onLogout);
    };
  }, [attempt]);

  const logout = useCallback(async () => {
    try {
      await api('POST', '/api/admin/auth/logout');
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
    }
    setState('login');
  }, []);

  if (state === 'checking') return <p className="note narrow">확인하는 중입니다.</p>;
  if (state === 'error')
    return (
      <div className="narrow">
        <p className="error">로그인 상태를 확인하지 못했습니다. 다시 시도해 주세요.</p>
        <button
          onClick={() => {
            setState('checking');
            setAttempt((value) => value + 1);
          }}
        >
          다시 시도
        </button>
      </div>
    );
  if (state === 'login') return <LoginPage onDone={setState} />;
  if (state.mustChangeCredentials)
    return (
      <CredentialsPage
        admin={state.admin}
        onDone={(admin) => setState({ ...state, admin, mustChangeCredentials: false })}
      />
    );
  return (
    <AdminContext.Provider value={{ admin: state.admin, appEnv: state.appEnv, logout }}>
      {children}
    </AdminContext.Provider>
  );
}
