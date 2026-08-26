import { randomBytes } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Router } from 'express'
import { DEFAULT_ADMIN_PASSWORD } from '../bootstrap.js'
import {
  deleteAdmin,
  deleteBenutzer,
  deletePaket,
  deleteVideo,
  findAdmin,
  findBenutzerById,
  listAdmins,
  listBenutzer,
  listPakete,
  listVideos,
  saveBenutzer,
  savePaket,
  saveVideo,
  upsertAdmin,
} from '../db.js'
import { hashPassword, verifyPassword } from '../passwords.js'
import { THUMB_DIR, VIDEO_DIR } from '../paths.js'
import { destroySessionsFor, requireAdmin } from '../sessions.js'
import { formatiereDauer, leseDauerSekunden } from '../videodauer.js'

export const adminRouter: Router = Router()

adminRouter.use(requireAdmin)

/**
 * Zugang bei jedem Aufruf frisch aus der Datenbank — löscht ein Admin einen
 * anderen, muss das sofort gelten und nicht erst nach dessen nächster
 * Anmeldung.
 */
adminRouter.use(async (req, res, next) => {
  const account = await findAdmin(req.session!.subject)
  if (!account) {
    res.status(401).json({ error: 'Zugang nicht mehr vorhanden.' })
    return
  }
  next()
})

/** MariaDB meldet doppelte Schlüssel als ER_DUP_ENTRY — daraus wird eine Meldung. */
function istDuplikat(cause: unknown): boolean {
  return (cause as { code?: string })?.code === 'ER_DUP_ENTRY'
}

// ── Nutzer ─────────────────────────────────────────────────────────────────

adminRouter.get('/benutzer', async (_req, res) => {
  res.json(await listBenutzer())
})

/**
 * Anlegen (ohne id) bzw. Ändern (mit id) samt Paketzuweisung. `passwort` wird
 * nur geschrieben, wenn ein neues eingetippt wurde — ein leeres Feld heißt
 * „das bestehende behalten", damit sich ein Nutzer bearbeiten lässt, ohne
 * sein Passwort zu kennen.
 */
adminRouter.put('/benutzer', async (req, res) => {
  const body = req.body ?? {}
  const id = body.id == null ? null : Number(body.id)
  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.passwort ?? '')

  if (!email || !email.includes('@')) {
    res.status(400).json({ error: 'Eine gültige E-Mail-Adresse ist Pflicht.' })
    return
  }
  if (id === null && !password) {
    res.status(400).json({ error: 'Für einen neuen Nutzer wird ein Passwort benötigt.' })
    return
  }

  // Nur Pakete und Videos, die es gibt — sonst stünden Karteileichen in der Zuweisung.
  const bekanntePakete = new Set((await listPakete()).map((paket) => paket.id))
  const paketIds = (Array.isArray(body.paketIds) ? body.paketIds : [])
    .map(Number)
    .filter((paketId: number) => bekanntePakete.has(paketId))

  const bekannteVideos = new Set((await listVideos()).map((video) => video.id))
  const videoIds = (Array.isArray(body.videoIds) ? body.videoIds : [])
    .map(Number)
    .filter((videoId: number) => bekannteVideos.has(videoId))

  const aktiv = body.aktiv !== false

  try {
    const benutzerId = await saveBenutzer(id, {
      email,
      name: String(body.name ?? ''),
      aktiv,
      passwortHash: password ? await hashPassword(password) : null,
      paketIds,
      videoIds,
    })

    /*
     * Neues Passwort oder Deaktivierung beenden die laufenden Sitzungen —
     * wer das Passwort nicht mehr kennt oder gesperrt wurde, soll nicht
     * angemeldet weiterarbeiten.
     */
    if (id !== null && (password || !aktiv)) destroySessionsFor('user', String(id))

    res.json({ id: benutzerId })
  } catch (cause) {
    if (istDuplikat(cause)) {
      res.status(409).json({ error: 'Diese E-Mail-Adresse ist bereits vergeben.' })
      return
    }
    throw cause
  }
})

adminRouter.delete('/benutzer/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!(await findBenutzerById(id))) {
    res.status(404).json({ error: 'Nutzer nicht gefunden.' })
    return
  }

  await deleteBenutzer(id)
  destroySessionsFor('user', String(id))
  res.json({ ok: true })
})

// ── Pakete ─────────────────────────────────────────────────────────────────

adminRouter.get('/pakete', async (_req, res) => {
  res.json(await listPakete())
})

adminRouter.put('/pakete', async (req, res) => {
  const body = req.body ?? {}
  const id = body.id == null ? null : Number(body.id)
  const name = String(body.name ?? '').trim()

  if (!name) {
    res.status(400).json({ error: 'Der Paketname ist Pflicht.' })
    return
  }

  try {
    const paketId = await savePaket(id, {
      name,
      beschreibung: String(body.beschreibung ?? ''),
      sortierung: Number(body.sortierung) || 0,
      aktiv: body.aktiv !== false,
    })
    res.json({ id: paketId })
  } catch (cause) {
    if (istDuplikat(cause)) {
      res.status(409).json({ error: 'Ein Paket mit diesem Namen gibt es bereits.' })
      return
    }
    throw cause
  }
})

adminRouter.delete('/pakete/:id', async (req, res) => {
  const ergebnis = await deletePaket(Number(req.params.id))

  if (ergebnis === 'videos') {
    res.status(409).json({
      error: 'Diesem Paket sind noch Videos zugeordnet. Bitte zuerst die Videos umhängen oder löschen.',
    })
    return
  }
  if (ergebnis === 'benutzer') {
    res.status(409).json({
      error: 'Dieses Paket ist noch Nutzern zugewiesen. Bitte zuerst die Zuweisungen entfernen.',
    })
    return
  }

  res.json({ ok: true })
})

// ── Videos (Kacheln) ───────────────────────────────────────────────────────

adminRouter.get('/videos', async (_req, res) => {
  res.json(await listVideos())
})

/** Was als Videodatei durchgeht — sowohl beim Hochladen als auch in der Liste. */
const VIDEO_ENDUNGEN = new Set(['.mp4', '.m4v', '.webm', '.mov'])

/**
 * Die Dateien in VIDEO_DIR — zur Auswahl beim Verknüpfen. Sie kommen entweder
 * über den Upload hier oder per SFTP/rsync dorthin (deploy/README.md); für
 * sehr große Dateien bleibt SFTP der verlässlichere Weg.
 *
 * Die Dauer wird gleich mitgelesen, damit die Verwaltung sie beim Verknüpfen
 * anbieten kann, ohne dass jemand ins Video schauen muss.
 */
adminRouter.get('/video-dateien', async (_req, res) => {
  let namen: string[] = []
  try {
    namen = (await readdir(VIDEO_DIR))
      .filter((name) => VIDEO_ENDUNGEN.has(extname(name).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, 'de'))
  } catch {
    // Fehlendes Verzeichnis heißt schlicht: noch keine Dateien.
  }

  const dateien = await Promise.all(
    namen.map(async (name) => {
      const sekunden = await leseDauerSekunden(join(VIDEO_DIR, name))
      return { name, dauer: sekunden === null ? '' : formatiereDauer(sekunden) }
    }),
  )

  res.json({ dateien })
})

/**
 * Macht aus einem beliebigen Namen aus dem Browser einen, der gefahrlos in
 * VIDEO_DIR landen darf: kein Pfad, keine Sonderzeichen, bekannte Endung.
 * Liefert null, wenn daraus nichts Brauchbares wird.
 */
function sichererDateiname(roh: string): string | null {
  const endung = extname(roh).toLowerCase()
  if (!VIDEO_ENDUNGEN.has(endung)) return null

  const stamm = basename(roh, extname(roh))
    // Deutsche Umlaute ausgeschrieben, sonst würde aus "Übung" ein "Ubung".
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    // Alles weitere Diakritische auf seinen Grundbuchstaben zurückführen.
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    // Der Rest auf Bindestriche: der Name muss über SFTP, Shell und
    // Dateisystem hinweg unauffällig bleiben.
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 120)

  return stamm ? `${stamm}${endung}` : null
}

/** Hängt -2, -3 … an, bis der Name frei ist — ein Upload soll nie überschreiben. */
function freierName(name: string): string {
  const endung = extname(name)
  const stamm = basename(name, endung)

  let kandidat = name
  let zaehler = 2
  while (existsSync(join(VIDEO_DIR, kandidat))) {
    kandidat = `${stamm}-${zaehler++}${endung}`
  }
  return kandidat
}

/**
 * Nimmt eine Videodatei entgegen — der Rumpf der Anfrage IST die Datei.
 *
 * Bewusst kein Formular-Upload: multipart müsste zerlegt werden (Bibliothek)
 * und landet je nach Umsetzung zwischenzeitlich komplett im Speicher. Hier
 * wird der Datenstrom direkt auf die Platte geschrieben — der Speicherbedarf
 * bleibt bei einer 20-GB-Datei derselbe wie bei einer 20-MB-Datei.
 *
 * Geschrieben wird zuerst in eine .part-Datei und erst am Ende umbenannt:
 * ein Abbruch hinterlässt damit nie eine halbe Datei, die jemand verknüpfen
 * könnte, und das Umbenennen selbst ist atomar.
 */
adminRouter.post('/upload', async (req, res) => {
  const gewuenscht = sichererDateiname(String(req.query.name ?? ''))
  if (!gewuenscht) {
    res.status(400).json({
      error: 'Dateiname oder Format nicht zulässig. Erlaubt sind MP4, M4V, MOV und WebM.',
    })
    return
  }

  await mkdir(VIDEO_DIR, { recursive: true })

  const teilPfad = join(VIDEO_DIR, `.upload-${randomBytes(8).toString('hex')}.part`)

  try {
    await pipeline(req, createWriteStream(teilPfad))
  } catch (cause) {
    // Abgebrochene Verbindung, volle Platte — in jedem Fall nichts liegenlassen.
    await rm(teilPfad, { force: true })
    console.error('[Admin] Upload fehlgeschlagen:', cause)
    if (!res.headersSent) res.status(500).json({ error: 'Der Upload ist fehlgeschlagen.' })
    return
  }

  // Eine leere Datei entsteht, wenn der Browser die Verbindung sofort schließt.
  const { size } = await stat(teilPfad)
  if (!size) {
    await rm(teilPfad, { force: true })
    res.status(400).json({ error: 'Die Datei kam leer an.' })
    return
  }

  const name = freierName(gewuenscht)
  await rename(teilPfad, join(VIDEO_DIR, name))

  const sekunden = await leseDauerSekunden(join(VIDEO_DIR, name))
  console.log(`[Admin] Video hochgeladen: ${name} (${Math.round(size / 1024 / 1024)} MB)`)

  res.json({
    datei: name,
    groesse: size,
    // Leer, wenn sich der Kopf nicht lesen ließ (etwa bei WebM) — dann trägt
    // die Verwaltung die Dauer von Hand nach.
    dauer: sekunden === null ? '' : formatiereDauer(sekunden),
  })
})

adminRouter.put('/videos', async (req, res) => {
  const body = req.body ?? {}
  const id = body.id == null ? null : Number(body.id)
  const titel = String(body.titel ?? '').trim()

  if (!titel) {
    res.status(400).json({ error: 'Der Titel ist Pflicht.' })
    return
  }

  // Unbekannte Pakete wären eine unsichtbare Kachel — lieber gleich ablehnen.
  const bekannt = new Set((await listPakete()).map((paket) => paket.id))
  const roheIds: unknown[] = Array.isArray(body.paketIds) ? body.paketIds : []
  const gewuenschtePakete = [...new Set(roheIds.map((wert) => Number(wert)))]
  if (gewuenschtePakete.some((paketId) => !bekannt.has(paketId))) {
    res.status(400).json({ error: 'Unbekanntes Paket.' })
    return
  }

  /*
   * Nur ein nackter Dateiname aus VIDEO_DIR, kein Pfad — und die Datei muss
   * existieren: eine Kachel, deren Stream ins Leere liefe, fällt sonst erst
   * auf, wenn der erste Nutzer auf Abspielen drückt.
   */
  const datei = String(body.datei ?? '').trim()
  if (datei) {
    if (datei !== basename(datei) || !existsSync(join(VIDEO_DIR, datei))) {
      res.status(400).json({ error: 'Diese Videodatei gibt es nicht in der Ablage.' })
      return
    }
  }

  /*
   * Die Dauer kommt aus der Datei, sobald das Feld leer bleibt — von Hand
   * eingetragene Werte bleiben unangetastet, etwa bei Formaten, deren Kopf
   * sich nicht lesen lässt.
   */
  let dauer = String(body.dauer ?? '').trim()
  if (!dauer && datei) {
    const sekunden = await leseDauerSekunden(join(VIDEO_DIR, datei))
    if (sekunden !== null) dauer = formatiereDauer(sekunden)
  }

  const videoId = await saveVideo(id, {
    titel,
    untertitel: String(body.untertitel ?? ''),
    beschreibung: String(body.beschreibung ?? ''),
    dauer,
    paketIds: gewuenschtePakete,
    datei,
    sortierung: Number(body.sortierung) || 0,
    aktiv: body.aktiv !== false,
  })
  res.json({ id: videoId, dauer })
})

/**
 * Streamt jedes Video für die Verwaltung — unabhängig von Paketen.
 *
 * Nötig, damit der Browser das Vorschaubild auch für Dateien erzeugen kann,
 * die per SFTP hereinkamen: er muss dafür kurz in das Video hineinsehen. Der
 * Portal-Endpunkt käme dafür nicht in Frage, dessen Regel gilt für Nutzer.
 * Hier steht bereits requireAdmin davor, und wer die Inhalte verwaltet, darf
 * sie ohnehin alle sehen.
 */
adminRouter.get('/videos/:id/stream', async (req, res) => {
  const videos = await listVideos()
  const video = videos.find((eintrag) => eintrag.id === Number(req.params.id))

  if (!video?.datei || video.datei !== basename(video.datei)) {
    res.status(404).json({ error: 'Video nicht gefunden.' })
    return
  }

  const pfad = join(VIDEO_DIR, video.datei)
  if (!existsSync(pfad)) {
    res.status(404).json({ error: 'Video nicht gefunden.' })
    return
  }

  res.sendFile(pfad)
})

/**
 * Nimmt das Vorschaubild entgegen — ein JPEG, das der Browser der Verwaltung
 * aus dem Video gezogen hat (siehe src/utils/vorschaubild.ts).
 *
 * Bewusst im Browser erzeugt und nicht hier: ein Einzelbild aus einem Video
 * zu holen hieße, den Datenstrom zu decodieren, wofür es ffmpeg auf dem
 * Server bräuchte. Der Browser kann das Video ohnehin abspielen — er hat den
 * Decoder schon.
 */
adminRouter.post('/videos/:id/thumb', async (req, res) => {
  const id = Number(req.params.id)
  const bild = req.body

  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Unbekanntes Video.' })
    return
  }
  if (!Buffer.isBuffer(bild) || !bild.length) {
    res.status(400).json({ error: 'Es kam kein Bild an.' })
    return
  }

  // JPEG beginnt immer mit FF D8 FF — was anderes gehört hier nicht hin.
  if (bild[0] !== 0xff || bild[1] !== 0xd8 || bild[2] !== 0xff) {
    res.status(400).json({ error: 'Das ist kein JPEG.' })
    return
  }

  const videos = await listVideos()
  if (!videos.some((video) => video.id === id)) {
    res.status(404).json({ error: 'Video nicht gefunden.' })
    return
  }

  await mkdir(THUMB_DIR, { recursive: true })
  await writeFile(join(THUMB_DIR, `${id}.jpg`), bild)

  res.json({ ok: true, groesse: bild.length })
})

adminRouter.delete('/videos/:id', async (req, res) => {
  const id = Number(req.params.id)
  await deleteVideo(id)

  /*
   * Das Vorschaubild wird nur abgekoppelt, nicht gelöscht — auf dem Server
   * darf es liegen bleiben.
   *
   * Umbenannt werden muss es trotzdem: die Datei heißt nach der Video-ID, und
   * InnoDB setzt den AUTO_INCREMENT-Zähler nach einem Neustart auf MAX(id)+1
   * zurück. Ein später angelegtes Video könnte also dieselbe ID bekommen —
   * und hätte dann stillschweigend das Bild seines Vorgängers.
   */
  const bild = join(THUMB_DIR, `${id}.jpg`)
  if (existsSync(bild)) {
    try {
      await rename(bild, join(THUMB_DIR, `geloescht-${id}-${Date.now()}.jpg`))
    } catch (cause) {
      console.warn(`[Admin] Vorschaubild ${bild} ließ sich nicht abkoppeln:`, cause)
    }
  }

  res.json({ ok: true })
})

// ── Backend-Zugänge ────────────────────────────────────────────────────────

/** Passwörter gehen nie an den Browser, auch nicht gehasht. */
adminRouter.get('/admins', async (_req, res) => {
  res.json((await listAdmins()).map(({ passwort: _passwort, ...rest }) => rest))
})

/**
 * Upsert. Wie bei den Nutzern gilt: ein leeres `passwort` behält das
 * gespeicherte — so lässt sich ein Zugang umbenennen, ohne sein Passwort zu
 * kennen.
 */
adminRouter.put('/admins/:benutzer', async (req, res) => {
  const key = String(req.params.benutzer).trim().toLowerCase()
  if (!key) {
    res.status(400).json({ error: 'Benutzername ist Pflicht.' })
    return
  }

  const existing = await findAdmin(key)
  const password = String(req.body?.passwort ?? '')

  if (!existing && !password) {
    res.status(400).json({ error: 'Für einen neuen Zugang wird ein Passwort benötigt.' })
    return
  }

  await upsertAdmin({
    benutzer: key,
    passwort: password ? await hashPassword(password) : existing!.passwort,
    name: String(req.body?.name ?? existing?.name ?? key),
  })

  // Neues Passwort beendet fremde Sitzungen dieses Zugangs — nicht die eigene.
  if (existing && password && key !== req.session!.subject) destroySessionsFor('admin', key)

  res.json({ benutzer: key })
})

adminRouter.delete('/admins/:benutzer', async (req, res) => {
  const key = String(req.params.benutzer).trim().toLowerCase()
  const admins = await listAdmins()

  // Sich selbst aus dem Backend auszusperren, darf keinen Klick entfernt sein.
  if (admins.length <= 1) {
    res.status(400).json({ error: 'Der letzte Backend-Zugang kann nicht gelöscht werden.' })
    return
  }
  if (key === req.session!.subject) {
    res.status(400).json({ error: 'Der eigene Zugang kann nicht gelöscht werden.' })
    return
  }

  await deleteAdmin(key)
  destroySessionsFor('admin', key)
  res.json({ ok: true })
})

// ── Zustand ────────────────────────────────────────────────────────────────

/** Sichtbar in der Oberfläche, damit niemand rätselt, warum etwas fehlt. */
adminRouter.get('/health', async (_req, res) => {
  const [benutzer, pakete, videos, admins] = await Promise.all([
    listBenutzer(),
    listPakete(),
    listVideos(),
    listAdmins(),
  ])

  // Geprüft, nicht vermutet: wer es geändert hat, sieht den Hinweis nicht mehr.
  const defaults: string[] = []
  for (const admin of admins) {
    if (await verifyPassword(DEFAULT_ADMIN_PASSWORD, admin.passwort)) {
      defaults.push(admin.benutzer)
    }
  }

  res.json({
    benutzer: benutzer.length,
    pakete: pakete.length,
    videos: videos.length,
    admins: admins.length,
    defaultPasswordAdmins: defaults,
  })
})
