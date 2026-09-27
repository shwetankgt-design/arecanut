import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Arecanut Farmer Survey',
        short_name: 'Arecanut Survey',
        description: 'Karnataka arecanut farmer data collection — offline-capable field app',
        theme_color: '#5A2D82',
        background_color: '#F6F4F9',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Never cache API calls with the app-shell strategy — surveys/masters are
        // handled by our own IndexedDB offline queue instead, which needs to see
        // real network failures rather than a stale cached response.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^\/api\/masters\//,
            handler: 'CacheFirst',
            options: { cacheName: 'masters-cache', expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 7 } },
          },
        ],
      },
      devOptions: { enabled: true },
    }),
  ],
  server: {
    port: 3701,
    proxy: {
      '/api': 'http://127.0.0.1:8300',
    },
  },
})
