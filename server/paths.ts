import { existsSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Findet die Projektwurzel über die nächstgelegene package.json.
 *
 * Pfade relativ zum Modul zu rechnen bräche den kompilierten Build: in der
 * Entwicklung läuft der Code aus `server/`, nach `tsc` aus
 * `server-dist/server/`.
 */
function findRoot(start: string): string {
  let current = start
  const { root } = parse(current)

  while (true) {
    if (existsSync(join(current, 'package.json'))) return current
    if (current === root) return start
    current = dirname(current)
  }
}

export const PROJECT_ROOT = findRoot(dirname(fileURLToPath(import.meta.url)))

/** Die gebaute Oberfläche. */
export const DIST_DIR = join(PROJECT_ROOT, 'dist')

/**
 * Ablage der Videodateien — im Betrieb außerhalb des Anwendungsverzeichnisses
 * (etwa /var/lib/stneuro/videos), sonst ist bei einem Neu-Deploy alles weg.
 * Die Dateien kommen per SFTP/rsync dorthin; die Verwaltung verknüpft sie nur.
 */
export const VIDEO_DIR = process.env.VIDEO_DIR ?? join(PROJECT_ROOT, 'server', 'videos')

/**
 * Vorschaubilder, je Video eine JPEG-Datei mit der Video-ID als Namen.
 *
 * Erzeugt werden sie im Browser der Verwaltung (ein Einzelbild aus dem Video);
 * der Server legt sie nur ab. Sie liegen bewusst NICHT in VIDEO_DIR, sonst
 * tauchten sie in dessen Dateiauswahl auf und wanderten in jede rsync-Kopie
 * des Videobestands mit.
 */
export const THUMB_DIR = process.env.THUMB_DIR ?? join(PROJECT_ROOT, 'server', 'vorschaubilder')
