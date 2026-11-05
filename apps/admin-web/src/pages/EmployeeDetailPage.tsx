import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { ApiError, api } from '../api';
import { ConsentDialog } from '../components/ConsentDialog';
import { Dialog } from '../components/Dialog';
import { EmployeeGroups } from '../components/EmployeeGroups';
import { EmployeePhones } from '../components/EmployeePhones';
import { OrgSelect } from '../components/OrgSelect';
import { PhotoPicker, type PickedPhoto } from '../components/PhotoPicker';
import { timeText } from '../format';
import { SOURCE_LABEL } from '../labels';
import { useLoad } from '../useLoad';
import { CONSENT_DECLINED } from './EmployeeNewPage';

type Detail = {
  employeeKey: number;
  employeeNo: string;
  name: string;
  department: string;
  status: 'ACTIVE' | 'RETIRED';
  consentAt: string | null;
  consentVersion: string | null;
  faces: { faceImageKey: number; source: string; registeredBy: string | null; createdAt: string }[];
};

export function EmployeeDetailPage() {
  const key = Number(useParams().employeeKey);
  return <EmployeeDetail key={key} employeeKey={key} />;
}

function EmployeeDetail({ employeeKey: key }: { employeeKey: number }) {
  const employee = useLoad(() => api<Detail>('GET', `/api/admin/employees/${key}`), [key]);
  const [edit, setEdit] = useState<{ employeeNo: string; name: string; department: string } | null>(
    null,
  );
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<PickedPhoto[]>([]);
  const [asking, setAsking] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const e = employee.data;
  if (employee.error)
    return <p className="error">직원을 불러오지 못했습니다. ({employee.error})</p>;
  if (!e) return <p className="note">불러오는 중입니다.</p>;
  const active = e.status === 'ACTIVE';

  async function run(
    action: () => Promise<unknown>,
    done: string,
    failed: (err: unknown) => string,
  ) {
    if (pending || employee.loading) return false;
    setPending(true);
    setMessage(null);
    try {
      await action();
      setMessage({ text: done, error: false });
      employee.reload();
      return true;
    } catch (err) {
      setMessage({ text: failed(err), error: true });
      return false;
    } finally {
      setPending(false);
    }
  }

  async function save(ev: FormEvent) {
    ev.preventDefault();
    if (!active || !edit || !edit.employeeNo.trim() || !edit.name.trim()) return;
    if (
      await run(
        () => api('PATCH', `/api/admin/employees/${key}`, edit),
        '저장했습니다.',
        (err) =>
          err instanceof ApiError && err.status === 409
            ? '이미 있는 사번입니다.'
            : '저장하지 못했습니다. 사번과 이름은 비울 수 없습니다.',
      )
    )
      setEdit(null);
  }

  /** 동의 기록이 없는 직원은 본인이 동의서에서 동의한 뒤에만 (consent: true) 올린다 */
  async function addPhotos(consent = false) {
    if (!active || !picked.length) return;
    if (!e?.consentAt && !consent) {
      setDeclined(false);
      setAsking(true);
      return;
    }
    const body = {
      photos: picked.map((p) => p.dataUrl),
      source: 'WEB_UPLOAD',
      ...(consent ? { consent: true } : {}),
    };
    if (
      await run(
        () => api('POST', `/api/admin/employees/${key}/photos`, body),
        '사진을 추가했습니다.',
        (err) =>
          err instanceof ApiError && err.status === 409
            ? '사진은 한 사람당 10장까지입니다.'
            : '사진을 추가하지 못했습니다.',
      )
    ) {
      setAdding(false);
      setPicked([]);
    }
  }

  return (
    <>
      <div className="page-heading">
        <h1>{e.name}</h1>
      </div>
      {message && !retiring && <p className={message.error ? 'error' : 'note'}>{message.text}</p>}
      <section className="panel employee-form" aria-label="직원 정보">
        {edit ? (
          <form className="row" onSubmit={save}>
            <label>
              <span>사번</span>
              <input
                value={edit.employeeNo}
                onChange={(ev) => setEdit({ ...edit, employeeNo: ev.target.value })}
              />
            </label>
            <label>
              <span>이름</span>
              <input
                value={edit.name}
                onChange={(ev) => setEdit({ ...edit, name: ev.target.value })}
              />
            </label>
            <OrgSelect
              value={edit.department}
              onChange={(department) => setEdit({ ...edit, department })}
            />
            <div className="row">
              <button
                className="primary"
                type="submit"
                disabled={
                  pending || employee.loading || !edit.employeeNo.trim() || !edit.name.trim()
                }
              >
                저장
              </button>
              <button type="button" disabled={pending} onClick={() => setEdit(null)}>
                취소
              </button>
            </div>
          </form>
        ) : (
          <table className="employee-info">
            <tbody>
              <tr>
                <th>사번</th>
                <td>{e.employeeNo}</td>
              </tr>
              <tr>
                <th>소속</th>
                <td>{e.department}</td>
              </tr>
              <tr>
                <th>상태</th>
                <td>{active ? '재직' : '퇴사'}</td>
              </tr>
              <tr>
                <th>생체정보 동의</th>
                <td className={e.consentAt ? 'ok' : 'problem'}>
                  {e.consentAt
                    ? `동의 ${timeText(e.consentAt)}${e.consentVersion ? ` (${e.consentVersion}판)` : ''}`
                    : '기록 없음'}
                </td>
              </tr>
            </tbody>
          </table>
        )}
        {active && !edit && (
          <div className="row" style={{ marginTop: 12 }}>
            <button
              disabled={pending || employee.loading}
              onClick={() =>
                setEdit({ employeeNo: e.employeeNo, name: e.name, department: e.department })
              }
            >
              정보 수정
            </button>
            <button
              className="danger"
              disabled={pending || employee.loading}
              onClick={() => {
                setMessage(null);
                setRetiring(true);
              }}
            >
              퇴사 처리
            </button>
          </div>
        )}
      </section>
      {active && <EmployeeGroups employeeKey={key} />}
      {active && <EmployeePhones employeeKey={key} />}
      <section className="panel" aria-label="얼굴 사진">
        <h2 style={{ marginTop: 0 }}>얼굴 사진 ({e.faces.length}장)</h2>
        <div className="photos">
          {e.faces.map((f) => (
            <figure key={f.faceImageKey}>
              <img
                src={`/api/admin/employees/${key}/photos/${f.faceImageKey}`}
                alt={`얼굴 사진 ${f.faceImageKey}`}
              />
              <figcaption>{`${SOURCE_LABEL[f.source] ?? f.source}, ${f.registeredBy ?? '알 수 없음'}`}</figcaption>
              <figcaption>{timeText(f.createdAt)}</figcaption>
              {active && (
                <button
                  aria-label={`사진 ${f.faceImageKey} 삭제`}
                  disabled={pending || employee.loading}
                  onClick={() =>
                    confirm('이 사진을 삭제할까요?') &&
                    run(
                      () => api('DELETE', `/api/admin/employees/${key}/photos/${f.faceImageKey}`),
                      '사진을 삭제했습니다.',
                      () => '삭제하지 못했습니다.',
                    )
                  }
                >
                  삭제
                </button>
              )}
            </figure>
          ))}
        </div>
        {active && !adding && (
          <div className="row" style={{ marginTop: 12 }}>
            <button
              disabled={pending || employee.loading || e.faces.length >= 10}
              onClick={() => {
                setDeclined(false);
                setAdding(true);
              }}
            >
              파일로 사진 추가
            </button>
          </div>
        )}
        {declined && <p className="error">{CONSENT_DECLINED}</p>}
        {active && adding && (
          <div style={{ marginTop: 12 }}>
            <PhotoPicker photos={picked} onChange={setPicked} max={10 - e.faces.length} />
            <div className="row" style={{ marginTop: 12 }}>
              <button
                className="primary"
                disabled={pending || employee.loading || picked.length === 0}
                onClick={() => void addPhotos()}
              >
                추가
              </button>
              <button
                disabled={pending}
                onClick={() => {
                  setAdding(false);
                  setPicked([]);
                }}
              >
                취소
              </button>
            </div>
          </div>
        )}
      </section>

      <ConsentDialog
        open={asking}
        person={e}
        onAgree={() => {
          setAsking(false);
          void addPhotos(true);
        }}
        onDecline={() => {
          setDeclined(true);
          setAsking(false);
        }}
      />
      <Dialog open={retiring} title={`${e.name} 퇴사 처리`} onClose={() => setRetiring(false)}>
        <p>즉시 출입이 막히고 얼굴 사진이 모두 삭제됩니다. 되돌릴 수 없습니다.</p>
        {message?.error && <p className="error">{message.text}</p>}
        <div className="actions">
          <button disabled={pending} onClick={() => setRetiring(false)}>
            취소
          </button>
          <button
            className="danger"
            aria-label="퇴사 처리 확인"
            disabled={pending || employee.loading}
            onClick={async () => {
              if (
                await run(
                  () => api('POST', `/api/admin/employees/${key}/retire`),
                  '퇴사 처리했습니다.',
                  () => '퇴사 처리하지 못했습니다.',
                )
              )
                setRetiring(false);
            }}
          >
            퇴사 처리
          </button>
        </div>
      </Dialog>
    </>
  );
}
