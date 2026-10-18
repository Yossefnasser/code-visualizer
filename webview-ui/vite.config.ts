import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the built index.html references assets with "./" URLs,
  // which the extension host rewrites to webview resource URIs at runtime.
  base: './',
  plugins: [react(), tailwindcss()],
    resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})

