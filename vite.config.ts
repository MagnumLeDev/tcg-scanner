import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-180.png'],
      manifest: {
        name: 'YGO Scanner',
        short_name: 'YGO Scanner',
        description: 'Scan Yu-Gi-Oh card set codes and keep a list of your cards.',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#111418',
        theme_color: '#111418',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,wasm}'],
        runtimeCaching: [
          {
            // Tesseract.js worker, core, and English model, fetched on first scan.
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/(@tesseract\.js-data|tesseract\.js)/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tesseract',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 20 },
            },
          },
        ],
      },
    }),
  ],
  test: { environment: 'node' },
});
