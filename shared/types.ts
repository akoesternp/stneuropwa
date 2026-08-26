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
export const BEREICHE = [
  'Augen',
  'Vestibulär',
  'Propriozeption',
  'Atmung',
  'Koordination',
  'Mobilität',
] as const
export type Bereich = (typeof BEREICHE)[number]

/** Aufsteigend — die Reihenfolge bestimmt auch die Anzeige der Filter. */
export const SCHWIERIGKEITEN = ['leicht', 'mittel', 'schwer'] as const
export type Schwierigkeit = (typeof SCHWIERIGKEITEN)[number]

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
   * Dateiname in VIDEO_DIR, '' = noch keine Datei verknüpft. Abgespielt wird
   * nie über diesen Namen, sondern über /api/portal/videos/:id/stream — der
   * Endpunkt prüft die Berechtigung und schlägt die Datei selbst nach.
   */
  datei: string
  sortierung: number
  aktiv: boolean
}

/**
 * Ein Paket mit seinem Inhaltsverzeichnis — die öffentliche Paketübersicht.
 *
 * Titel und Laufzeiten sind bewusst für alle sichtbar: sie sind die
 * Beschreibung dessen, was ein Paket enthält. Abspielbar ist ein Eintrag nur
 * mit `freigeschaltet`.
 */
export interface PaketInhalt extends Paket {
  videos: {
    id: number
    titel: string
    untertitel: string
    beschreibung: string
    dauer: string
    bereich: string
    schwierigkeit: string
    /** Darf der aktuelle Aufrufer dieses Video abspielen? */
    freigeschaltet: boolean
    /** Liegt überhaupt schon eine Videodatei vor? Der Name bleibt intern. */
    hatDatei: boolean
  }[]
  /** Summe der Laufzeiten, z. B. "1:24:10" — leer, wenn eine Dauer fehlt. */
  gesamtdauer: string
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
}
