import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',

      /*
       * Ohne das erzeugt das Plugin im Entwicklungsmodus GAR KEINEN Service
       * Worker — unter `npm run dev` bleibt der Bereich in den
       * Entwicklerwerkzeugen dann leer, und es sieht aus, als wäre die PWA
       * nicht eingerichtet. Genau dieser Eindruck ist im Review entstanden;
       * im Build war der Worker die ganze Zeit vorhanden.
       */
      devOptions: { enabled: true, type: 'module' },
      workbox: {
        /*
         * Ohne diese Ausnahme beantwortet der Service Worker JEDE Navigation
         * aus dem Zwischenspeicher mit index.html — auch den Aufruf eines
         * /api-Pfads. Antworten der API wären dann die Anwendung statt der
         * Daten.
         */
        navigateFallbackDenylist: [/^\/api\//],

        /*
         * Nach einem Deploy tragen die Dateien neue Namen. Ohne diese drei
         * Einstellungen behielte der alte Service Worker das alte index.html
         * im Zwischenspeicher und verwiese auf Dateien, die es nicht mehr
         * gibt — die Anwendung lädt dann, aber jeder Seitenwechsel läuft ins
         * Leere.
         */
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
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
        /*
         * Vier Einträge mit verschiedenen Aufgaben:
         *
         * Das SVG skaliert verlustfrei und bedient alles, was damit umgehen
         * kann. Die beiden PNG sind für die Systeme, die es nicht können —
         * Android nimmt für den Startbildschirm 192 und 512.
         *
         * `maskable` steht NUR am eigens dafür gebauten Bild: ein
         * maskierbares Symbol braucht rundum etwa 20 % Sicherheitsrand, weil
         * das System eine beliebige Form daraus schneidet. Das randlose
         * Grundsymbol als maskable auszugeben hieße zuzusagen, dass es
         * beschnitten werden darf — und dann fehlt außen etwas.
         */
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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
    /*
     * Die API lebt auf dem Node-Server; in der Entwicklung leitet Vite dorthin.
     * Der Port steht bewusst nicht zweimal fest verdrahtet: wer den Server auf
     * einem anderen Port fährt (PORT=3005 npm run dev:server), setzt hier
     * dasselbe über API_PORT und muss die Datei nicht anfassen.
     */
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.API_PORT ?? 3001}`,
        changeOrigin: true,
      },
    },
  },
})
