import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/**/*.spec.ts',
      '../../tests/contract/video-activation/**/*.spec.ts',
    ],
  },
});
