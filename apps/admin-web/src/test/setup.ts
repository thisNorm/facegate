import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom에는 없다. 카메라 장면 표시에 쓴다.
let objectUrls = 0;
URL.createObjectURL = () => `blob:frame-${++objectUrls}`;
URL.revokeObjectURL = () => {};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
