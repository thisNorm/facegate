import { useEffect, useRef, type ReactNode } from 'react';

export function Dialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // jsdom에는 showModal이 없어 open 속성으로 대신
    if (open && !dialog.open) {
      if (dialog.showModal) dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    if (!open && dialog.open) {
      if (dialog.close) dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-label={title}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {open && children}
    </dialog>
  );
}
