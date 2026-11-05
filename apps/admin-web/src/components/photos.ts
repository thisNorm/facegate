const MAX_SIDE = 1280;

/** 서버는 JPEG만 받으므로 무엇이든 JPEG로. 긴 변 1280px 이하 */
export function toJpegDataUrl(source: CanvasImageSource, width: number, height: number): string {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.9);
}

export async function fileToJpeg(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    return toJpegDataUrl(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}
