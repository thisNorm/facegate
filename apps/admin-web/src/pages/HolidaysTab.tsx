import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useLoad } from '../useLoad';

type Holiday = { date: string; name: string };

/** 휴일 (D-61): 이 날짜에는 시간표의 휴일 줄을 따른다 */
export function HolidaysTab() {
  const holidays = useLoad(() => api<Holiday[]>('GET', '/api/admin/holidays'), []);
  const [form, setForm] = useState({ date: '', name: '' });
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function run(job: () => Promise<unknown>, failed: string) {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await job();
      holidays.reload();
      return true;
    } catch {
      setError(failed);
      return false;
    } finally {
      setPending(false);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!form.date || !form.name.trim()) return;
    if (
      await run(
        () => api('POST', '/api/admin/holidays', { date: form.date, name: form.name.trim() }),
        '추가하지 못했습니다. 날짜와 이름을 확인하세요.',
      )
    )
      setForm({ date: '', name: '' });
  }

  return (
    <section className="panel" aria-label="휴일">
      <h2>휴일</h2>
      <p className="note">
        설, 추석, 회사 휴무일을 넣으면 그날은 요일 대신 시간표의 휴일 줄을 따릅니다.
      </p>
      <form aria-label="휴일 추가" onSubmit={add}>
        <fieldset className="row" disabled={pending}>
          <label>
            <span>날짜</span>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </label>
          <label>
            <span>이름</span>
            <input
              value={form.name}
              maxLength={40}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <button type="submit" disabled={!form.date || !form.name.trim()}>
            추가
          </button>
        </fieldset>
      </form>
      {error && <p className="error">{error}</p>}
      <table className="holiday-table">
        <thead>
          <tr>
            <th>날짜</th>
            <th>이름</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {holidays.data?.map((h) => (
            <tr key={h.date}>
              <td>{h.date}</td>
              <td>{h.name}</td>
              <td>
                <button
                  type="button"
                  className="danger-text"
                  aria-label={`${h.date} ${h.name} 지우기`}
                  disabled={pending}
                  onClick={() =>
                    void run(
                      () => api('DELETE', `/api/admin/holidays/${h.date}`),
                      '지우지 못했습니다.',
                    )
                  }
                >
                  지우기
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {holidays.data?.length === 0 && <p className="empty-state">넣은 휴일이 없습니다.</p>}
    </section>
  );
}
