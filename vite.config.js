import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync } from 'fs'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/tr909/',
  server: {
    port: 16,
    host: true,
  },
  preview: {
    port: 16,
    host: true,
  },
  plugins: [
    react(),
    {
      name: 'copy-package-json',
      closeBundle() {
        // Copy package.json to dist directory for version fetching
        copyFileSync('package.json', 'dist/package.json')
      }
    },
  ],
  assetsInclude: ['**/*.tr909bank'],
  // optimizeDeps: false,
  
})
