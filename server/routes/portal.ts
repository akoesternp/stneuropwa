import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { Router } from 'express'
import { darfVideoSehen, paketInhalte, sichtbareVideos } from '../db.js'
import { VIDEO_DIR } from '../paths.js'
import { currentSession } from '../sessions.js'
import { formatiereDauer, parseDauer } from '../videodauer.js'

/**
 * Die Nutzerseite des Portals.
 *
 * Bewusst OHNE Anmeldezwang: die Startseite zeigt auch Besuchern die
 * öffentlichen Kacheln. Was jemand sehen darf, entscheidet die Datenbank-
 * Abfrage anhand der Sitzung — nicht die Oberfläche.
 */
export const portalRouter: Router = Router()

portalRouter.get('/videos', async (req, res) => {
  const session = currentSession(req, 'user')
  const benutzerId = session ? Number(session.subject) : null

  res.json({ videos: await sichtbareVideos(benutzerId) })
})

/**
 * Die Paketübersicht — ebenfalls ohne Anmeldung.
 *
 * Wer wissen will, was ein Paket enthält, soll das sehen können, bevor er
 * einen Zugang hat: Titel und Laufzeiten sind die Beschreibung des Angebots.
 * Abspielbar macht sie das nicht — dafür bleibt der Stream-Endpunkt zuständig.
 */
portalRouter.get('/pakete', async (req, res) => {
  const session = currentSession(req, 'user')
  const benutzerId = session ? Number(session.subject) : null

  const pakete = await paketInhalte(benutzerId)

  res.json({
    pakete: pakete.map((paket) => {
      /*
       * Die Gesamtdauer bleibt leer, sobald eine Einzeldauer fehlt oder nicht
       * dem Muster mm:ss folgt — eine Summe, die stillschweigend Videos
       * unterschlägt, wäre schlechter als gar keine Angabe.
       */
      const sekunden = paket.videos.map((video) => parseDauer(video.dauer))
      const vollstaendig = sekunden.length > 0 && sekunden.every((wert) => wert !== null)

      return {
        ...paket,
        gesamtdauer: vollstaendig
          ? formatiereDauer(sekunden.reduce((summe: number, wert) => summe + wert!, 0))
          : '',
      }
    }),
  })
})

/**
 * Streamt die Videodatei — der EINZIGE Weg an die Dateien in VIDEO_DIR.
 *
 * Das <video>-Element schickt das Sitzungscookie automatisch mit (gleiche
 * Origin), deshalb braucht es weder Tokens noch signierte Links: die
 * Berechtigung wird bei jedem Abruf gegen dieselbe Regel geprüft wie die
 * Kachel-Liste. Ein weitergegebener Link läuft bei Unberechtigten ins Leere.
 *
 * `sendFile` beherrscht HTTP-Range von Haus aus — der Browser lädt also nie
 * die ganze Datei, sondern nur die Stücke, die er gerade abspielt oder
 * anspult. Genau deshalb dürfen hier auch sehr große Bestände liegen.
 */
portalRouter.get('/videos/:id/stream', async (req, res) => {
  const session = currentSession(req, 'user')
  const benutzerId = session ? Number(session.subject) : null

  // Nicht vorhanden und nicht berechtigt antworten identisch — der Endpunkt
  // soll nicht verraten, welche IDs es gibt.
  const video = await darfVideoSehen(Number(req.params.id), benutzerId)
  if (!video || !video.datei) {
    res.status(404).json({ error: 'Video nicht gefunden.' })
    return
  }

  /*
   * Der Dateiname kommt aus der Datenbank, nie aus der URL. Trotzdem wird er
   * auf seinen Basisnamen geprüft: stünde dort je ein Pfad (Handbearbeitung
   * der Tabelle), darf daraus kein Ausbruch aus VIDEO_DIR werden.
   */
  if (video.datei !== basename(video.datei)) {
    res.status(404).json({ error: 'Video nicht gefunden.' })
    return
  }

  const pfad = join(VIDEO_DIR, video.datei)
  if (!existsSync(pfad)) {
    // Verknüpfung zeigt auf eine gelöschte/umbenannte Datei — für den
    // Zuschauer ein 404, fürs Log der eigentliche Grund.
    console.warn(`[Portal] Videodatei fehlt: ${pfad} (Video ${video.id})`)
    res.status(404).json({ error: 'Video nicht gefunden.' })
    return
  }

  res.sendFile(pfad)
})
