import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoPicker, type PickedPhoto } from './PhotoPicker';
import { fileToJpeg } from './photos';

// ESM 모듈 함수는 spyOn으로 바꿀 수 없어 모듈째 흉내 (jsdom에는 createImageBitmap과 canvas가 없음)
vi.mock('./photos', () => ({
  fileToJpeg: vi.fn(async () => 'data:image/jpeg;base64,AAA'),
}));

function Harness({ max = 10 }: { max?: number }) {
  const [list, setList] = useState<PickedPhoto[]>([]);
  return <PhotoPicker photos={list} onChange={setList} max={max} />;
}

beforeEach(() => {
  vi.mocked(fileToJpeg).mockReset().mockResolvedValue('data:image/jpeg;base64,AAA');
});

describe('PhotoPicker', () => {
  it('adds chosen files as JPEG previews and removes them', async () => {
    render(<Harness />);
    const input = screen.getByLabelText('사진 파일 고르기');
    await userEvent.upload(input, [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
    ]);
    expect(await screen.findAllByRole('img', { name: /고른 사진/ })).toHaveLength(2);
    await userEvent.click(screen.getAllByRole('button', { name: '빼기' })[0]);
    expect(screen.getAllByRole('img', { name: /고른 사진/ })).toHaveLength(1);
  });

  it('stops at the maximum and says so', async () => {
    render(<Harness max={2} />);
    await userEvent.upload(screen.getByLabelText('사진 파일 고르기'), [
      new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
      new File(['c'], 'c.jpg', { type: 'image/jpeg' }),
    ]);
    expect(await screen.findAllByRole('img', { name: /고른 사진/ })).toHaveLength(2);
    expect(screen.getByText('사진은 2장까지 고를 수 있습니다.')).toBeInTheDocument();
    expect(fileToJpeg).toHaveBeenCalledTimes(2);
  });

  it('takes one file for a single slot and replaces it on the next pick', async () => {
    render(<Harness max={1} />);
    const input = screen.getByLabelText('사진 파일 고르기');
    expect(input).not.toHaveAttribute('multiple');
    await userEvent.upload(input, new File(['a'], 'a.jpg', { type: 'image/jpeg' }));
    expect(await screen.findByRole('img', { name: '고른 사진 1' })).toHaveAttribute(
      'src',
      'data:image/jpeg;base64,AAA',
    );
    vi.mocked(fileToJpeg).mockResolvedValueOnce('data:image/jpeg;base64,BBB');
    await userEvent.upload(input, new File(['b'], 'b.jpg', { type: 'image/jpeg' }));
    expect(await screen.findByRole('img', { name: '고른 사진 1' })).toHaveAttribute(
      'src',
      'data:image/jpeg;base64,BBB',
    );
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.queryByText(/장까지 고를 수 있습니다/)).not.toBeInTheDocument();
  });

  it('keeps a removal made while another file is still converting', async () => {
    render(<Harness />);
    const input = screen.getByLabelText('사진 파일 고르기');
    await userEvent.upload(input, [
      new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
    ]);
    expect(await screen.findAllByRole('img', { name: /고른 사진/ })).toHaveLength(2);
    let finish!: (dataUrl: string) => void;
    vi.mocked(fileToJpeg).mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    );
    await userEvent.upload(input, new File(['c'], 'c.jpg', { type: 'image/jpeg' }));
    await userEvent.click(screen.getAllByRole('button', { name: '빼기' })[0]);
    await act(async () => {
      finish('data:image/jpeg;base64,CCC');
    });
    expect(screen.getAllByRole('img', { name: /고른 사진/ })).toHaveLength(2);
  });

  it('keeps both batches when file conversions complete together', async () => {
    render(<Harness />);
    const input = screen.getByLabelText('사진 파일 고르기');
    let finishFirst!: (dataUrl: string) => void;
    let finishSecond!: (dataUrl: string) => void;
    vi.mocked(fileToJpeg)
      .mockReturnValueOnce(
        new Promise<string>((resolve) => {
          finishFirst = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<string>((resolve) => {
          finishSecond = resolve;
        }),
      );
    await userEvent.upload(input, new File(['a'], 'a.jpg', { type: 'image/jpeg' }));
    await userEvent.upload(input, new File(['b'], 'b.jpg', { type: 'image/jpeg' }));
    await act(async () => {
      finishFirst('data:image/jpeg;base64,AAA');
      finishSecond('data:image/jpeg;base64,BBB');
    });
    const images = screen.getAllByRole('img', { name: /고른 사진/ });
    expect(images).toHaveLength(2);
    expect(images.map((image) => image.getAttribute('src'))).toEqual([
      'data:image/jpeg;base64,AAA',
      'data:image/jpeg;base64,BBB',
    ]);
  });

  it('discards a file conversion after the picker is closed', async () => {
    const onChange = vi.fn();
    let finish!: (dataUrl: string) => void;
    vi.mocked(fileToJpeg).mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    );
    const { unmount } = render(<PhotoPicker photos={[]} onChange={onChange} max={10} />);
    await userEvent.upload(
      screen.getByLabelText('사진 파일 고르기'),
      new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
    );
    unmount();
    await act(async () => {
      finish('data:image/jpeg;base64,AAA');
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
