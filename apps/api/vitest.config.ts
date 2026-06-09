import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.test.ts'],
    // reflect-metadata so decorator-bearing classes import cleanly in unit tests.
    setupFiles: ['reflect-metadata'],
  },
})
