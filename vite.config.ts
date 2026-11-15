import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// UI lives in ui/ and builds into dist/, which Tauri loads.
export default defineConfig({
  root: 'ui',
  plugins: [react()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2023' }
})
