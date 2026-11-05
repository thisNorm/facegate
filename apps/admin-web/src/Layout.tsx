import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useAdmin } from './auth/Session';
import Header from './components/Header';
import Footer from './components/Footer';

const MENU = [
  ['/', '현황'],
  ['/employees', '직원'],
  ['/access-logs', '출입 기록'],
  ['/gates', '게이트'],
  ['/access-rules', '출입 권한'],
  ['/settings', '설정'],
  ['/audit-logs', '작업 이력'],
] as const;

export function Layout() {
  const { admin, logout } = useAdmin();
  const [logoutError, setLogoutError] = useState('');
  return (
    <div className="app-layout">
      <aside className="sidebar" aria-label="주 메뉴">
        <div className="sidebar-brand">
          <strong>FaceGate</strong>
        </div>
        <nav aria-label="관리 메뉴">
          {MENU.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="app-workspace">
        <Header
          adminName={admin.name}
          onLogout={() => {
            void logout().catch(() =>
              setLogoutError('로그아웃하지 못했습니다. 다시 시도해 주세요.'),
            );
          }}
        />
        <main className="app-main">
          {logoutError && (
            <p className="error" role="alert">
              {logoutError}
            </p>
          )}
          <Outlet />
        </main>
        <Footer />
      </div>
    </div>
  );
}
