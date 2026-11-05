import QRCode from 'qrcode';
import { useState } from 'react';
import { api } from '../api';
import { timeText } from '../format';
import { useLoad } from '../useLoad';

type Phone = { phoneKey: number; label: string; createdAt: string; lastUsedAt: string | null };
type Invite = { url: string; expiresAt: string; qr: string };

/** 직원 핸드폰으로 열기 (D-62). 본인 핸드폰으로 찍을 등록 QR과 등록된 핸드폰 해제 */
export function EmployeePhones({ employeeKey }: { employeeKey: number }) {
  const phones = useLoad(
    () =>
      api<{ enabled: boolean; phones: Phone[] }>(
        'GET',
        `/api/admin/employees/${employeeKey}/phones`,
      ),
    [employeeKey],
  );
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState('');
  if (!phones.data) return null;

  async function makeInvite() {
    setError('');
    try {
      const made = await api<Omit<Invite, 'qr'>>(
        'POST',
        `/api/admin/employees/${employeeKey}/phone-invite`,
      );
      const qr = await QRCode.toDataURL(made.url, {
        margin: 4,
        width: 280,
        errorCorrectionLevel: 'L',
      });
      setInvite({ ...made, qr });
    } catch {
      setError('등록 링크를 만들지 못했습니다.');
    }
  }

  async function revoke(phone: Phone) {
    if (
      !confirm(`${phone.label} 핸드폰 등록을 해제할까요? 그 핸드폰으로는 더 이상 열 수 없습니다.`)
    )
      return;
    try {
      await api('DELETE', `/api/admin/phones/${phone.phoneKey}`);
      phones.reload();
    } catch {
      setError('해제하지 못했습니다.');
    }
  }

  return (
    <section className="panel" aria-label="핸드폰">
      <h2 style={{ marginTop: 0 }}>핸드폰</h2>
      {!phones.data.enabled ? (
        <p className="note">
          핸드폰으로 열기가 꺼져 있습니다. 서버 설정에 PHONE_BASE_URL을 넣으면 켜집니다.
        </p>
      ) : (
        <>
          <p className="note">
            등록한 핸드폰을 게이트 단말에 대거나 단말의 QR을 비추면 문이 열립니다. 핸드폰에 앱은
            설치하지 않습니다.
          </p>
          {phones.data.phones.length === 0 ? (
            <p className="empty-state">등록된 핸드폰이 없습니다.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>종류</th>
                  <th>등록</th>
                  <th>마지막 사용</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {phones.data.phones.map((p) => (
                  <tr key={p.phoneKey}>
                    <td>{p.label}</td>
                    <td>{timeText(p.createdAt)}</td>
                    <td>{timeText(p.lastUsedAt) || '없음'}</td>
                    <td>
                      <button type="button" onClick={() => void revoke(p)}>
                        해제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {invite ? (
            <div className="phone-invite">
              <img src={invite.qr} alt="핸드폰 등록 QR" width={280} height={280} />
              <p className="note">
                직원 본인 핸드폰 카메라로 비추고 "이 핸드폰으로 등록"을 누르게 하세요.{' '}
                {timeText(invite.expiresAt)}까지 한 번만 쓸 수 있습니다. 메신저로 보낼 때는 이
                주소를 보냅니다.
              </p>
              <input
                readOnly
                value={invite.url}
                aria-label="등록 주소"
                onFocus={(e) => e.target.select()}
              />
              <button type="button" onClick={() => setInvite(null)}>
                닫기
              </button>
            </div>
          ) : (
            <button type="button" className="primary" onClick={() => void makeInvite()}>
              등록 링크 만들기
            </button>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
