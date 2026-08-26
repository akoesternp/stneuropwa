/**
 * Gemeinsame Datentypen für Server und Oberfläche.
 *
 * Das sind die Formen, in denen die API antwortet — nicht die Tabellen selbst.
 * Passwörter tauchen hier bewusst nirgends auf: sie verlassen den Server nie,
 * auch nicht gehasht.
 */

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
 * Ein Video kann in mehreren Paketen liegen — `paketIds` leer bedeutet
 * öffentlich: die Kachel sehen auch Besucher ohne Anmeldung.
 */
export interface Video {
  id: number
  titel: string
  untertitel: string
  /** Anzeigetext, z. B. "12:30". Beim Verknüpfen aus der Datei ausgelesen. */
  dauer: string
  /** Pakete, in denen dieses Video liegt. Leer = öffentlich. */
  paketIds: number[]
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
    dauer: string
    /** Darf der aktuelle Aufrufer dieses Video abspielen? */
    freigeschaltet: boolean
  }[]
  /** Summe der Laufzeiten, z. B. "1:24:10" — leer, wenn eine Dauer fehlt. */
  gesamtdauer: string
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
