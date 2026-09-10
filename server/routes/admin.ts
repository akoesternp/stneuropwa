import { randomBytes } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Router } from 'express'
import { KOMMENTAR_MAX_ZEICHEN, SCHWIERIGKEITEN } from '../../shared/types.js'
import { DEFAULT_ADMIN_PASSWORD } from '../bootstrap.js'
import { erstattePaypalKauf, ziehePaypalEin } from '../einzug.js'
import {
  bucheBestellung,
  erstatteBestellung,
  findeBestellung,
  istErstattbar,
  deleteAdmin,
  deleteAktion,
  deleteBereich,
  deleteZielgruppe,
  deleteBenutzer,
  deletePaket,
  deleteVideo,
  findAdmin,
  findBenutzerById,
  listAdmins,
  listAktionen,
  listBereiche,
  listPaketeMitVideos,
  listZielgruppenMitInhalt,
  listBenutzer,
  listBestellungen,
  kommentareZuVideoFuerAdmin,
  listKommentare,
  listPakete,
  listSterne,
  listVideos,
  saveAktion,
  saveBenutzer,
  saveBereich,
  savePaket,
  saveZielgruppe,
  saveVideo,
  loescheKommentar,
  loescheSterne,
  setzeKommentarStatus,
  speichereKommentar,
  storniereBestellung,
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

  /*
   * Guthaben: ganzzahlig und nie negativ. Ein Minusstand ließe sich über kein
   * Formular wieder ausgleichen und würde jeden Kauf blockieren.
   */
  const rohCredits = Number(body.credits)
  const credits = Number.isFinite(rohCredits) ? Math.max(0, Math.floor(rohCredits)) : 0

  try {
    const benutzerId = await saveBenutzer(id, {
      email,
      name: String(body.name ?? ''),
      aktiv,
      passwortHash: password ? await hashPassword(password) : null,
      paketIds,
      videoIds,
      credits,
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
  res.json(await listPaketeMitVideos())
})

adminRouter.put('/pakete', async (req, res) => {
  const body = req.body ?? {}
  const id = body.id == null ? null : Number(body.id)
  const name = String(body.name ?? '').trim()

  if (!name) {
    res.status(400).json({ error: 'Der Paketname ist Pflicht.' })
    return
  }

  /*
   * Nur bekannte Videos übernehmen. Fehlt das Feld ganz, bleibt die Zuordnung
   * unangetastet — „nicht mitgeschickt" heißt nicht „keine Videos".
   */
  let videoIds: number[] | null = null
  if (Array.isArray(body.videoIds)) {
    const bekannt = new Set((await listVideos()).map((video) => video.id))
    const roh: unknown[] = body.videoIds
    videoIds = [...new Set(roh.map((wert) => Number(wert)))].filter((videoId) =>
      bekannt.has(videoId),
    )
  }

  try {
    const paketId = await savePaket(
      id,
      {
        name,
        beschreibung: String(body.beschreibung ?? ''),
        sortierung: Number(body.sortierung) || 0,
        aktiv: body.aktiv !== false,
      },
      videoIds,
    )
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

// ── Zielgruppen ────────────────────────────────────────────────────────────

adminRouter.get('/zielgruppen', async (_req, res) => {
  res.json(await listZielgruppenMitInhalt())
})

adminRouter.put('/zielgruppen', async (req, res) => {
  const body = req.body ?? {}
  const id = body.id == null ? null : Number(body.id)
  const name = String(body.name ?? '').trim().slice(0, 128)

  if (!name) {
    res.status(400).json({ error: 'Der Name ist Pflicht.' })
    return
  }

  /*
   * Nur Bekanntes übernehmen, und "nicht mitgeschickt" heißt unangetastet —
   * dieselbe Unterscheidung wie bei den Paketen.
   */
  const nurBekannte = async (roh: unknown, bekannt: Set<number>) => {
    if (!Array.isArray(roh)) return null
    return [...new Set((roh as unknown[]).map((wert) => Number(wert)))].filter((eintrag) =>
      bekannt.has(eintrag),
    )
  }

  const paketIds = await nurBekannte(
    body.paketIds,
    new Set((await listPakete()).map((paket) => paket.id)),
  )
  const videoIds = await nurBekannte(
    body.videoIds,
    new Set((await listVideos()).map((video) => video.id)),
  )

  try {
    const zielgruppeId = await saveZielgruppe(
      id,
      {
        name,
        beschreibung: String(body.beschreibung ?? ''),
        sortierung: Number(body.sortierung) || 0,
        aktiv: body.aktiv !== false,
      },
      paketIds,
      videoIds,
    )
    res.json({ id: zielgruppeId })
  } catch (cause) {
    if (istDuplikat(cause)) {
      res.status(409).json({ error: 'Eine Zielgruppe mit diesem Namen gibt es bereits.' })
      return
    }
    throw cause
  }
})

adminRouter.delete('/zielgruppen/:id', async (req, res) => {
  /*
   * Ohne Rückfrage löschbar: an einer Zielgruppe hängt keine Berechtigung,
   * Pakete und Videos bleiben unberührt — anders als bei einem Paket.
   */
  await deleteZielgruppe(Number(req.params.id))
  res.json({ ok: true })
})

// ── Trainingsbereiche ──────────────────────────────────────────────────────

adminRouter.get('/bereiche', async (_req, res) => {
  res.json(await listBereiche())
})

adminRouter.put('/bereiche', async (req, res) => {
  const body = req.body ?? {}
  const id = body.id == null ? null : Number(body.id)
  const name = String(body.name ?? '').trim().slice(0, 64)

  if (!name) {
    res.status(400).json({ error: 'Der Name ist Pflicht.' })
    return
  }

  try {
    const bereichId = await saveBereich(id, name, Number(body.sortierung) || 0)
    res.json({ id: bereichId })
  } catch (cause) {
    if (istDuplikat(cause)) {
      res.status(409).json({ error: 'Einen Bereich mit diesem Namen gibt es bereits.' })
      return
    }
    throw cause
  }
})

adminRouter.delete('/bereiche/:id', async (req, res) => {
  const ergebnis = await deleteBereich(Number(req.params.id))

  if (ergebnis === 'nicht-gefunden') {
    res.status(404).json({ error: 'Bereich nicht gefunden.' })
    return
  }
  if (ergebnis === 'in-benutzung') {
    res.status(409).json({
      error: 'Diesem Bereich sind noch Videos zugeordnet. Bitte dort zuerst umtragen.',
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

  /*
   * Nur bekannte Werte übernehmen. Ein Tippfehler oder ein veralteter Wert
   * aus einer älteren Fassung landete sonst als eigener Filtereintrag in der
   * Oberfläche — leer heißt schlicht „nicht gepflegt".
   */
  const ausListe = (wert: unknown, erlaubt: readonly string[]) =>
    erlaubt.includes(String(wert ?? '')) ? String(wert) : ''

  const bekannteBereiche = (await listBereiche()).map((bereich) => bereich.name)

  const videoId = await saveVideo(id, {
    titel,
    untertitel: String(body.untertitel ?? ''),
    beschreibung: String(body.beschreibung ?? ''),
    dauer,
    oeffentlich: body.oeffentlich === true,
    bereich: ausListe(body.bereich, bekannteBereiche),
    schwierigkeit: ausListe(body.schwierigkeit, SCHWIERIGKEITEN),
    hilfsmittel: String(body.hilfsmittel ?? '').trim().slice(0, 255),
    /*
     * Die Paketzuordnung wird von der Paketmaske aus gepflegt; null lässt sie
     * unangetastet. Käme hier eine leere Liste an, risse jedes Speichern eines
     * Videos seine Pakete weg.
     */
    paketIds: null,
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

// ── Aktionen ───────────────────────────────────────────────────────────────

/**
 * Aktionszeiträume fürs Startguthaben.
 *
 * Wer sich im Fenster registriert, bekommt den hier hinterlegten Betrag statt
 * des Grundguthabens aus START_CREDITS. Laufende Aktionen stehen oben.
 */
adminRouter.get('/aktionen', async (_req, res) => {
  res.json(await listAktionen())
})

adminRouter.put('/aktionen', async (req, res) => {
  const body = req.body ?? {}
  const id = body.id == null ? null : Number(body.id)
  const name = String(body.name ?? '').trim().slice(0, 128)

  if (!name) {
    res.status(400).json({ error: 'Der Name ist Pflicht.' })
    return
  }

  const credits = Math.floor(Number(body.credits))
  if (!Number.isFinite(credits) || credits < 0) {
    res.status(400).json({ error: 'Der Betrag muss eine Zahl ab 0 sein.' })
    return
  }

  const beginn = Number(body.beginn)
  const ende = Number(body.ende)
  if (!Number.isFinite(beginn) || !Number.isFinite(ende)) {
    res.status(400).json({ error: 'Bitte Beginn und Ende angeben.' })
    return
  }
  /*
   * `ende` gilt ausschließend — ein Fenster, das endet, bevor es beginnt, wäre
   * still wirkungslos statt erkennbar falsch.
   */
  if (ende <= beginn) {
    res.status(400).json({ error: 'Das Ende muss nach dem Beginn liegen.' })
    return
  }

  const maxEinloesungen = Math.max(0, Math.floor(Number(body.maxEinloesungen)) || 0)

  const aktionId = await saveAktion(id, {
    name,
    credits,
    beginn,
    ende,
    aktiv: body.aktiv !== false,
    maxEinloesungen,
  })
  res.json({ id: aktionId })
})

adminRouter.delete('/aktionen/:id', async (req, res) => {
  const ergebnis = await deleteAktion(Number(req.params.id))

  if (ergebnis === 'nicht-gefunden') {
    res.status(404).json({ error: 'Aktion nicht gefunden.' })
    return
  }
  if (ergebnis === 'in-benutzung') {
    res.status(409).json({
      error:
        'Diese Aktion wurde bereits eingelöst und bleibt als Beleg erhalten. ' +
        'Bitte stattdessen deaktivieren.',
    })
    return
  }

  res.json({ ok: true })
})

// ── Bestellungen ───────────────────────────────────────────────────────────

/**
 * Die Bestellungen über Credits — offene zuerst, denn nur die verlangen etwas.
 *
 * Für PayPal ist das reine Auskunft: dort bucht die Zahlungsbestätigung. Bei
 * Vorkasse ist diese Liste der Arbeitsplatz — Kontoauszug daneben, Referenz
 * vergleichen, bestätigen.
 */
adminRouter.get('/bestellungen', async (_req, res) => {
  res.json(await listBestellungen())
})

/**
 * Zahlungseingang bestätigen — die Vorkasse-Buchung von Hand.
 *
 * Läuft durch dieselbe Buchung wie PayPal, samt derselben Sperre gegen
 * Doppelbuchungen: ein zweiter Klick auf denselben Knopf schreibt nichts
 * nochmal gut.
 */
adminRouter.post('/bestellungen/:id/bestaetigen', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    res.status(404).json({ error: 'Bestellung nicht gefunden.' })
    return
  }

  /*
   * Von Hand bestätigt wird nur eine Überweisung — dort ist der Mensch am
   * Kontoauszug die einzige Quelle. Bei PayPal wäre es eine Gutschrift ohne
   * Deckung: ob Geld geflossen ist, weiß allein PayPal, und der Einzug
   * fragt es. Wer wirklich außer der Reihe gutschreiben will, tut das beim
   * Konto — dort steht es dann auch als Handbuchung.
   */
  const vorhanden = await findeBestellung(id)
  if (vorhanden?.zahlweg === 'paypal') {
    res.status(409).json({
      error: 'Bei PayPal bitte „einziehen“ — dabei wird der Betrag geprüft.',
    })
    return
  }

  const ergebnis = await bucheBestellung(id)

  switch (ergebnis.status) {
    case 'gebucht':
      console.log(
        `[Zahlung] Vorkasse ${ergebnis.bestellung.referenz} bestätigt: ` +
          `+${ergebnis.bestellung.credits} Credits, neuer Stand ${ergebnis.credits}`,
      )
      res.json({ ok: true, credits: ergebnis.credits })
      return
    case 'schon-gebucht':
      res.status(409).json({ error: 'Diese Bestellung ist bereits gebucht.' })
      return
    case 'storniert':
      res.status(409).json({ error: 'Diese Bestellung wurde storniert.' })
      return
    default:
      res.status(404).json({ error: 'Bestellung nicht gefunden.' })
  }
})

/**
 * Nachfassen: eine PayPal-Zahlung einziehen, die der Käufer freigegeben,
 * aber nicht abgeschlossen hat.
 *
 * Der übliche Fall: der Reiter ging nach der Freigabe zu, bevor der Browser
 * zurückmelden konnte. Dann liegt bei PayPal ein freigegebener Vorgang, aus
 * dem noch kein Geld gezogen wurde — der Käufer glaubt, bezahlt zu haben,
 * und hat kein Guthaben. Hier holt der Betreiber das nach.
 *
 * Geprüft wird dabei dasselbe wie im Portal: der Betrag muss zur Bestellung
 * passen, gebucht wird genau einmal.
 */
adminRouter.post('/bestellungen/:id/einziehen', async (req, res) => {
  const bestellung = await findeBestellung(Number(req.params.id))

  if (!bestellung || bestellung.zahlweg !== 'paypal') {
    res.status(404).json({ error: 'Keine PayPal-Bestellung mit dieser Nummer.' })
    return
  }
  if (bestellung.status === 'bezahlt') {
    res.status(409).json({ error: 'Diese Bestellung ist bereits gebucht.' })
    return
  }

  const ergebnis = await ziehePaypalEin(bestellung)

  switch (ergebnis.status) {
    case 'gebucht':
      res.json({ ok: true, gutgeschrieben: ergebnis.gutgeschrieben, credits: ergebnis.credits })
      return
    case 'schon-gebucht':
      res.json({ ok: true, schonGebucht: true })
      return
    case 'noch-nicht':
      res.status(409).json({
        error: 'PayPal hat dazu keine abgeschlossene Zahlung — der Käufer hat noch nicht freigegeben.',
      })
      return
    case 'kein-vorgang':
      res.status(409).json({ error: 'Zu dieser Bestellung gibt es keinen PayPal-Vorgang.' })
      return
    case 'betrag-weicht-ab':
      res.status(409).json({
        error:
          `Gezahlt wurden ${(ergebnis.erhalten / 100).toFixed(2)} €, bestellt waren ` +
          `${(ergebnis.erwartet / 100).toFixed(2)} €. Nicht gebucht.`,
      })
      return
    case 'nicht-buchbar':
      res.status(409).json({ error: 'Diese Bestellung lässt sich nicht mehr buchen.' })
      return
    default:
      res.status(502).json({ error: 'PayPal antwortet gerade nicht.' })
  }
})

/**
 * Einen Kauf zurücknehmen — nur, solange nichts davon benutzt wurde.
 *
 * Rechtlich ist das Kulanz, kein Widerruf: den hat der Käufer beim Kauf
 * ausdrücklich abbedungen, damit die Neuro sofort nutzbar sind. Deshalb
 * entscheidet der Betreiber, nicht ein Knopf im Portal.
 *
 * Reihenfolge mit Bedacht: erst prüfen, dann bei PayPal zurückzahlen, dann
 * abbuchen. Andersherum stünde die Bestellung auf „erstattet", während das
 * Geld noch beim Anbieter liegt. Bei Vorkasse überweist ein Mensch zurück —
 * das kann nur er.
 */
adminRouter.post('/bestellungen/:id/erstatten', async (req, res) => {
  const pruefung = await istErstattbar(Number(req.params.id))
  if (!pruefung.bestellung) {
    res.status(404).json({ error: pruefung.grund })
    return
  }
  if (!pruefung.moeglich) {
    res.status(409).json({ error: pruefung.grund })
    return
  }
  const bestellung = pruefung.bestellung

  if (bestellung.zahlweg === 'paypal') {
    const zurueck = await erstattePaypalKauf(bestellung)
    if (!zurueck.ok) {
      res.status(502).json({ error: zurueck.grund })
      return
    }
  }

  const ergebnis = await erstatteBestellung(bestellung.id)
  if (ergebnis.status !== 'erstattet') {
    /*
     * Bei PayPal ist das Geld an dieser Stelle schon zurück. Dass die
     * Abbuchung trotzdem scheitert, kann nur heißen: zwischen Prüfung und
     * Buchung wurde etwas freigeschaltet. Das gehört ins Log und dem
     * Betreiber deutlich gesagt.
     */
    console.error(
      `[Zahlung] Erstattung ${bestellung.referenz}: Rückzahlung lief, Abbuchung nicht — ` +
        ergebnis.grund,
    )
    res.status(409).json({
      error:
        bestellung.zahlweg === 'paypal'
          ? `${ergebnis.grund} Das Geld ist bei PayPal bereits zurückgezahlt — bitte das Guthaben von Hand richtigstellen.`
          : ergebnis.grund,
    })
    return
  }

  res.json({
    ok: true,
    credits: ergebnis.credits,
    zahlweg: bestellung.zahlweg,
    betragCent: bestellung.betragCent,
    referenz: bestellung.referenz,
  })
})

adminRouter.post('/bestellungen/:id/stornieren', async (req, res) => {
  const erledigt = await storniereBestellung(Number(req.params.id))
  if (!erledigt) {
    res.status(409).json({ error: 'Nur offene Bestellungen lassen sich stornieren.' })
    return
  }
  res.json({ ok: true })
})

// ── Kommentare und Sterne ──────────────────────────────────────────────────

/**
 * Die Prüfliste. Offene stehen oben — nur die verlangen eine Handlung.
 *
 * Hier darf die E-Mail des Verfassers stehen: die Liste liegt hinter
 * requireAdmin. Nach außen geht sie nie.
 */
adminRouter.get('/kommentare', async (_req, res) => {
  res.json(await listKommentare())
})

/**
 * Freigeben — und damit dem Verfasser dauerhaft vertrauen.
 *
 * Die Freigabe setzt zugleich den Vertrauensmerker an seinem Konto: ab dann
 * erscheinen seine Beiträge sofort. Genau das ist der Zweck der Prüfung —
 * einmal Vertrauen fassen statt jeden Satz einzeln durchwinken.
 */
adminRouter.post('/kommentare/:id/freigeben', async (req, res) => {
  if (!(await setzeKommentarStatus(Number(req.params.id), 'freigegeben'))) {
    res.status(404).json({ error: 'Beitrag nicht gefunden.' })
    return
  }
  res.json({ ok: true })
})

adminRouter.post('/kommentare/:id/ablehnen', async (req, res) => {
  if (!(await setzeKommentarStatus(Number(req.params.id), 'abgelehnt'))) {
    res.status(404).json({ error: 'Beitrag nicht gefunden.' })
    return
  }
  res.json({ ok: true })
})

adminRouter.delete('/kommentare/:id', async (req, res) => {
  if (!(await loescheKommentar(Number(req.params.id)))) {
    res.status(404).json({ error: 'Beitrag nicht gefunden.' })
    return
  }
  res.json({ ok: true })
})

/**
 * Die Beiträge zu EINER Übung — der Arbeitsplatz für den Strang.
 *
 * Moderiert wird hier, im Backend, nicht im Portal: dort schreiben Nutzer,
 * hier entscheidet der Betreiber. Beide Rollen bleiben damit getrennt, und es
 * braucht kein zweites Konto im Portal, nur um antworten zu können.
 */
adminRouter.get('/videos/:id/kommentare', async (req, res) => {
  res.json(await kommentareZuVideoFuerAdmin(Number(req.params.id)))
})

/**
 * Als Betreiber schreiben oder antworten.
 *
 * Ohne Verfasser gespeichert: der Beitrag ist eine Auskunft des Portals, nicht
 * die Meinung einer Person. Er steht sofort — die Prüfliste ist für Fremde da.
 */
adminRouter.post('/videos/:id/kommentare', async (req, res) => {
  const videoId = Number(req.params.id)
  const text = String(req.body?.text ?? '').trim().slice(0, KOMMENTAR_MAX_ZEICHEN)

  if (!text) {
    res.status(400).json({ error: 'Bitte schreiben Sie etwas.' })
    return
  }

  const elternId = req.body?.elternId == null ? null : Number(req.body.elternId)
  const ergebnis = await speichereKommentar(null, videoId, text, elternId)

  if (ergebnis.status === 'eltern-unbekannt') {
    res.status(404).json({ error: 'Der Beitrag, auf den geantwortet werden sollte, fehlt.' })
    return
  }

  res.status(201).json({ id: ergebnis.id })
})


/** Die Wertungen einer Übung — samt der Möglichkeit, eine zu entfernen. */
adminRouter.get('/videos/:id/sterne', async (req, res) => {
  res.json(await listSterne(Number(req.params.id)))
})

adminRouter.delete('/videos/:id/sterne/:benutzerId', async (req, res) => {
  await loescheSterne(Number(req.params.benutzerId), Number(req.params.id))
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
