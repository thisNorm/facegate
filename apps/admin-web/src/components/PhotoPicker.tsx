import { useEffect, useRef, useState } from 'react';
import * as photos from './photos';

export type PickedPhoto = { id: string; dataUrl: string };

export function PhotoPicker({
  photos: list,
  onChange,
  max,
  label,
  disabled = false,
}: {
  photos: PickedPhoto[];
  onChange: (photos: PickedPhoto[]) => void;
  max: number;
  label?: string;
  disabled?: boolean;
}) {
  const [error, setError] = useState('');
  const selection = useRef({ list, max, onChange });
  const generation = useRef(0);

  useEffect(() => {
    selection.current = { list, max, onChange };
  }, [list, max, onChange]);

  useEffect(() => {
    return () => {
      generation.current += 1;
    };
  }, []);

  function add(dataUrls: string[]) {
    const current = selection.current;
    if (current.max === 1) {
      // 자세 칸은 한 장뿐이라 새로 고르면 바로 바꾼다.
      const next = dataUrls.slice(0, 1).map((dataUrl) => ({ id: crypto.randomUUID(), dataUrl }));
      setError('');
      selection.current = { ...current, list: next };
      current.onChange(next);
      return;
    }
    const room = current.max - current.list.length;
    if (dataUrls.length > room) setError(`사진은 ${current.max}장까지 고를 수 있습니다.`);
    else setError('');
    const next = [
      ...current.list,
      ...dataUrls
        .slice(0, Math.max(0, room))
        .map((dataUrl) => ({ id: crypto.randomUUID(), dataUrl })),
    ];
    selection.current = { ...current, list: next };
    current.onChange(next);
  }

  async function pickFiles(files: File[]) {
    if (!files.length) return;
    const current = selection.current;
    const room = current.max === 1 ? 1 : Math.max(0, current.max - current.list.length);
    if (room === 0) {
      setError(`사진은 ${current.max}장까지 고를 수 있습니다.`);
      return;
    }
    const started = generation.current;
    try {
      const converted = await Promise.all(
        files.slice(0, room).map((file) => photos.fileToJpeg(file)),
      );
      if (started !== generation.current) return;
      add(converted);
      if (files.length > room) setError(`사진은 ${current.max}장까지 고를 수 있습니다.`);
    } catch {
      if (started === generation.current)
        setError('사진 파일을 읽지 못했습니다. JPG나 PNG 파일을 골라 주세요.');
    }
  }

  function remove(id: string) {
    const current = selection.current;
    const next = current.list.filter((photo) => photo.id !== id);
    selection.current = { ...current, list: next };
    current.onChange(next);
  }

  return (
    <div>
      <label>
        <span>{label ?? '사진 파일 고르기'}</span>
        <input
          type="file"
          accept="image/*"
          multiple={max > 1}
          aria-label={label ?? '사진 파일 고르기'}
          disabled={disabled}
          onChange={(e) => {
            const files = Array.from(e.currentTarget.files ?? []);
            e.currentTarget.value = '';
            void pickFiles(files);
          }}
        />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="photos">
        {list.map((photo, i) => (
          <figure key={photo.id}>
            <img src={photo.dataUrl} alt={label ? `${label} 미리보기` : `고른 사진 ${i + 1}`} />
            <button type="button" disabled={disabled} onClick={() => remove(photo.id)}>
              빼기
            </button>
          </figure>
        ))}
      </div>
    </div>
  );
}
