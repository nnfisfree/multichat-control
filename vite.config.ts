import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The interface lives in ui/ and is built into dist/, which the Tauri core loads.
export default defineConfig({
  root: 'ui',
  plugins: [react()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2023' }
})
