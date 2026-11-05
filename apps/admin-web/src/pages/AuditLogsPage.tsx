import { useState } from 'react';
import { api } from '../api';
import { timeText } from '../format';
import { ACTION_LABEL, LIGHT_COLORS, REASON_LABEL } from '../labels';
import { useLoad } from '../useLoad';

type Log = {
  auditKey: number;
  adminName: string | null;
  action: string;
  target: string | null;
  targetName: string | null;
  via: string | null;
  viaName: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
};
type Gate = { gateKey: number; name: string };

const PAGE_SIZE = 30;

const TARGET_LABEL: Record<string, string> = {
  employee: '직원',
  admin: '관리자',
  terminal: '단말',
  gate: '게이트',
  org: '소속',
  'visitor-call': '방문객 호출',
};

/** 서버가 지금 이름을 찾아 준다. 지워진 대상은 기록 안의 이름, 그것도 없으면 `직원 7` */
function targetText(log: Log) {
  if (log.targetName) return log.targetName;
  if (!log.target) return '';
  if (typeof log.detail?.name === 'string') return log.detail.name;
  const [kind, id] = log.target.split(/:(.*)/s);
  return TARGET_LABEL[kind] && id ? `${TARGET_LABEL[kind]} ${id}` : log.target;
}

/** 계정 없이 단말 관리자 번호로 한 일은 `관리자 번호`, 방문객 호출은 단말 앞 방문객 */
function actorText(log: Log) {
  if (log.adminName) return log.adminName;
  if (log.action === 'VISITOR_CALL') return '방문객';
  return log.via?.startsWith('TERMINAL:') ? '관리자 번호' : '';
}

function viaText(log: Log) {
  if (log.via === 'WEB') return '관리자 웹';
  if (log.via?.startsWith('TERMINAL:')) return log.viaName ?? `단말 ${log.via.slice(9)}`;
  return '';
}

const COLOR = Object.fromEntries(LIGHT_COLORS.map((c) => [c.value, c.label]));
// 설정 화면과 같은 이름
const LIGHT_STATE = { idle: '대기', granted: '통과', denied: '불통' };
const VOICE_STATE = { granted: '통과', denied: '거부', unregistered: '미등록' };

/** 설정 항목 이름과 값 글자 */
const SETTING: Record<string, { name: string; value?: (v: unknown) => string }> = {
  duplicateWindowSec: { name: '중복 개방 간격', value: (v) => `${v}초` },
  photoRetentionDays: { name: '출입 사진 보존 기간', value: (v) => `${v}일` },
  terminalAdminMode: {
    name: '단말 관리자 확인',
    value: (v) => (v === 'PIN' ? '관리자 번호' : '관리자 계정'),
  },
  ...Object.fromEntries(
    Object.entries(LIGHT_STATE).map(([key, label]) => [
      `terminalLight.${key}`,
      { name: `${label} 불빛`, value: (v: unknown) => COLOR[String(v)] },
    ]),
  ),
  ...Object.fromEntries(
    Object.entries(VOICE_STATE).map(([key, label]) => [
      `terminalVoice.${key}`,
      { name: `${label} 음성`, value: (v: unknown) => (v ? `"${v}"` : '말 안 함') },
    ]),
  ),
};

function settingChanges(detail: Record<string, unknown>) {
  // 예전 기록은 `{ terminalLight: { idle, ... } }`처럼 바뀐 뒤 값만 있다
  const flat = Object.entries(detail).flatMap(([key, value]) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value).map(([k, v]) => [`${key}.${k}`, v] as const)
      : [[key, value] as const],
  );
  return flat.map(([key, value]) => {
    if (key === 'terminalAdminPin') return '단말 관리자 번호 바꿈';
    const rule = SETTING[key];
    const show = (v: unknown) => rule?.value?.(v) ?? String(v);
    const name = rule?.name ?? key;
    return Array.isArray(value)
      ? `${name} ${show(value[0])} → ${show(value[1])}`
      : `${name} ${show(value)}`;
  });
}

const EMPLOYEE_FIELD: Record<string, string> = {
  employeeNo: '사번',
  name: '이름',
  department: '소속',
};

/** 무엇을 바꿨는지 한 줄씩 */
function detailLines(log: Log, gates: Gate[]): string[] {
  const d = log.detail;
  if (!d) return [];
  const gateName = (key: unknown) => gates.find((g) => g.gateKey === key)?.name ?? `게이트 ${key}`;
  switch (log.action) {
    case 'SETTINGS_UPDATE':
      return settingChanges(d);
    case 'EMPLOYEE_UPDATE':
      return Object.entries(d)
        .filter(([key]) => EMPLOYEE_FIELD[key])
        .map(([key, value]) => `${EMPLOYEE_FIELD[key]} ${value}`);
    case 'ACCESS_RULE_UPDATE': {
      const keys = Array.isArray(d.gateKeys) ? d.gateKeys : [];
      return [keys.length ? keys.map(gateName).join(', ') : '고른 게이트 없음'];
    }
    case 'REMOTE_OPEN':
      return [`사유 ${REASON_LABEL[String(d.reason)] ?? d.reason}`];
    case 'TERMINAL_PAIR':
    case 'TERMINAL_UNPAIR':
      return d.gateKey === undefined ? [] : [gateName(d.gateKey)];
    default:
      return [];
  }
}

export function AuditLogsPage() {
  const [page, setPage] = useState(0);
  const logs = useLoad(
    () =>
      api<{ items: Log[]; total: number }>(
        'GET',
        `/api/admin/audit-logs?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
      ),
    [page],
  );
  const gates = useLoad(() => api<Gate[]>('GET', '/api/admin/gates'), []);
  const total = logs.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <>
      <div className="page-heading">
        <h1>작업 이력</h1>
        {logs.data && <p className="note">{`모두 ${total}건`}</p>}
      </div>
      <section className="panel" aria-label="작업 이력 목록">
        <div className="audit-log-body">
          {!logs.loading && logs.error && (
            <>
              <p className="error" role="alert">
                작업 이력을 불러오지 못했습니다. ({logs.error})
              </p>
              <button type="button" onClick={logs.reload}>
                다시 시도
              </button>
            </>
          )}
          <table>
            <thead>
              <tr>
                <th>시각</th>
                <th>관리자</th>
                <th>어디서</th>
                <th>작업</th>
                <th>대상</th>
                <th>내용</th>
              </tr>
            </thead>
            <tbody>
              {logs.data?.items.map((log) => (
                <tr key={log.auditKey}>
                  <td>{timeText(log.createdAt)}</td>
                  <td>{actorText(log)}</td>
                  <td>{viaText(log)}</td>
                  <td>{ACTION_LABEL[log.action] ?? log.action}</td>
                  <td>{targetText(log)}</td>
                  <td className="audit-detail">
                    {detailLines(log, gates.data ?? []).map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.loading && !logs.data && (
            <p className="empty-state">작업 이력을 불러오는 중입니다.</p>
          )}
          {!logs.loading && !logs.error && total === 0 && (
            <p className="empty-state">작업 이력이 없습니다.</p>
          )}
        </div>
        {pages > 1 && (
          <nav className="actions access-log-pagination" aria-label="쪽 이동">
            <button
              type="button"
              disabled={page === 0 || logs.loading}
              onClick={() => setPage(page - 1)}
            >
              이전
            </button>
            <span className="muted">{`${page + 1} / ${pages}쪽`}</span>
            <button
              type="button"
              disabled={page + 1 >= pages || logs.loading}
              onClick={() => setPage(page + 1)}
            >
              다음
            </button>
          </nav>
        )}
      </section>
    </>
  );
}
