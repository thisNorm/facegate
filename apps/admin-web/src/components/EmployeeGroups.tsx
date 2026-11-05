import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useLoad } from '../useLoad';
import type { GateItem } from './GateChecklist';

type Group = { groupKey: number; name: string; scheduleName: string };
type Access = { groupKeys: number[]; orgGroupKeys: number[]; gateKeys: number[] };

/** 직원의 권한 그룹 (D-61). 소속으로 받는 그룹은 체크된 채 잠그고, 직접 넣을 그룹만 고른다 */
export function EmployeeGroups({ employeeKey }: { employeeKey: number }) {
  const groups = useLoad(() => api<Group[]>('GET', '/api/admin/access-groups'), []);
  const gates = useLoad(() => api<GateItem[]>('GET', '/api/admin/gates'), []);
  const access = useLoad(
    () => api<Access>('GET', `/api/admin/employees/${employeeKey}/access-groups`),
    [employeeKey],
  );
  const [checked, setChecked] = useState<Set<number> | null>(null);
  const [saved, setSaved] = useState<Access | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const now = saved ?? access.data;
  if (!groups.data || !gates.data || !now) return null;
  const current = checked ?? new Set(now.groupKeys);
  const viaOrg = new Set(now.orgGroupKeys);
  const open = gates.data.filter((g) => g.openToAll || now.gateKeys.includes(g.gateKey));
  const toggle = (key: number, on: boolean) => {
    const next = new Set(current);
    if (on) next.add(key);
    else next.delete(key);
    setChecked(next);
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage(null);
    try {
      setSaved(
        await api<Access>('PUT', `/api/admin/employees/${employeeKey}/access-groups`, {
          groupKeys: [...current].sort((a, b) => a - b),
        }),
      );
      setMessage({ text: '저장했습니다.', error: false });
    } catch {
      setMessage({ text: '저장하지 못했습니다.', error: true });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="panel" aria-label="권한 그룹" onSubmit={save}>
      <h2 style={{ marginTop: 0 }}>권한 그룹</h2>
      <p className="note">
        소속으로 들어가 있는 그룹은 체크된 채 잠겨 있습니다. 이 사람만 더 넣을 그룹을 고르세요.
      </p>
      {groups.data.length === 0 && (
        <p className="empty-state">권한 그룹이 없습니다. 출입 권한 메뉴에서 만드세요.</p>
      )}
      <div className="member-orgs">
        {groups.data.map((g) => (
          <label key={g.groupKey} className="check">
            <input
              type="checkbox"
              checked={viaOrg.has(g.groupKey) || current.has(g.groupKey)}
              disabled={viaOrg.has(g.groupKey)}
              onChange={(e) => toggle(g.groupKey, e.target.checked)}
            />
            <span>
              {g.name}
              <span className="muted">
                {` ${g.scheduleName}${viaOrg.has(g.groupKey) ? ', 소속으로' : ''}`}
              </span>
            </span>
          </label>
        ))}
      </div>
      <p className="note">
        {open.length
          ? `다닐 수 있는 게이트: ${open.map((g) => g.name).join(', ')}`
          : '다닐 수 있는 게이트가 없습니다.'}
      </p>
      <button className="primary" type="submit" disabled={pending} aria-label="권한 그룹 저장">
        저장
      </button>
      {message && <p className={message.error ? 'error' : 'note'}>{message.text}</p>}
    </form>
  );
}
