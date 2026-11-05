import { BrowserRouter, Route, Routes } from 'react-router';
import { Session } from './auth/Session';
import { Layout } from './Layout';
import { AccessLogsPage } from './pages/AccessLogsPage';
import { AuditLogsPage } from './pages/AuditLogsPage';
import { EmployeeDetailPage } from './pages/EmployeeDetailPage';
import { EmployeeNewPage } from './pages/EmployeeNewPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { AccessRulesPage } from './pages/AccessRulesPage';
import { GatesPage } from './pages/GatesPage';
import { SettingsPage } from './pages/SettingsPage';
import { StatusPage } from './pages/StatusPage';

export function App() {
  return (
    <Session>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<StatusPage />} />
            <Route path="employees" element={<EmployeesPage />} />
            <Route path="employees/new" element={<EmployeeNewPage />} />
            <Route path="employees/:employeeKey" element={<EmployeeDetailPage />} />
            <Route path="access-logs" element={<AccessLogsPage />} />
            <Route path="gates" element={<GatesPage />} />
            <Route path="access-rules" element={<AccessRulesPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="audit-logs" element={<AuditLogsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </Session>
  );
}
