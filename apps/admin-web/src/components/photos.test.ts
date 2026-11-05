import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileToJpeg, toJpegDataUrl } from './photos';

let encoded: { width: number; height: number };
const drawImage = vi.fn();

beforeEach(() => {
  drawImage.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (
    this: HTMLCanvasElement,
    type?: string,
  ) {
    encoded = { width: this.width, height: this.height };
    return `data:${type};base64,ZW5jb2RlZA==`;
  });
});

afterEach(() => vi.restoreAllMocks());

describe('photo conversion', () => {
  for (const [width, height, expectedWidth, expectedHeight] of [
    [2560, 1440, 1280, 720],
    [640, 480, 640, 480],
    [4096, 1, 1280, 1],
    [1, 4096, 1, 1280],
  ]) {
    it(`encodes ${width}x${height} as a non-empty ${expectedWidth}x${expectedHeight} JPEG`, () => {
      const source = document.createElement('canvas');
      source.width = width;
      source.height = height;
      expect(toJpegDataUrl(source, width, height)).toMatch(/^data:image\/jpeg;base64,/);
      expect([encoded.width, encoded.height]).toEqual([expectedWidth, expectedHeight]);
      expect(drawImage).toHaveBeenCalledWith(source, 0, 0, expectedWidth, expectedHeight);
      expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.9);
    });
  }

  it('releases the decoded bitmap after converting a file', async () => {
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 2560, height: 1440, close })),
    );
    expect(await fileToJpeg(new File(['fixture'], 'photo.png', { type: 'image/png' }))).toMatch(
      /^data:image\/jpeg;base64,/,
    );
    expect([encoded.width, encoded.height]).toEqual([1280, 720]);
    expect(close).toHaveBeenCalledOnce();
  });

  it('releases the decoded bitmap when encoding fails', async () => {
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 640, height: 480, close })),
    );
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockImplementation(() => {
      throw new Error('encoding unavailable');
    });
    await expect(fileToJpeg(new File(['fixture'], 'photo.png'))).rejects.toThrow(
      'encoding unavailable',
    );
    expect(close).toHaveBeenCalledOnce();
  });
});
