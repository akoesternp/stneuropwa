import mariadb from 'mariadb'
import type { Pool, PoolConnection } from 'mariadb'
import { CREDITS_JE_VIDEO, paketPreis, SCHWIERIGKEITEN, STANDARD_BEREICHE } from '../shared/types.js'
import type {
  Bereich,
  BenutzerEintrag,
  Fortschritt,
  KatalogVideo,
  Paket,
  PaketEintrag,
  Video,
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
}

function toBenutzerRow(row: Record<string, unknown>): BenutzerRow {
  return {
    id: Number(row.id),
    email: String(row.email),
    passwort: String(row.passwort ?? ''),
    name: String(row.name ?? ''),
    aktiv: Number(row.aktiv) === 1,
    credits: Number(row.credits) || 0,
  }
}

export async function findBenutzerByEmail(email: string): Promise<BenutzerRow | null> {
  await ensureReady()
  const rows: Record<string, unknown>[] = await getPool().query(
    'SELECT id, email, passwort, name, aktiv, credits FROM benutzer WHERE email = ?',
    [email],
  )
  return rows[0] ? toBenutzerRow(rows[0]) : null
}

export async function findBenutzerById(id: number): Promise<BenutzerRow | null> {
  await ensureReady()
  const rows: Record<string, unknown>[] = await getPool().query(
    'SELECT id, email, passwort, name, aktiv, credits FROM benutzer WHERE id = ?',
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
    'SELECT id, email, name, aktiv, credits FROM benutzer ORDER BY email',
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
        `INSERT INTO benutzer (email, passwort, name, aktiv, credits, angelegt_am)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          daten.email,
          daten.passwortHash ?? '',
          daten.name,
          daten.aktiv ? 1 : 0,
          daten.credits,
          Date.now(),
        ],
      )
      benutzerId = Number(result.insertId)
    } else {
      benutzerId = id
      await conn.query(
        `UPDATE benutzer SET email = ?, name = ?, aktiv = ?, credits = ?
         ${daten.passwortHash ? ', passwort = ?' : ''} WHERE id = ?`,
        daten.passwortHash
          ? [daten.email, daten.name, daten.aktiv ? 1 : 0, daten.credits, daten.passwortHash, id]
          : [daten.email, daten.name, daten.aktiv ? 1 : 0, daten.credits, id],
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

export async function deleteBenutzer(id: number): Promise<void> {
  await ensureReady()
  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM benutzer_pakete WHERE benutzer_id = ?', [id])
    await conn.query('DELETE FROM benutzer_videos WHERE benutzer_id = ?', [id])
    await conn.query('DELETE FROM fortschritt WHERE benutzer_id = ?', [id])
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
  }))

  return ergaenzeZuordnungen(videos)
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
    /** Preis in Credits — dieselbe Formel, die auch beim Kauf abgebucht wird. */
    kosten: number
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

    return {
    ...paket,
    zielgruppenNamen: zielgruppenJePaket.get(paket.id) ?? [],
    // `zeilen` enthält nur aktive Videos — inaktive kosten also nichts und
    // wären auch nicht abspielbar.
    kosten: paketPreis(eigene.length),
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
                WHERE vp.paket_id = p.id) AS anzahl
         FROM pakete p
        WHERE p.id = ? AND p.aktiv = 1`,
      [benutzerId, paketId],
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

    const kosten = paketPreis(Number(paket.anzahl) || 0)
    if (kosten <= 0) {
      // Ein Paket ohne aktive Übungen: es gäbe nichts freizuschalten.
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
