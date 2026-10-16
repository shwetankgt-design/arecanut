import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

// Baked in at build time so the login screen can show "last updated" — this is
// the moment `npm run build` ran, independent of deployment method (works the
// same whether deployed via git-triggered build or a direct `vercel --prod`
// CLI upload, unlike Vercel's own VERCEL_GIT_COMMIT_* vars which are only set
// for git-triggered builds).
const BUILD_TIME = new Date().toISOString();

export default defineConfig({
  define: {
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Madhyastha',
        short_name: 'Madhyastha',
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
            // Matched against the request's full URL by Workbox, so an anchored
            // relative regex like /^\/api\/masters\// only ever matches the dev
            // server's relative "/api/..." calls. The packaged Android app is
            // built with VITE_API_BASE set to the absolute Azure backend URL
            // (https://arecanut...azurecontainerapps.io/api/masters/...), which
            // that regex can never match — so master data (villages, societies,
            // crops, schemes, machines, option lists) silently never got cached
            // there, and dropdowns came up empty offline despite working fine in
            // local dev. Matching on url.pathname instead works for both.
            urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/api/masters/'),
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
