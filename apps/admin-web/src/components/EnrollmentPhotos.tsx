import { useEffect, useRef } from 'react';
import { PhotoPicker, type PickedPhoto } from './PhotoPicker';

export const ENROLLMENT_POSES = [
  { id: 'front-1', label: '정면 1' },
  { id: 'front-2', label: '정면 2' },
  { id: 'left', label: '좌측' },
  { id: 'right', label: '우측' },
  { id: 'up', label: '상향' },
  { id: 'down', label: '하향' },
] as const;

export function EnrollmentPhotos({
  photos,
  onChange,
  disabled,
}: {
  photos: PickedPhoto[];
  onChange: (photos: PickedPhoto[]) => void;
  disabled: boolean;
}) {
  const selection = useRef({ photos, onChange, disabled });
  useEffect(() => {
    selection.current = { photos, onChange, disabled };
  }, [photos, onChange, disabled]);

  function change(id: string, picked: PickedPhoto[]) {
    const current = selection.current;
    if (current.disabled) return;
    const next = ENROLLMENT_POSES.flatMap((pose) => {
      const photo = pose.id === id ? picked[0] : current.photos.find((p) => p.id === pose.id);
      return photo ? [{ id: pose.id, dataUrl: photo.dataUrl }] : [];
    });
    selection.current = { ...current, photos: next };
    current.onChange(next);
  }

  return (
    <div className="enrollment-photos">
      {ENROLLMENT_POSES.map((pose) => (
        <section className="enrollment-pose" aria-label={pose.label} key={pose.id}>
          <PhotoPicker
            photos={photos.filter((photo) => photo.id === pose.id)}
            onChange={(picked) => change(pose.id, picked)}
            max={1}
            label={`${pose.label} 사진`}
            disabled={disabled}
          />
        </section>
      ))}
    </div>
  );
}
