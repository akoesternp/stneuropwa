import { mkdir } from 'node:fs/promises'
import {
  findAdmin,
  listAdmins,
  listPakete,
  listVideos,
  savePaket,
  saveVideo,
  upsertAdmin,
} from './db.js'
import { hashPassword, verifyPassword } from './passwords.js'
import { VIDEO_DIR } from './paths.js'

/**
 * Standardpasswort der Ersteinrichtung. Steht in der Anleitung — solange es
 * irgendwo gilt, warnt das Backend auf jeder Seite (siehe /admin/health).
 */
export const DEFAULT_ADMIN_PASSWORD = 'stneuro-admin'

/** Legt den ersten Backend-Zugang an, damit das Backend überhaupt erreichbar ist. */
async function ensureAdmin(log: (message: string) => void): Promise<void> {
  if ((await listAdmins()).length) return

  const user = (process.env.ADMIN_USER ?? 'admin').trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD ?? DEFAULT_ADMIN_PASSWORD

  await upsertAdmin({ benutzer: user, passwort: await hashPassword(password), name: 'Admin' })

  log(`  Admin angelegt: ${user} / ${password}`)
  if (!process.env.ADMIN_PASSWORD) {
    log('  ⚠ Standardpasswort aktiv — bitte im Backend ändern oder ADMIN_PASSWORD setzen.')
  }
}

/**
 * Rettungsweg für ein vergessenes Backend-Passwort.
 *
 * Ohne das sperrt ein vergessenes Admin-Passwort das Backend dauerhaft — der
 * einzige Zugang, der Passwörter ändern darf, ist genau der, den man nicht
 * mehr nutzen kann. Ein gesetztes ADMIN_PASSWORD setzt den Zugang deshalb bei
 * jedem Start zurück. Danach wieder auskommentieren, sonst pinnt jeder
 * Neustart das Passwort erneut auf diesen Wert.
 */
async function resetAdminPassword(log: (message: string) => void): Promise<void> {
  const password = process.env.ADMIN_PASSWORD
  if (!password) return

  const user = (process.env.ADMIN_USER ?? 'admin').trim().toLowerCase()
  const existing = await findAdmin(user)
  if (!existing) return

  // Stimmt es schon, bleibt eine dauerhaft gesetzte Variable still.
  if (await verifyPassword(password, existing.passwort)) return

  await upsertAdmin({ ...existing, passwort: await hashPassword(password) })
  log(`  Passwort von "${user}" per ADMIN_PASSWORD zurückgesetzt`)
}

/**
 * Beispieldaten für den ersten Start: zwei Pakete und ein paar Kacheln, damit
 * Startseite und Backend nicht leer sind. Läuft nur auf einer leeren
 * Installation — was der Admin danach ändert oder löscht, bleibt gelöscht.
 */
async function seedBeispieldaten(log: (message: string) => void): Promise<void> {
  if ((await listPakete()).length || (await listVideos()).length) return

  const grundlagen = await savePaket(null, {
    name: 'Grundlagen',
    beschreibung: 'Einstieg — die Basis-Videoreihe.',
    sortierung: 1,
    aktiv: true,
  })
  const aufbau = await savePaket(null, {
    name: 'Aufbaukurs',
    beschreibung: 'Vertiefung für Fortgeschrittene.',
    sortierung: 2,
    aktiv: true,
  })

  // Das letzte Beispiel liegt bewusst in beiden Paketen — so ist die
  // Mehrfachzuordnung von Anfang an sichtbar.
  const kacheln: [string, string, string, number[]][] = [
    ['Willkommen', 'Was Sie hier erwartet', '02:15', []],
    ['So funktioniert das Portal', 'Ein Rundgang in drei Minuten', '03:10', []],
    ['Erste Schritte', 'Grundlagen, Teil 1', '12:30', [grundlagen]],
    ['Aufbau und Vertiefung', 'Grundlagen, Teil 2', '14:05', [grundlagen]],
    ['Praxisbeispiel A', 'Aufbaukurs, Teil 1', '18:40', [aufbau]],
    ['Praxisbeispiel B', 'In beiden Paketen enthalten', '21:12', [grundlagen, aufbau]],
  ]

  let sortierung = 1
  for (const [titel, untertitel, dauer, paketIds] of kacheln) {
    await saveVideo(null, {
      titel,
      untertitel,
      dauer,
      paketIds,
      datei: '',
      sortierung: sortierung++,
      aktiv: true,
    })
  }

  log('  Beispieldaten angelegt: 2 Pakete, 6 Video-Kacheln')
}

/**
 * Das Videoverzeichnis anlegen bzw. seine Abwesenheit melden. Im Betrieb
 * liegt es außerhalb des Anwendungsverzeichnisses und kann auf einem
 * schreibgeschützten System nicht von hier aus entstehen — dann ist die
 * Meldung im Log der Hinweis, es von Hand anzulegen (deploy/README.md).
 */
async function ensureVideoDir(log: (message: string) => void): Promise<void> {
  try {
    await mkdir(VIDEO_DIR, { recursive: true })
    log(`Videoverzeichnis: ${VIDEO_DIR}`)
  } catch {
    log(`⚠ Videoverzeichnis ${VIDEO_DIR} fehlt und ließ sich nicht anlegen — Streams laufen ins Leere.`)
  }
}

export async function bootstrap(log: (message: string) => void = console.log): Promise<void> {
  await ensureVideoDir(log)
  await ensureAdmin(log)
  await resetAdminPassword(log)
  await seedBeispieldaten(log)
}
