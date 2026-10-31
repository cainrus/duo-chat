/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const alias = {
  '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
  '@client': fileURLToPath(new URL('./src/client', import.meta.url)),
  '@server': fileURLToPath(new URL('./src/server', import.meta.url)),
}

export default defineConfig({
  plugins: [vue()],
  resolve: { alias },
  build: {
    // Reproducible output: no sourcemaps with absolute paths, stable hashes.
    sourcemap: false,
  },
  test: {
    include: ['src/**/*.test.ts', 'build/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
})
