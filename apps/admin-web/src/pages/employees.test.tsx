import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/mockApi';

vi.mock('../components/photos', () => ({
  fileToJpeg: vi.fn(async () => 'data:image/jpeg;base64,AAA'),
  toJpegDataUrl: vi.fn(() => 'data:image/jpeg;base64,AAA'),
}));
import { EmployeeDetailPage } from './EmployeeDetailPage';
import { EmployeeNewPage } from './EmployeeNewPage';
import { EmployeesPage } from './EmployeesPage';

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/employees" element={<EmployeesPage />} />
        <Route path="/employees/new" element={<EmployeeNewPage />} />
        <Route path="/employees/:employeeKey" element={<EmployeeDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );

const detail = {
  employeeKey: 7,
  employeeNo: 'E7',
  name: '홍길동',
  department: '개발팀',
  status: 'ACTIVE',
  createdAt: '2026-11-03 09:00:00',
  consentAt: '2026-11-03 09:00:00',
  faces: [
    {
      faceImageKey: 3,
      source: 'TERMINAL',
      registeredBy: '김인사',
      createdAt: '2026-11-03 09:00:00',
    },
  ],
};

async function choosePhoto() {
  await userEvent.upload(
    screen.getByLabelText('사진 파일 고르기'),
    new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
  );
  await screen.findByRole('img', { name: '고른 사진 1' });
}

const enrollmentPoses = ['정면 1', '정면 2', '좌측', '우측', '상향', '하향'];
async function chooseEnrollmentPhotos(count = 6) {
  for (const pose of enrollmentPoses.slice(0, count)) {
    await userEvent.upload(
      screen.getByLabelText(`${pose} 사진`),
      new File(['a'], `${pose}.jpg`, { type: 'image/jpeg' }),
    );
    await screen.findByRole('img', { name: `${pose} 사진 미리보기` });
  }
}

const CONSENT_DOC = {
  version: '2026-11-04',
  title: '생체인식정보(얼굴인식정보) 수집·이용 동의서',
  intro: ['출입 확인에 씁니다.'],
  sections: [{ title: '1. 목적', lines: ['- 출입 본인 확인', '다른 목적으로 쓰지 않습니다.'] }],
  agreement: '위 내용에 동의합니다.',
};

/** 등록이나 사진 추가를 누르면 뜨는 동의서에서 본인이 끝까지 본 뒤 동의합니다를 누른다 */
async function agreeConsent() {
  const dialog = within(await screen.findByRole('dialog', { name: '생체정보 동의' }));
  await userEvent.click(await dialog.findByRole('button', { name: '끝까지 보기' }));
  await userEvent.click(dialog.getByRole('button', { name: '동의합니다' }));
}

describe('employees', () => {
  it('list searches with the filters', async () => {
    const calls = mockApi({
      'GET /api/admin/consent': CONSENT_DOC,
      'GET /api/admin/employees': [
        {
          employeeKey: 7,
          employeeNo: 'E7',
          name: '홍길동',
          department: '개발팀',
          status: 'ACTIVE',
          faceCount: 0,
        },
      ],
    });
    at('/employees');
    const row = await screen.findByRole('row', { name: /홍길동/ });
    expect(within(row).getByText('미등록', { selector: 'td' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('검색'), '홍');
    await userEvent.selectOptions(screen.getByLabelText('상태'), 'RETIRED');
    await userEvent.click(screen.getByLabelText('얼굴 미등록만'));
    expect(calls.at(-1)?.path).toBe('/api/admin/employees?q=%ED%99%8D&status=RETIRED&noFace=1');
  });

  it('register shows the consent filled with the typed employee and sends only after agreeing', async () => {
    const calls = mockApi({
      'GET /api/admin/consent': CONSENT_DOC,
      'POST /api/admin/employees': { employeeKey: 7 },
      'GET /api/admin/employees/7': detail,
    });
    at('/employees/new');
    await userEvent.type(await screen.findByLabelText('사번'), 'E7');
    await userEvent.type(screen.getByLabelText('이름'), '홍길동');
    await chooseEnrollmentPhotos();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    // 등록을 누르면 입력한 사람으로 채워진 동의서가 뜨고, 동의해야 보낸다
    await userEvent.click(screen.getByRole('button', { name: '등록' }));
    const dialog = within(await screen.findByRole('dialog', { name: '생체정보 동의' }));
    expect(await dialog.findByText('홍길동 님 (사번 E7)')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await agreeConsent();
    expect(await screen.findByRole('heading', { name: '홍길동' })).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      employeeNo: 'E7',
      name: '홍길동',
      department: '',
      photos: Array(6).fill('data:image/jpeg;base64,AAA'),
      source: 'WEB_UPLOAD',
      consent: true,
    });
  });

  it('new employee picks an org from the list', async () => {
    const calls = mockApi({
      'GET /api/admin/consent': CONSENT_DOC,
      'GET /api/admin/orgs': [{ orgKey: 1, name: '개발팀', kind: 'DEPARTMENT', employeeCount: 0 }],
      'POST /api/admin/employees': { employeeKey: 7 },
      'GET /api/admin/employees/7': detail,
    });
    at('/employees/new');
    await userEvent.type(await screen.findByLabelText('사번'), 'E7');
    await userEvent.type(screen.getByLabelText('이름'), '홍길동');
    await screen.findByRole('option', { name: '개발팀 (부서)' });
    await userEvent.selectOptions(screen.getByLabelText('소속'), '개발팀');
    await chooseEnrollmentPhotos(1);
    await userEvent.click(screen.getByRole('button', { name: '등록' }));
    await agreeConsent();
    await screen.findByRole('heading', { name: '홍길동' });
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ department: '개발팀' });
  });

  it('detail shows groups from the org locked and saves the groups given directly', async () => {
    let saved: unknown;
    const gate = (gateKey: number, name: string, floor: number) => ({
      gateKey,
      name,
      floor,
      openToAll: false,
      adapter: { type: 'MOCK' },
      terminals: [],
    });
    mockApi({
      'GET /api/admin/consent': CONSENT_DOC,
      'GET /api/admin/employees/7': detail,
      'GET /api/admin/gates': [gate(1, '동측', 3), gate(2, '서측', 7)],
      'GET /api/admin/access-groups': [
        { groupKey: 1, name: '개발팀', scheduleName: '근무시간' },
        { groupKey: 2, name: '서버실', scheduleName: '24시간' },
      ],
      'GET /api/admin/employees/7/access-groups': {
        groupKeys: [],
        orgGroupKeys: [1],
        gateKeys: [1],
      },
      'PUT /api/admin/employees/7/access-groups': (body) => {
        saved = body;
        return { json: { groupKeys: [2], orgGroupKeys: [1], gateKeys: [1, 2] } };
      },
    });
    at('/employees/7');
    const groups = within(await screen.findByRole('form', { name: '권한 그룹' }));
    expect(groups.getByLabelText(/개발팀/)).toBeDisabled();
    expect(groups.getByLabelText(/개발팀/)).toBeChecked();
    expect(groups.getByText('다닐 수 있는 게이트: 동측')).toBeInTheDocument();
    await userEvent.click(groups.getByLabelText(/서버실/));
    await userEvent.click(groups.getByRole('button', { name: '권한 그룹 저장' }));
    expect(saved).toEqual({ groupKeys: [2] });
    expect(await groups.findByText('다닐 수 있는 게이트: 동측, 서측')).toBeInTheDocument();
  });

  it('duplicate employee number shows a clear message', async () => {
    mockApi({
      'GET /api/admin/consent': CONSENT_DOC,
      'POST /api/admin/employees': () => ({
        status: 409,
        json: { error: 'employee number already exists' },
      }),
    });
    at('/employees/new');
    await userEvent.type(await screen.findByLabelText('사번'), 'E7');
    await userEvent.type(screen.getByLabelText('이름'), '홍길동');
    await chooseEnrollmentPhotos();
    await userEvent.click(screen.getByRole('button', { name: '등록' }));
    await agreeConsent();
    expect(await screen.findByText('이미 있는 사번입니다.')).toBeInTheDocument();
  });

  it('can register with any number of views from one to six', async () => {
    const calls = mockApi({
      'GET /api/admin/consent': CONSENT_DOC,
    });
    at('/employees/new');
    await userEvent.type(screen.getByLabelText('사번'), 'E7');
    await userEvent.type(screen.getByLabelText('이름'), '홍길동');
    expect(screen.getByRole('button', { name: '등록' })).toBeDisabled();
    await chooseEnrollmentPhotos(1);
    expect(screen.getByRole('button', { name: '등록' })).toBeEnabled();
    await chooseEnrollmentPhotos(3);
    expect(screen.getByText('6장 중 3장 선택')).toBeInTheDocument();
    for (const pose of ['정면 1', '정면 2', '좌측'])
      await userEvent.click(
        within(screen.getByRole('region', { name: pose })).getByRole('button', { name: '빼기' }),
      );
    expect(screen.getByRole('button', { name: '등록' })).toBeDisabled();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('detail shows photos with source and registrar, and can delete one', async () => {
    const calls = mockApi({
      'GET /api/admin/consent': CONSENT_DOC,
      'GET /api/admin/employees/7': detail,
      'DELETE /api/admin/employees/7/photos/3': {},
    });
    vi.stubGlobal('confirm', () => true);
    at('/employees/7');
    expect(await screen.findByText('게이트 단말, 김인사')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '얼굴 사진 3' })).toHaveAttribute(
      'src',
      '/api/admin/employees/7/photos/3',
    );
    expect(screen.getByText('동의 11/03 09:00:00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '사진 3 삭제' }));
    expect(
      calls.some((c) => c.method === 'DELETE' && c.path === '/api/admin/employees/7/photos/3'),
    ).toBe(true);
  });

  it('retire asks first, explains what happens, and calls the API', async () => {
    const calls = mockApi({
      'GET /api/admin/consent': CONSENT_DOC,
      'GET /api/admin/employees/7': detail,
      'POST /api/admin/employees/7/retire': {},
    });
    at('/employees/7');
    await userEvent.click(await screen.findByRole('button', { name: '퇴사 처리' }));
    expect(
      screen.getByText('즉시 출입이 막히고 얼굴 사진이 모두 삭제됩니다. 되돌릴 수 없습니다.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '퇴사 처리 확인' }));
    expect(calls.some((c) => c.path === '/api/admin/employees/7/retire')).toBe(true);
  });

  it('edits employee information and keeps the input when the number is duplicated', async () => {
    let saved = false;
    const calls = mockApi({
      'GET /api/admin/consent': CONSENT_DOC,
      'GET /api/admin/employees/7': () => ({
        json: saved ? { ...detail, department: '인사팀' } : detail,
      }),
      'GET /api/admin/orgs': [
        { orgKey: 1, name: '개발팀', kind: 'DEPARTMENT', employeeCount: 1 },
        { orgKey: 2, name: '인사팀', kind: 'DEPARTMENT', employeeCount: 0 },
      ],
      'PATCH /api/admin/employees/7': () => {
        if (!saved) {
          saved = true;
          return { status: 409, json: { error: 'duplicate' } };
        }
        return { json: {} };
      },
    });
    at('/employees/7');
    await userEvent.click(await screen.findByRole('button', { name: '정보 수정' }));
    await screen.findByRole('option', { name: '인사팀 (부서)' });
    await userEvent.selectOptions(screen.getByLabelText('소속'), '인사팀');
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('이미 있는 사번입니다.')).toBeInTheDocument();
    expect(screen.getByLabelText('소속')).toHaveValue('인사팀');
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('저장했습니다.')).toBeInTheDocument();
    expect(await screen.findByRole('cell', { name: '인사팀' })).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'PATCH').at(-1)?.body).toEqual({
      employeeNo: 'E7',
      name: '홍길동',
      department: '인사팀',
    });
  });

  it('adding photos without a consent record asks for agreement before uploading', async () => {
    const calls = mockApi({
      'GET /api/admin/consent': CONSENT_DOC,
      'GET /api/admin/employees/7': { ...detail, consentAt: null, faces: [] },
      'POST /api/admin/employees/7/photos': {},
    });
    at('/employees/7');
    await userEvent.click(await screen.findByRole('button', { name: '파일로 사진 추가' }));
    await choosePhoto();
    await userEvent.click(screen.getByRole('button', { name: '추가' }));
    const dialog = within(await screen.findByRole('dialog', { name: '생체정보 동의' }));
    await userEvent.click(await dialog.findByRole('button', { name: '동의하지 않음' }));
    expect(screen.getByText(/동의하지 않으면 얼굴 등록을 할 수 없습니다/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: '추가' }));
    await agreeConsent();
    expect(await screen.findByText('사진을 추가했습니다.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      photos: ['data:image/jpeg;base64,AAA'],
      source: 'WEB_UPLOAD',
      consent: true,
    });
  });

  it('sends a photo upload once while pending and preserves chosen files after failure', async () => {
    let finish!: (reply: { status: number; json: unknown }) => void;
    const calls = mockApi({
      'GET /api/admin/consent': CONSENT_DOC,
      'GET /api/admin/employees/7': detail,
      'POST /api/admin/employees/7/photos': () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    at('/employees/7');
    await userEvent.click(await screen.findByRole('button', { name: '파일로 사진 추가' }));
    await choosePhoto();
    await userEvent.dblClick(screen.getByRole('button', { name: '추가' }));
    const uploads = () => calls.filter((c) => c.method === 'POST');
    expect(uploads()).toHaveLength(1);
    expect(uploads()[0].body).toEqual({
      photos: ['data:image/jpeg;base64,AAA'],
      source: 'WEB_UPLOAD',
    });
    await act(async () => {
      finish({ status: 409, json: { error: 'too many photos' } });
    });
    expect(await screen.findByText('사진은 한 사람당 10장까지입니다.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '고른 사진 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '추가' })).toBeEnabled();
  });

  it('blocks a duplicate new employee request and permits retry after a network error', async () => {
    let fail!: (reason: Error) => void;
    const calls = mockApi({
      'GET /api/admin/consent': CONSENT_DOC,
      'POST /api/admin/employees': () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    });
    at('/employees/new');
    await userEvent.type(screen.getByLabelText('사번'), 'E7');
    await userEvent.type(screen.getByLabelText('이름'), '홍길동');
    await chooseEnrollmentPhotos();
    await userEvent.click(screen.getByRole('button', { name: '등록' }));
    await agreeConsent();
    await userEvent.click(screen.getByRole('button', { name: '등록' }));
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    await act(async () => {
      fail(new TypeError('network unavailable'));
    });
    expect(
      await screen.findByText('등록하지 못했습니다. 입력과 사진을 확인해 주세요.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '등록' })).toBeEnabled();
    expect(screen.getByLabelText('이름')).toHaveValue('홍길동');
    expect(screen.getByRole('img', { name: '정면 1 사진 미리보기' })).toBeInTheDocument();
  });

  it('keeps the retirement confirmation available after a failed request and prevents duplicates', async () => {
    let finish!: (reply: { status: number; json: unknown }) => void;
    const calls = mockApi({
      'GET /api/admin/consent': CONSENT_DOC,
      'GET /api/admin/employees/7': detail,
      'POST /api/admin/employees/7/retire': () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    at('/employees/7');
    await userEvent.click(await screen.findByRole('button', { name: '퇴사 처리' }));
    await userEvent.dblClick(screen.getByRole('button', { name: '퇴사 처리 확인' }));
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    await act(async () => {
      finish({ status: 500, json: { error: 'failed' } });
    });
    const dialog = screen.getByRole('dialog', { name: '홍길동 퇴사 처리' });
    expect(within(dialog).getByText('퇴사 처리하지 못했습니다.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '퇴사 처리 확인' })).toBeEnabled();
    expect(screen.getByRole('cell', { name: '재직' })).toBeInTheDocument();
  });

  it('does not delete a photo when confirmation is cancelled', async () => {
    const calls = mockApi({
      'GET /api/admin/consent': CONSENT_DOC,
      'GET /api/admin/employees/7': detail,
    });
    vi.stubGlobal('confirm', () => false);
    at('/employees/7');
    await userEvent.click(await screen.findByRole('button', { name: '사진 3 삭제' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('shows a retired employee as read only', async () => {
    mockApi({
      'GET /api/admin/consent': CONSENT_DOC,
      'GET /api/admin/employees/7': { ...detail, status: 'RETIRED', faces: [] },
    });
    at('/employees/7');
    expect(await screen.findByRole('cell', { name: '퇴사' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '정보 수정' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '파일로 사진 추가' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '퇴사 처리' })).not.toBeInTheDocument();
  });

  it('distinguishes list loading from an empty result and allows a failed load to retry', async () => {
    let finish!: (reply: { status: number; json: unknown }) => void;
    let first = true;
    mockApi({
      'GET /api/admin/consent': CONSENT_DOC,
      'GET /api/admin/employees': () => {
        if (first) {
          first = false;
          return new Promise((resolve) => {
            finish = resolve;
          });
        }
        return { json: [] };
      },
    });
    at('/employees');
    expect(screen.getByText('불러오는 중입니다.')).toBeInTheDocument();
    expect(screen.queryByText('검색 결과가 없습니다.')).not.toBeInTheDocument();
    await act(async () => {
      finish({ status: 500, json: { error: 'failed' } });
    });
    expect(await screen.findByText(/목록을 불러오지 못했습니다/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('검색 결과가 없습니다.')).toBeInTheDocument();
    expect(screen.queryByText(/목록을 불러오지 못했습니다/)).not.toBeInTheDocument();
  });

  it('clears an unsaved edit when the employee route changes', async () => {
    mockApi({
      'GET /api/admin/consent': CONSENT_DOC,
      'GET /api/admin/employees/7': detail,
      'GET /api/admin/employees/8': { ...detail, employeeKey: 8, employeeNo: 'E8', name: '김직원' },
    });
    render(
      <MemoryRouter initialEntries={['/employees/7']}>
        <Link to="/employees/8">다른 직원</Link>
        <Routes>
          <Route path="/employees/:employeeKey" element={<EmployeeDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole('button', { name: '정보 수정' }));
    await userEvent.clear(screen.getByLabelText('이름'));
    await userEvent.type(screen.getByLabelText('이름'), '저장하지 않은 이름');
    await userEvent.click(screen.getByRole('link', { name: '다른 직원' }));
    expect(await screen.findByRole('heading', { name: '김직원' })).toBeInTheDocument();
    expect(screen.queryByLabelText('이름')).not.toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'E8' })).toBeInTheDocument();
  });

  it('can retry a failed retirement after its pending dialog was closed by the browser', async () => {
    let finish!: (reply: { status: number; json: unknown }) => void;
    mockApi({
      'GET /api/admin/consent': CONSENT_DOC,
      'GET /api/admin/employees/7': detail,
      'POST /api/admin/employees/7/retire': () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    at('/employees/7');
    await userEvent.click(await screen.findByRole('button', { name: '퇴사 처리' }));
    await userEvent.click(screen.getByRole('button', { name: '퇴사 처리 확인' }));
    fireEvent(screen.getByRole('dialog', { name: '홍길동 퇴사 처리' }), new Event('close'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => {
      finish({ status: 500, json: { error: 'failed' } });
    });
    expect(await screen.findByText('퇴사 처리하지 못했습니다.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '퇴사 처리' }));
    expect(screen.getByRole('dialog', { name: '홍길동 퇴사 처리' })).toBeVisible();
  });
});
