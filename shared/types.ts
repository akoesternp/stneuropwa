/**
 * Gemeinsame Datentypen für Server und Oberfläche.
 *
 * Das sind die Formen, in denen die API antwortet — nicht die Tabellen selbst.
 * Passwörter tauchen hier bewusst nirgends auf: sie verlassen den Server nie,
 * auch nicht gehasht.
 */

/**
 * Trainingsbereiche der Neuroathletik. Feste Liste statt Freitext, damit sich
 * danach filtern lässt — bei Freitext stünden nach einem halben Jahr
 * „Vestibulär", „vestibulaer" und „Gleichgewicht" nebeneinander.
 *
 * Erweitern ist unkritisch: unbekannte Werte in der Datenbank behandelt der
 * Server wie „nicht gesetzt".
 */
/** Ein Trainingsbereich, im Backend pflegbar. */
export interface Bereich {
  id: number
  name: string
  sortierung: number
}

/** Nur noch die Erstbefüllung — gepflegt wird die Liste danach im Backend. */
export const STANDARD_BEREICHE = [
  'Augen',
  'Vestibulär',
  'Propriozeption',
  'Atmung',
  'Koordination',
  'Mobilität',
] as const

/** Aufsteigend — die Reihenfolge bestimmt auch die Anzeige der Filter. */
export const SCHWIERIGKEITEN = ['leicht', 'mittel', 'schwer'] as const
export type Schwierigkeit = (typeof SCHWIERIGKEITEN)[number]

/* ── Credits ───────────────────────────────────────────────────────────── */

/** Eine einzelne Übung kostet einen Credit. */
export const CREDITS_JE_VIDEO = 1

/** Im Paket ist dieselbe Übung günstiger — 25 % Nachlass auf den Einzelpreis. */
export const PAKET_RABATT = 0.75

/**
 * Was ein Paket kostet: Anzahl der Übungen mal Einzelpreis, davon 75 %.
 *
 * Steht hier statt im Server, damit die Oberfläche denselben Preis nennt, den
 * der Server abbucht — eine Kachel, die 5 verspricht und 6 kostet, wäre
 * schlimmer als gar keine Angabe.
 *
 * Gerundet wird kaufmännisch, mindestens aber auf 1: ein Paket mit Inhalt darf
 * nie umsonst sein. Gezählt werden alle aktiven Übungen des Pakets, auch
 * bereits einzeln freigeschaltete — der Paketpreis hängt am Paket, nicht am
 * Stand des Käufers.
 */
export function paketPreis(anzahlVideos: number): number {
  if (anzahlVideos <= 0) return 0
  return Math.max(1, Math.round(anzahlVideos * CREDITS_JE_VIDEO * PAKET_RABATT))
}

/* ── Credits kaufen ────────────────────────────────────────────────────── */

/**
 * Was ein einzelner Credit kostet, in Cent.
 *
 * Alles in Cent und ganzzahlig: Preise als Fließkommazahl führen früher oder
 * später zu 19,999999 auf einer Rechnung.
 */
export const CREDIT_BASISPREIS_CENT = 200

/** Eine Stufe der Rabattstaffel. */
export interface CreditPaket {
  /**
   * Stabile Kennung. Der Client schickt beim Kauf NUR sie — nie einen Preis
   * und nie eine Menge, sonst könnte man sich beides selbst aussuchen.
   */
  id: string
  /** Name der Stufe für die Oberfläche. */
  name: string
  credits: number
  preisCent: number
}

/**
 * Die Rabattstaffel: je mehr auf einmal, desto günstiger der einzelne Credit.
 *
 * Bewusst eine feste Liste statt einer Formel — so lässt sich jede Stufe
 * einzeln ansetzen, ohne dass eine Kurve die Preise bestimmt. Zum Ändern
 * genügt es, hier Zahlen zu tauschen; Oberfläche und Server ziehen nach.
 */
export const CREDIT_PAKETE: readonly CreditPaket[] = [
  { id: 'start', name: 'Zum Ausprobieren', credits: 5, preisCent: 1000 },
  { id: 'klein', name: 'Kleines Paket', credits: 15, preisCent: 2700 },
  { id: 'gross', name: 'Großes Paket', credits: 40, preisCent: 6400 },
  { id: 'jahr', name: 'Jahresvorrat', credits: 100, preisCent: 14000 },
] as const

export function creditPaket(id: string): CreditPaket | undefined {
  return CREDIT_PAKETE.find((stufe) => stufe.id === id)
}

/** Preis eines einzelnen Credits in dieser Stufe, in Cent (kann krumm sein). */
export function preisJeCreditCent(paket: CreditPaket): number {
  return paket.preisCent / paket.credits
}

/**
 * Ersparnis gegenüber dem Basispreis, in ganzen Prozent. 0 = kein Nachlass.
 */
export function rabattProzent(paket: CreditPaket): number {
  const voll = paket.credits * CREDIT_BASISPREIS_CENT
  if (voll <= 0) return 0
  return Math.max(0, Math.round((1 - paket.preisCent / voll) * 100))
}

/**
 * Eine Zielgruppe bündelt Pakete UND einzelne Videos — die oberste Ebene der
 * Gliederung.
 *
 * Sie steuert bewusst KEINE Berechtigung: sichtbar bleibt, was öffentlich ist,
 * in einem zugewiesenen Paket liegt oder einzeln freigeschaltet wurde. Die
 * Zielgruppe sagt nur, für wen etwas gedacht ist.
 */
export interface Zielgruppe {
  id: number
  name: string
  beschreibung: string
  sortierung: number
  aktiv: boolean
}

/** Eine Zielgruppe aus Sicht der Verwaltung — samt Inhalt, in Reihenfolge. */
export interface ZielgruppeEintrag extends Zielgruppe {
  paketIds: number[]
  videoIds: number[]
}

/** Ein Paket bündelt Videos; Nutzern werden Pakete zugewiesen. */
export interface Paket {
  id: number
  name: string
  beschreibung: string
  sortierung: number
  aktiv: boolean
}

/**
 * Eine Video-Kachel.
 *
 * Paketzugehörigkeit und Öffentlichkeit sind unabhängig voneinander: ein
 * Video kann in mehreren Paketen liegen, zugleich öffentlich sein, oder
 * beides nicht — dann sieht es nur, wem es einzeln freigeschaltet wurde.
 */
export interface Video {
  id: number
  titel: string
  untertitel: string
  /**
   * Kurzer beschreibender Text. Steht auch bei gesperrten Videos in der
   * Paketübersicht — er sagt, worum es geht, ohne etwas preiszugeben.
   */
  beschreibung: string
  /** Anzeigetext, z. B. "12:30". Beim Verknüpfen aus der Datei ausgelesen. */
  dauer: string
  /** Pakete, in denen dieses Video liegt. */
  paketIds: number[]
  /** Ohne Anmeldung sichtbar — unabhängig von den Paketen. */
  oeffentlich: boolean
  /** Trainingsbereich, '' wenn nicht gesetzt. */
  bereich: string
  /** 'leicht' | 'mittel' | 'schwer', '' wenn nicht gesetzt. */
  schwierigkeit: string
  /** Benötigte Hilfsmittel als Freitext, z. B. "Brille, Ball". */
  hilfsmittel: string
  /** Paketnamen zum Anzeigen auf der Kachel, vom Server aufgelöst. */
  paketNamen: string[]
  /**
   * Zielgruppen dieses Videos — direkt zugeordnet oder über eines seiner
   * Pakete. Vom Server aufgelöst, damit die Oberfläche danach filtern kann,
   * ohne die Zuordnungen selbst nachzubauen.
   */
  zielgruppenNamen: string[]
  /**
   * Dateiname in VIDEO_DIR, '' = noch keine Datei verknüpft. Abgespielt wird
   * nie über diesen Namen, sondern über /api/portal/videos/:id/stream — der
   * Endpunkt prüft die Berechtigung und schlägt die Datei selbst nach.
   */
  datei: string
  sortierung: number
  aktiv: boolean
}

/**
 * Eine Übung, wie sie der Katalog des Portals zeigt.
 *
 * Enthält bewusst ALLES, was angeboten wird — auch was dieser Aufrufer noch
 * nicht abspielen darf: wer nichts freigeschaltet hat, soll trotzdem finden,
 * was es gibt. Der Dateiname fehlt (nur `hatDatei`), und abspielbar macht die
 * Auskunft nichts: das entscheidet weiterhin der Stream-Endpunkt.
 */
export interface KatalogVideo {
  id: number
  titel: string
  untertitel: string
  beschreibung: string
  dauer: string
  bereich: string
  schwierigkeit: string
  hilfsmittel: string
  oeffentlich: boolean
  /** Reihenfolge im Bestand — bestimmt, was „die nächste Übung" ist. */
  sortierung: number
  paketIds: number[]
  paketNamen: string[]
  zielgruppenNamen: string[]
  /** Darf der Aufrufer diese Übung abspielen? */
  freigeschaltet: boolean
  /** Liegt überhaupt eine Videodatei vor? Der Name bleibt intern. */
  hatDatei: boolean
}

/** Ein Paket aus Sicht der Verwaltung — samt der zugeordneten Videos. */
export interface PaketEintrag extends Paket {
  videoIds: number[]
}

/**
 * Ein Paket mit seinem Inhaltsverzeichnis — die öffentliche Paketübersicht.
 *
 * Titel und Laufzeiten sind bewusst für alle sichtbar: sie sind die
 * Beschreibung dessen, was ein Paket enthält. Abspielbar ist ein Eintrag nur
 * mit `freigeschaltet`.
 */
export interface PaketInhalt extends Paket {
  /** Zielgruppen, in denen dieses Paket steckt — für die Gliederung im Portal. */
  zielgruppenNamen: string[]
  videos: {
    id: number
    titel: string
    untertitel: string
    beschreibung: string
    dauer: string
    bereich: string
    schwierigkeit: string
    hilfsmittel: string
    /** Darf der aktuelle Aufrufer dieses Video abspielen? */
    freigeschaltet: boolean
    /** Liegt überhaupt schon eine Videodatei vor? Der Name bleibt intern. */
    hatDatei: boolean
  }[]
  /** Summe der Laufzeiten, z. B. "1:24:10" — leer, wenn eine Dauer fehlt. */
  gesamtdauer: string
  /** Preis in Credits für das ganze Paket — vom Server nach `paketPreis`. */
  kosten: number
}

/**
 * Wie weit ein Nutzer bei einer Übung ist.
 *
 * `position` ist der Stand in Sekunden, damit die Wiedergabe dort weitergeht,
 * wo sie unterbrochen wurde. `erledigt` setzt der Player am Ende selbst, lässt
 * sich aber auch von Hand umschalten — man macht eine Übung auch mal, ohne
 * das Video bis zum Schluss laufen zu lassen.
 */
export interface Fortschritt {
  videoId: number
  position: number
  erledigt: boolean
  /** Zeitstempel der letzten Änderung — bestimmt die Reihenfolge in „Weiterschauen". */
  aktualisiertAm: number
}

/** Ein angemeldeter Nutzer, wie ihn /api/auth/me liefert. */
export interface Benutzer {
  id: number
  email: string
  name: string
  /** Namen der zugewiesenen Pakete — bestimmt, welche Kacheln er sieht. */
  pakete: string[]
  /**
   * Guthaben in Credits, mit dem sich Übungen und Pakete selbst freischalten
   * lassen. Ein neues Konto startet bei 0.
   */
  credits: number
}

/** Ein Nutzer aus Sicht der Verwaltung (Backend). */
export interface BenutzerEintrag {
  id: number
  email: string
  name: string
  aktiv: boolean
  /** IDs der zugewiesenen Pakete. */
  paketIds: number[]
  /** IDs einzeln freigeschalteter Videos — zusätzlich zu den Paketen. */
  videoIds: number[]
  /** Guthaben in Credits. Im Backend frei setzbar. */
  credits: number
}
