import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { useLoad } from '../useLoad';

type DayRange = { start: string; end: string } | null;
type Schedule = { scheduleKey: number; name: string; days: DayRange[]; groupCount: number };
type Message = { text: string; error: boolean } | null;

/** 서버 schedule.ts와 같은 순서: 0=일 … 6=토, 7=휴일 */
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토', '휴일'];
const WORKDAY = { start: '09:00', end: '18:00' };
// 끝은 24:00까지 써야 해서 시각 입력칸(type=time) 대신 HH:MM 글자로 받는다
const NEW_DAYS: DayRange[] = [null, WORKDAY, WORKDAY, WORKDAY, WORKDAY, WORKDAY, null, null];

/** 시간표 (D-61): 요일과 휴일마다 다닐 수 있는 시간 한 구간 */
export function SchedulesTab() {
  const schedules = useLoad(() => api<Schedule[]>('GET', '/api/admin/schedules'), []);
  const [selected, setSelected] = useState<number | 'new' | null>(null);
  const schedule = schedules.data?.find((s) => s.scheduleKey === selected);

  return (
    <section className="panel access-rules" aria-label="시간표">
      <div>
        <h2>시간표</h2>
        {schedules.error && <p className="error">시간표를 불러오지 못했습니다.</p>}
        <ul className="org-list">
          {schedules.data?.map((s) => (
            <li key={s.scheduleKey}>
              <button
                type="button"
                className={s.scheduleKey === selected ? 'primary' : undefined}
                aria-pressed={s.scheduleKey === selected}
                onClick={() => setSelected(s.scheduleKey)}
              >
                {s.name}
                <span className="muted">{`그룹 ${s.groupCount}개가 씀`}</span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setSelected('new')}>
          새 시간표
        </button>
      </div>
      <div>
        {selected === 'new' || schedule ? (
          <ScheduleEditor
            key={String(selected)}
            schedule={schedule}
            onSaved={(key) => {
              schedules.reload();
              setSelected(key);
            }}
          />
        ) : (
          <p className="note">
            왼쪽에서 시간표를 고르거나 새로 만드세요. 휴일 줄은 휴일 탭에 넣은 날짜에 씁니다.
          </p>
        )}
      </div>
    </section>
  );
}

function ScheduleEditor({
  schedule,
  onSaved,
}: {
  schedule?: Schedule;
  onSaved: (scheduleKey: number | null) => void;
}) {
  const [name, setName] = useState(schedule?.name ?? '');
  const [days, setDays] = useState<DayRange[]>(schedule?.days ?? NEW_DAYS);
  const [message, setMessage] = useState<Message>(null);
  const [pending, setPending] = useState(false);
  const setDay = (i: number, value: DayRange) => setDays(days.map((d, j) => (j === i ? value : d)));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (pending || !name.trim()) return;
    setPending(true);
    setMessage(null);
    const body = { name: name.trim(), days };
    try {
      const saved = schedule
        ? await api<Schedule>('PATCH', `/api/admin/schedules/${schedule.scheduleKey}`, body)
        : await api<Schedule>('POST', '/api/admin/schedules', body);
      setMessage({ text: '저장했습니다.', error: false });
      onSaved(saved.scheduleKey);
    } catch (err) {
      setMessage({
        text:
          err instanceof ApiError && err.status === 409
            ? '같은 이름의 시간표가 있습니다.'
            : '저장하지 못했습니다. 시작은 끝보다 앞이어야 합니다.',
        error: true,
      });
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!schedule || !confirm(`${schedule.name} 시간표를 지울까요?`)) return;
    setPending(true);
    try {
      await api('DELETE', `/api/admin/schedules/${schedule.scheduleKey}`);
      onSaved(null);
    } catch (err) {
      setMessage({
        text:
          !(err instanceof ApiError) || err.status !== 409
            ? '지우지 못했습니다.'
            : err.message.includes('at least one')
              ? '시간표는 하나 이상 있어야 합니다.'
              : '이 시간표를 쓰는 그룹이 있어 지울 수 없습니다.',
        error: true,
      });
      setPending(false);
    }
  }

  return (
    <form aria-label={schedule ? `${schedule.name} 시간표` : '새 시간표'} onSubmit={save}>
      <h2>{schedule ? schedule.name : '새 시간표'}</h2>
      <fieldset disabled={pending}>
        <label className="schedule-name">
          <span>이름</span>
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </label>
        <table className="schedule-days">
          <tbody>
            {DAY_NAMES.map((day, i) => (
              <tr key={day}>
                <th scope="row">{day}</th>
                <td>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={days[i] !== null}
                      onChange={(e) => setDay(i, e.target.checked ? WORKDAY : null)}
                    />
                    출입 허용
                  </label>
                </td>
                <td>
                  {days[i] ? (
                    <span className="schedule-range">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={5}
                        aria-label={`${day} 시작`}
                        value={days[i]!.start}
                        onChange={(e) => setDay(i, { ...days[i]!, start: e.target.value })}
                      />
                      ~
                      <input
                        type="text"
                        inputMode="numeric"
                        aria-label={`${day} 끝`}
                        value={days[i]!.end}
                        maxLength={5}
                        onChange={(e) => setDay(i, { ...days[i]!, end: e.target.value })}
                      />
                      <button
                        type="button"
                        onClick={() => setDay(i, { start: '00:00', end: '24:00' })}
                      >
                        종일
                      </button>
                    </span>
                  ) : (
                    <span className="muted">출입 불가</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>
      <div className="actions group-actions">
        <button className="primary" type="submit" disabled={pending || !name.trim()}>
          저장
        </button>
        {schedule && (
          <button
            type="button"
            className="danger-text"
            disabled={pending}
            onClick={() => void remove()}
          >
            시간표 삭제
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
