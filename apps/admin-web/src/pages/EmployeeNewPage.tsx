import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ApiError, api } from '../api';
import { type PickedPhoto } from '../components/PhotoPicker';
import { EnrollmentPhotos } from '../components/EnrollmentPhotos';
import { ConsentDialog } from '../components/ConsentDialog';
import { OrgSelect } from '../components/OrgSelect';

/** 동의 거절 때 안내 (동의서 5항) */
export const CONSENT_DECLINED =
  '동의하지 않으면 얼굴 등록을 할 수 없습니다. NFC 카드 등 다른 출입 수단을 안내해 주세요.';

export function EmployeeNewPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ employeeNo: '', name: '', department: '' });
  const [asking, setAsking] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const ready = form.employeeNo.trim() && form.name.trim() && photos.length > 0;
  const edit = (change: Partial<typeof form>) => setForm({ ...form, ...change });

  // 등록을 누르면 입력한 사번, 이름, 소속이 채워진 동의서를 본인에게 보여 준다
  function confirm(e: FormEvent) {
    e.preventDefault();
    if (!ready || pending) return;
    setDeclined(false);
    setAsking(true);
  }

  async function submit() {
    if (!ready || pending) return;
    setPending(true);
    setError('');
    try {
      const { employeeKey } = await api<{ employeeKey: number }>('POST', '/api/admin/employees', {
        ...form,
        photos: photos.map((p) => p.dataUrl),
        source: 'WEB_UPLOAD',
        consent: true,
      });
      navigate(`/employees/${employeeKey}`);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? '이미 있는 사번입니다.'
          : '등록하지 못했습니다. 입력과 사진을 확인해 주세요.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <h1>직원 등록</h1>
      </div>
      <form className="panel employee-form" onSubmit={confirm}>
        <div className="row">
          <label>
            <span>사번</span>
            <input value={form.employeeNo} onChange={(e) => edit({ employeeNo: e.target.value })} />
          </label>
          <label>
            <span>이름</span>
            <input value={form.name} onChange={(e) => edit({ name: e.target.value })} />
          </label>
          <OrgSelect value={form.department} onChange={(department) => edit({ department })} />
        </div>
        <h2>얼굴 사진</h2>
        <p className="note">
          정면 1, 정면 2, 좌측, 우측, 상향, 하향 칸에 한 장씩 넣습니다. 1장 이상이면 등록할 수 있고,
          여러 방향을 채울수록 인식이 잘 됩니다.
        </p>
        <p className="note">6장 중 {photos.length}장 선택</p>
        <EnrollmentPhotos photos={photos} onChange={setPhotos} disabled={pending} />
        {declined && <p className="error">{CONSENT_DECLINED}</p>}
        {error && <p className="error">{error}</p>}
        <p className="note">등록을 누르면 직원 본인이 동의서를 확인하고 동의합니다.</p>
        <div className="actions" style={{ justifyContent: 'flex-start' }}>
          <button className="primary" type="submit" disabled={!ready || pending}>
            등록
          </button>
          <button type="button" disabled={pending} onClick={() => navigate('/employees')}>
            취소
          </button>
        </div>
      </form>
      <ConsentDialog
        open={asking}
        person={form}
        onAgree={() => {
          setAsking(false);
          void submit();
        }}
        onDecline={() => {
          setDeclined(true);
          setAsking(false);
        }}
      />
    </>
  );
}
