import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  base: '/',
  // We hand-ship a minimal service worker (client/public/sw.js) that handles ONLY
  // Web Push + notification clicks and does NO precaching — deliberately avoiding
  // the stale-asset regression that the old vite-plugin-pwa precaching caused.
  // The static manifest (public/manifest.webmanifest) keeps the app installable,
  // which iOS requires before it will deliver push. Registered in src/main.tsx.
  plugins: [
    react(),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('firebase') || id.includes('@firebase')) return 'firebase'
          if (id.includes('framer-motion')) return 'framer-motion'
          if (id.includes('@dnd-kit')) return 'dnd-kit'
          if (id.includes('@tanstack')) return 'query'
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/react-router') ||
            id.includes('/scheduler/')
          ) {
            return 'react-vendor'
          }
        },
      },
    },
  },
})
