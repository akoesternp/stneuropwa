import mariadb from 'mariadb'
import type { Pool, PoolConnection } from 'mariadb'
import { BEREICHE, SCHWIERIGKEITEN } from '../shared/types.js'
import type { BenutzerEintrag, Paket, Video } from '../shared/types.js'

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

    /* Ein Video kann in mehreren Paketen liegen; kein Eintrag = öffentlich. */
    await conn.query(
      `CREATE TABLE IF NOT EXISTS video_pakete (
        video_id INT UNSIGNED NOT NULL,
        paket_id INT UNSIGNED NOT NULL,
        PRIMARY KEY (video_id, paket_id),
        KEY ix_paket (paket_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    )

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
}

function toBenutzerRow(row: Record<string, unknown>): BenutzerRow {
  return {
    id: Number(row.id),
    email: String(row.email),
    passwort: String(row.passwort ?? ''),
    name: String(row.name ?? ''),
    aktiv: Number(row.aktiv) === 1,
  }
}

export async function findBenutzerByEmail(email: string): Promise<BenutzerRow | null> {
  await ensureReady()
  const rows: Record<string, unknown>[] = await getPool().query(
    'SELECT id, email, passwort, name, aktiv FROM benutzer WHERE email = ?',
    [email],
  )
  return rows[0] ? toBenutzerRow(rows[0]) : null
}

export async function findBenutzerById(id: number): Promise<BenutzerRow | null> {
  await ensureReady()
  const rows: Record<string, unknown>[] = await getPool().query(
    'SELECT id, email, passwort, name, aktiv FROM benutzer WHERE id = ?',
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
    'SELECT id, email, name, aktiv FROM benutzer ORDER BY email',
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
        'INSERT INTO benutzer (email, passwort, name, aktiv, angelegt_am) VALUES (?, ?, ?, ?, ?)',
        [daten.email, daten.passwortHash ?? '', daten.name, daten.aktiv ? 1 : 0, Date.now()],
      )
      benutzerId = Number(result.insertId)
    } else {
      benutzerId = id
      await conn.query(
        `UPDATE benutzer SET email = ?, name = ?, aktiv = ?
         ${daten.passwortHash ? ', passwort = ?' : ''} WHERE id = ?`,
        daten.passwortHash
          ? [daten.email, daten.name, daten.aktiv ? 1 : 0, daten.passwortHash, id]
          : [daten.email, daten.name, daten.aktiv ? 1 : 0, id],
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

export async function savePaket(
  id: number | null,
  daten: Omit<Paket, 'id'>,
): Promise<number> {
  await ensureReady()
  if (id === null) {
    const result = await getPool().query(
      'INSERT INTO pakete (name, beschreibung, sortierung, aktiv) VALUES (?, ?, ?, ?)',
      [daten.name, daten.beschreibung, daten.sortierung, daten.aktiv ? 1 : 0],
    )
    return Number(result.insertId)
  }

  await getPool().query(
    'UPDATE pakete SET name = ?, beschreibung = ?, sortierung = ?, aktiv = ? WHERE id = ?',
    [daten.name, daten.beschreibung, daten.sortierung, daten.aktiv ? 1 : 0, id],
  )
  return id
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
 * Hängt die Paketzuordnung an die Videozeilen.
 *
 * Bewusst eine zweite Abfrage statt GROUP_CONCAT: das Zusammenkleben und
 * Wiederzerlegen einer Zeichenkette scheitert stillschweigend an einem
 * Paketnamen mit Komma.
 */
async function mitPaketen(rows: Record<string, unknown>[]): Promise<Video[]> {
  const videos: Video[] = rows.map((row) => ({
    id: Number(row.id),
    titel: String(row.titel),
    untertitel: String(row.untertitel ?? ''),
    beschreibung: String(row.beschreibung ?? ''),
    dauer: String(row.dauer ?? ''),
    paketIds: [],
    paketNamen: [],
    datei: String(row.datei ?? ''),
    oeffentlich: Number(row.oeffentlich) === 1,
    // Ein Wert, den die Liste nicht kennt, gilt als nicht gesetzt — sonst
    // stünde in einem Filter ein Eintrag, den niemand mehr vergeben kann.
    bereich: BEREICHE.includes(String(row.bereich ?? '') as never) ? String(row.bereich) : '',
    schwierigkeit: SCHWIERIGKEITEN.includes(String(row.schwierigkeit ?? '') as never)
      ? String(row.schwierigkeit)
      : '',
    hilfsmittel: String(row.hilfsmittel ?? ''),
    sortierung: Number(row.sortierung) || 0,
    aktiv: Number(row.aktiv) === 1,
  }))

  if (!videos.length) return videos

  const zuordnungen: Record<string, unknown>[] = await getPool().query(
    `SELECT vp.video_id, vp.paket_id, p.name
     FROM video_pakete vp JOIN pakete p ON p.id = vp.paket_id
     WHERE vp.video_id IN (?)
     ORDER BY p.sortierung, p.name`,
    [videos.map((video) => video.id)],
  )

  const nachId = new Map(videos.map((video) => [video.id, video]))
  for (const zuordnung of zuordnungen) {
    const video = nachId.get(Number(zuordnung.video_id))
    if (!video) continue
    video.paketIds.push(Number(zuordnung.paket_id))
    video.paketNamen.push(String(zuordnung.name))
  }

  return videos
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

/**
 * Anlegen bzw. Ändern samt Paketzuordnung in EINER Transaktion — ein Video,
 * dessen Zuordnung nur halb geschrieben wurde, wäre entweder unsichtbar oder
 * für die Falschen sichtbar.
 */
export async function saveVideo(
  id: number | null,
  daten: Omit<Video, 'id' | 'paketNamen'>,
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

    await conn.query('DELETE FROM video_pakete WHERE video_id = ?', [videoId])
    if (daten.paketIds.length) {
      await conn.batch(
        'INSERT INTO video_pakete (video_id, paket_id) VALUES (?, ?)',
        daten.paketIds.map((paketId) => [videoId, paketId]),
      )
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
    videos: {
      id: number
      titel: string
      untertitel: string
      beschreibung: string
      dauer: string
      bereich: string
      schwierigkeit: string
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
            v.bereich, v.schwierigkeit,
            ${benutzerId === null ? OEFFENTLICH : SICHTBAR_FUER_NUTZER} AS freigeschaltet
     FROM video_pakete vp
     JOIN videos v ON v.id = vp.video_id AND v.aktiv = 1
     WHERE vp.paket_id IN (?)
     ORDER BY v.sortierung, v.id`,
    benutzerId === null
      ? [pakete.map((paket) => paket.id)]
      : [benutzerId, benutzerId, pakete.map((paket) => paket.id)],
  )

  return pakete.map((paket) => ({
    ...paket,
    videos: zeilen
      .filter((zeile) => Number(zeile.paket_id) === paket.id)
      .map((zeile) => ({
        id: Number(zeile.id),
        titel: String(zeile.titel),
        untertitel: String(zeile.untertitel ?? ''),
        beschreibung: String(zeile.beschreibung ?? ''),
        dauer: String(zeile.dauer ?? ''),
        bereich: String(zeile.bereich ?? ''),
        schwierigkeit: String(zeile.schwierigkeit ?? ''),
        freigeschaltet: Number(zeile.freigeschaltet) === 1,
        // Nur ob eine Datei hinterlegt ist — der Dateiname bleibt intern.
        hatDatei: String(zeile.datei ?? '') !== '',
      })),
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
