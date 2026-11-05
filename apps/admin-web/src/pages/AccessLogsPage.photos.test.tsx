import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { mockApi } from '../test/mockApi';
import { AccessLogsPage } from './AccessLogsPage';

const item = (eventKey: number, extra = {}) => ({
  eventKey,
  gateKey: 1,
  method: 'FACE',
  result: 'GRANTED',
  receivedAt: '2026-11-03 09:00:00.000',
  employeeNo: 'E1',
  employeeName: '홍길동',
  visitorName: null,
  remoteReason: null,
  hasFullImage: true,
  hasCropImage: true,
  ...extra,
});

const page = (items = [item(1)]) => {
  mockApi({
    'GET /api/admin/gates': [{ gateKey: 1, name: '정문 1' }],
    'GET /api/admin/access-logs': { items, nextBeforeEventKey: null },
  });
  return render(
    <MemoryRouter>
      <AccessLogsPage />
    </MemoryRouter>,
  );
};

describe('AccessLogsPage photos', () => {
  it('opens the full photo from a keyboard-accessible thumbnail when both images exist', async () => {
    page();
    const row = await screen.findByRole('row', { name: /홍길동/ });
    const opener = within(row).getByRole('button', { name: '출입 사진 1 크게 보기' });
    expect(within(opener).getByRole('img', { name: '출입 사진 1' })).toHaveAttribute(
      'src',
      '/api/admin/access-logs/1/images/crop',
    );
    opener.focus();
    expect(opener).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('img', { name: '전체 사진' })).toHaveAttribute(
      'src',
      '/api/admin/access-logs/1/images/full',
    );
  });

  it('makes full-only photos viewable and omits the opener when neither image exists', async () => {
    page([
      item(1, { hasCropImage: false }),
      item(2, { employeeName: '사진 없음', hasFullImage: false, hasCropImage: false }),
    ]);
    const withoutPhoto = await screen.findByRole('row', { name: /사진 없음/ });
    expect(within(withoutPhoto).queryByRole('button')).not.toBeInTheDocument();
    expect(within(withoutPhoto).queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const row = screen.getByRole('row', { name: /홍길동/ });
    await userEvent.click(within(row).getByRole('button', { name: '출입 사진 1 크게 보기' }));
    expect(
      within(screen.getByRole('dialog')).getByRole('img', { name: '전체 사진' }),
    ).toHaveAttribute('src', '/api/admin/access-logs/1/images/full');
  });

  it('opens the face photo when only the crop image exists', async () => {
    page([item(1, { hasFullImage: false })]);
    await userEvent.click(await screen.findByRole('img', { name: '출입 사진 1' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('img', { name: '얼굴 사진' })).toHaveAttribute(
      'src',
      '/api/admin/access-logs/1/images/crop',
    );
    expect(within(dialog).queryByRole('img', { name: '전체 사진' })).not.toBeInTheDocument();
  });

  it('replaces a failed enlarged photo with an error and retries after closing and reopening', async () => {
    page();
    await userEvent.click(await screen.findByRole('img', { name: '출입 사진 1' }));
    const dialog = screen.getByRole('dialog');
    const photo = within(dialog).getByRole('img', { name: '전체 사진' });
    fireEvent.error(photo);
    expect(within(dialog).getByText('사진을 불러오지 못했습니다.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('img')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '닫기' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('img', { name: '출입 사진 1' }));
    const reopened = screen.getByRole('dialog');
    const retried = within(reopened).getByRole('img', { name: '전체 사진' });
    expect(retried).toHaveAttribute('src', '/api/admin/access-logs/1/images/full');
    fireEvent.load(retried);
    expect(within(reopened).queryByText('사진을 불러오지 못했습니다.')).not.toBeInTheDocument();
    expect(retried).toBeVisible();
  });

  it('keeps the full photo available through a text fallback when the thumbnail fails', async () => {
    page();
    const thumbnail = await screen.findByRole('img', { name: '출입 사진 1' });
    fireEvent.error(thumbnail);
    const fallback = screen.getByText('사진 보기');
    const opener = screen.getByRole('button', { name: '출입 사진 1 크게 보기' });
    expect(opener).toContainElement(fallback);
    expect(within(opener).queryByRole('img')).not.toBeInTheDocument();
    await userEvent.click(opener);
    expect(
      within(screen.getByRole('dialog')).getByRole('img', { name: '전체 사진' }),
    ).toHaveAttribute('src', '/api/admin/access-logs/1/images/full');
  });
});
