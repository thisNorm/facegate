import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { GateChecklist, type GateItem } from '../components/GateChecklist';
import { ORG_KIND_LABEL } from '../labels';
import { useLoad } from '../useLoad';

export type Group = {
  groupKey: number;
  name: string;
  scheduleKey: number;
  scheduleName: string;
  gateKeys: number[];
  orgKeys: number[];
  employeeKeys: number[];
};
export type Schedule = { scheduleKey: number; name: string };
type Org = { orgKey: number; name: string; kind: string };
type Person = { employeeKey: number; employeeNo: string; name: string; department: string };
type Message = { text: string; error: boolean } | null;

const MAX_FOUND = 8;

/** 권한 그룹 (D-61): 게이트 묶음 + 시간표 + 구성원(소속, 직원). 한 사람이 여러 그룹 */
export function AccessGroupsTab() {
  const groups = useLoad(() => api<Group[]>('GET', '/api/admin/access-groups'), []);
  const gates = useLoad(() => api<GateItem[]>('GET', '/api/admin/gates'), []);
  const schedules = useLoad(() => api<Schedule[]>('GET', '/api/admin/schedules'), []);
  const orgs = useLoad(() => api<Org[]>('GET', '/api/admin/orgs'), []);
  const people = useLoad(() => api<Person[]>('GET', '/api/admin/employees?status=ACTIVE'), []);
  // null 고르지 않음, 'new' 새 그룹
  const [selected, setSelected] = useState<number | 'new' | null>(null);
  const group = groups.data?.find((g) => g.groupKey === selected);
  const ready = gates.data && schedules.data && orgs.data && people.data;

  return (
    <section className="panel access-rules" aria-label="권한 그룹">
      <div>
        <h2>권한 그룹</h2>
        {groups.error && <p className="error">권한 그룹을 불러오지 못했습니다.</p>}
        {groups.data?.length === 0 && <p className="empty-state">권한 그룹이 없습니다.</p>}
        <ul className="org-list">
          {groups.data?.map((g) => (
            <li key={g.groupKey}>
              <button
                type="button"
                className={g.groupKey === selected ? 'primary' : undefined}
                aria-pressed={g.groupKey === selected}
                onClick={() => setSelected(g.groupKey)}
              >
                {g.name}
                <span className="muted">
                  {`${g.scheduleName}, 게이트 ${g.gateKeys.length}, 구성원 ${g.orgKeys.length + g.employeeKeys.length}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setSelected('new')}>
          새 그룹
        </button>
      </div>
      <div>
        {selected !== null && ready && (selected === 'new' || group) ? (
          <GroupEditor
            key={String(selected)}
            group={group}
            gates={gates.data!}
            schedules={schedules.data!}
            orgs={orgs.data!}
            people={people.data!}
            onSaved={(groupKey) => {
              groups.reload();
              setSelected(groupKey);
            }}
          />
        ) : (
          <p className="note">
            왼쪽에서 그룹을 고르거나 새 그룹을 만드세요. 그룹에 넣은 소속과 직원은 그룹의 게이트를
            시간표 안에서 다닐 수 있습니다.
          </p>
        )}
      </div>
    </section>
  );
}

function GroupEditor({
  group,
  gates,
  schedules,
  orgs,
  people,
  onSaved,
}: {
  group?: Group;
  gates: GateItem[];
  schedules: Schedule[];
  orgs: Org[];
  people: Person[];
  onSaved: (groupKey: number | null) => void;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [scheduleKey, setScheduleKey] = useState(group?.scheduleKey ?? schedules[0]?.scheduleKey);
  const [gateKeys, setGateKeys] = useState(new Set(group?.gateKeys ?? []));
  const [orgKeys, setOrgKeys] = useState(new Set(group?.orgKeys ?? []));
  const [employeeKeys, setEmployeeKeys] = useState(group?.employeeKeys ?? []);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<Message>(null);
  const [pending, setPending] = useState(false);
  const person = (key: number) => people.find((p) => p.employeeKey === key);
  const q = query.trim();
  const found = q
    ? people
        .filter((p) => !employeeKeys.includes(p.employeeKey))
        .filter((p) => p.name.includes(q) || p.employeeNo.includes(q))
        .slice(0, MAX_FOUND)
    : [];
  const toggleOrg = (key: number, on: boolean) => {
    const next = new Set(orgKeys);
    if (on) next.add(key);
    else next.delete(key);
    setOrgKeys(next);
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (pending || !name.trim()) return;
    setPending(true);
    setMessage(null);
    const body = {
      name: name.trim(),
      scheduleKey,
      gateKeys: [...gateKeys],
      orgKeys: [...orgKeys],
      employeeKeys,
    };
    try {
      const saved = group
        ? await api<Group>('PATCH', `/api/admin/access-groups/${group.groupKey}`, body)
        : await api<Group>('POST', '/api/admin/access-groups', body);
      setMessage({ text: '저장했습니다.', error: false });
      onSaved(saved.groupKey);
    } catch (err) {
      setMessage({
        text:
          err instanceof ApiError && err.status === 409
            ? '같은 이름의 그룹이 있습니다.'
            : '저장하지 못했습니다. 이름은 40자까지입니다.',
        error: true,
      });
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (
      !group ||
      !confirm(`${group.name} 그룹을 지울까요? 구성원은 이 그룹의 게이트를 못 다니게 됩니다.`)
    )
      return;
    setPending(true);
    try {
      await api('DELETE', `/api/admin/access-groups/${group.groupKey}`);
      onSaved(null);
    } catch {
      setMessage({ text: '지우지 못했습니다.', error: true });
      setPending(false);
    }
  }

  return (
    <form aria-label={group ? `${group.name} 그룹` : '새 그룹'} onSubmit={save}>
      <h2>{group ? group.name : '새 그룹'}</h2>
      <fieldset className="row" disabled={pending}>
        <label>
          <span>이름</span>
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span>시간표</span>
          <select value={scheduleKey} onChange={(e) => setScheduleKey(Number(e.target.value))}>
            {schedules.map((s) => (
              <option key={s.scheduleKey} value={s.scheduleKey}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <h3>게이트</h3>
      <GateChecklist gates={gates} checked={gateKeys} onChange={setGateKeys} />

      <h3>구성원</h3>
      <p className="note">고른 소속의 직원은 모두 이 그룹에 들어갑니다.</p>
      <div className="member-orgs">
        {orgs.map((o) => (
          <label key={o.orgKey} className="check">
            <input
              type="checkbox"
              checked={orgKeys.has(o.orgKey)}
              onChange={(e) => toggleOrg(o.orgKey, e.target.checked)}
            />
            <span>
              {o.name}
              <span className="muted">{` ${ORG_KIND_LABEL[o.kind] ?? ''}`}</span>
            </span>
          </label>
        ))}
      </div>
      <ul className="member-people" aria-label="그룹 직원">
        {employeeKeys.map((key) => (
          <li key={key}>
            {person(key) ? `${person(key)!.name} ${person(key)!.employeeNo}` : `직원 ${key}`}
            <button
              type="button"
              className="danger-text"
              aria-label={`${person(key)?.name ?? key} 빼기`}
              onClick={() => setEmployeeKeys(employeeKeys.filter((k) => k !== key))}
            >
              빼기
            </button>
          </li>
        ))}
      </ul>
      <label className="member-search">
        <span>직원 더하기</span>
        <input
          value={query}
          placeholder="이름 또는 사번"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {found.length > 0 && (
        <ul className="member-found" aria-label="찾은 직원">
          {found.map((p) => (
            <li key={p.employeeKey}>
              <button
                type="button"
                onClick={() => {
                  setEmployeeKeys([...employeeKeys, p.employeeKey]);
                  setQuery('');
                }}
              >
                {`${p.name} ${p.employeeNo}`}
                <span className="muted">{p.department ? ` ${p.department}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="actions group-actions">
        <button className="primary" type="submit" disabled={pending || !name.trim()}>
          저장
        </button>
        {group && (
          <button
            type="button"
            className="danger-text"
            disabled={pending}
            onClick={() => void remove()}
          >
            그룹 삭제
          </button>
        )}
      </div>
      {message && (
        <p className={message.error ? 'error' : 'note'} role={message.error ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
    </form>
  );
}
