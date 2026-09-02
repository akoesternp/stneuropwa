import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { Router } from 'express'
import type { Response } from 'express'
import { creditPaket } from '../../shared/types.js'
import type { Zahlweg } from '../../shared/types.js'
import {
  bucheBestellung,
  darfVideoSehen,
  erzeugeBestellung,
  anbieterReferenzVon,
  findeBestellung,
  kaufePaket,
  kaufeVideo,
  katalogVideos,
  listBereiche,
  listBestellungenFuer,
  listZielgruppen,
  leseFortschritt,
  merkeAnbieterReferenz,
  paketInhalte,
  speichereFortschritt,
  storniereBestellung,
} from '../db.js'
import type { KaufErgebnis } from '../db.js'
import {
  erfassePaypalZahlung,
  erzeugePaypalVorgang,
  paypalAktiv,
  paypalClientId,
  paypalUmgebung,
} from '../paypal.js'
import { VORKASSE } from '../vorkasse.js'
import { THUMB_DIR, VIDEO_DIR } from '../paths.js'
import { currentSession, requireUser } from '../sessions.js'
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

  /*
   * Die Bereiche kommen mit: die Startseite braucht sie für die Filterleiste,
   * und ein zweiter Aufruf für eine Handvoll Namen wäre Verschwendung.
   */
  const [videos, bereiche, zielgruppen] = await Promise.all([
    katalogVideos(benutzerId),
    listBereiche(),
    listZielgruppen(true),
  ])

  res.json({
    videos,
    bereiche: bereiche.map((bereich) => bereich.name),
    zielgruppen: zielgruppen.map((zielgruppe) => ({
      name: zielgruppe.name,
      beschreibung: zielgruppe.beschreibung,
    })),
  })
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
 * Was für Zahlwege offenstehen — und womit die Oberfläche sie darstellen kann.
 *
 * Die PayPal-Kennung (client id) ist öffentlich, sie steckt ohnehin im Skript
 * im Browser. Das Geheimnis bleibt hier.
 */
portalRouter.get('/zahlung/konfig', (_req, res) => {
  res.json({
    paypal: {
      aktiv: paypalAktiv(),
      clientId: paypalClientId(),
      umgebung: paypalUmgebung(),
    },
    vorkasse: VORKASSE,
  })
})

/**
 * Legt eine Bestellung an — der gemeinsame erste Schritt beider Zahlwege.
 *
 * Der Client schickt nur die Kennung der Staffelstufe und den Zahlweg. Menge
 * und Betrag kommen aus CREDIT_PAKETE und werden in die Bestellung
 * geschrieben; käme der Preis aus der Anfrage, könnte man ihn sich aussuchen.
 *
 * Gebucht wird hier nichts. Bei Vorkasse wartet die Bestellung auf die
 * Bestätigung im Backend, bei PayPal auf die Erfassung der Zahlung.
 */
portalRouter.post('/bestellungen', requireUser, async (req, res) => {
  const stufe = creditPaket(String(req.body?.paket ?? ''))
  if (!stufe) {
    res.status(400).json({ error: 'Unbekanntes Credit-Paket.' })
    return
  }

  const zahlweg = String(req.body?.zahlweg ?? '') as Zahlweg
  if (zahlweg !== 'vorkasse' && zahlweg !== 'paypal') {
    res.status(400).json({ error: 'Unbekannter Zahlweg.' })
    return
  }
  if (zahlweg === 'paypal' && !paypalAktiv()) {
    res.status(503).json({ error: 'PayPal steht derzeit nicht zur Verfügung.' })
    return
  }
  if (zahlweg === 'vorkasse' && !VORKASSE.aktiv) {
    res.status(503).json({ error: 'Vorkasse steht derzeit nicht zur Verfügung.' })
    return
  }

  /*
   * Bei digitalen Inhalten muss der Käufer der sofortigen Ausführung
   * ausdrücklich zustimmen — sonst bliebe das Widerrufsrecht bestehen,
   * obwohl die Credits schon nutzbar sind.
   */
  if (req.body?.sofortAusfuehren !== true) {
    res.status(400).json({
      error: 'Bitte bestätigen Sie die sofortige Freischaltung.',
    })
    return
  }

  const bestellung = await erzeugeBestellung(Number(req.session!.subject), stufe, zahlweg)

  if (zahlweg === 'vorkasse') {
    res.json({ bestellung })
    return
  }

  try {
    const vorgangId = await erzeugePaypalVorgang(bestellung)
    await merkeAnbieterReferenz(bestellung.id, vorgangId)
    res.json({ bestellung, paypalVorgang: vorgangId })
  } catch (cause) {
    // Die Bestellung soll nicht als Leiche stehenbleiben, wenn PayPal den
    // Vorgang gar nicht erst angelegt hat.
    await storniereBestellung(bestellung.id)
    console.error('[Zahlung] PayPal-Vorgang fehlgeschlagen:', cause)
    res.status(502).json({ error: 'PayPal antwortet gerade nicht. Bitte später erneut versuchen.' })
  }
})

/**
 * Der Abschluss bei PayPal: Geld einziehen und gutschreiben.
 *
 * Der Browser meldet hier nur, DASS der Käufer zugestimmt hat. Ob wirklich
 * gezahlt wurde, erfährt der Server allein aus seinem eigenen Aufruf bei
 * PayPal — und der zurückgemeldete Betrag wird gegen die Bestellung geprüft,
 * bevor irgendetwas gebucht wird.
 */
portalRouter.post('/bestellungen/:id/paypal', requireUser, async (req, res) => {
  const benutzerId = Number(req.session!.subject)
  const bestellung = await findeBestellung(Number(req.params.id), benutzerId)

  if (!bestellung || bestellung.zahlweg !== 'paypal') {
    res.status(404).json({ error: 'Bestellung nicht gefunden.' })
    return
  }
  if (bestellung.status === 'storniert') {
    res.status(409).json({ error: 'Diese Bestellung wurde abgebrochen.' })
    return
  }

  /*
   * Die Vorgangsnummer kommt aus UNSERER Bestellung, nicht aus der Anfrage.
   * Der Browser meldet zwar eine mit, aber würde man ihr folgen, ließe sich
   * eine fremde Zahlung auf das eigene Konto buchen.
   */
  const vorgangId = await anbieterReferenzVon(bestellung.id)
  if (!vorgangId) {
    res.status(409).json({ error: 'Zu dieser Bestellung gibt es keinen PayPal-Vorgang.' })
    return
  }

  const ergebnis = await erfassePaypalZahlung(vorgangId)

  if (ergebnis.status === 'offen') {
    res.status(402).json({ error: 'Die Zahlung ist noch nicht abgeschlossen.' })
    return
  }
  if (ergebnis.status === 'fehlgeschlagen') {
    console.error(`[Zahlung] Erfassung fehlgeschlagen (Bestellung ${bestellung.id}): ${ergebnis.grund}`)
    res.status(502).json({ error: 'Die Zahlung konnte nicht abgeschlossen werden.' })
    return
  }

  /*
   * Betragsprüfung: gezahlt werden muss, was bestellt wurde. Weicht es ab,
   * wird NICHT gebucht — lieber ein Fall für die Hand als eine falsche
   * Gutschrift.
   */
  if (ergebnis.betragCent !== bestellung.betragCent) {
    console.error(
      `[Zahlung] Betrag weicht ab (Bestellung ${bestellung.id}): ` +
        `erwartet ${bestellung.betragCent}, erhalten ${ergebnis.betragCent}`,
    )
    res.status(409).json({
      error: 'Der gezahlte Betrag stimmt nicht mit der Bestellung überein. Bitte melden Sie sich bei uns.',
    })
    return
  }

  const gebucht = await bucheBestellung(bestellung.id)

  if (gebucht.status === 'nicht-gefunden' || gebucht.status === 'storniert') {
    res.status(409).json({ error: 'Diese Bestellung lässt sich nicht mehr buchen.' })
    return
  }
  if (gebucht.status === 'schon-gebucht') {
    // Zweiter Aufruf derselben Zahlung — kein Fehler, nur nichts zu tun.
    res.json({ ok: true, schonGebucht: true, credits: null })
    return
  }

  console.log(
    `[Zahlung] PayPal ${bestellung.referenz}: +${bestellung.credits} Credits ` +
      `für Konto ${benutzerId}, neuer Stand ${gebucht.credits}`,
  )
  res.json({ ok: true, gutgeschrieben: bestellung.credits, credits: gebucht.credits })
})

/** Die eigenen Bestellungen — Beleg und Stand der offenen Überweisungen. */
portalRouter.get('/bestellungen', requireUser, async (req, res) => {
  res.json({ bestellungen: await listBestellungenFuer(Number(req.session!.subject)) })
})

/** Eine offene Bestellung abbrechen — etwa nach Abbruch im PayPal-Fenster. */
portalRouter.post('/bestellungen/:id/abbrechen', requireUser, async (req, res) => {
  const bestellung = await findeBestellung(Number(req.params.id), Number(req.session!.subject))
  if (!bestellung) {
    res.status(404).json({ error: 'Bestellung nicht gefunden.' })
    return
  }
  res.json({ ok: await storniereBestellung(bestellung.id) })
})

/**
 * Freischalten gegen Credits — der Nutzer bedient sich selbst.
 *
 * Bewusst POST ohne Rumpf: was gekauft wird, steht in der Adresse, und was es
 * kostet, entscheidet allein der Server. Ein Preis aus der Anfrage wäre eine
 * Einladung, ihn zu setzen.
 *
 * Beide Endpunkte sind idempotent im Ergebnis, nicht in der Buchung: ein
 * zweiter Aufruf für dasselbe Ziel bucht nichts ab, sondern antwortet mit 409.
 */
function antworteAufKauf(res: Response, ergebnis: KaufErgebnis): void {
  switch (ergebnis.status) {
    case 'ok':
      res.json({ ok: true, kosten: ergebnis.kosten, credits: ergebnis.credits })
      return
    case 'zu-wenig':
      res.status(402).json({
        error: `Dafür brauchen Sie ${ergebnis.kosten} Credits, Ihr Guthaben beträgt ${ergebnis.credits}.`,
        kosten: ergebnis.kosten,
        credits: ergebnis.credits,
      })
      return
    case 'schon-frei':
      res.status(409).json({ error: 'Das ist für Sie bereits freigeschaltet.' })
      return
    case 'leer':
      res.status(409).json({ error: 'Dieses Paket enthält derzeit keine Übungen.' })
      return
    default:
      // Nicht vorhanden, nicht im Angebot, Konto gesperrt — alles dasselbe
      // 404: der Endpunkt soll nicht verraten, welche IDs es gibt.
      res.status(404).json({ error: 'Nicht gefunden.' })
  }
}

portalRouter.post('/freischalten/video/:id', requireUser, async (req, res) => {
  const videoId = Number(req.params.id)
  if (!Number.isInteger(videoId) || videoId <= 0) {
    res.status(404).json({ error: 'Nicht gefunden.' })
    return
  }

  antworteAufKauf(res, await kaufeVideo(Number(req.session!.subject), videoId))
})

portalRouter.post('/freischalten/paket/:id', requireUser, async (req, res) => {
  const paketId = Number(req.params.id)
  if (!Number.isInteger(paketId) || paketId <= 0) {
    res.status(404).json({ error: 'Nicht gefunden.' })
    return
  }

  antworteAufKauf(res, await kaufePaket(Number(req.session!.subject), paketId))
})

/**
 * Der Trainingsfortschritt des angemeldeten Nutzers.
 *
 * Nur mit Anmeldung — ohne Konto gibt es niemanden, dem ein Stand gehören
 * könnte. Der Nutzer bekommt immer nur den eigenen: die Benutzer-ID stammt
 * aus der Sitzung, nie aus der Anfrage.
 */
portalRouter.get('/fortschritt', requireUser, async (req, res) => {
  res.json({ fortschritt: await leseFortschritt(Number(req.session!.subject)) })
})

portalRouter.put('/fortschritt/:videoId', requireUser, async (req, res) => {
  const benutzerId = Number(req.session!.subject)
  const videoId = Number(req.params.videoId)

  /*
   * Nur für Videos, die dieser Nutzer sehen darf. Sonst ließe sich über die
   * Fortschrittstabelle herausfinden, welche IDs es überhaupt gibt.
   */
  if (!Number.isInteger(videoId) || !(await darfVideoSehen(videoId, benutzerId))) {
    res.status(404).json({ error: 'Video nicht gefunden.' })
    return
  }

  const position = Number(req.body?.position)
  await speichereFortschritt(
    benutzerId,
    videoId,
    Number.isFinite(position) ? position : 0,
    req.body?.erledigt === true,
  )

  res.json({ ok: true })
})

/**
 * Das Vorschaubild einer Kachel — bewusst OHNE Berechtigungsprüfung.
 *
 * Ein Einzelbild aus dem Video ist die Beschreibung des Inhalts, nicht der
 * Inhalt selbst: es soll auch an gesperrten Kacheln stehen, so wie Titel und
 * Laufzeit. Wer kein Vorschaubild hinterlegt hat, bekommt 404 — die Kachel
 * fällt dann auf ihren Farbverlauf zurück.
 */
portalRouter.get('/videos/:id/thumb', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    res.status(404).end()
    return
  }

  const pfad = join(THUMB_DIR, `${id}.jpg`)
  if (!existsSync(pfad)) {
    res.status(404).end()
    return
  }

  /*
   * Kurze Frist statt langer: ein neu erzeugtes Vorschaubild soll bald
   * sichtbar sein, ohne dass die Kacheln bei jedem Seitenaufruf erneut
   * geladen werden. Den Rest erledigt die ETag-Prüfung von sendFile.
   */
  res.setHeader('Cache-Control', 'public, max-age=300')
  res.sendFile(pfad)
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
