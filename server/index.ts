import { existsSync } from 'node:fs'
import { join } from 'node:path'
import express from 'express'
import { bootstrap } from './bootstrap.js'
import { initDb } from './db.js'
import { DIST_DIR } from './paths.js'
import { adminRouter } from './routes/admin.js'
import { authRouter } from './routes/auth.js'
import { portalRouter } from './routes/portal.js'
import { cookieParser, initSessions } from './sessions.js'

const PORT = Number(process.env.PORT ?? 3001)

/*
 * Lauscht standardmäßig nur auf localhost: hinter einem Reverse Proxy darf die
 * Anwendung nicht zusätzlich direkt auf ihrem Port erreichbar sein, sonst
 * ließe sich die TLS-Terminierung schlicht umgehen. Container brauchen
 * HOST=0.0.0.0.
 */
const HOST = process.env.HOST ?? '127.0.0.1'

/*
 * Ohne Datenbank kein Start: die Zugänge liegen dort, ein Weiterlaufen ohne
 * sie ergäbe nur ein Portal, an dem sich niemand anmelden kann.
 */
try {
  await initDb()
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : cause)
  process.exit(1)
}

await bootstrap()
await initSessions()

const app = express()

app.disable('x-powered-by')

/*
 * Hinter dem Reverse Proxy steht in req.ip sonst dessen Adresse — die Bremse
 * für die Registrierung würde damit für alle Besucher gemeinsam greifen.
 * Vertraut wird nur der Schleife: X-Forwarded-For zählt nur, wenn die
 * Verbindung von localhost kommt, also vom eigenen Apache.
 */
app.set('trust proxy', 'loopback')
app.use(express.json({ limit: '1mb' }))

/*
 * Vorschaubilder kommen roh, nicht als Formular — das spart eine Abhängigkeit
 * zum Zerlegen von multipart und die Aufblähung durch Base64. Videodateien
 * laufen NICHT hierüber: die nimmt der Upload-Endpunkt als Datenstrom
 * entgegen, damit sie nie vollständig im Speicher landen.
 */
app.use(express.raw({ type: 'image/jpeg', limit: '4mb' }))
app.use(cookieParser)

app.use('/api/auth', authRouter)
app.use('/api/portal', portalRouter)
app.use('/api/admin', adminRouter)

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Unbekannter Endpunkt.' })
})

/**
 * Liefert die gebaute SPA aus. In der Entwicklung übernimmt das Vite und
 * leitet /api hierher — ein fehlendes dist/ ist dann kein Grund abzustürzen.
 */
if (existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR, { index: false }))
  app.get(/.*/, (_req, res) => {
    res.sendFile(join(DIST_DIR, 'index.html'))
  })
} else {
  app.get(/.*/, (_req, res) => {
    res.status(503).type('text/plain').send('Kein Build vorhanden — bitte "npm run build" ausführen.')
  })
}

const server = app.listen(PORT, HOST, () => {
  console.log(`stneuro-Server läuft auf http://${HOST}:${PORT}`)
})

/*
 * Node bricht Anfragen nach 5 Minuten ab (requestTimeout). Ein Video-Upload
 * über eine gewöhnliche Anschlussleitung dauert länger — die Übertragung
 * wäre also mitten im Hochladen gescheitert, ohne erkennbaren Grund.
 *
 * 0 schaltet die Grenze ab; headersTimeout bleibt bestehen und fängt
 * Verbindungen ab, die gar nichts senden.
 */
server.requestTimeout = 0
