import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, readFileSync, writeFileSync } from 'fs'

const base = process.env.VITE_BASE_PATH || '/';

// Generate a unique build ID for cache-busting
const buildId = Date.now().toString();

// https://vitejs.dev/config/
export default defineConfig({
  base,
  server: {
    port: 16,
    host: true,
  },
  preview: {
    port: 16,
    host: true,
  },
  build: {
    // Add timestamp to filenames for cache busting
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash]-${buildId}.js`,
        chunkFileNames: `assets/[name]-[hash]-${buildId}.js`,
        assetFileNames: `assets/[name]-[hash]-${buildId}.[ext]`
      }
    },
    // Ensure we generate a proper manifest for service worker
    manifest: true,
  },
  plugins: [
    react(),
    {
      name: 'copy-package-json',
      closeBundle() {
        try {
          // Copy package.json to dist directory for version fetching
          copyFileSync('package.json', 'dist/package.json');
          
          // Update the service worker version on each build
          const swPath = 'public/sw.js';
          let swContent = readFileSync(swPath, 'utf8');
          
          // Update the version in the service worker
          const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
          const appVersion = packageJson.version;
          
          // Replace the APP_VERSION constant with the current version
          swContent = swContent.replace(
            /const APP_VERSION = ['"].*?['"];/,
            `const APP_VERSION = '${appVersion}-${buildId}';`
          );
          
          // Write the updated service worker back to public
          writeFileSync(swPath, swContent, 'utf8');
          
          console.log(`Updated service worker version to ${appVersion}-${buildId}`);
          
          // Copy the updated service worker to dist
          copyFileSync(swPath, 'dist/sw.js');
        } catch (err) {
          console.error('Error during build process:', err);
        }
      }
    },
  ],
  assetsInclude: ['**/*.tr909bank'],
  // optimizeDeps: false,
  
})
