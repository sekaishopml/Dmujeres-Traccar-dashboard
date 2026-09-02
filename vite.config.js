import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import svgr from 'vite-plugin-svgr';
import { VitePWA } from 'vite-plugin-pwa';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig(() => ({
  server: {
    port: 3000,
    proxy: {
      '/api/socket': 'ws://localhost:8082',
      '/api': 'http://localhost:8082',
    },
  },
  build: {
    outDir: 'build',
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined;
          }
          if (/(maplibre-gl|mapbox-gl|mapbox-gl-draw|pmtiles|gcoord|wellknown|@turf|mapbox-gl-rtl-text)/.test(id)) {
            return 'map';
          }
          if (/(react|react-dom|react-redux|react-router|redux)/.test(id)) {
            return 'react-vendor';
          }
          if (/(@mui|emotion|stylis|tss-react)/.test(id)) {
            return 'mui';
          }
          if (/recharts/.test(id)) {
            return 'charts';
          }
          if (/(exceljs|file-saver)/.test(id)) {
            return 'reports';
          }
          if (/hls\.js/.test(id)) {
            return 'stream';
          }
          return 'vendor';
        },
      },
    },
  },
  plugins: [
    svgr(),
    react(),
    VitePWA({
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png'],
      workbox: {
        navigateFallbackDenylist: [/^\/api/],
        globPatterns: ['**/*.{js,css,html,woff,woff2,mp3}'],
      },
      manifest: {
        short_name: '${title}',
        name: '${description}',
        theme_color: '#0A0B14',
        background_color: '#0A0B14',
        backgroundColor: '#0A0B14',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-64x64.png',
            sizes: '64x64',
            type: 'image/png',
          },
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
    }),
    viteStaticCopy({
      targets: [
        { src: 'node_modules/@mapbox/mapbox-gl-rtl-text/dist/mapbox-gl-rtl-text.js', dest: '' },
      ],
    }),
  ],
}));
