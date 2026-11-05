import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EnrollmentPhotos } from './EnrollmentPhotos';
import type { PickedPhoto } from './PhotoPicker';
import { fileToJpeg } from './photos';

vi.mock('./photos', () => ({ fileToJpeg: vi.fn() }));
beforeEach(() => vi.mocked(fileToJpeg).mockReset());

function Harness({ disabled = false }: { disabled?: boolean }) {
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  return (
    <>
      <EnrollmentPhotos photos={photos} onChange={setPhotos} disabled={disabled} />
      <output aria-label="사진 순서">{photos.map((photo) => photo.dataUrl).join(',')}</output>
    </>
  );
}

describe('EnrollmentPhotos', () => {
  it('retains both views in enrollment order when conversions finish out of order', async () => {
    let front!: (value: string) => void;
    let left!: (value: string) => void;
    vi.mocked(fileToJpeg)
      .mockReturnValueOnce(
        new Promise<string>((resolve) => {
          front = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<string>((resolve) => {
          left = resolve;
        }),
      );
    render(<Harness />);
    await userEvent.upload(
      screen.getByLabelText('정면 1 사진'),
      new File(['a'], 'front.jpg', { type: 'image/jpeg' }),
    );
    await userEvent.upload(
      screen.getByLabelText('좌측 사진'),
      new File(['b'], 'left.jpg', { type: 'image/jpeg' }),
    );
    await act(async () => {
      left('data:image/jpeg;base64,TEVGVA==');
    });
    await act(async () => {
      front('data:image/jpeg;base64,RlJPTlQ=');
    });
    expect(screen.getByRole('img', { name: '정면 1 사진 미리보기' })).toHaveAttribute(
      'src',
      'data:image/jpeg;base64,RlJPTlQ=',
    );
    expect(screen.getByRole('img', { name: '좌측 사진 미리보기' })).toHaveAttribute(
      'src',
      'data:image/jpeg;base64,TEVGVA==',
    );
    expect(screen.getByLabelText('사진 순서')).toHaveTextContent(
      'data:image/jpeg;base64,RlJPTlQ=,data:image/jpeg;base64,TEVGVA==',
    );
  });

  it('discards a pending file when consent is withdrawn', async () => {
    let finish!: (value: string) => void;
    vi.mocked(fileToJpeg).mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    );
    const { rerender } = render(<Harness />);
    await userEvent.upload(
      screen.getByLabelText('정면 1 사진'),
      new File(['a'], 'front.jpg', { type: 'image/jpeg' }),
    );
    rerender(<Harness disabled />);
    await act(async () => {
      finish('data:image/jpeg;base64,RlJPTlQ=');
    });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByLabelText('사진 순서')).toBeEmptyDOMElement();
    expect(screen.getByLabelText('정면 1 사진')).toBeDisabled();
  });
});
