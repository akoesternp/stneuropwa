import { open } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'

/**
 * Liest die Spieldauer aus einer Videodatei — ohne ffmpeg und ohne die Datei
 * einzulesen.
 *
 * MP4/M4V/MOV sind ISO-BMFF: eine Folge von „Boxen" aus 4 Byte Länge und
 * 4 Byte Typ. Gebraucht wird nur `moov > mvhd`, dort stehen Zeitskala und
 * Dauer. Gelesen werden ausschließlich die Box-Köpfe an ihren Offsets, bei
 * einer 20-GB-Datei also ein paar hundert Byte.
 *
 * Bewusst keine Bibliothek: für zwei Zahlen aus einem Dateikopf wäre eine
 * Abhängigkeit mit eigener Angriffsfläche unverhältnismäßig. WebM (EBML) ist
 * nicht abgedeckt — dort bleibt die Dauer leer und wird von Hand eingetragen.
 */

/** Box-Kopf: Länge inklusive Kopf, Typ, und wo der Inhalt beginnt. */
interface BoxHeader {
  size: number
  type: string
  contentStart: number
}

async function readBoxHeader(datei: FileHandle, offset: number, ende: number): Promise<BoxHeader | null> {
  if (offset + 8 > ende) return null

  const kopf = Buffer.alloc(16)
  const { bytesRead } = await datei.read(kopf, 0, 16, offset)
  if (bytesRead < 8) return null

  let size = kopf.readUInt32BE(0)
  const type = kopf.toString('latin1', 4, 8)
  let contentStart = offset + 8

  if (size === 1) {
    // 64-Bit-Länge steht hinter dem Typ — bei Dateien über 4 GB der Normalfall.
    if (bytesRead < 16) return null
    const gross = kopf.readBigUInt64BE(8)
    if (gross > BigInt(Number.MAX_SAFE_INTEGER)) return null
    size = Number(gross)
    contentStart = offset + 16
  } else if (size === 0) {
    // Reicht bis zum Dateiende.
    size = ende - offset
  }

  // Eine Box, die kleiner als ihr Kopf ist, kann nicht stimmen — und würde die
  // Schleife unten nie vorankommen lassen.
  if (size < contentStart - offset) return null

  return { size, type, contentStart }
}

/** Sucht eine Box dieses Typs auf einer Ebene und liefert ihren Kopf. */
async function findBox(
  datei: FileHandle,
  von: number,
  bis: number,
  gesucht: string,
): Promise<BoxHeader | null> {
  let offset = von

  while (offset < bis) {
    const box = await readBoxHeader(datei, offset, bis)
    if (!box) return null
    if (box.type === gesucht) return box
    offset += box.size
  }

  return null
}

/**
 * Dauer in Sekunden, oder null wenn die Datei kein lesbares ISO-BMFF ist.
 * Wirft nicht: ein unlesbarer Kopf ist kein Grund, einen Upload scheitern zu
 * lassen — die Dauer lässt sich von Hand nachtragen.
 */
export async function leseDauerSekunden(pfad: string): Promise<number | null> {
  let datei: FileHandle | null = null
  try {
    datei = await open(pfad, 'r')
    const { size } = await datei.stat()

    // `moov` liegt je nach Encoder vorn (faststart) oder hinten — beide Fälle
    // findet der Durchlauf über die oberste Ebene.
    const moov = await findBox(datei, 0, size, 'moov')
    if (!moov) return null

    const mvhd = await findBox(datei, moov.contentStart, moov.contentStart + moov.size, 'mvhd')
    if (!mvhd) return null

    const daten = Buffer.alloc(28)
    const { bytesRead } = await datei.read(daten, 0, 28, mvhd.contentStart)
    if (bytesRead < 20) return null

    const version = daten.readUInt8(0)

    // Nach 1 Byte Version und 3 Byte Flags folgen die Zeitstempel; deren
    // Breite hängt an der Version, danach kommen Zeitskala und Dauer.
    let zeitskala: number
    let dauer: number

    if (version === 1) {
      if (bytesRead < 28) return null
      zeitskala = daten.readUInt32BE(20)
      const roh = daten.readBigUInt64BE(24)
      dauer = roh > BigInt(Number.MAX_SAFE_INTEGER) ? 0 : Number(roh)
    } else {
      zeitskala = daten.readUInt32BE(12)
      dauer = daten.readUInt32BE(16)
    }

    if (!zeitskala || !dauer) return null

    // 0xFFFFFFFF steht für „unbekannt" — kommt bei abgebrochenen Aufnahmen vor.
    if (version === 0 && dauer === 0xffffffff) return null

    return Math.round(dauer / zeitskala)
  } catch {
    return null
  } finally {
    await datei?.close()
  }
}

/** 750 → "12:30", 3750 → "1:02:30". */
export function formatiereDauer(sekunden: number): string {
  const s = Math.max(0, Math.round(sekunden))
  const stunden = Math.floor(s / 3600)
  const minuten = Math.floor((s % 3600) / 60)
  const rest = s % 60

  const zweistellig = (wert: number) => String(wert).padStart(2, '0')

  return stunden
    ? `${stunden}:${zweistellig(minuten)}:${zweistellig(rest)}`
    : `${minuten}:${zweistellig(rest)}`
}

/**
 * Gegenstück zu formatiereDauer, für Summen über mehrere Videos.
 * Liefert null, wenn der Text nicht dem Muster folgt — die Anzeige lässt die
 * Gesamtdauer dann lieber weg, als eine falsche Zahl zu nennen.
 */
export function parseDauer(text: string): number | null {
  const teile = text.trim().split(':')
  if (teile.length < 2 || teile.length > 3) return null

  const zahlen = teile.map((teil) => Number(teil))
  if (zahlen.some((zahl) => !Number.isInteger(zahl) || zahl < 0)) return null

  return teile.length === 3
    ? zahlen[0]! * 3600 + zahlen[1]! * 60 + zahlen[2]!
    : zahlen[0]! * 60 + zahlen[1]!
}
