import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { OrgSelect } from '../components/OrgSelect';
import { useLoad } from '../useLoad';

type Row = {
  employeeKey: number;
  employeeNo: string;
  name: string;
  department: string;
  status: string;
  faceCount: number;
};

export function EmployeesPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ q: '', status: 'ACTIVE', department: '', noFace: false });
  // 찾기 버튼 없이 입력하는 대로 바로 거른다. 한글은 서버가 자모로 비교해 "기"로도 "김"을 찾는다
  const params = new URLSearchParams();
  if (form.q.trim()) params.set('q', form.q.trim());
  if (form.status) params.set('status', form.status);
  if (form.department) params.set('department', form.department);
  if (form.noFace) params.set('noFace', '1');
  const query = params.toString();
  const list = useLoad(() => api<Row[]>('GET', `/api/admin/employees?${query}`), [query]);

  return (
    <>
      <div className="page-heading">
        <h1>직원</h1>
        <Link className="button primary" to="/employees/new">
          직원 등록
        </Link>
      </div>
      <section className="panel" aria-label="직원 목록">
        <form className="row" onSubmit={(e) => e.preventDefault()} style={{ marginBottom: 16 }}>
          <label>
            <span>검색</span>
            <input
              value={form.q}
              placeholder="이름, 사번, 부서"
              onChange={(e) => setForm({ ...form, q: e.target.value })}
            />
          </label>
          <label>
            <span>상태</span>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="ACTIVE">재직</option>
              <option value="RETIRED">퇴사</option>
              <option value="">전체</option>
            </select>
          </label>
          <OrgSelect
            value={form.department}
            emptyLabel="전체"
            onChange={(department) => setForm({ ...form, department })}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={form.noFace}
              onChange={(e) => setForm({ ...form, noFace: e.target.checked })}
            />
            얼굴 미등록만
          </label>
        </form>
        {list.loading && !list.data && <p className="note">불러오는 중입니다.</p>}
        {!list.loading && list.error && (
          <p className="error">
            목록을 불러오지 못했습니다.{' '}
            <button type="button" onClick={list.reload}>
              다시 시도
            </button>
          </p>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>사번</th>
                <th>이름</th>
                <th>소속</th>
                <th>상태</th>
                <th>얼굴 사진</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.map((e) => (
                <tr
                  key={e.employeeKey}
                  className="clickable"
                  onClick={() => navigate(`/employees/${e.employeeKey}`)}
                >
                  <td>{e.employeeNo}</td>
                  <td>
                    <Link to={`/employees/${e.employeeKey}`}>{e.name}</Link>
                  </td>
                  <td>{e.department}</td>
                  <td className={e.status === 'ACTIVE' ? undefined : 'muted'}>
                    {e.status === 'ACTIVE' ? '재직' : '퇴사'}
                  </td>
                  <td className={e.faceCount === 0 ? 'muted' : undefined}>
                    {e.faceCount === 0
                      ? e.status === 'ACTIVE'
                        ? '미등록'
                        : '없음'
                      : `${e.faceCount}장`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.loading && !list.error && list.data?.length === 0 && (
          <p className="empty-state">검색 결과가 없습니다.</p>
        )}
      </section>
    </>
  );
}
