import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { Router } from 'express'
import type { Response } from 'express'
import { creditPaket, KOMMENTAR_MAX_ZEICHEN } from '../../shared/types.js'
import type { Zahlweg } from '../../shared/types.js'
import {
  bestaetigeBestellung,
  darfVideoSehen,
  erzeugeBestellung,
  findeAktiveAktion,
  findeBestellung,
  kaufePaket,
  kaufeVideo,
  katalogVideos,
  kommentareZuVideo,
  listBereiche,
  listBestellungenFuer,
  listZielgruppen,
  leseFortschritt,
  loescheKommentar,
  loescheSterne,
  merkeAnbieterReferenz,
  paketInhalte,
  setzeSterne,
  speichereFortschritt,
  speichereKommentar,
  stehtImAngebot,
  storniereBestellung,
} from '../db.js'
import type { KaufErgebnis } from '../db.js'
import { ziehePaypalEin } from '../einzug.js'
import {
  erzeugePaypalVorgang,
  paypalAktiv,
  paypalClientId,
  paypalUmgebung,
} from '../paypal.js'
import { VORKASSE } from '../vorkasse.js'
import { START_CREDITS } from './auth.js'
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
 * Was ein neues Konto an Startguthaben bekäme.
 *
 * Öffentlich, denn genau davor steht die Frage: die Registrierungsseite soll
 * damit werben dürfen. Preisgegeben wird nur der Betrag und wie lange er noch
 * gilt — wie viele Plätze eine Aktion noch hat, ist Betriebsinterna.
 */
portalRouter.get('/startguthaben', async (_req, res) => {
  const aktion = await findeAktiveAktion(START_CREDITS)

  res.json({
    grundguthaben: START_CREDITS,
    aktion: aktion
      ? { name: aktion.name, credits: aktion.credits, endetAm: aktion.ende }
      : null,
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
    res.status(400).json({ error: 'Unbekanntes Neuro-Paket.' })
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

  const ergebnis = await ziehePaypalEin(bestellung)

  switch (ergebnis.status) {
    case 'gebucht':
      res.json({
        ok: true,
        gutgeschrieben: ergebnis.gutgeschrieben,
        credits: ergebnis.credits,
      })
      return
    case 'schon-gebucht':
      // Zweiter Aufruf derselben Zahlung — kein Fehler, nur nichts zu tun.
      res.json({ ok: true, schonGebucht: true, credits: null })
      return
    case 'noch-nicht':
      res.status(402).json({ error: 'Die Zahlung ist noch nicht abgeschlossen.' })
      return
    case 'kein-vorgang':
      res.status(409).json({ error: 'Zu dieser Bestellung gibt es keinen PayPal-Vorgang.' })
      return
    case 'betrag-weicht-ab':
      res.status(409).json({
        error:
          'Der gezahlte Betrag stimmt nicht mit der Bestellung überein. ' +
          'Bitte melden Sie sich bei uns.',
      })
      return
    case 'nicht-buchbar':
      res.status(409).json({ error: 'Diese Bestellung lässt sich nicht mehr buchen.' })
      return
    default:
      res.status(502).json({ error: 'Die Zahlung konnte nicht abgeschlossen werden.' })
  }
})

/**
 * Der Käufer meldet, dass die Überweisung raus ist.
 *
 * Das bucht nichts und beschleunigt nichts — es sagt dem Betreiber nur,
 * dass hier wirklich Geld unterwegs ist. Ohne diesen Schritt sähe jede
 * angezeigte Bankverbindung aus wie eine Bestellung, und in der
 * Arbeitsliste stünde vor allem, wer sich die Daten bloß angesehen hat.
 */
portalRouter.post('/bestellungen/:id/ueberwiesen', requireUser, async (req, res) => {
  const benutzerId = Number(req.session!.subject)
  const bestellung = await findeBestellung(Number(req.params.id), benutzerId)

  if (!bestellung || bestellung.zahlweg !== 'vorkasse') {
    res.status(404).json({ error: 'Bestellung nicht gefunden.' })
    return
  }

  const erledigt = await bestaetigeBestellung(bestellung.id, benutzerId)
  if (!erledigt) {
    // Schon bestätigt, schon bezahlt oder abgebrochen — in jedem Fall nichts zu tun.
    res.status(409).json({ error: 'Diese Bestellung wartet nicht mehr auf Ihre Bestätigung.' })
    return
  }

  console.log(`[Zahlung] ${bestellung.referenz}: Käufer meldet die Überweisung`)
  res.json({ ok: true })
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
        error: `Dafür brauchen Sie ${ergebnis.kosten} Neuro, Ihr Guthaben beträgt ${ergebnis.credits}.`,
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
 * Sterne und Kommentare unter einer Übung.
 *
 * Lesen bewusst ohne Anmeldung: der Katalog ist ohnehin öffentlich, und was
 * andere über eine Übung sagen, beschreibt das Angebot wie Titel und Laufzeit.
 * Geprüft wird nur, dass die Übung überhaupt im Angebot steht — sonst ließe
 * sich über diesen Endpunkt abklopfen, welche Entwürfe es gibt.
 */
portalRouter.get('/videos/:id/kommentare', async (req, res) => {
  const session = currentSession(req, 'user')
  const benutzerId = session ? Number(session.subject) : null
  const videoId = Number(req.params.id)

  if (!Number.isInteger(videoId) || !(await stehtImAngebot(videoId))) {
    res.status(404).json({ error: 'Übung nicht gefunden.' })
    return
  }

  res.json(await kommentareZuVideo(videoId, benutzerId))
})

/**
 * Die eigene Sternewertung setzen.
 *
 * Bewerten darf nur, wer die Übung auch abspielen darf — dieselbe Regel wie
 * fürs Abspielen, über dasselbe `darfVideoSehen`. Eine Note von jemandem, der
 * die Übung nie gesehen hat, wäre keine.
 *
 * `403` statt `404` ist hier richtig, anders als beim Stream: der Aufrufer ist
 * angemeldet, die Übung steht ohnehin im öffentlichen Katalog, und „für Sie
 * noch nicht freigeschaltet" ist die Auskunft, die er braucht.
 */
portalRouter.put('/videos/:id/sterne', requireUser, async (req, res) => {
  const benutzerId = Number(req.session!.subject)
  const videoId = Number(req.params.id)
  const sterne = Number(req.body?.sterne)

  if (!Number.isInteger(sterne) || sterne < 1 || sterne > 5) {
    res.status(400).json({ error: 'Bitte eine Wertung von 1 bis 5 Sternen angeben.' })
    return
  }
  if (!Number.isInteger(videoId) || !(await stehtImAngebot(videoId))) {
    res.status(404).json({ error: 'Übung nicht gefunden.' })
    return
  }
  if (!(await darfVideoSehen(videoId, benutzerId))) {
    res.status(403).json({ error: 'Bewerten können Sie nur, was für Sie freigeschaltet ist.' })
    return
  }

  await setzeSterne(benutzerId, videoId, sterne)
  res.json(await kommentareZuVideo(videoId, benutzerId))
})

portalRouter.delete('/videos/:id/sterne', requireUser, async (req, res) => {
  const benutzerId = Number(req.session!.subject)
  const videoId = Number(req.params.id)

  await loescheSterne(benutzerId, videoId)
  res.json(await kommentareZuVideo(videoId, benutzerId))
})

/**
 * Einen Beitrag schreiben — oder auf einen antworten.
 *
 * Ob er sofort erscheint, entscheidet der Server: der erste Beitrag eines
 * Kontos geht in die Prüfliste, danach ist der Weg frei. Die Antwort sagt mit
 * `sichtbar`, was gilt, damit die Oberfläche nicht raten muss.
 */
portalRouter.post('/videos/:id/kommentare', requireUser, async (req, res) => {
  const benutzerId = Number(req.session!.subject)
  const videoId = Number(req.params.id)
  const text = String(req.body?.text ?? '').trim().slice(0, KOMMENTAR_MAX_ZEICHEN)

  if (!text) {
    res.status(400).json({ error: 'Bitte schreiben Sie etwas.' })
    return
  }
  if (!Number.isInteger(videoId) || !(await stehtImAngebot(videoId))) {
    res.status(404).json({ error: 'Übung nicht gefunden.' })
    return
  }
  if (!(await darfVideoSehen(videoId, benutzerId))) {
    res.status(403).json({
      error: 'Schreiben können Sie nur unter Übungen, die für Sie freigeschaltet sind.',
    })
    return
  }

  const elternId = req.body?.elternId == null ? null : Number(req.body.elternId)
  const ergebnis = await speichereKommentar(benutzerId, videoId, text, elternId)

  if (ergebnis.status === 'eltern-unbekannt') {
    res.status(404).json({ error: 'Der Beitrag, auf den Sie antworten wollten, gibt es nicht mehr.' })
    return
  }

  res.status(201).json({ id: ergebnis.id, sichtbar: ergebnis.sichtbar })
})

/**
 * Einen eigenen Beitrag zurücknehmen. Fremde bleiben unantastbar.
 *
 * Geprüft und gelöscht wird sonst im Backend — hier schreiben Nutzer, dort
 * entscheidet der Betreiber.
 */
portalRouter.delete('/kommentare/:id', requireUser, async (req, res) => {
  const erledigt = await loescheKommentar(Number(req.params.id), Number(req.session!.subject))
  if (!erledigt) {
    res.status(404).json({ error: 'Beitrag nicht gefunden.' })
    return
  }
  res.json({ ok: true })
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
