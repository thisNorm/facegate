import { useEffect, useId, useRef, useState } from 'react';

const Eye = ({ off }: { off: boolean }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    aria-hidden="true"
  >
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
    {off && <path d="M3 3l18 18" />}
  </svg>
);

export function PasswordField({
  label,
  name,
  value,
  onChange,
  autoComplete = 'current-password',
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // 제출하면 다시 가린다. 실패해도 입력값은 그대로 둔다.
  useEffect(() => {
    const form = input.current?.form;
    const hide = () => setVisible(false);
    form?.addEventListener('submit', hide);
    return () => form?.removeEventListener('submit', hide);
  }, []);
  return (
    <label htmlFor={id}>
      <span>{label}</span>
      <span className="password">
        <input
          ref={input}
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          aria-label={visible ? '비밀번호 숨기기' : '비밀번호 보기'}
          onClick={() => setVisible((v) => !v)}
        >
          <Eye off={visible} />
        </button>
      </span>
    </label>
  );
}
