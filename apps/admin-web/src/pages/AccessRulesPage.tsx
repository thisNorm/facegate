import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { ORG_KIND_LABEL } from '../labels';
import { useLoad } from '../useLoad';
import { AccessGroupsTab } from './AccessGroupsTab';
import { HolidaysTab } from './HolidaysTab';
import { SchedulesTab } from './SchedulesTab';

type Org = { orgKey: number; name: string; kind: 'DEPARTMENT' | 'TENANT'; employeeCount: number };
type Message = { text: string; error: boolean } | null;

const Note = ({ message }: { message: Message }) =>
  message ? (
    <p className={message.error ? 'error' : 'note'} role={message.error ? 'alert' : 'status'}>
      {message.text}
    </p>
  ) : null;

const KindSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <label>
    <span>종류</span>
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {Object.entries(ORG_KIND_LABEL).map(([kind, label]) => (
        <option key={kind} value={kind}>
          {label}
        </option>
      ))}
    </select>
  </label>
);

function AddOrg({ onAdded }: { onAdded: (org: Org) => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('DEPARTMENT');
  const [message, setMessage] = useState<Message>(null);
  const [pending, setPending] = useState(false);
  async function add(e: FormEvent) {
    e.preventDefault();
    if (pending || !name.trim()) return;
    setPending(true);
    setMessage(null);
    try {
      const org = await api<Org>('POST', '/api/admin/orgs', { name: name.trim(), kind });
      setName('');
      onAdded(org);
    } catch (err) {
      setMessage({
        text:
          err instanceof ApiError && err.status === 409
            ? '이미 있는 소속 이름입니다.'
            : '추가하지 못했습니다. 이름은 40자까지입니다.',
        error: true,
      });
    } finally {
      setPending(false);
    }
  }
  return (
    <form aria-label="소속 추가" onSubmit={add} className="org-add">
      <h3>소속 추가</h3>
      <fieldset className="row" disabled={pending}>
        <label>
          <span>이름</span>
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </label>
        <KindSelect value={kind} onChange={setKind} />
        <button type="submit">추가</button>
      </fieldset>
      <Note message={message} />
    </form>
  );
}

/** 고른 소속의 이름과 종류, 삭제 */
function OrgInfo({ org, onChanged }: { org: Org; onChanged: (removed?: boolean) => void }) {
  const [edit, setEdit] = useState({ name: org.name, kind: org.kind as string });
  const [message, setMessage] = useState<Message>(null);
  const [pending, setPending] = useState(false);

  async function run(job: () => Promise<unknown>, done: string, failed: string) {
    if (pending) return false;
    setPending(true);
    setMessage(null);
    try {
      await job();
      setMessage({ text: done, error: false });
      return true;
    } catch {
      setMessage({ text: failed, error: true });
      return false;
    } finally {
      setPending(false);
    }
  }

  async function rename(e: FormEvent) {
    e.preventDefault();
    if (
      await run(
        () =>
          api('PATCH', `/api/admin/orgs/${org.orgKey}`, {
            name: edit.name.trim(),
            kind: edit.kind,
          }),
        '소속 정보를 바꿨습니다.',
        '바꾸지 못했습니다. 같은 이름의 소속이 있는지 확인하세요.',
      )
    )
      onChanged();
  }

  async function remove() {
    if (!confirm(`${org.name} 소속을 지울까요?`)) return;
    if (
      await run(
        () => api('DELETE', `/api/admin/orgs/${org.orgKey}`),
        '지웠습니다.',
        '지우지 못했습니다. 이 소속의 직원을 먼저 다른 소속으로 옮기세요.',
      )
    )
      onChanged(true);
  }

  return (
    <form aria-label={`${org.name} 정보`} onSubmit={rename}>
      <h2>{org.name}</h2>
      <p className="note">
        {`직원 ${org.employeeCount}명. 이 소속이 다닐 게이트는 권한 그룹 탭에서 그룹 구성원으로 넣어 정합니다.`}
      </p>
      <fieldset className="row" disabled={pending}>
        <label>
          <span>이름</span>
          <input
            value={edit.name}
            maxLength={40}
            onChange={(e) => setEdit({ ...edit, name: e.target.value })}
          />
        </label>
        <KindSelect value={edit.kind} onChange={(kind) => setEdit({ ...edit, kind })} />
        <button type="submit" aria-label="소속 정보 저장">
          저장
        </button>
        <button
          type="button"
          className="danger-text"
          disabled={org.employeeCount > 0}
          title={org.employeeCount > 0 ? '직원이 있는 소속은 지울 수 없습니다' : undefined}
          onClick={() => void remove()}
        >
          소속 삭제
        </button>
      </fieldset>
      <Note message={message} />
    </form>
  );
}

/** 소속(부서, 입주사) 목록과 정보 (D-59) */
function OrgsTab() {
  const orgs = useLoad(() => api<Org[]>('GET', '/api/admin/orgs'), []);
  const [selected, setSelected] = useState<number | null>(null);
  const org = orgs.data?.find((o) => o.orgKey === selected) ?? null;

  return (
    <section className="panel access-rules" aria-label="소속">
      <div>
        <h2>소속</h2>
        {orgs.error && <p className="error">소속을 불러오지 못했습니다.</p>}
        {orgs.data?.length === 0 && (
          <p className="empty-state">소속이 없습니다. 아래에서 추가하세요.</p>
        )}
        <ul className="org-list">
          {orgs.data?.map((o) => (
            <li key={o.orgKey}>
              <button
                type="button"
                className={o.orgKey === selected ? 'primary' : undefined}
                aria-pressed={o.orgKey === selected}
                onClick={() => setSelected(o.orgKey)}
              >
                {o.name}
                <span className="muted">{`${ORG_KIND_LABEL[o.kind]}, 직원 ${o.employeeCount}명`}</span>
              </button>
            </li>
          ))}
        </ul>
        <AddOrg
          onAdded={(added) => {
            orgs.reload();
            setSelected(added.orgKey);
          }}
        />
      </div>
      <div>
        {org ? (
          <OrgInfo
            key={org.orgKey}
            org={org}
            onChanged={(removed) => {
              if (removed) setSelected(null);
              orgs.reload();
            }}
          />
        ) : (
          <p className="note">왼쪽에서 소속을 고르면 이름과 종류를 바꾸거나 지울 수 있습니다.</p>
        )}
      </div>
    </section>
  );
}

const TABS = [
  ['groups', '권한 그룹'],
  ['schedules', '시간표'],
  ['holidays', '휴일'],
  ['orgs', '소속'],
] as const;

/** 출입 권한 (D-61): 권한 그룹, 시간표, 휴일, 소속 */
export function AccessRulesPage() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('groups');
  return (
    <>
      <div className="page-heading">
        <h1>출입 권한</h1>
      </div>
      <div className="floor-tabs" role="tablist" aria-label="출입 권한 메뉴">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'primary' : undefined}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'groups' && <AccessGroupsTab />}
      {tab === 'schedules' && <SchedulesTab />}
      {tab === 'holidays' && <HolidaysTab />}
      {tab === 'orgs' && <OrgsTab />}
    </>
  );
}
