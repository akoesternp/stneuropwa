import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        /*
         * Ohne diese Ausnahme beantwortet der Service Worker JEDE Navigation
         * aus dem Zwischenspeicher mit index.html — auch den Aufruf eines
         * /api-Pfads. Antworten der API wären dann die Anwendung statt der
         * Daten.
         */
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: 'stneuro Videoportal',
        short_name: 'stneuro',
        description: 'Videoportal — Kurse und Inhalte nach Paketen',
        lang: 'de',
        start_url: '/',
        display: 'standalone',
        background_color: '#FBFAFC',
        theme_color: '#182142',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    // 5173 ist lokal schon von einem anderen Projekt belegt. strictPort,
    // damit Vite nicht stillschweigend doch dorthin ausweicht.
    port: 5174,
    strictPort: true,
    // Die API lebt auf dem Node-Server; in der Entwicklung leitet Vite dorthin.
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})
