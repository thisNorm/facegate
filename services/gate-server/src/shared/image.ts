const JPEG_DATA_URL = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/;

export function decodeJpeg(dataUrl: unknown): Buffer | null {
  const match = JPEG_DATA_URL.exec(String(dataUrl ?? ''));
  return match ? Buffer.from(match[1], 'base64') : null;
}
