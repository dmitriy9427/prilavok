import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// GitHub Pages отдаёт сайт из подпапки /prilavok/ — base задаётся переменной окружения,
// локально всё работает с корня.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    // Порядок важен: роутер генерирует дерево маршрутов до того, как React-плагин увидит файлы.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
