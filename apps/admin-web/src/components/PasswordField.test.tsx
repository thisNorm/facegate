import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { PasswordField } from './PasswordField';

function Harness() {
  const [value, setValue] = useState('');
  return <PasswordField label="비밀번호" name="password" value={value} onChange={setValue} />;
}

describe('PasswordField', () => {
  it('is masked and the eye button toggles visibility', async () => {
    render(<Harness />);
    const input = screen.getByLabelText('비밀번호');
    await userEvent.type(input, 'secret value');
    expect(input).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: '비밀번호 보기' }));
    expect(input).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: '비밀번호 숨기기' }));
    expect(input).toHaveAttribute('type', 'password');
  });
});
