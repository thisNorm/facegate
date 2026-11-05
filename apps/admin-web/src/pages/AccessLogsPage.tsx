import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Dialog } from '../components/Dialog';
import { timeText, todayKst } from '../format';
import { METHOD_LABEL, REASON_LABEL, RESULT_LABEL } from '../labels';
import { useLoad } from '../useLoad';

type Item = {
  eventKey: number;
  gateKey: number;
  method: string;
  result: string;
  receivedAt: string;
  employeeNo: string | null;
  employeeName: string | null;
  visitorName: string | null;
  remoteReason: string | null;
  hasFullImage: boolean;
  hasCropImage: boolean;
};
type Page = { items: Item[]; nextBeforeEventKey: number | null };
type Filter = {
  from: string;
  to: string;
  gateKey: string;
  result: string;
  method: string;
  q: string;
};

const toQuery = (f: Filter) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(f)) if (value.trim()) params.set(key, value.trim());
  return params.toString();
};

export function AccessLogsPage() {
  const today = todayKst();
  const [filter, setFilter] = useState<Filter>({
    from: today,
    to: today,
    gateKey: '',
    result: '',
    method: '',
    q: '',
  });
  // 찾기 버튼 없이 고르거나 입력하는 대로 바로 조회한다
  const applied = filter;
  const [items, setItems] = useState<Item[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const request = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const [photo, setPhoto] = useState<Item | null>(null);
  const [photoError, setPhotoError] = useState(false);
  const [failedThumbs, setFailedThumbs] = useState<Set<number>>(() => new Set());
  const gates = useLoad(
    () => api<{ gateKey: number; name: string }[]>('GET', '/api/admin/gates'),
    [],
  );
  const gateName = (key: number) => gates.data?.find((g) => g.gateKey === key)?.name ?? String(key);

  const load = useCallback(async (f: Filter, before: number | null) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    pending.current = true;
    setLoading(true);
    setError('');
    // 새 조건이어도 응답이 올 때까지 지금 목록을 둔다 (입력할 때마다 표가 깜빡이지 않게)
    try {
      const page = await api<Page>(
        'GET',
        `/api/admin/access-logs?${toQuery(f)}${before ? `&beforeEventKey=${before}` : ''}`,
        undefined,
        controller.signal,
      );
      if (request.current !== controller || controller.signal.aborted) return;
      if (!before) setFailedThumbs(new Set());
      setItems((list) => (before ? [...list, ...page.items] : page.items));
      setNext(page.nextBeforeEventKey);
    } catch {
      if (request.current === controller && !controller.signal.aborted) {
        setError('기록을 불러오지 못했습니다. 다시 시도해 주세요.');
        // 새 조건 조회가 실패하면 이전 조건의 목록을 새 결과처럼 남기지 않는다
        if (!before) {
          setItems([]);
          setNext(null);
        }
      }
    } finally {
      if (request.current === controller && !controller.signal.aborted) {
        pending.current = false;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    // 조회 조건이 바뀌면 이전 목록과 커서를 비우고 새 요청을 시작합니다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(applied, null);
    return () => request.current?.abort();
  }, [applied, load]);

  const set = (key: keyof Filter) => (e: { target: { value: string } }) =>
    setFilter({ ...filter, [key]: e.target.value });

  return (
    <>
      <div className="page-heading">
        <h1>출입 기록</h1>
        <a className="button" href={`/api/admin/access-logs.csv?${toQuery(applied)}`} download>
          CSV 내려받기
        </a>
      </div>
      <section className="panel" aria-label="출입 기록 조회">
        <form className="row access-log-filters" onSubmit={(e) => e.preventDefault()}>
          <label>
            <span>시작일</span>
            <input type="date" value={filter.from} onChange={set('from')} />
          </label>
          <label>
            <span>종료일</span>
            <input type="date" value={filter.to} onChange={set('to')} />
          </label>
          <label>
            <span>게이트</span>
            <select value={filter.gateKey} onChange={set('gateKey')}>
              <option value="">전체</option>
              {gates.data?.map((g) => (
                <option key={g.gateKey} value={g.gateKey}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>결과</span>
            <select value={filter.result} onChange={set('result')}>
              <option value="">전체</option>
              {Object.entries(RESULT_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>인증 수단</span>
            <select value={filter.method} onChange={set('method')}>
              <option value="">전체</option>
              {Object.entries(METHOD_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>이름</span>
            <input value={filter.q} placeholder="이름, 사번, 방문객" onChange={set('q')} />
          </label>
        </form>
        {gates.error && (
          <p className="error" role="alert">
            게이트 목록을 불러오지 못했습니다.{' '}
            <button type="button" onClick={gates.reload} disabled={gates.loading}>
              게이트 다시 불러오기
            </button>
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="access-log-body">
          <table>
            <thead>
              <tr>
                <th>시각</th>
                <th>게이트</th>
                <th>이름</th>
                <th>결과</th>
                <th>인증 수단</th>
                <th>사진</th>
              </tr>
            </thead>
            <tbody>
              {items.map((log) => (
                <tr key={log.eventKey} className={log.result === 'GRANTED' ? undefined : 'problem'}>
                  <td>{timeText(log.receivedAt)}</td>
                  <td>{gateName(log.gateKey)}</td>
                  <td>
                    {log.employeeName ?? (log.visitorName ? `${log.visitorName} (방문객)` : '')}
                    {log.remoteReason && (
                      <span className="note">{` ${REASON_LABEL[log.remoteReason]}`}</span>
                    )}
                  </td>
                  <td className={log.result === 'GRANTED' ? 'ok' : 'problem'}>
                    {RESULT_LABEL[log.result] ?? log.result}
                  </td>
                  <td>{METHOD_LABEL[log.method] ?? log.method}</td>
                  <td>
                    {log.hasCropImage || log.hasFullImage ? (
                      <button
                        type="button"
                        className="photo-thumb"
                        aria-label={`출입 사진 ${log.eventKey} 크게 보기`}
                        onClick={() => {
                          setPhotoError(false);
                          setPhoto(log);
                        }}
                      >
                        {failedThumbs.has(log.eventKey) ? (
                          '사진 보기'
                        ) : (
                          <img
                            className="thumb"
                            loading="lazy"
                            src={`/api/admin/access-logs/${log.eventKey}/images/${log.hasCropImage ? 'crop' : 'full'}`}
                            alt={`출입 사진 ${log.eventKey}`}
                            onError={() =>
                              setFailedThumbs((current) => new Set(current).add(log.eventKey))
                            }
                          />
                        )}
                      </button>
                    ) : (
                      <span className="note">없음</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && items.length === 0 && (
            <p className="empty-state" role="status">
              기록을 불러오는 중입니다.
            </p>
          )}
          {items.length === 0 && !loading && !error && (
            <p className="empty-state">조건에 맞는 기록이 없습니다.</p>
          )}
        </div>
        {(next !== null || error) && (
          <div className="actions access-log-pagination">
            <button
              disabled={loading}
              onClick={() => {
                if (!pending.current) void load(applied, next);
              }}
            >
              {error ? '다시 시도' : '더 보기'}
            </button>
          </div>
        )}
      </section>
      <Dialog
        open={photo !== null}
        title={photo ? `${timeText(photo.receivedAt)} ${gateName(photo.gateKey)}` : ''}
        onClose={() => setPhoto(null)}
      >
        {photo &&
          (photoError ? (
            <p className="error" role="alert">
              사진을 불러오지 못했습니다.
            </p>
          ) : (
            <img
              className="access-photo"
              src={`/api/admin/access-logs/${photo.eventKey}/images/${photo.hasFullImage ? 'full' : 'crop'}`}
              alt={photo.hasFullImage ? '전체 사진' : '얼굴 사진'}
              onError={() => setPhotoError(true)}
            />
          ))}
        <div className="actions">
          <button onClick={() => setPhoto(null)}>닫기</button>
        </div>
      </Dialog>
    </>
  );
}
