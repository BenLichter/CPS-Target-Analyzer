import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // Disable minification completely - eliminates ALL TDZ-via-minification bugs
    // The bundle is larger but the app works correctly on all devices
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      }
    }
  },
  server: {
    port: 3000,
  }
})
