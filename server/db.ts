import { randomBytes } from 'node:crypto'
import mariadb from 'mariadb'
import type { Pool, PoolConnection } from 'mariadb'
import {
  CREDITS_JE_VIDEO,
  paketPreis,
  paketPreisFuerNutzer,
  SCHWIERIGKEITEN,
  STANDARD_BEREICHE,
} from '../shared/types.js'
import type {
  Aktion,
  Bereich,
  BenutzerEintrag,
  Bestellung,
  BestellStatus,
  BestellungEintrag,
  Fortschritt,
  KatalogVideo,
  Kommentar,
  KommentarBereich,
  KommentarEintrag,
  KommentarStatus,
  Paket,
  PaketEintrag,
  Video,
  Zahlweg,
  Zielgruppe,
  ZielgruppeEintrag,
} from '../shared/types.js'

/**
 * MariaDB als Datenhaltung für alles, was das Portal besitzt und beschreibt:
 * Nutzer, Pakete, Videos (Kacheln), Backend-Zugänge, Sitzungen.
 *
 * Kein ORM — das Schema ist klein, und die Abfragen stehen lesbar dort, wo
 * sie gebraucht werden. Angelegt wird es beim Start über CREATE TABLE IF NOT
 * EXISTS; ein separates Schema-Skript, das aus dem Tritt geraten könnte,
 * gibt es bewusst nicht.
 */

const CONFIG = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_NAME ?? 'stneuro',
  user: process.env.DB_USER ?? 'stneuro',
  // Nur für die lokale Entwicklung ein Standard — im Betrieb kommt das
  // Passwort aus /etc/stneuro.env.
  password: process.env.DB_PASSWORD ?? 'stneuro',
}

/*
 * Der Pool entsteht erst bei der ersten Abfrage — Werkzeuge, die dieses Modul
 * nur mitladen, sollen nicht am offenen Pool hängenbleiben.
 */
let pool: Pool | null = null

function getPool(): Pool {
  pool ??= mariadb.createPool({
    ...CONFIG,
    connectionLimit: 5,
    // Zähler und Zeitstempel passen in number; BigInt bräuchte hier niemand.
    bigIntAsNumber: true,
  })
  return pool
}

/** Schema einmal je Prozess anlegen, bevor die erste Abfrage läuft. */
let ready: Promise<void> | null = null

function ensureReady(): Promise<void> {
  ready ??= createSchema().catch((cause: unknown) => {
    ready = null
    throw cause
  })
  return ready
}

/** Baut das Schema auf und prüft dabei zugleich, dass die Datenbank erreichbar ist. */
export async function initDb(log: (message: string) => void = console.log): Promise<void> {
  await ensureReady()
  log(`Datenbank: ${CONFIG.database} auf ${CONFIG.host}:${CONFIG.port}`)
}

async function createSchema(): Promise<void> {
  let conn: PoolConnection
  try {
    conn = await getPool().getConnection()
  } catch (cause) {
    throw new Error(
      `MariaDB nicht erreichbar (${CONFIG.user}@${CONFIG.host}:${CONFIG.port}/${CONFIG.database}). ` +
        'Läuft der Dienst? DB_HOST, DB_USER, DB_PASSWORD und DB_NAME prüfen.',
      { cause },
    )
  }

  try {
    await conn.query(
      `CREATE TABLE IF NOT EXISTS benutzer (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        email VARCHAR(255) NOT NULL,
        passwort VARCHAR(255) NOT NULL DEFAULT '',
        name VARCHAR(255) NOT NULL DEFAULT '',
        aktiv TINYINT(1) NOT NULL DEFAULT 1,
        angelegt_am BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        UNIQUE KEY uq_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    )

    /*
     * Guthaben in Credits. Nachträglich ergänzt, deshalb als eigene Prüfung:
     * CREATE TABLE IF NOT EXISTS rührt eine bestehende Tabelle nicht an.
     * DEFAULT 0 heißt, dass alle Altkonten mit leerem Konto starten — was
     * genau richtig ist, denn bezahlt hat dafür noch niemand.
     */
    const benutzerSpalten: { Field: string }[] = await conn.query(`SHOW COLUMNS FROM benutzer`)
    if (!benutzerSpalten.some((spalte) => spalte.Field === 'credits')) {
      await conn.query(`ALTER TABLE benutzer ADD COLUMN credits INT NOT NULL DEFAULT 0`)
    }

    /*
     * Woher das Startguthaben kam. Ohne diese beiden Spalten ließe sich später
     * nicht mehr beantworten, warum ein Konto mit Guthaben begonnen hat — die
     * Aktion kann bis dahin längst abgelaufen sein. `start_aktion_id` bleibt
     * NULL, wenn nur der Grundbetrag galt.
     */
    if (!benutzerSpalten.some((spalte) => spalte.Field === 'start_credits')) {
      await conn.query(`ALTER TABLE benutzer ADD COLUMN start_credits INT NOT NULL DEFAULT 0`)
    }
    if (!benutzerSpalten.some((spalte) => spalte.Field === 'start_aktion_id')) {
      await conn.query(
        `ALTER TABLE benutzer ADD COLUMN start_aktion_id INT UNSIGNED NULL DEFAULT NULL`,
      )
    }

    /*
     * Vertrauensmerker fürs Kommentieren. Der ERSTE Beitrag eines Nutzers geht
     * in die Prüfliste; gibt der Betreiber ihn frei, steht dieses Kennzeichen
     * auf 1 und alle weiteren Beiträge erscheinen sofort. Das hält
     * Wegwerfkonten draußen, ohne dass ein Gespräch bei jeder Antwort auf die
     * nächste Backend-Sitzung warten muss.
     */
    /*
     * Moderationsrecht am PORTALKONTO — bewusst getrennt vom Backend-Zugang.
     *
     * Wer im Portal moderiert, tut das dort, wo er den Zusammenhang sieht: als
     * angemeldeter Nutzer unter der Übung. Dafür die Backend-Sitzung zu
     * verlangen, hieße zwei Anmeldungen für eine Handlung — und es verwischte
     * die Trennung der beiden Rollen, die sonst überall gilt.
     */
    if (!benutzerSpalten.some((spalte) => spalte.Field === 'moderator')) {
      await conn.query(`ALTER TABLE benutzer ADD COLUMN moderator TINYINT(1) NOT NULL DEFAULT 0`)
    }

    if (!benutzerSpalten.some((spalte) => spalte.Field === 'kommentare_frei')) {
      await conn.query(
        `ALTER TABLE benutzer ADD COLUMN kommentare_frei TINYINT(1) NOT NULL DEFAULT 0`,
      )
    }

    await conn.query(
      `CREATE TABLE IF NOT EXISTS pakete (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        beschreibung TEXT NOT NULL,
        sortierung INT NOT NULL DEFAULT 0,
        aktiv TINYINT(1) NOT NULL DEFAULT 1,
        PRIMARY KEY (id),
        UNIQUE KEY uq_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    )

    /*
     * Die Kacheln. Die Paketzuordnung steht in video_pakete (n:m) — ein Video
     * ohne Eintrag dort ist öffentlich sichtbar, auch ohne Anmeldung.
     */
    await conn.query(
      `CREATE TABLE IF NOT EXISTS videos (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        titel VARCHAR(255) NOT NULL,
        untertitel VARCHAR(255) NOT NULL DEFAULT '',
        beschreibung TEXT NOT NULL,
        dauer VARCHAR(16) NOT NULL DEFAULT '',
        datei VARCHAR(255) NOT NULL DEFAULT '',
        oeffentlich TINYINT(1) NOT NULL DEFAULT 0,
        bereich VARCHAR(64) NOT NULL DEFAULT '',
        schwierigkeit VARCHAR(16) NOT NULL DEFAULT '',
        hilfsmittel VARCHAR(255) NOT NULL DEFAULT '',
        sortierung INT NOT NULL DEFAULT 0,
        aktiv TINYINT(1) NOT NULL DEFAULT 1,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    )

    /*
     * CREATE TABLE IF NOT EXISTS ergänzt keine Spalten in bestehenden
     * Installationen — Spalten, die eine neuere Fassung braucht, werden hier
     * nachgetragen. Ohne das fehlte `datei` überall dort still, wo die
     * Tabelle schon vor der Video-Anbindung existierte.
     */
    const spalten: { Field: string }[] = await conn.query(`SHOW COLUMNS FROM videos`)
    if (!spalten.some((spalte) => spalte.Field === 'datei')) {
      await conn.query(`ALTER TABLE videos ADD COLUMN datei VARCHAR(255) NOT NULL DEFAULT ''`)
    }
    if (!spalten.some((spalte) => spalte.Field === 'beschreibung')) {
      await conn.query(`ALTER TABLE videos ADD COLUMN beschreibung TEXT NOT NULL AFTER untertitel`)
    }
    // Merkmale der Übung — leer heißt schlicht „nicht gepflegt".
    for (const [name, typ] of [
      ['bereich', "VARCHAR(64) NOT NULL DEFAULT ''"],
      ['schwierigkeit', "VARCHAR(16) NOT NULL DEFAULT ''"],
      ['hilfsmittel', "VARCHAR(255) NOT NULL DEFAULT ''"],
    ] as const) {
      if (!spalten.some((spalte) => spalte.Field === name)) {
        await conn.query(`ALTER TABLE videos ADD COLUMN ${name} ${typ}`)
      }
    }

    /*
     * Zielgruppen — die oberste Ebene. Sie fassen Pakete und einzelne Videos
     * zusammen und dienen der Gliederung, nicht der Berechtigung.
     */
    await conn.query(
      `CREATE TABLE IF NOT EXISTS zielgruppen (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(128) NOT NULL,
        beschreibung TEXT NOT NULL,
        sortierung INT NOT NULL DEFAULT 0,
        aktiv TINYINT(1) NOT NULL DEFAULT 1,
        PRIMARY KEY (id),
        UNIQUE KEY uq_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    )

    await conn.query(
      `CREATE TABLE IF NOT EXISTS zielgruppe_pakete (
        zielgruppe_id INT UNSIGNED NOT NULL,
        paket_id INT UNSIGNED NOT NULL,
        sortierung INT NOT NULL DEFAULT 0,
        PRIMARY KEY (zielgruppe_id, paket_id),
        KEY ix_paket (paket_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    )

    /* Einzelne Videos ohne Umweg über ein Paket. */
    await conn.query(
      `CREATE TABLE IF NOT EXISTS zielgruppe_videos (
        zielgruppe_id INT UNSIGNED NOT NULL,
        video_id INT UNSIGNED NOT NULL,
        sortierung INT NOT NULL DEFAULT 0,
        PRIMARY KEY (zielgruppe_id, video_id),
        KEY ix_video (video_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    )

    /*
     * Die Trainingsbereiche. In videos.bereich steht der NAME, nicht eine ID:
     * das hält die Abfragen einfach, und das Umbenennen zieht der Server über
     * alle Videos nach (siehe saveBereich).
     */
    await conn.query(
      `CREATE TABLE IF NOT EXISTS bereiche (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(64) NOT NULL,
        sortierung INT NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        UNIQUE KEY uq_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    )

    /*
     * Ein Video kann in mehreren Paketen liegen; kein Eintrag = öffentlich.
     * Die Reihenfolge hängt an der Zuordnung, nicht am Video: dieselbe Übung
     * kann in zwei Paketen an unterschiedlicher Stelle stehen.
     */
    await conn.query(
      `CREATE TABLE IF NOT EXISTS video_pakete (
        video_id INT UNSIGNED NOT NULL,
        paket_id INT UNSIGNED NOT NULL,
        sortierung INT NOT NULL DEFAULT 0,
        PRIMARY KEY (video_id, paket_id),
        KEY ix_paket (paket_id, sortierung)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    )

    const vpSpalten: { Field: string }[] = await conn.query(`SHOW COLUMNS FROM video_pakete`)
    if (!vpSpalten.some((spalte) => spalte.Field === 'sortierung')) {
      await conn.query(`ALTER TABLE video_pakete ADD COLUMN sortierung INT NOT NULL DEFAULT 0`)
      // Bisher galt die Sortierung des Videos — die wird übernommen, damit
      // die gewohnte Reihenfolge nicht mit dem Update durcheinandergerät.
      await conn.query(
        `UPDATE video_pakete vp JOIN videos v ON v.id = vp.video_id
         SET vp.sortierung = v.sortierung`,
      )
    }

    /*
     * Umstellung von der einen paket_id auf die n:m-Tabelle. Die Spalte fällt
     * am Ende weg — ihre Abwesenheit ist zugleich die Merkung, dass die
     * Übernahme gelaufen ist. Ein zusätzliches Migrationsflag bräuchte eigene
     * Pflege und könnte gegenüber der Wirklichkeit aus dem Tritt geraten.
     */
    if (spalten.some((spalte) => spalte.Field === 'paket_id')) {
      await conn.query(
        `INSERT IGNORE INTO video_pakete (video_id, paket_id)
         SELECT id, paket_id FROM videos WHERE paket_id IS NOT NULL`,
      )
      await conn.query(`ALTER TABLE videos DROP COLUMN paket_id`)
    }

    /*
     * „Öffentlich" war früher gleichbedeutend mit „in keinem Paket". Jetzt ist
     * es ein eigener Schalter, damit ein Video zugleich öffentlich und Teil
     * eines Pakets sein kann. Beim Nachrüsten der Spalte wird der bisherige
     * Zustand übernommen, sonst verschwänden die freien Videos schlagartig.
     */
    if (!spalten.some((spalte) => spalte.Field === 'oeffentlich')) {
      await conn.query(
        `ALTER TABLE videos ADD COLUMN oeffentlich TINYINT(1) NOT NULL DEFAULT 0 AFTER datei`,
      )
      await conn.query(
        `UPDATE videos SET oeffentlich = 1
         WHERE id NOT IN (SELECT video_id FROM video_pakete)`,
      )
    }

    await conn.query(
      `CREATE TABLE IF NOT EXISTS benutzer_pakete (
        benutzer_id INT UNSIGNED NOT NULL,
        paket_id INT UNSIGNED NOT NULL,
        PRIMARY KEY (benutzer_id, paket_id),
        KEY ix_paket (paket_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    )

    /*
     * Einzelfreischaltungen: ein Video kann einem Nutzer auch ohne dessen
     * Pakete zugewiesen sein — zusätzlich, nie stattdessen.
     */
    await conn.query(
      `CREATE TABLE IF NOT EXISTS benutzer_videos (
        benutzer_id INT UNSIGNED NOT NULL,
        video_id INT UNSIGNED NOT NULL,
        PRIMARY KEY (benutzer_id, video_id),
        KEY ix_video (video_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    )

    /*
     * Fortschritt je Nutzer und Video. Bewusst kein FOREIGN KEY: die Zeilen
     * sind Beiwerk, und ein gelöschtes Video soll nicht am Fortschritt
     * scheitern — verwaiste Zeilen räumt deleteVideo mit weg.
     */
    /*
     * Bestellungen über Credits — für beide Zahlwege dieselbe Tabelle.
     *
     * Sie ist nicht nur Beleg, sondern die Sperre gegen Doppelbuchungen:
     * `status` wird beim Buchen mit einem bedingten UPDATE von 'offen' auf
     * 'bezahlt' gedreht, und nur wer diesen Übergang gewinnt, schreibt gut.
     * Bei PayPal kommt dieselbe Bestätigung durchaus mehrfach an.
     *
     * `anbieter_referenz` ist absichtlich NULL statt '' vorbelegt: ein
     * UNIQUE-Index lässt beliebig viele NULL zu, aber nur ein einziges leeres
     * Feld — mit '' ließe sich keine zweite Vorkasse-Bestellung anlegen.
     */
    await conn.query(
      `CREATE TABLE IF NOT EXISTS bestellungen (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        referenz VARCHAR(24) NOT NULL,
        benutzer_id INT UNSIGNED NOT NULL,
        paket_id VARCHAR(40) NOT NULL,
        credits INT NOT NULL,
        betrag_cent INT NOT NULL,
        zahlweg VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'offen',
        anbieter_referenz VARCHAR(64) NULL DEFAULT NULL,
        angelegt_am BIGINT NOT NULL DEFAULT 0,
        bezahlt_am BIGINT NULL DEFAULT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_referenz (referenz),
        UNIQUE KEY uq_anbieter (anbieter_referenz),
        KEY ix_benutzer (benutzer_id, angelegt_am),
        KEY ix_status (status, angelegt_am)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    )

    /*
     * Aktionszeiträume fürs Startguthaben.
     *
     * In der Datenbank statt in der Umgebung, weil ein Zeitraum ein Vorgang
     * ist und kein Betriebsparameter: er wird angelegt, läuft ab und soll
     * danach noch nachweisbar sein, ohne dass jemand den Dienst neu startet.
     *
     * `beginn` und `ende` in Millisekunden wie alle Zeitstempel hier; `ende`
     * gilt ausschließend — es ist der erste Moment, in dem die Aktion NICHT
     * mehr zieht. `max_einloesungen = 0` heißt unbegrenzt; `einloesungen` ist
     * dabei kein Bericht, sondern die Sperre: hochgezählt wird im bedingten
     * UPDATE derselben Transaktion, die das Konto anlegt. Eine Aktion ohne
     * Deckel wäre sonst ein offener Scheck für jeden, der den Link streut.
     */
    await conn.query(
      `CREATE TABLE IF NOT EXISTS aktionen (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(128) NOT NULL,
        credits INT NOT NULL DEFAULT 0,
        beginn BIGINT NOT NULL DEFAULT 0,
        ende BIGINT NOT NULL DEFAULT 0,
        aktiv TINYINT(1) NOT NULL DEFAULT 1,
        max_einloesungen INT NOT NULL DEFAULT 0,
        einloesungen INT NOT NULL DEFAULT 0,
        angelegt_am BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        KEY ix_fenster (aktiv, beginn, ende)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    )

    await conn.query(
      `CREATE TABLE IF NOT EXISTS fortschritt (
        benutzer_id INT UNSIGNED NOT NULL,
        video_id INT UNSIGNED NOT NULL,
        position INT NOT NULL DEFAULT 0,
        erledigt TINYINT(1) NOT NULL DEFAULT 0,
        aktualisiert_am BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (benutzer_id, video_id),
        KEY ix_zuletzt (benutzer_id, aktualisiert_am)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    )

    /*
     * Sternewertungen — eine je Nutzer und Übung.
     *
     * Der zusammengesetzte Primärschlüssel erzwingt das in der Datenbank statt
     * in der Anwendung: eine zweite Wertung ist technisch kein zweiter
     * Datensatz, sondern ein INSERT … ON DUPLICATE KEY UPDATE. Damit kann
     * niemand den Durchschnitt durch Mehrfachabgabe verschieben, und die Frage
     * nach einer Freigabe stellt sich gar nicht erst — eine nackte Zahl
     * enthält nichts, was zu moderieren wäre.
     */
    await conn.query(
      `CREATE TABLE IF NOT EXISTS video_sterne (
        video_id INT UNSIGNED NOT NULL,
        benutzer_id INT UNSIGNED NOT NULL,
        sterne TINYINT UNSIGNED NOT NULL,
        angelegt_am BIGINT NOT NULL DEFAULT 0,
        aktualisiert_am BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (video_id, benutzer_id),
        KEY ix_benutzer (benutzer_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    )

    /*
     * Kommentare unter den Übungen, mit Antworten eine Ebene tief.
     *
     * `eltern_id` NULL = eigener Beitrag, sonst Antwort darauf. Tiefer als eine
     * Ebene kann es nicht werden: der Server hängt eine Antwort auf eine
     * Antwort an deren Wurzel um, egal was der Client schickt.
     *
     * `benutzer_id` NULL = vom Betreiber geschrieben. Dessen Beiträge stehen
     * sofort auf 'freigegeben'.
     *
     * `anzeige_name` ist eine Momentaufnahme aus benutzer.name. Damit fasst der
     * öffentliche Lesepfad die Benutzertabelle gar nicht erst an — dort stehen
     * die E-Mail-Adressen, und was nie mitgelesen wird, kann auch nicht
     * versehentlich mit hinausgehen.
     *
     * 'abgelehnt' bleibt stehen statt zu verschwinden: die Entscheidung soll
     * nachvollziehbar und zurücknehmbar sein. Öffentlich ist ausschließlich
     * 'freigegeben'.
     *
     * Kein FOREIGN KEY, wie überall hier — aufgeräumt wird in deleteVideo und
     * deleteBenutzer.
     */
    await conn.query(
      `CREATE TABLE IF NOT EXISTS kommentare (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        video_id INT UNSIGNED NOT NULL,
        eltern_id INT UNSIGNED NULL DEFAULT NULL,
        benutzer_id INT UNSIGNED NULL DEFAULT NULL,
        anzeige_name VARCHAR(128) NOT NULL DEFAULT '',
        vom_team TINYINT(1) NOT NULL DEFAULT 0,
        text TEXT NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'offen',
        angelegt_am BIGINT NOT NULL DEFAULT 0,
        geprueft_am BIGINT NULL DEFAULT NULL,
        PRIMARY KEY (id),
        KEY ix_video (video_id, status, angelegt_am),
        KEY ix_status (status, angelegt_am),
        KEY ix_eltern (eltern_id),
        KEY ix_benutzer (benutzer_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    )

    /*
     * Nachträglich ergänzt: wer moderiert, schreibt jetzt als angemeldeter
     * Nutzer statt über den Backend-Zugang — deshalb braucht der Beitrag ein
     * eigenes Kennzeichen statt der bisherigen Ableitung aus „kein Verfasser".
     */
    const kommentarSpalten: { Field: string }[] = await conn.query(
      `SHOW COLUMNS FROM kommentare`,
    )
    if (!kommentarSpalten.some((spalte) => spalte.Field === 'vom_team')) {
      await conn.query(`ALTER TABLE kommentare ADD COLUMN vom_team TINYINT(1) NOT NULL DEFAULT 0`)
    }

    await conn.query(
      `CREATE TABLE IF NOT EXISTS admins (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        benutzer VARCHAR(128) NOT NULL,
        passwort VARCHAR(255) NOT NULL DEFAULT '',
        name VARCHAR(255) NOT NULL DEFAULT '',
        PRIMARY KEY (id),
        UNIQUE KEY uq_benutzer (benutzer)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    )

    await conn.query(
      `CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(64) NOT NULL,
        role VARCHAR(8) NOT NULL,
        subject VARCHAR(128) NOT NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    )
  } finally {
    conn.release()
  }
}

/* ── Nutzer ────────────────────────────────────────────────────────────── */

/** Interne Form mit Passwort-Hash — verlässt dieses Modul nur Richtung Anmeldung. */
export interface BenutzerRow {
  id: number
  email: string
  passwort: string
  name: string
  aktiv: boolean
  credits: number
  /** Darf Beiträge freigeben und als Betreiber schreiben. */
  moderator: boolean
}

function toBenutzerRow(row: Record<string, unknown>): BenutzerRow {
  return {
    id: Number(row.id),
    email: String(row.email),
    passwort: String(row.passwort ?? ''),
    name: String(row.name ?? ''),
    aktiv: Number(row.aktiv) === 1,
    credits: Number(row.credits) || 0,
    moderator: Number(row.moderator) === 1,
  }
}

export async function findBenutzerByEmail(email: string): Promise<BenutzerRow | null> {
  await ensureReady()
  const rows: Record<string, unknown>[] = await getPool().query(
    'SELECT id, email, passwort, name, aktiv, credits, moderator FROM benutzer WHERE email = ?',
    [email],
  )
  return rows[0] ? toBenutzerRow(rows[0]) : null
}

export async function findBenutzerById(id: number): Promise<BenutzerRow | null> {
  await ensureReady()
  const rows: Record<string, unknown>[] = await getPool().query(
    'SELECT id, email, passwort, name, aktiv, credits, moderator FROM benutzer WHERE id = ?',
    [id],
  )
  return rows[0] ? toBenutzerRow(rows[0]) : null
}

/** Namen der aktiven Pakete eines Nutzers — für /auth/me und die Kachel-Sicht. */
export async function paketNamenFuer(benutzerId: number): Promise<string[]> {
  await ensureReady()
  const rows: { name: string }[] = await getPool().query(
    `SELECT p.name FROM benutzer_pakete bp
     JOIN pakete p ON p.id = bp.paket_id AND p.aktiv = 1
     WHERE bp.benutzer_id = ? ORDER BY p.sortierung, p.name`,
    [benutzerId],
  )
  return rows.map((row) => String(row.name))
}

/** Alle Nutzer samt Paket- und Einzelvideo-Zuweisung — die Liste der Verwaltung. */
export async function listBenutzer(): Promise<BenutzerEintrag[]> {
  await ensureReady()
  const rows: Record<string, unknown>[] = await getPool().query(
    'SELECT id, email, name, aktiv, credits, moderator FROM benutzer ORDER BY email',
  )
  const pakete: { benutzer_id: number; paket_id: number }[] = await getPool().query(
    'SELECT benutzer_id, paket_id FROM benutzer_pakete',
  )
  const videos: { benutzer_id: number; video_id: number }[] = await getPool().query(
    'SELECT benutzer_id, video_id FROM benutzer_videos',
  )

  const paketeVon = new Map<number, number[]>()
  for (const z of pakete) {
    const liste = paketeVon.get(Number(z.benutzer_id)) ?? []
    liste.push(Number(z.paket_id))
    paketeVon.set(Number(z.benutzer_id), liste)
  }

  const videosVon = new Map<number, number[]>()
  for (const z of videos) {
    const liste = videosVon.get(Number(z.benutzer_id)) ?? []
    liste.push(Number(z.video_id))
    videosVon.set(Number(z.benutzer_id), liste)
  }

  return rows.map((row) => ({
    id: Number(row.id),
    email: String(row.email),
    name: String(row.name ?? ''),
    aktiv: Number(row.aktiv) === 1,
    credits: Number(row.credits) || 0,
    moderator: Number(row.moderator) === 1,
    paketIds: paketeVon.get(Number(row.id)) ?? [],
    videoIds: videosVon.get(Number(row.id)) ?? [],
  }))
}

export interface BenutzerSpeichern {
  email: string
  name: string
  aktiv: boolean
  /** Leer = bestehendes Passwort behalten (beim Anlegen Pflicht, prüft die Route). */
  passwortHash: string | null
  paketIds: number[]
  videoIds: number[]
  /** Guthaben in Credits — im Backend frei setzbar, nie negativ. */
  credits: number
  /** Moderationsrecht im Portal. */
  moderator: boolean
}

/**
 * Anlegen bzw. Ändern samt Paketzuweisung in EINER Transaktion — ein Nutzer
 * ohne seine Pakete wäre nur ein halber Datensatz.
 */
export async function saveBenutzer(id: number | null, daten: BenutzerSpeichern): Promise<number> {
  await ensureReady()
  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()

    let benutzerId: number
    if (id === null) {
      const result = await conn.query(
        `INSERT INTO benutzer (email, passwort, name, aktiv, credits, moderator, angelegt_am)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          daten.email,
          daten.passwortHash ?? '',
          daten.name,
          daten.aktiv ? 1 : 0,
          daten.credits,
          daten.moderator ? 1 : 0,
          Date.now(),
        ],
      )
      benutzerId = Number(result.insertId)
    } else {
      benutzerId = id
      await conn.query(
        `UPDATE benutzer SET email = ?, name = ?, aktiv = ?, credits = ?, moderator = ?
         ${daten.passwortHash ? ', passwort = ?' : ''} WHERE id = ?`,
        daten.passwortHash
          ? [
              daten.email,
              daten.name,
              daten.aktiv ? 1 : 0,
              daten.credits,
              daten.moderator ? 1 : 0,
              daten.passwortHash,
              id,
            ]
          : [daten.email, daten.name, daten.aktiv ? 1 : 0, daten.credits, daten.moderator ? 1 : 0, id],
      )
    }

    await conn.query('DELETE FROM benutzer_pakete WHERE benutzer_id = ?', [benutzerId])
    if (daten.paketIds.length) {
      await conn.batch(
        'INSERT INTO benutzer_pakete (benutzer_id, paket_id) VALUES (?, ?)',
        daten.paketIds.map((paketId) => [benutzerId, paketId]),
      )
    }

    await conn.query('DELETE FROM benutzer_videos WHERE benutzer_id = ?', [benutzerId])
    if (daten.videoIds.length) {
      await conn.batch(
        'INSERT INTO benutzer_videos (benutzer_id, video_id) VALUES (?, ?)',
        daten.videoIds.map((videoId) => [benutzerId, videoId]),
      )
    }

    await conn.commit()
    return benutzerId
  } catch (cause) {
    await conn.rollback()
    throw cause
  } finally {
    conn.release()
  }
}

export interface Registrierung {
  id: number
  /** Was tatsächlich gutgeschrieben wurde. */
  credits: number
  /** Name der Aktion, die griff — leer, wenn nur der Grundbetrag galt. */
  aktion: string
}

/**
 * Legt ein Konto aus der Selbstregistrierung an — samt Startguthaben, in EINER
 * Transaktion.
 *
 * Eigener Weg neben `saveBenutzer`, weil hier andere Spalten geschrieben
 * werden: woher das Guthaben kam, hält nur die Registrierung fest; die
 * Verwaltung setzt Guthaben frei und braucht keine Herkunft.
 *
 * Über den Deckel einer Aktion entscheidet NICHT der vorher gelesene
 * Zählerstand, sondern das bedingte UPDATE — dasselbe Prinzip wie beim Buchen
 * einer Bestellung. Zwei Anmeldungen im selben Augenblick können ihn damit
 * nicht gemeinsam überschreiten; wer den Übergang verliert, bekommt den
 * Grundbetrag statt einer Fehlermeldung.
 */
export async function registriereBenutzer(daten: {
  email: string
  name: string
  passwortHash: string
  grundguthaben: number
}): Promise<Registrierung> {
  await ensureReady()
  const jetzt = Date.now()
  const conn = await getPool().getConnection()

  try {
    await conn.beginTransaction()

    /*
     * Die laufende Aktion mit dem höchsten Betrag. `credits > grundguthaben`
     * erspart jede Sonderbehandlung: was gefunden wird, zahlt immer mehr.
     * FOR UPDATE sperrt genau die Zeile, an der alle gleichzeitigen
     * Registrierungen hängen.
     */
    const aktionen: Record<string, unknown>[] = await conn.query(
      `SELECT id, name, credits FROM aktionen
        WHERE aktiv = 1 AND beginn <= ? AND ? < ende AND credits > ?
          AND (max_einloesungen = 0 OR einloesungen < max_einloesungen)
        ORDER BY credits DESC, id DESC
        LIMIT 1
        FOR UPDATE`,
      [jetzt, jetzt, daten.grundguthaben],
    )

    let credits = daten.grundguthaben
    let aktionId: number | null = null
    let aktionName = ''

    const treffer = aktionen[0]
    if (treffer) {
      const gedreht = await conn.query(
        `UPDATE aktionen SET einloesungen = einloesungen + 1
          WHERE id = ? AND aktiv = 1 AND beginn <= ? AND ? < ende
            AND (max_einloesungen = 0 OR einloesungen < max_einloesungen)`,
        [Number(treffer.id), jetzt, jetzt],
      )
      if (Number(gedreht.affectedRows) === 1) {
        credits = Number(treffer.credits) || 0
        aktionId = Number(treffer.id)
        aktionName = String(treffer.name)
      }
    }

    const ergebnis = await conn.query(
      `INSERT INTO benutzer
         (email, passwort, name, aktiv, credits, start_credits, start_aktion_id, angelegt_am)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
      [daten.email, daten.passwortHash, daten.name, credits, credits, aktionId, jetzt],
    )

    await conn.commit()
    return { id: Number(ergebnis.insertId), credits, aktion: aktionName }
  } catch (cause) {
    await conn.rollback()
    throw cause
  } finally {
    conn.release()
  }
}

export async function deleteBenutzer(id: number): Promise<void> {
  await ensureReady()
  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM benutzer_pakete WHERE benutzer_id = ?', [id])
    await conn.query('DELETE FROM benutzer_videos WHERE benutzer_id = ?', [id])
    await conn.query('DELETE FROM fortschritt WHERE benutzer_id = ?', [id])
    /*
     * Wer sein Konto verliert, kann eine veröffentlichte Äußerung nicht mehr
     * zurücknehmen — sie stehenzulassen hieße, Text über eine Person zu
     * veröffentlichen, die es hier nicht mehr gibt.
     */
    await conn.query('DELETE FROM video_sterne WHERE benutzer_id = ?', [id])
    await conn.query('DELETE FROM kommentare WHERE benutzer_id = ?', [id])
    await conn.query('DELETE FROM benutzer WHERE id = ?', [id])
    await conn.commit()
  } catch (cause) {
    await conn.rollback()
    throw cause
  } finally {
    conn.release()
  }
}

/* ── Pakete ────────────────────────────────────────────────────────────── */

function toPaket(row: Record<string, unknown>): Paket {
  return {
    id: Number(row.id),
    name: String(row.name),
    beschreibung: String(row.beschreibung ?? ''),
    sortierung: Number(row.sortierung) || 0,
    aktiv: Number(row.aktiv) === 1,
  }
}

export async function listPakete(): Promise<Paket[]> {
  await ensureReady()
  const rows: Record<string, unknown>[] = await getPool().query(
    'SELECT id, name, beschreibung, sortierung, aktiv FROM pakete ORDER BY sortierung, name',
  )
  return rows.map(toPaket)
}

/** Die Pakete mit ihren Videos — die Liste der Verwaltung. */
export async function listPaketeMitVideos(): Promise<PaketEintrag[]> {
  await ensureReady()
  const pakete = await listPakete()
  if (!pakete.length) return []

  const zuordnungen: { video_id: number; paket_id: number }[] = await getPool().query(
    'SELECT video_id, paket_id FROM video_pakete ORDER BY sortierung, video_id',
  )

  const nachPaket = new Map<number, number[]>()
  for (const zuordnung of zuordnungen) {
    const liste = nachPaket.get(Number(zuordnung.paket_id)) ?? []
    liste.push(Number(zuordnung.video_id))
    nachPaket.set(Number(zuordnung.paket_id), liste)
  }

  return pakete.map((paket) => ({ ...paket, videoIds: nachPaket.get(paket.id) ?? [] }))
}

/**
 * Anlegen bzw. Ändern, auf Wunsch samt Videozuordnung.
 *
 * `videoIds` null bedeutet „unangetastet lassen" — nicht „keine Videos".
 * Ohne diese Unterscheidung risse ein Speichern aus einer Maske, die die
 * Zuordnung gar nicht anzeigt, den ganzen Paketinhalt weg.
 */
export async function savePaket(
  id: number | null,
  daten: Omit<Paket, 'id'>,
  videoIds: number[] | null = null,
): Promise<number> {
  await ensureReady()
  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()

    let paketId: number
    if (id === null) {
      const result = await conn.query(
        'INSERT INTO pakete (name, beschreibung, sortierung, aktiv) VALUES (?, ?, ?, ?)',
        [daten.name, daten.beschreibung, daten.sortierung, daten.aktiv ? 1 : 0],
      )
      paketId = Number(result.insertId)
    } else {
      paketId = id
      await conn.query(
        'UPDATE pakete SET name = ?, beschreibung = ?, sortierung = ?, aktiv = ? WHERE id = ?',
        [daten.name, daten.beschreibung, daten.sortierung, daten.aktiv ? 1 : 0, id],
      )
    }

    if (videoIds !== null) {
      await conn.query('DELETE FROM video_pakete WHERE paket_id = ?', [paketId])
      if (videoIds.length) {
        // Die Stelle in der Liste IST die Reihenfolge im Paket.
        await conn.batch(
          'INSERT INTO video_pakete (video_id, paket_id, sortierung) VALUES (?, ?, ?)',
          videoIds.map((videoId, stelle) => [videoId, paketId, stelle + 1]),
        )
      }
    }

    await conn.commit()
    return paketId
  } catch (cause) {
    await conn.rollback()
    throw cause
  } finally {
    conn.release()
  }
}

/**
 * Löschen nur, wenn nichts mehr daran hängt. Videos stillschweigend mit zu
 * löschen oder Zuweisungen verschwinden zu lassen, wäre Datenverlust auf einen
 * Klick — die Route macht daraus eine verständliche Fehlermeldung.
 */
export async function deletePaket(id: number): Promise<'ok' | 'videos' | 'benutzer'> {
  await ensureReady()
  const [videos]: { anzahl: number }[] = await getPool().query(
    'SELECT COUNT(*) anzahl FROM video_pakete WHERE paket_id = ?',
    [id],
  )
  if (Number(videos?.anzahl)) return 'videos'

  const [nutzer]: { anzahl: number }[] = await getPool().query(
    'SELECT COUNT(*) anzahl FROM benutzer_pakete WHERE paket_id = ?',
    [id],
  )
  if (Number(nutzer?.anzahl)) return 'benutzer'

  await getPool().query('DELETE FROM zielgruppe_pakete WHERE paket_id = ?', [id])
  await getPool().query('DELETE FROM pakete WHERE id = ?', [id])
  return 'ok'
}

/* ── Videos ────────────────────────────────────────────────────────────── */

const VIDEO_SPALTEN =
  `v.id, v.titel, v.untertitel, v.beschreibung, v.dauer, v.datei, v.oeffentlich,
   v.bereich, v.schwierigkeit, v.hilfsmittel, v.sortierung, v.aktiv`

/**
 * Die Sichtbarkeitsregel für einen angemeldeten Nutzer: öffentlich (in keinem
 * Paket), über ein zugewiesenes aktives Paket, oder einzeln freigeschaltet.
 *
 * Steckt in einer Konstanten, damit Kachel-Liste, Paketübersicht und
 * Stream-Endpunkt garantiert dieselbe Regel anwenden — zwei Fassungen
 * derselben Frage laufen früher oder später auseinander, und hier hinge an
 * der Abweichung, wer fremde Inhalte sieht.
 *
 * Erwartet zweimal die Benutzer-ID als Parameter.
 */
const SICHTBAR_FUER_NUTZER = `(
  v.oeffentlich = 1
  OR EXISTS (
    SELECT 1 FROM video_pakete vp
    JOIN pakete p ON p.id = vp.paket_id AND p.aktiv = 1
    WHERE vp.video_id = v.id
      AND vp.paket_id IN (SELECT paket_id FROM benutzer_pakete WHERE benutzer_id = ?)
  )
  OR EXISTS (SELECT 1 FROM benutzer_videos bv WHERE bv.video_id = v.id AND bv.benutzer_id = ?)
)`

/** Ohne Anmeldung: nur, was ausdrücklich öffentlich gestellt ist. */
const OEFFENTLICH = `v.oeffentlich = 1`

/**
 * Hängt Pakete und Zielgruppen an eine Liste von Übungen.
 *
 * Bewusst eigene Abfragen statt GROUP_CONCAT: das Zusammenkleben und
 * Wiederzerlegen einer Zeichenkette scheitert stillschweigend an einem
 * Paketnamen mit Komma.
 *
 * Verträgt beide Formen — die Verwaltungsform mit Dateinamen und die des
 * Katalogs ohne —, damit die Regel nicht zweimal existiert.
 */
async function ergaenzeZuordnungen<
  T extends { id: number; paketIds: number[]; paketNamen: string[]; zielgruppenNamen: string[] },
>(eintraege: T[]): Promise<T[]> {
  if (!eintraege.length) return eintraege

  const ids = eintraege.map((eintrag) => eintrag.id)
  const nachId = new Map(eintraege.map((eintrag) => [eintrag.id, eintrag]))

  const zuordnungen: Record<string, unknown>[] = await getPool().query(
    `SELECT vp.video_id, vp.paket_id, p.name
     FROM video_pakete vp JOIN pakete p ON p.id = vp.paket_id
     WHERE vp.video_id IN (?)
     ORDER BY p.sortierung, p.name`,
    [ids],
  )

  for (const zuordnung of zuordnungen) {
    const eintrag = nachId.get(Number(zuordnung.video_id))
    if (!eintrag) continue
    eintrag.paketIds.push(Number(zuordnung.paket_id))
    eintrag.paketNamen.push(String(zuordnung.name))
  }

  /*
   * Eine Übung gehört zu einer Zielgruppe, wenn sie ihr direkt zugeordnet ist
   * ODER in einem ihrer Pakete liegt. Beide Wege in einer Abfrage, damit die
   * Oberfläche die Regel nicht nachbauen muss.
   */
  const zielgruppen: Record<string, unknown>[] = await getPool().query(
    `SELECT zv.video_id, z.name, z.sortierung
       FROM zielgruppe_videos zv JOIN zielgruppen z ON z.id = zv.zielgruppe_id AND z.aktiv = 1
      WHERE zv.video_id IN (?)
      UNION
     SELECT vp.video_id, z.name, z.sortierung
       FROM video_pakete vp
       JOIN zielgruppe_pakete zp ON zp.paket_id = vp.paket_id
       JOIN zielgruppen z ON z.id = zp.zielgruppe_id AND z.aktiv = 1
      WHERE vp.video_id IN (?)
      ORDER BY sortierung, name`,
    [ids, ids],
  )

  for (const zuordnung of zielgruppen) {
    const eintrag = nachId.get(Number(zuordnung.video_id))
    if (!eintrag) continue
    const name = String(zuordnung.name)
    // UNION entfernt Dubletten je Zeile, nicht je Übung — eine Übung kann über
    // zwei Pakete in derselben Zielgruppe landen.
    if (!eintrag.zielgruppenNamen.includes(name)) eintrag.zielgruppenNamen.push(name)
  }

  return eintraege
}

/** Die Verwaltungsform: mit Dateinamen, Sortierung und Aktiv-Kennzeichen. */
async function mitPaketen(rows: Record<string, unknown>[]): Promise<Video[]> {
  const videos: Video[] = rows.map((row) => ({
    zielgruppenNamen: [],
    id: Number(row.id),
    titel: String(row.titel),
    untertitel: String(row.untertitel ?? ''),
    beschreibung: String(row.beschreibung ?? ''),
    dauer: String(row.dauer ?? ''),
    paketIds: [],
    paketNamen: [],
    datei: String(row.datei ?? ''),
    oeffentlich: Number(row.oeffentlich) === 1,
    bereich: String(row.bereich ?? ''),
    schwierigkeit: SCHWIERIGKEITEN.includes(String(row.schwierigkeit ?? '') as never)
      ? String(row.schwierigkeit)
      : '',
    hilfsmittel: String(row.hilfsmittel ?? ''),
    sortierung: Number(row.sortierung) || 0,
    aktiv: Number(row.aktiv) === 1,
  }))

  return ergaenzeZuordnungen(videos)
}

/**
 * Der Katalog des Portals: ALLES, was angeboten wird — auch was dieser
 * Aufrufer noch nicht abspielen darf.
 *
 * Wer nichts freigeschaltet hat, soll trotzdem finden, was es gibt; sonst
 * wäre die Suche für genau die Nutzer nutzlos, die etwas suchen. Preisgegeben
 * wird dabei nichts, was die Paketübersicht nicht ohnehin zeigt: Titel,
 * Beschreibung, Laufzeit und Merkmale. Der Dateiname bleibt drin, abspielbar
 * macht die Auskunft nichts — das entscheidet der Stream-Endpunkt.
 *
 * Nicht im Katalog stehen Übungen ohne Paket und ohne Öffentlich-Schalter:
 * für die gibt es keinen Weg zur Freischaltung, sie sind Entwurf oder
 * Einzelfall. Wem eine davon zugeteilt wurde, sieht sie trotzdem.
 */
export async function katalogVideos(benutzerId: number | null): Promise<KatalogVideo[]> {
  await ensureReady()

  const imAngebot = `(
    v.oeffentlich = 1
    OR EXISTS (SELECT 1 FROM video_pakete vp WHERE vp.video_id = v.id)
  )`

  const spalten = `v.id, v.titel, v.untertitel, v.beschreibung, v.dauer, v.datei,
                   v.oeffentlich, v.sortierung, v.bereich, v.schwierigkeit, v.hilfsmittel`

  const rows: Record<string, unknown>[] =
    benutzerId === null
      ? await getPool().query(
          `SELECT ${spalten}, ${OEFFENTLICH} AS freigeschaltet FROM videos v
           WHERE v.aktiv = 1 AND ${imAngebot} ORDER BY v.sortierung, v.id`,
        )
      : await getPool().query(
          `SELECT ${spalten}, ${SICHTBAR_FUER_NUTZER} AS freigeschaltet FROM videos v
           WHERE v.aktiv = 1 AND (${imAngebot} OR ${SICHTBAR_FUER_NUTZER})
           ORDER BY v.sortierung, v.id`,
          [benutzerId, benutzerId, benutzerId, benutzerId],
        )

  const videos: KatalogVideo[] = rows.map((row) => ({
    id: Number(row.id),
    titel: String(row.titel),
    untertitel: String(row.untertitel ?? ''),
    beschreibung: String(row.beschreibung ?? ''),
    dauer: String(row.dauer ?? ''),
    bereich: String(row.bereich ?? ''),
    schwierigkeit: SCHWIERIGKEITEN.includes(String(row.schwierigkeit ?? '') as never)
      ? String(row.schwierigkeit)
      : '',
    hilfsmittel: String(row.hilfsmittel ?? ''),
    oeffentlich: Number(row.oeffentlich) === 1,
    sortierung: Number(row.sortierung ?? 0),
    paketIds: [],
    paketNamen: [],
    zielgruppenNamen: [],
    freigeschaltet: Number(row.freigeschaltet) === 1,
    // Nur ob eine Datei hinterlegt ist — der Name bleibt intern.
    hatDatei: String(row.datei ?? '') !== '',
    sterneSchnitt: 0,
    sterneAnzahl: 0,
  }))

  return ergaenzeSterne(await ergaenzeZuordnungen(videos))
}

/** Alle Videos, auch inaktive — die Liste der Verwaltung. */
export async function listVideos(): Promise<Video[]> {
  await ensureReady()
  const rows: Record<string, unknown>[] = await getPool().query(
    `SELECT ${VIDEO_SPALTEN} FROM videos v ORDER BY v.sortierung, v.id`,
  )
  return mitPaketen(rows)
}

/**
 * Die Kacheln, die ein Aufrufer sehen darf: öffentliche für alle, dazu die
 * Videos der zugewiesenen aktiven Pakete und die einzeln freigeschalteten
 * des angemeldeten Nutzers.
 *
 * Entschieden wird hier, nicht in der Oberfläche — was der Browser nie
 * bekommt, kann er auch nicht anzeigen.
 */
export async function sichtbareVideos(benutzerId: number | null): Promise<Video[]> {
  await ensureReady()

  const rows: Record<string, unknown>[] =
    benutzerId === null
      ? await getPool().query(
          `SELECT ${VIDEO_SPALTEN} FROM videos v
           WHERE v.aktiv = 1 AND ${OEFFENTLICH} ORDER BY v.sortierung, v.id`,
        )
      : await getPool().query(
          `SELECT ${VIDEO_SPALTEN} FROM videos v
           WHERE v.aktiv = 1 AND ${SICHTBAR_FUER_NUTZER} ORDER BY v.sortierung, v.id`,
          [benutzerId, benutzerId],
        )

  return mitPaketen(rows)
}

/**
 * Darf dieser Aufrufer dieses eine Video sehen? Liefert das Video (samt
 * Dateinamen) oder null — dieselbe Regel wie in der Kachel-Liste, nur für
 * eine einzelne ID. Der Stream-Endpunkt hängt an genau dieser Funktion.
 */
export async function darfVideoSehen(
  videoId: number,
  benutzerId: number | null,
): Promise<Video | null> {
  await ensureReady()

  const rows: Record<string, unknown>[] =
    benutzerId === null
      ? await getPool().query(
          `SELECT ${VIDEO_SPALTEN} FROM videos v WHERE v.id = ? AND v.aktiv = 1 AND ${OEFFENTLICH}`,
          [videoId],
        )
      : await getPool().query(
          `SELECT ${VIDEO_SPALTEN} FROM videos v
           WHERE v.id = ? AND v.aktiv = 1 AND ${SICHTBAR_FUER_NUTZER}`,
          [videoId, benutzerId, benutzerId],
        )

  return rows[0] ? (await mitPaketen(rows))[0]! : null
}

/** Eingabe für saveVideo — `paketIds` null lässt die Zuordnung unangetastet. */
export interface VideoSpeichern
  extends Omit<Video, 'id' | 'paketNamen' | 'paketIds' | 'zielgruppenNamen'> {
  paketIds: number[] | null
}

/**
 * Anlegen bzw. Ändern in EINER Transaktion — ein Video, dessen Zuordnung nur
 * halb geschrieben wurde, wäre entweder unsichtbar oder für die Falschen
 * sichtbar.
 *
 * Die Paketzuordnung wird seit der Umstellung von der Paketmaske aus gepflegt.
 * `paketIds` null heißt deshalb „nicht anfassen": sonst löschte jedes
 * Speichern aus der Videomaske die dort gar nicht mehr angezeigte Zuordnung.
 */
export async function saveVideo(
  id: number | null,
  daten: VideoSpeichern,
): Promise<number> {
  await ensureReady()
  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()

    let videoId: number
    if (id === null) {
      const result = await conn.query(
        `INSERT INTO videos (titel, untertitel, beschreibung, dauer, datei, oeffentlich,
                             bereich, schwierigkeit, hilfsmittel, sortierung, aktiv)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [daten.titel, daten.untertitel, daten.beschreibung, daten.dauer, daten.datei, daten.oeffentlich ? 1 : 0,
         daten.bereich, daten.schwierigkeit, daten.hilfsmittel, daten.sortierung, daten.aktiv ? 1 : 0],
      )
      videoId = Number(result.insertId)
    } else {
      videoId = id
      await conn.query(
        `UPDATE videos SET titel = ?, untertitel = ?, beschreibung = ?, dauer = ?, datei = ?,
           oeffentlich = ?, bereich = ?, schwierigkeit = ?, hilfsmittel = ?, sortierung = ?, aktiv = ?
         WHERE id = ?`,
        [daten.titel, daten.untertitel, daten.beschreibung, daten.dauer, daten.datei, daten.oeffentlich ? 1 : 0,
         daten.bereich, daten.schwierigkeit, daten.hilfsmittel, daten.sortierung, daten.aktiv ? 1 : 0, id],
      )
    }

    if (daten.paketIds !== null) {
      await conn.query('DELETE FROM video_pakete WHERE video_id = ?', [videoId])
      if (daten.paketIds.length) {
        /*
         * Ans Ende des jeweiligen Pakets. Die Reihenfolge innerhalb eines
         * Pakets wird in der Paketmaske gepflegt; von hier aus soll ein Video
         * einsortiert werden können, ohne die übrigen zu verschieben.
         */
        for (const paketId of daten.paketIds) {
          const [letzte]: { max: number | null }[] = await conn.query(
            'SELECT MAX(sortierung) max FROM video_pakete WHERE paket_id = ?',
            [paketId],
          )
          await conn.query(
            'INSERT INTO video_pakete (video_id, paket_id, sortierung) VALUES (?, ?, ?)',
            [videoId, paketId, (Number(letzte?.max) || 0) + 1],
          )
        }
      }
    }

    await conn.commit()
    return videoId
  } catch (cause) {
    await conn.rollback()
    throw cause
  } finally {
    conn.release()
  }
}

export async function deleteVideo(id: number): Promise<void> {
  await ensureReady()
  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM benutzer_videos WHERE video_id = ?', [id])
    await conn.query('DELETE FROM video_pakete WHERE video_id = ?', [id])
    await conn.query('DELETE FROM zielgruppe_videos WHERE video_id = ?', [id])
    await conn.query('DELETE FROM fortschritt WHERE video_id = ?', [id])
    /*
     * Ohne das bliebe eine verwaiste Wertung liegen und ginge in den
     * Durchschnitt einer später gleich nummerierten Übung ein — InnoDB setzt
     * AUTO_INCREMENT nach einem Neustart auf MAX(id)+1 zurück.
     */
    await conn.query('DELETE FROM video_sterne WHERE video_id = ?', [id])
    await conn.query('DELETE FROM kommentare WHERE video_id = ?', [id])
    await conn.query('DELETE FROM videos WHERE id = ?', [id])
    await conn.commit()
  } catch (cause) {
    await conn.rollback()
    throw cause
  } finally {
    conn.release()
  }
}

/**
 * Die öffentliche Paketübersicht: aktive Pakete mit ihrem
 * Inhaltsverzeichnis.
 *
 * Titel und Laufzeiten sind für alle sichtbar — sie sind die Beschreibung
 * dessen, was ein Paket enthält, und niemand kann daraus etwas abspielen.
 * `freigeschaltet` sagt je Eintrag, ob dieser Aufrufer ihn ansehen darf.
 */
export async function paketInhalte(benutzerId: number | null): Promise<
  (Paket & {
    zielgruppenNamen: string[]
    /** Listenpreis, unabhängig vom Betrachter. */
    kosten: number
    /** Was es diesem Aufrufer kostet — dieselbe Formel, die der Kauf abbucht. */
    kostenFuerSie: number
    videos: {
      id: number
      titel: string
      untertitel: string
      beschreibung: string
      dauer: string
      bereich: string
      schwierigkeit: string
      hilfsmittel: string
      freigeschaltet: boolean
      hatDatei: boolean
    }[]
  })[]
> {
  await ensureReady()

  const paketZeilen: Record<string, unknown>[] = await getPool().query(
    'SELECT id, name, beschreibung, sortierung, aktiv FROM pakete WHERE aktiv = 1 ORDER BY sortierung, name',
  )
  const pakete = paketZeilen.map(toPaket)

  if (!pakete.length) return []

  const zeilen: Record<string, unknown>[] = await getPool().query(
    `SELECT vp.paket_id, v.id, v.titel, v.untertitel, v.beschreibung, v.dauer, v.datei,
            v.bereich, v.schwierigkeit, v.hilfsmittel,
            ${benutzerId === null ? OEFFENTLICH : SICHTBAR_FUER_NUTZER} AS freigeschaltet
     FROM video_pakete vp
     JOIN videos v ON v.id = vp.video_id AND v.aktiv = 1
     WHERE vp.paket_id IN (?)
     ORDER BY vp.sortierung, v.sortierung, v.id`,
    benutzerId === null
      ? [pakete.map((paket) => paket.id)]
      : [benutzerId, benutzerId, pakete.map((paket) => paket.id)],
  )

  /*
   * Die Zielgruppen je Paket. Das Portal gliedert danach; ohne diese Angabe
   * müsste die Oberfläche die Zuordnung aus den Videos zurückrechnen — was
   * bei einem Paket ohne sichtbare Videos gar nicht ginge.
   */
  const zuZielgruppen: Record<string, unknown>[] = await getPool().query(
    `SELECT zp.paket_id, z.name
       FROM zielgruppe_pakete zp
       JOIN zielgruppen z ON z.id = zp.zielgruppe_id AND z.aktiv = 1
      WHERE zp.paket_id IN (?)
      ORDER BY z.sortierung, z.name`,
    [pakete.map((paket) => paket.id)],
  )

  const zielgruppenJePaket = new Map<number, string[]>()
  for (const zeile of zuZielgruppen) {
    const schluessel = Number(zeile.paket_id)
    const liste = zielgruppenJePaket.get(schluessel) ?? []
    liste.push(String(zeile.name))
    zielgruppenJePaket.set(schluessel, liste)
  }

  return pakete.map((paket) => {
    const eigene = zeilen.filter((zeile) => Number(zeile.paket_id) === paket.id)
    const offen = eigene.filter((zeile) => Number(zeile.freigeschaltet) !== 1).length

    return {
    ...paket,
    zielgruppenNamen: zielgruppenJePaket.get(paket.id) ?? [],
    // `zeilen` enthält nur aktive Videos — inaktive kosten also nichts und
    // wären auch nicht abspielbar.
    kosten: paketPreis(eigene.length),
    /*
     * Für Gäste ist beides dasselbe: ohne Anmeldung heißt `freigeschaltet`
     * nur „öffentlich", und daraus einen persönlichen Nachlass zu machen
     * hieße, jedem Besucher einen Preis zu nennen, den es für ihn nicht gibt.
     */
    kostenFuerSie:
      benutzerId === null ? paketPreis(eigene.length) : paketPreisFuerNutzer(eigene.length, offen),
    videos: eigene
      .map((zeile) => ({
        id: Number(zeile.id),
        titel: String(zeile.titel),
        untertitel: String(zeile.untertitel ?? ''),
        beschreibung: String(zeile.beschreibung ?? ''),
        dauer: String(zeile.dauer ?? ''),
        bereich: String(zeile.bereich ?? ''),
        schwierigkeit: String(zeile.schwierigkeit ?? ''),
        hilfsmittel: String(zeile.hilfsmittel ?? ''),
        freigeschaltet: Number(zeile.freigeschaltet) === 1,
        // Nur ob eine Datei hinterlegt ist — der Dateiname bleibt intern.
        hatDatei: String(zeile.datei ?? '') !== '',
      })),
    }
  })
}

/* ── Credits ───────────────────────────────────────────────────────────── */

/**
 * Wie ein Kaufversuch ausgegangen ist.
 *
 * Bewusst kein bloßes true/false: die Oberfläche soll „reicht nicht" von „hast
 * du schon" unterscheiden können, und beides sind keine Fehler, sondern
 * Antworten.
 */
export type KaufErgebnis =
  | { status: 'ok'; kosten: number; credits: number }
  | { status: 'zu-wenig'; kosten: number; credits: number }
  | { status: 'schon-frei' }
  | { status: 'nicht-gefunden' }
  | { status: 'leer' }

/**
 * Schreibt Credits gut und liefert den neuen Stand — `null`, wenn es das
 * Konto nicht (mehr) gibt oder es gesperrt ist.
 *
 * Bewusst getrennt vom Bezahlvorgang: wer später einen Zahlungsanbieter
 * anbindet, ruft genau diese Funktion auf, sobald der Eingang bestätigt ist.
 * Die Buchung selbst bleibt dieselbe.
 */
export async function gutschreibeCredits(
  benutzerId: number,
  menge: number,
): Promise<number | null> {
  await ensureReady()
  if (!Number.isInteger(menge) || menge <= 0) return null

  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()

    const konten: Record<string, unknown>[] = await conn.query(
      'SELECT credits FROM benutzer WHERE id = ? AND aktiv = 1 FOR UPDATE',
      [benutzerId],
    )
    if (!konten[0]) {
      await conn.rollback()
      return null
    }

    await conn.query('UPDATE benutzer SET credits = credits + ? WHERE id = ?', [menge, benutzerId])
    await conn.commit()
    return (Number(konten[0].credits) || 0) + menge
  } catch (cause) {
    await conn.rollback()
    throw cause
  } finally {
    conn.release()
  }
}

/* ── Bestellungen ──────────────────────────────────────────────────────── */

function toBestellung(row: Record<string, unknown>): Bestellung {
  return {
    id: Number(row.id),
    referenz: String(row.referenz),
    paketId: String(row.paket_id),
    credits: Number(row.credits) || 0,
    betragCent: Number(row.betrag_cent) || 0,
    zahlweg: String(row.zahlweg) as Zahlweg,
    status: String(row.status) as BestellStatus,
    angelegtAm: Number(row.angelegt_am) || 0,
    bezahltAm: row.bezahlt_am === null ? null : Number(row.bezahlt_am),
  }
}

/**
 * Der Verwendungszweck.
 *
 * Ohne 0/O/1/I/L — die Referenz wird von Hand aus einem Kontoauszug
 * abgetippt, und genau dort passieren Verwechslungen. Kurz genug, dass sie
 * niemand kürzt, lang genug, dass sie sich nicht erraten lässt.
 */
const REFERENZ_ZEICHEN = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function neueReferenz(): string {
  const bytes = randomBytes(8)
  let text = ''
  for (let stelle = 0; stelle < 8; stelle++) {
    text += REFERENZ_ZEICHEN[bytes[stelle]! % REFERENZ_ZEICHEN.length]
  }
  return `STN-${text.slice(0, 4)}-${text.slice(4)}`
}

/**
 * Legt eine offene Bestellung an. Gebucht wird hier nichts.
 *
 * Menge und Betrag werden mitgeschrieben statt später nachgeschlagen: eine
 * Preisänderung darf nicht rückwirkend gelten für jemanden, der schon
 * überwiesen hat.
 */
export async function erzeugeBestellung(
  benutzerId: number,
  paket: { id: string; credits: number; preisCent: number },
  zahlweg: Zahlweg,
): Promise<Bestellung> {
  await ensureReady()

  // Ein Zusammenstoß ist bei 31^8 Möglichkeiten unwahrscheinlich, aber der
  // UNIQUE-Index entscheidet das, nicht die Wahrscheinlichkeit.
  for (let versuch = 0; versuch < 5; versuch++) {
    const referenz = neueReferenz()
    try {
      const ergebnis = await getPool().query(
        `INSERT INTO bestellungen
           (referenz, benutzer_id, paket_id, credits, betrag_cent, zahlweg, status, angelegt_am)
         VALUES (?, ?, ?, ?, ?, ?, 'offen', ?)`,
        [referenz, benutzerId, paket.id, paket.credits, paket.preisCent, zahlweg, Date.now()],
      )
      const rows: Record<string, unknown>[] = await getPool().query(
        'SELECT * FROM bestellungen WHERE id = ?',
        [Number(ergebnis.insertId)],
      )
      return toBestellung(rows[0]!)
    } catch (cause) {
      if (!istDuplikatFehler(cause) || versuch === 4) throw cause
    }
  }

  throw new Error('Keine freie Bestellreferenz gefunden.')
}

/** Duplikat auf einem UNIQUE-Index — MariaDB meldet 1062. */
function istDuplikatFehler(cause: unknown): boolean {
  return Boolean(cause) && (cause as { errno?: number }).errno === 1062
}

/** Hält die PayPal-Vorgangsnummer fest, sobald sie vorliegt. */
export async function merkeAnbieterReferenz(
  bestellungId: number,
  referenz: string,
): Promise<void> {
  await ensureReady()
  await getPool().query('UPDATE bestellungen SET anbieter_referenz = ? WHERE id = ?', [
    referenz,
    bestellungId,
  ])
}

export async function findeBestellung(
  bestellungId: number,
  benutzerId?: number,
): Promise<Bestellung | null> {
  await ensureReady()
  const rows: Record<string, unknown>[] = await getPool().query(
    benutzerId === undefined
      ? 'SELECT * FROM bestellungen WHERE id = ?'
      : 'SELECT * FROM bestellungen WHERE id = ? AND benutzer_id = ?',
    benutzerId === undefined ? [bestellungId] : [bestellungId, benutzerId],
  )
  return rows[0] ? toBestellung(rows[0]) : null
}

/**
 * Die PayPal-Vorgangsnummer einer Bestellung.
 *
 * Eigene Abfrage statt eines Felds in `Bestellung`: die Nummer ist eine
 * interne Verknüpfung und hat in dem, was die Oberfläche bekommt, nichts zu
 * suchen.
 */
export async function anbieterReferenzVon(bestellungId: number): Promise<string> {
  await ensureReady()
  const rows: Record<string, unknown>[] = await getPool().query(
    'SELECT anbieter_referenz FROM bestellungen WHERE id = ?',
    [bestellungId],
  )
  return String(rows[0]?.anbieter_referenz ?? '')
}

export async function listBestellungenFuer(benutzerId: number): Promise<Bestellung[]> {
  await ensureReady()
  const rows: Record<string, unknown>[] = await getPool().query(
    'SELECT * FROM bestellungen WHERE benutzer_id = ? ORDER BY angelegt_am DESC LIMIT 50',
    [benutzerId],
  )
  return rows.map(toBestellung)
}

/** Die Verwaltungsliste — offene zuerst, denn die verlangen eine Handlung. */
export async function listBestellungen(): Promise<BestellungEintrag[]> {
  await ensureReady()
  const rows: Record<string, unknown>[] = await getPool().query(
    `SELECT b.*, u.email, u.name
       FROM bestellungen b
       LEFT JOIN benutzer u ON u.id = b.benutzer_id
      ORDER BY b.status = 'offen' DESC, b.angelegt_am DESC
      LIMIT 300`,
  )
  return rows.map((row) => ({
    ...toBestellung(row),
    benutzerId: Number(row.benutzer_id),
    email: String(row.email ?? '—'),
    name: String(row.name ?? ''),
    anbieterReferenz: String(row.anbieter_referenz ?? ''),
  }))
}

export type BuchungsErgebnis =
  | { status: 'gebucht'; bestellung: Bestellung; credits: number }
  | { status: 'schon-gebucht'; bestellung: Bestellung }
  | { status: 'storniert'; bestellung: Bestellung }
  | { status: 'nicht-gefunden' }

/**
 * Bucht eine bezahlte Bestellung — GENAU einmal.
 *
 * Das Kernstück der ganzen Zahlungsanbindung. PayPal stellt Bestätigungen
 * mindestens einmal zu, oft mehrfach, und wiederholt sie bei Zeitüberschreitung;
 * bei Vorkasse kann ein Doppelklick im Backend dasselbe auslösen. Deshalb
 * entscheidet nicht ein vorher gelesener Zustand, sondern das bedingte UPDATE
 * selbst: nur wer den Übergang 'offen' → 'bezahlt' gewinnt, schreibt gut. Alle
 * weiteren Aufrufe sehen affectedRows = 0 und tun nichts.
 *
 * Gutschrift und Statuswechsel liegen in derselben Transaktion — sonst gäbe es
 * einen Moment, in dem das eine ohne das andere gilt.
 */
export async function bucheBestellung(bestellungId: number): Promise<BuchungsErgebnis> {
  await ensureReady()
  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()

    const vorher: Record<string, unknown>[] = await conn.query(
      'SELECT * FROM bestellungen WHERE id = ? FOR UPDATE',
      [bestellungId],
    )
    if (!vorher[0]) {
      await conn.rollback()
      return { status: 'nicht-gefunden' }
    }
    const bestellung = toBestellung(vorher[0])

    const gedreht = await conn.query(
      `UPDATE bestellungen SET status = 'bezahlt', bezahlt_am = ?
        WHERE id = ? AND status = 'offen'`,
      [Date.now(), bestellungId],
    )

    if (Number(gedreht.affectedRows) !== 1) {
      await conn.rollback()
      return bestellung.status === 'storniert'
        ? { status: 'storniert', bestellung }
        : { status: 'schon-gebucht', bestellung }
    }

    await conn.query('UPDATE benutzer SET credits = credits + ? WHERE id = ?', [
      bestellung.credits,
      Number(vorher[0].benutzer_id),
    ])
    const konten: Record<string, unknown>[] = await conn.query(
      'SELECT credits FROM benutzer WHERE id = ?',
      [Number(vorher[0].benutzer_id)],
    )

    await conn.commit()
    return {
      status: 'gebucht',
      bestellung: { ...bestellung, status: 'bezahlt', bezahltAm: Date.now() },
      credits: Number(konten[0]?.credits) || 0,
    }
  } catch (cause) {
    await conn.rollback()
    throw cause
  } finally {
    conn.release()
  }
}

/** Bricht eine offene Bestellung ab. Bezahlte bleiben unangetastet. */
export async function storniereBestellung(bestellungId: number): Promise<boolean> {
  await ensureReady()
  const ergebnis = await getPool().query(
    `UPDATE bestellungen SET status = 'storniert' WHERE id = ? AND status = 'offen'`,
    [bestellungId],
  )
  return Number(ergebnis.affectedRows) === 1
}

/**
 * Schaltet eine einzelne Übung gegen Credits frei.
 *
 * Alles in EINER Transaktion, und das Guthaben wird mit FOR UPDATE gesperrt:
 * zwei gleichzeitige Käufe desselben Kontos dürfen nicht beide gegen denselben
 * Stand prüfen und am Ende mehr ausgeben, als da war.
 *
 * Preis und Berechtigung kommen aus derselben Quelle wie überall sonst — was
 * ohnehin sichtbar ist (öffentlich, über ein Paket, bereits einzeln), kostet
 * nichts und wird abgelehnt statt abgebucht.
 */
export async function kaufeVideo(benutzerId: number, videoId: number): Promise<KaufErgebnis> {
  await ensureReady()
  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()

    const konten: Record<string, unknown>[] = await conn.query(
      'SELECT credits FROM benutzer WHERE id = ? AND aktiv = 1 FOR UPDATE',
      [benutzerId],
    )
    if (!konten[0]) {
      await conn.rollback()
      return { status: 'nicht-gefunden' }
    }
    const credits = Number(konten[0].credits) || 0

    /*
     * Nur was im Angebot steht: aktiv und in mindestens einem Paket. Eine
     * Übung ohne Paket und ohne Öffentlich-Schalter ist Entwurf — dafür
     * Credits zu nehmen wäre ein Fehlkauf.
     */
    const zeilen: Record<string, unknown>[] = await conn.query(
      `SELECT v.oeffentlich,
              EXISTS (SELECT 1 FROM video_pakete vp WHERE vp.video_id = v.id) AS imPaket,
              ${SICHTBAR_FUER_NUTZER} AS schonFrei
         FROM videos v
        WHERE v.id = ? AND v.aktiv = 1`,
      [benutzerId, benutzerId, videoId],
    )
    const video = zeilen[0]
    if (!video || (Number(video.oeffentlich) !== 1 && Number(video.imPaket) !== 1)) {
      await conn.rollback()
      return { status: 'nicht-gefunden' }
    }
    if (Number(video.schonFrei) === 1) {
      await conn.rollback()
      return { status: 'schon-frei' }
    }

    const kosten = CREDITS_JE_VIDEO
    if (credits < kosten) {
      await conn.rollback()
      return { status: 'zu-wenig', kosten, credits }
    }

    await conn.query('UPDATE benutzer SET credits = credits - ? WHERE id = ?', [kosten, benutzerId])
    await conn.query(
      'INSERT IGNORE INTO benutzer_videos (benutzer_id, video_id) VALUES (?, ?)',
      [benutzerId, videoId],
    )

    await conn.commit()
    return { status: 'ok', kosten, credits: credits - kosten }
  } catch (cause) {
    await conn.rollback()
    throw cause
  } finally {
    conn.release()
  }
}

/**
 * Schaltet ein ganzes Paket gegen Credits frei.
 *
 * Der Preis richtet sich nach der Zahl der aktiven Übungen im Paket, auch wenn
 * einzelne davon bereits freigeschaltet sind: der Paketpreis hängt am Paket,
 * nicht am Stand des Käufers. Gezahlt wird einmal — ein zweiter Kauf desselben
 * Pakets wird abgelehnt, nicht abgebucht.
 */
export async function kaufePaket(benutzerId: number, paketId: number): Promise<KaufErgebnis> {
  await ensureReady()
  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()

    const konten: Record<string, unknown>[] = await conn.query(
      'SELECT credits FROM benutzer WHERE id = ? AND aktiv = 1 FOR UPDATE',
      [benutzerId],
    )
    if (!konten[0]) {
      await conn.rollback()
      return { status: 'nicht-gefunden' }
    }
    const credits = Number(konten[0].credits) || 0

    const pakete: Record<string, unknown>[] = await conn.query(
      `SELECT p.id,
              EXISTS (SELECT 1 FROM benutzer_pakete bp
                       WHERE bp.paket_id = p.id AND bp.benutzer_id = ?) AS schonFrei,
              (SELECT COUNT(*) FROM video_pakete vp
                 JOIN videos v ON v.id = vp.video_id AND v.aktiv = 1
                WHERE vp.paket_id = p.id) AS anzahl,
              /*
               * Was dieser Nutzer noch NICHT hat — daran hängt der Preis.
               * Gezählt wird in derselben Transaktion, die oben schon das
               * Guthaben gesperrt hat: ein gleichzeitiger Einzelkauf desselben
               * Kontos wartet an genau dieser Sperre, die Zahl kann also
               * zwischen Zählen und Abbuchen nicht kippen.
               */
              (SELECT COUNT(*) FROM video_pakete vp
                 JOIN videos v ON v.id = vp.video_id AND v.aktiv = 1
                WHERE vp.paket_id = p.id AND NOT ${SICHTBAR_FUER_NUTZER}) AS offen
         FROM pakete p
        WHERE p.id = ? AND p.aktiv = 1`,
      [benutzerId, benutzerId, benutzerId, paketId],
    )
    const paket = pakete[0]
    if (!paket) {
      await conn.rollback()
      return { status: 'nicht-gefunden' }
    }
    if (Number(paket.schonFrei) === 1) {
      await conn.rollback()
      return { status: 'schon-frei' }
    }

    /*
     * `leer` hängt an der Gesamtzahl, nicht an den offenen: ein Paket ohne
     * Inhalt bleibt unverkäuflich, ein vollständig freigeschaltetes kostet
     * dagegen 1 und bleibt kaufbar — dort wird die Zugehörigkeit gekauft.
     */
    const kosten = paketPreisFuerNutzer(Number(paket.anzahl) || 0, Number(paket.offen) || 0)
    if (kosten <= 0) {
      await conn.rollback()
      return { status: 'leer' }
    }
    if (credits < kosten) {
      await conn.rollback()
      return { status: 'zu-wenig', kosten, credits }
    }

    await conn.query('UPDATE benutzer SET credits = credits - ? WHERE id = ?', [kosten, benutzerId])
    await conn.query(
      'INSERT IGNORE INTO benutzer_pakete (benutzer_id, paket_id) VALUES (?, ?)',
      [benutzerId, paketId],
    )

    await conn.commit()
    return { status: 'ok', kosten, credits: credits - kosten }
  } catch (cause) {
    await conn.rollback()
    throw cause
  } finally {
    conn.release()
  }
}

/* ── Aktionen ──────────────────────────────────────────────────────────── */

function toAktion(row: Record<string, unknown>): Aktion {
  return {
    id: Number(row.id),
    name: String(row.name),
    credits: Number(row.credits) || 0,
    beginn: Number(row.beginn) || 0,
    ende: Number(row.ende) || 0,
    aktiv: Number(row.aktiv) === 1,
    maxEinloesungen: Number(row.max_einloesungen) || 0,
    einloesungen: Number(row.einloesungen) || 0,
    angelegtAm: Number(row.angelegt_am) || 0,
  }
}

/** Alle Aktionen — laufende zuerst, denn nur die wirken gerade. */
export async function listAktionen(): Promise<Aktion[]> {
  await ensureReady()
  const jetzt = Date.now()
  const rows: Record<string, unknown>[] = await getPool().query(
    `SELECT * FROM aktionen
      ORDER BY (aktiv = 1 AND beginn <= ? AND ? < ende) DESC, beginn DESC`,
    [jetzt, jetzt],
  )
  return rows.map(toAktion)
}

/**
 * Die Aktion, die jetzt gilt und mehr gibt als der Grundbetrag — nur lesend.
 *
 * Bei mehreren gleichzeitig gewinnt der höchste Betrag; bei Gleichstand die
 * zuletzt angelegte. Die Registrierungsseite nennt vorab eine Zahl, und die
 * muss dieselbe sein, die anschließend gebucht wird — sonst wäre es ein
 * gebrochenes Versprechen an genau der Stelle, an der jemand ein Konto anlegt.
 */
export async function findeAktiveAktion(grundguthaben: number): Promise<Aktion | null> {
  await ensureReady()
  const jetzt = Date.now()
  const rows: Record<string, unknown>[] = await getPool().query(
    `SELECT * FROM aktionen
      WHERE aktiv = 1 AND beginn <= ? AND ? < ende AND credits > ?
        AND (max_einloesungen = 0 OR einloesungen < max_einloesungen)
      ORDER BY credits DESC, id DESC
      LIMIT 1`,
    [jetzt, jetzt, grundguthaben],
  )
  return rows[0] ? toAktion(rows[0]) : null
}

export interface AktionSpeichern {
  name: string
  credits: number
  beginn: number
  ende: number
  aktiv: boolean
  maxEinloesungen: number
}

export async function saveAktion(id: number | null, daten: AktionSpeichern): Promise<number> {
  await ensureReady()

  if (id === null) {
    const ergebnis = await getPool().query(
      `INSERT INTO aktionen
         (name, credits, beginn, ende, aktiv, max_einloesungen, angelegt_am)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        daten.name,
        daten.credits,
        daten.beginn,
        daten.ende,
        daten.aktiv ? 1 : 0,
        daten.maxEinloesungen,
        Date.now(),
      ],
    )
    return Number(ergebnis.insertId)
  }

  // `einloesungen` bleibt unangetastet — das ist ein Zähler, kein Formularfeld.
  await getPool().query(
    `UPDATE aktionen SET name = ?, credits = ?, beginn = ?, ende = ?, aktiv = ?,
            max_einloesungen = ?
      WHERE id = ?`,
    [
      daten.name,
      daten.credits,
      daten.beginn,
      daten.ende,
      daten.aktiv ? 1 : 0,
      daten.maxEinloesungen,
      id,
    ],
  )
  return id
}

/**
 * Löschen nur, solange nichts daran hängt.
 *
 * Sobald eine Aktion eingelöst wurde, ist sie der Beleg dafür, woher fremdes
 * Guthaben kam — den wegzuwerfen hieße, eine Buchung unerklärbar zu machen.
 * Der Weg für „soll nicht mehr gelten" heißt `aktiv = 0`.
 */
export async function deleteAktion(id: number): Promise<'ok' | 'nicht-gefunden' | 'in-benutzung'> {
  await ensureReady()

  const rows: Record<string, unknown>[] = await getPool().query(
    'SELECT einloesungen FROM aktionen WHERE id = ?',
    [id],
  )
  if (!rows[0]) return 'nicht-gefunden'
  if (Number(rows[0].einloesungen) > 0) return 'in-benutzung'

  const genutzt: Record<string, unknown>[] = await getPool().query(
    'SELECT 1 FROM benutzer WHERE start_aktion_id = ? LIMIT 1',
    [id],
  )
  if (genutzt[0]) return 'in-benutzung'

  await getPool().query('DELETE FROM aktionen WHERE id = ?', [id])
  return 'ok'
}

/* ── Zielgruppen ───────────────────────────────────────────────────────── */

function toZielgruppe(row: Record<string, unknown>): Zielgruppe {
  return {
    id: Number(row.id),
    name: String(row.name),
    beschreibung: String(row.beschreibung ?? ''),
    sortierung: Number(row.sortierung) || 0,
    aktiv: Number(row.aktiv) === 1,
  }
}

export async function listZielgruppen(nurAktive = false): Promise<Zielgruppe[]> {
  await ensureReady()
  const rows: Record<string, unknown>[] = await getPool().query(
    `SELECT id, name, beschreibung, sortierung, aktiv FROM zielgruppen
     ${nurAktive ? 'WHERE aktiv = 1' : ''} ORDER BY sortierung, name`,
  )
  return rows.map(toZielgruppe)
}

/** Die Zielgruppen samt Inhalt, jeweils in ihrer Reihenfolge. */
export async function listZielgruppenMitInhalt(): Promise<ZielgruppeEintrag[]> {
  await ensureReady()
  const zielgruppen = await listZielgruppen()
  if (!zielgruppen.length) return []

  const pakete: Record<string, unknown>[] = await getPool().query(
    'SELECT zielgruppe_id, paket_id FROM zielgruppe_pakete ORDER BY sortierung, paket_id',
  )
  const videos: Record<string, unknown>[] = await getPool().query(
    'SELECT zielgruppe_id, video_id FROM zielgruppe_videos ORDER BY sortierung, video_id',
  )

  const sammle = (zeilen: Record<string, unknown>[], feld: string) => {
    const karte = new Map<number, number[]>()
    for (const zeile of zeilen) {
      const schluessel = Number(zeile.zielgruppe_id)
      const liste = karte.get(schluessel) ?? []
      liste.push(Number(zeile[feld]))
      karte.set(schluessel, liste)
    }
    return karte
  }

  const nachPaket = sammle(pakete, 'paket_id')
  const nachVideo = sammle(videos, 'video_id')

  return zielgruppen.map((zielgruppe) => ({
    ...zielgruppe,
    paketIds: nachPaket.get(zielgruppe.id) ?? [],
    videoIds: nachVideo.get(zielgruppe.id) ?? [],
  }))
}

/**
 * Anlegen bzw. Ändern samt Inhalt. Wie bei den Paketen bedeutet null
 * „unangetastet lassen" — nicht „nichts enthalten".
 */
export async function saveZielgruppe(
  id: number | null,
  daten: Omit<Zielgruppe, 'id'>,
  paketIds: number[] | null = null,
  videoIds: number[] | null = null,
): Promise<number> {
  await ensureReady()
  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()

    let zielgruppeId: number
    if (id === null) {
      const ergebnis = await conn.query(
        'INSERT INTO zielgruppen (name, beschreibung, sortierung, aktiv) VALUES (?, ?, ?, ?)',
        [daten.name, daten.beschreibung, daten.sortierung, daten.aktiv ? 1 : 0],
      )
      zielgruppeId = Number(ergebnis.insertId)
    } else {
      zielgruppeId = id
      await conn.query(
        'UPDATE zielgruppen SET name = ?, beschreibung = ?, sortierung = ?, aktiv = ? WHERE id = ?',
        [daten.name, daten.beschreibung, daten.sortierung, daten.aktiv ? 1 : 0, id],
      )
    }

    if (paketIds !== null) {
      await conn.query('DELETE FROM zielgruppe_pakete WHERE zielgruppe_id = ?', [zielgruppeId])
      if (paketIds.length) {
        await conn.batch(
          'INSERT INTO zielgruppe_pakete (zielgruppe_id, paket_id, sortierung) VALUES (?, ?, ?)',
          paketIds.map((paketId, stelle) => [zielgruppeId, paketId, stelle + 1]),
        )
      }
    }

    if (videoIds !== null) {
      await conn.query('DELETE FROM zielgruppe_videos WHERE zielgruppe_id = ?', [zielgruppeId])
      if (videoIds.length) {
        await conn.batch(
          'INSERT INTO zielgruppe_videos (zielgruppe_id, video_id, sortierung) VALUES (?, ?, ?)',
          videoIds.map((videoId, stelle) => [zielgruppeId, videoId, stelle + 1]),
        )
      }
    }

    await conn.commit()
    return zielgruppeId
  } catch (cause) {
    await conn.rollback()
    throw cause
  } finally {
    conn.release()
  }
}

/**
 * Löschen samt Zuordnungen. Anders als bei Paketen ist das unbedenklich: eine
 * Zielgruppe ist reine Gliederung, an ihr hängt keine Berechtigung — Pakete
 * und Videos bleiben unberührt.
 */
export async function deleteZielgruppe(id: number): Promise<void> {
  await ensureReady()
  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM zielgruppe_pakete WHERE zielgruppe_id = ?', [id])
    await conn.query('DELETE FROM zielgruppe_videos WHERE zielgruppe_id = ?', [id])
    await conn.query('DELETE FROM zielgruppen WHERE id = ?', [id])
    await conn.commit()
  } catch (cause) {
    await conn.rollback()
    throw cause
  } finally {
    conn.release()
  }
}

/* ── Bereiche ──────────────────────────────────────────────────────────── */

export async function listBereiche(): Promise<Bereich[]> {
  await ensureReady()
  const rows: Record<string, unknown>[] = await getPool().query(
    'SELECT id, name, sortierung FROM bereiche ORDER BY sortierung, name',
  )
  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    sortierung: Number(row.sortierung) || 0,
  }))
}

/** Legt die mitgelieferten Bereiche an, solange noch keine gepflegt sind. */
export async function seedBereiche(): Promise<boolean> {
  await ensureReady()
  if ((await listBereiche()).length) return false

  await getPool().batch(
    'INSERT INTO bereiche (name, sortierung) VALUES (?, ?)',
    STANDARD_BEREICHE.map((name, stelle) => [name, stelle + 1]),
  )
  return true
}

/**
 * Anlegen oder Umbenennen. Beim Umbenennen ziehen die Videos mit — in
 * videos.bereich steht der Name, und ohne diesen Durchgriff verlören alle
 * betroffenen Videos ihre Zuordnung stillschweigend.
 */
export async function saveBereich(
  id: number | null,
  name: string,
  sortierung: number,
): Promise<number> {
  await ensureReady()
  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()

    if (id === null) {
      const ergebnis = await conn.query(
        'INSERT INTO bereiche (name, sortierung) VALUES (?, ?)',
        [name, sortierung],
      )
      await conn.commit()
      return Number(ergebnis.insertId)
    }

    const [alt]: { name: string }[] = await conn.query(
      'SELECT name FROM bereiche WHERE id = ?',
      [id],
    )
    await conn.query('UPDATE bereiche SET name = ?, sortierung = ? WHERE id = ?', [
      name,
      sortierung,
      id,
    ])
    if (alt && alt.name !== name) {
      await conn.query('UPDATE videos SET bereich = ? WHERE bereich = ?', [name, alt.name])
    }

    await conn.commit()
    return id
  } catch (cause) {
    await conn.rollback()
    throw cause
  } finally {
    conn.release()
  }
}

/** Löschen nur, solange kein Video daran hängt — sonst wäre es stiller Datenverlust. */
export async function deleteBereich(id: number): Promise<'ok' | 'nicht-gefunden' | 'in-benutzung'> {
  await ensureReady()
  const [treffer]: { name: string }[] = await getPool().query(
    'SELECT name FROM bereiche WHERE id = ?',
    [id],
  )
  if (!treffer) return 'nicht-gefunden'

  const [benutzt]: { anzahl: number }[] = await getPool().query(
    'SELECT COUNT(*) anzahl FROM videos WHERE bereich = ?',
    [treffer.name],
  )
  if (Number(benutzt?.anzahl)) return 'in-benutzung'

  await getPool().query('DELETE FROM bereiche WHERE id = ?', [id])
  return 'ok'
}

/* ── Fortschritt ───────────────────────────────────────────────────────── */

/** Der ganze Stand eines Nutzers — klein genug, um ihn am Stück zu laden. */
export async function leseFortschritt(benutzerId: number): Promise<Fortschritt[]> {
  await ensureReady()
  const rows: Record<string, unknown>[] = await getPool().query(
    `SELECT video_id, position, erledigt, aktualisiert_am
     FROM fortschritt WHERE benutzer_id = ? ORDER BY aktualisiert_am DESC`,
    [benutzerId],
  )

  return rows.map((row) => ({
    videoId: Number(row.video_id),
    position: Number(row.position) || 0,
    erledigt: Number(row.erledigt) === 1,
    aktualisiertAm: Number(row.aktualisiert_am) || 0,
  }))
}

/**
 * Schreibt den Stand einer Übung. Der Player meldet sich im Takt von ein paar
 * Sekunden — deshalb ein einzelnes Upsert statt eines Lese-Schreib-Umwegs.
 */
export async function speichereFortschritt(
  benutzerId: number,
  videoId: number,
  position: number,
  erledigt: boolean,
): Promise<void> {
  await ensureReady()
  await getPool().query(
    `INSERT INTO fortschritt (benutzer_id, video_id, position, erledigt, aktualisiert_am)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       position = VALUES(position),
       erledigt = VALUES(erledigt),
       aktualisiert_am = VALUES(aktualisiert_am)`,
    [benutzerId, videoId, Math.max(0, Math.round(position)), erledigt ? 1 : 0, Date.now()],
  )
}

/* ── Sterne und Kommentare ─────────────────────────────────────────────── */

/**
 * „Anna Musterfrau" → „Anna M."
 *
 * Der Nachname geht niemanden etwas an, der Vorname macht einen Beitrag aber
 * erst zu dem einer Person. Ohne hinterlegten Namen bleibt es beim Platzhalter.
 */
function anzeigeName(name: string): string {
  const teile = name.trim().split(/\s+/).filter(Boolean)
  if (!teile.length) return 'Nutzer/in'
  if (teile.length === 1) return teile[0]!.slice(0, 40)
  return `${teile[0]!.slice(0, 40)} ${teile[teile.length - 1]![0]!.toUpperCase()}.`
}

/**
 * Steht diese Übung überhaupt im Angebot?
 *
 * Dieselbe Bedingung wie im Katalog: aktiv und öffentlich oder in einem Paket.
 * Gebraucht dort, wo etwas öffentlich lesbar ist — sonst ließe sich über einen
 * Leseendpunkt abklopfen, welche Entwürfe es gibt.
 */
export async function stehtImAngebot(videoId: number): Promise<boolean> {
  await ensureReady()
  const zeilen: Record<string, unknown>[] = await getPool().query(
    `SELECT 1 FROM videos v
      WHERE v.id = ? AND v.aktiv = 1
        AND (v.oeffentlich = 1 OR EXISTS (SELECT 1 FROM video_pakete vp WHERE vp.video_id = v.id))
      LIMIT 1`,
    [videoId],
  )
  return Boolean(zeilen[0])
}

/**
 * Hängt Sterne-Durchschnitt und -Anzahl an eine ganze Liste von Übungen.
 *
 * EINE Abfrage für alles, nicht eine je Kachel: bei 350 Übungen wäre das der
 * Unterschied zwischen drei und 353 Rundreisen je Seitenaufruf. Nach dem
 * Vorbild von `ergaenzeZuordnungen`.
 */
async function ergaenzeSterne<
  T extends { id: number; sterneSchnitt: number; sterneAnzahl: number },
>(eintraege: T[]): Promise<T[]> {
  if (!eintraege.length) return eintraege

  const zeilen: Record<string, unknown>[] = await getPool().query(
    `SELECT video_id, AVG(sterne) AS schnitt, COUNT(*) AS anzahl
       FROM video_sterne
      WHERE video_id IN (?)
      GROUP BY video_id`,
    [eintraege.map((eintrag) => eintrag.id)],
  )

  const nachId = new Map(eintraege.map((eintrag) => [eintrag.id, eintrag]))
  for (const zeile of zeilen) {
    const eintrag = nachId.get(Number(zeile.video_id))
    if (!eintrag) continue
    // Auf eine Nachkommastelle: „4,3" ist eine Aussage, „4,33333" ein Artefakt.
    eintrag.sterneSchnitt = Math.round(Number(zeile.schnitt) * 10) / 10
    eintrag.sterneAnzahl = Number(zeile.anzahl) || 0
  }

  return eintraege
}

/**
 * Setzt die Sternewertung eines Nutzers — oder ersetzt seine bisherige.
 *
 * Über ON DUPLICATE KEY, nicht über „erst suchen, dann schreiben": der
 * Primärschlüssel entscheidet, ob es ein neuer Eintrag ist, und damit gibt es
 * kein Fenster, in dem zwei gleichzeitige Wertungen zwei Zeilen erzeugen.
 */
export async function setzeSterne(
  benutzerId: number,
  videoId: number,
  sterne: number,
): Promise<void> {
  await ensureReady()
  const jetzt = Date.now()
  await getPool().query(
    `INSERT INTO video_sterne (video_id, benutzer_id, sterne, angelegt_am, aktualisiert_am)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE sterne = VALUES(sterne), aktualisiert_am = VALUES(aktualisiert_am)`,
    [videoId, benutzerId, sterne, jetzt, jetzt],
  )
}

export async function loescheSterne(benutzerId: number, videoId: number): Promise<void> {
  await ensureReady()
  await getPool().query('DELETE FROM video_sterne WHERE video_id = ? AND benutzer_id = ?', [
    videoId,
    benutzerId,
  ])
}

function toKommentar(row: Record<string, unknown>): Kommentar {
  return {
    id: Number(row.id),
    elternId: row.eltern_id === null ? null : Number(row.eltern_id),
    name: String(row.anzeige_name ?? ''),
    // Aus der Spalte, nicht aus dem Fehlen eines Verfassers: wem das Recht
    // später entzogen wird, dessen alte Beiträge bleiben, was sie waren.
    vomTeam: Number(row.vom_team) === 1 || row.benutzer_id === null,
    text: String(row.text ?? ''),
    angelegtAm: Number(row.angelegt_am) || 0,
    status: String(row.status) as KommentarStatus,
  }
}

/**
 * Was unter einer Übung steht: Sterne und die sichtbaren Beiträge.
 *
 * Für Angemeldete kommen die EIGENEN noch offenen Beiträge mit — sonst
 * schriebe jemand ein zweites Mal, weil er seinen ersten nicht sieht. Fremde
 * offene Beiträge bleiben unsichtbar.
 */
export async function kommentareZuVideo(
  videoId: number,
  benutzerId: number | null,
  alsModerator = false,
): Promise<KommentarBereich> {
  await ensureReady()

  const sterne: Record<string, unknown>[] = await getPool().query(
    'SELECT AVG(sterne) AS schnitt, COUNT(*) AS anzahl FROM video_sterne WHERE video_id = ?',
    [videoId],
  )

  const eigene: Record<string, unknown>[] =
    benutzerId === null
      ? []
      : await getPool().query(
          'SELECT sterne FROM video_sterne WHERE video_id = ? AND benutzer_id = ?',
          [videoId, benutzerId],
        )

  /*
   * Ein Moderator sieht alles, auch fremde offene Beiträge — er soll dort
   * prüfen, wo der Zusammenhang steht. Alle anderen sehen Freigegebenes und
   * ihre eigenen; abgelehnte Beiträge bleiben auch dem Verfasser sichtbar,
   * damit er die Entscheidung nachvollziehen kann.
   */
  const zeilen: Record<string, unknown>[] = alsModerator
    ? await getPool().query('SELECT * FROM kommentare WHERE video_id = ? ORDER BY angelegt_am', [
        videoId,
      ])
    : await getPool().query(
        `SELECT * FROM kommentare
          WHERE video_id = ?
            AND (status = 'freigegeben' ${benutzerId === null ? '' : 'OR benutzer_id = ?'})
          ORDER BY angelegt_am`,
        benutzerId === null ? [videoId] : [videoId, benutzerId],
      )

  /*
   * Eine Antwort ist nur sichtbar, wenn ihr Beitrag es ist. Sonst stünde unter
   * der Übung eine Erwiderung ohne das, worauf sie sich bezieht.
   */
  const sichtbareWurzeln = new Set(
    zeilen.filter((zeile) => zeile.eltern_id === null).map((zeile) => Number(zeile.id)),
  )

  const kommentare = zeilen
    .filter((zeile) => zeile.eltern_id === null || sichtbareWurzeln.has(Number(zeile.eltern_id)))
    .map(toKommentar)

  return {
    schnitt: Math.round((Number(sterne[0]?.schnitt) || 0) * 10) / 10,
    sterneAnzahl: Number(sterne[0]?.anzahl) || 0,
    meineSterne: Number(eigene[0]?.sterne) || 0,
    kommentare,
  }
}

export type KommentarErgebnis =
  | { status: 'ok'; id: number; sichtbar: boolean }
  | { status: 'eltern-unbekannt' }

/**
 * Legt einen Beitrag an.
 *
 * Zwei Dinge entscheidet der Server, nicht der Client: ob der Beitrag sofort
 * sichtbar ist (`kommentare_frei` am Konto) und an welcher Wurzel eine Antwort
 * hängt. Zeigt `elternId` auf eine Antwort, wird auf deren Wurzel umgehängt —
 * so kann die Tiefe nie über eine Ebene wachsen, egal was geschickt wird.
 *
 * `benutzerId === null` heißt: vom Betreiber. Dessen Beiträge sind sofort
 * sichtbar; die Prüfliste ist für Fremde da.
 */
export async function speichereKommentar(
  benutzerId: number | null,
  videoId: number,
  text: string,
  elternId: number | null,
): Promise<KommentarErgebnis> {
  await ensureReady()

  let wurzel: number | null = null
  if (elternId !== null) {
    const eltern: Record<string, unknown>[] = await getPool().query(
      'SELECT id, eltern_id, video_id FROM kommentare WHERE id = ?',
      [elternId],
    )
    const treffer = eltern[0]
    if (!treffer || Number(treffer.video_id) !== videoId) return { status: 'eltern-unbekannt' }
    wurzel = treffer.eltern_id === null ? Number(treffer.id) : Number(treffer.eltern_id)
  }

  let name = ''
  let sofort = true
  let alsTeam = benutzerId === null
  if (benutzerId !== null) {
    const konten: Record<string, unknown>[] = await getPool().query(
      'SELECT name, kommentare_frei, moderator FROM benutzer WHERE id = ?',
      [benutzerId],
    )
    /*
     * Ein Moderator schreibt als Betreiber und braucht keine Prüfung — er ist
     * derjenige, der prüft. Sein Name bleibt trotzdem am Datensatz, damit im
     * Backend nachvollziehbar ist, wer geantwortet hat.
     */
    alsTeam = Number(konten[0]?.moderator) === 1
    name = alsTeam ? '' : anzeigeName(String(konten[0]?.name ?? ''))
    sofort = alsTeam || Number(konten[0]?.kommentare_frei) === 1
  }

  const jetzt = Date.now()
  const ergebnis = await getPool().query(
    `INSERT INTO kommentare
       (video_id, eltern_id, benutzer_id, anzeige_name, vom_team, text, status,
        angelegt_am, geprueft_am)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      videoId,
      wurzel,
      benutzerId,
      name,
      alsTeam ? 1 : 0,
      text,
      sofort ? 'freigegeben' : 'offen',
      jetzt,
      sofort ? jetzt : null,
    ],
  )

  return { status: 'ok', id: Number(ergebnis.insertId), sichtbar: sofort }
}

/** Die Prüfliste — offene zuerst, denn nur die verlangen eine Handlung. */
export async function listKommentare(): Promise<KommentarEintrag[]> {
  await ensureReady()
  const zeilen: Record<string, unknown>[] = await getPool().query(
    `SELECT k.*, u.email, v.titel AS video_titel
       FROM kommentare k
       LEFT JOIN benutzer u ON u.id = k.benutzer_id
       LEFT JOIN videos v ON v.id = k.video_id
      ORDER BY k.status = 'offen' DESC, k.angelegt_am DESC
      LIMIT 300`,
  )

  return zeilen.map((zeile) => ({
    ...toKommentar(zeile),
    videoId: Number(zeile.video_id),
    videoTitel: String(zeile.video_titel ?? '—'),
    benutzerId: zeile.benutzer_id === null ? null : Number(zeile.benutzer_id),
    email: String(zeile.email ?? '—'),
    geprueftAm: zeile.geprueft_am === null ? null : Number(zeile.geprueft_am),
  }))
}

/**
 * Gibt einen Beitrag frei oder lehnt ihn ab.
 *
 * Eine Freigabe setzt zugleich `kommentare_frei` am Konto des Verfassers: ab
 * dann erscheinen seine Beiträge sofort. Genau das ist der Zweck der Prüfung —
 * einmal Vertrauen fassen statt jeden Satz einzeln durchwinken.
 */
export async function setzeKommentarStatus(
  id: number,
  status: KommentarStatus,
): Promise<boolean> {
  await ensureReady()
  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()

    const zeilen: Record<string, unknown>[] = await conn.query(
      'SELECT benutzer_id FROM kommentare WHERE id = ?',
      [id],
    )
    if (!zeilen[0]) {
      await conn.rollback()
      return false
    }

    await conn.query('UPDATE kommentare SET status = ?, geprueft_am = ? WHERE id = ?', [
      status,
      Date.now(),
      id,
    ])

    const verfasser = zeilen[0].benutzer_id
    if (status === 'freigegeben' && verfasser !== null) {
      await conn.query('UPDATE benutzer SET kommentare_frei = 1 WHERE id = ?', [Number(verfasser)])
    }

    await conn.commit()
    return true
  } catch (cause) {
    await conn.rollback()
    throw cause
  } finally {
    conn.release()
  }
}

/**
 * Löscht einen Beitrag samt seiner Antworten.
 *
 * Mit `benutzerId` nur den eigenen — der Nutzer soll zurücknehmen können, was
 * er geschrieben hat, aber nichts von anderen.
 */
export async function loescheKommentar(id: number, benutzerId?: number): Promise<boolean> {
  await ensureReady()
  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()

    const zeilen: Record<string, unknown>[] = await conn.query(
      benutzerId === undefined
        ? 'SELECT id FROM kommentare WHERE id = ?'
        : 'SELECT id FROM kommentare WHERE id = ? AND benutzer_id = ?',
      benutzerId === undefined ? [id] : [id, benutzerId],
    )
    if (!zeilen[0]) {
      await conn.rollback()
      return false
    }

    // Antworten zuerst: eine Erwiderung ohne ihren Beitrag ergäbe keinen Sinn.
    await conn.query('DELETE FROM kommentare WHERE eltern_id = ?', [id])
    await conn.query('DELETE FROM kommentare WHERE id = ?', [id])

    await conn.commit()
    return true
  } catch (cause) {
    await conn.rollback()
    throw cause
  } finally {
    conn.release()
  }
}

/**
 * Darf dieses Konto moderieren?
 *
 * Eigene Abfrage statt eines Felds in der Sitzung: das Recht kann entzogen
 * werden, und dann soll es sofort gelten — nicht erst nach der nächsten
 * Anmeldung. Dasselbe Muster wie beim Backend-Zugang.
 */
export async function istModerator(benutzerId: number): Promise<boolean> {
  await ensureReady()
  const zeilen: Record<string, unknown>[] = await getPool().query(
    'SELECT moderator FROM benutzer WHERE id = ? AND aktiv = 1',
    [benutzerId],
  )
  return Number(zeilen[0]?.moderator) === 1
}

/** Alle Wertungen einer Übung — nur für die Verwaltung. */
export async function listSterne(
  videoId: number,
): Promise<{ benutzerId: number; email: string; sterne: number; am: number }[]> {
  await ensureReady()
  const zeilen: Record<string, unknown>[] = await getPool().query(
    `SELECT s.benutzer_id, s.sterne, s.aktualisiert_am, u.email
       FROM video_sterne s LEFT JOIN benutzer u ON u.id = s.benutzer_id
      WHERE s.video_id = ? ORDER BY s.aktualisiert_am DESC`,
    [videoId],
  )
  return zeilen.map((zeile) => ({
    benutzerId: Number(zeile.benutzer_id),
    email: String(zeile.email ?? '—'),
    sterne: Number(zeile.sterne) || 0,
    am: Number(zeile.aktualisiert_am) || 0,
  }))
}

/* ── Backend-Zugänge ───────────────────────────────────────────────────── */

export interface AdminRow {
  benutzer: string
  passwort: string
  name: string
}

export async function listAdmins(): Promise<AdminRow[]> {
  await ensureReady()
  const rows: Record<string, unknown>[] = await getPool().query(
    'SELECT benutzer, passwort, name FROM admins ORDER BY benutzer',
  )
  return rows.map((row) => ({
    benutzer: String(row.benutzer),
    passwort: String(row.passwort ?? ''),
    name: String(row.name ?? ''),
  }))
}

export async function findAdmin(benutzer: string): Promise<AdminRow | null> {
  await ensureReady()
  const rows: Record<string, unknown>[] = await getPool().query(
    'SELECT benutzer, passwort, name FROM admins WHERE benutzer = ?',
    [benutzer],
  )
  return rows[0]
    ? {
        benutzer: String(rows[0].benutzer),
        passwort: String(rows[0].passwort ?? ''),
        name: String(rows[0].name ?? ''),
      }
    : null
}

export async function upsertAdmin(daten: AdminRow): Promise<void> {
  await ensureReady()
  await getPool().query(
    `INSERT INTO admins (benutzer, passwort, name) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE passwort = VALUES(passwort), name = VALUES(name)`,
    [daten.benutzer, daten.passwort, daten.name],
  )
}

export async function deleteAdmin(benutzer: string): Promise<void> {
  await ensureReady()
  await getPool().query('DELETE FROM admins WHERE benutzer = ?', [benutzer])
}

/* ── Sitzungen ─────────────────────────────────────────────────────────── */

export interface SessionRow {
  id: string
  role: string
  subject: string
  createdAt: number
  expiresAt: number
}

export async function readSessions(): Promise<SessionRow[]> {
  await ensureReady()
  const rows: Record<string, unknown>[] = await getPool().query(
    'SELECT id, role, subject, created_at, expires_at FROM sessions WHERE expires_at > ?',
    [Date.now()],
  )

  return rows.map((row) => ({
    id: String(row.id),
    role: String(row.role),
    subject: String(row.subject ?? ''),
    createdAt: Number(row.created_at) || 0,
    expiresAt: Number(row.expires_at) || 0,
  }))
}

/** Schreibt den kompletten Sitzungsstand — klein genug, um ihn ganz zu ersetzen. */
export async function writeSessions(sessions: SessionRow[]): Promise<void> {
  await ensureReady()
  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM sessions')
    if (sessions.length) {
      await conn.batch(
        `INSERT INTO sessions (id, role, subject, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        sessions.map((session) => [
          session.id,
          session.role,
          session.subject,
          session.createdAt,
          session.expiresAt,
        ]),
      )
    }
    await conn.commit()
  } catch (cause) {
    await conn.rollback()
    throw cause
  } finally {
    conn.release()
  }
}

/** Für Werkzeuge, die sauber enden sollen — der Server selbst läuft einfach weiter. */
export async function closeDb(): Promise<void> {
  if (pool) await pool.end()
  pool = null
  ready = null
}
