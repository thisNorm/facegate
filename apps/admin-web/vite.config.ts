/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // 게이트 서버로 넘김. changeOrigin을 끄면 Host와 Origin이 같아 서버의 교차 사이트 검사를 통과
    proxy: { '/api': { target: 'http://127.0.0.1:8080', changeOrigin: false } },
  },
  test: { environment: 'jsdom', globals: true, setupFiles: ['src/test/setup.ts'] },
});
