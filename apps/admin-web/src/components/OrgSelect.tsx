import { api } from '../api';
import { ORG_KIND_LABEL } from '../labels';
import { useLoad } from '../useLoad';

type Org = { orgKey: number; name: string; kind: string };

/** 소속 고르기 (D-59). 값은 소속 이름(직원의 department 글자). 목록에 없는 지금 값도 보여 준다 */
export function OrgSelect({
  value,
  onChange,
  label = '소속',
  emptyLabel = '없음',
}: {
  value: string;
  onChange: (name: string) => void;
  label?: string;
  emptyLabel?: string;
}) {
  const orgs = useLoad(() => api<Org[]>('GET', '/api/admin/orgs'), []);
  const list = orgs.data ?? [];
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{emptyLabel}</option>
        {value && !list.some((o) => o.name === value) && <option value={value}>{value}</option>}
        {list.map((o) => (
          <option key={o.orgKey} value={o.name}>
            {`${o.name} (${ORG_KIND_LABEL[o.kind] ?? o.kind})`}
          </option>
        ))}
      </select>
    </label>
  );
}
