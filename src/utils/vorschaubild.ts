/**
 * Zieht ein Einzelbild aus einem Video und gibt es als JPEG zurück.
 *
 * Bewusst im Browser statt auf dem Server: ein Frame aus einem Video zu holen
 * heißt, den Datenstrom zu decodieren — auf dem Server bräuchte das ffmpeg als
 * zusätzliche Systemabhängigkeit. Der Browser hat den Decoder ohnehin, sonst
 * könnte er das Video nicht abspielen.
 *
 * Die Quelle darf eine lokale Datei sein (frisch hochgeladen, dann fließt
 * nichts über das Netz) oder eine URL auf den Stream der Verwaltung. Im
 * zweiten Fall lädt der Browser dank Range-Requests nur den Dateikopf und ein
 * Stück um die gesuchte Stelle — auch bei einer sehr großen Datei.
 */

/** Sekunde, aus der das Bild stammt. Kürzere Videos werden anteilig genommen. */
const STANDARD_SEKUNDE = 3

/** Breite des Bildes; die Höhe folgt dem Seitenverhältnis des Videos. */
const BREITE = 800

/** Ein hängender Decoder darf die Oberfläche nicht dauerhaft blockieren. */
const ZEITGRENZE_MS = 30_000

export class VorschaubildFehler extends Error {}

export async function erzeugeVorschaubild(
  quelle: File | string,
  sekunde: number = STANDARD_SEKUNDE,
): Promise<Blob> {
  const objektUrl = typeof quelle === 'string' ? null : URL.createObjectURL(quelle)
  const video = document.createElement('video')

  video.preload = 'metadata'
  // Ohne muted+playsinline verweigern manche Browser das Vorspulen ohne
  // Zutun des Nutzers; sichtbar wird das Element ohnehin nie.
  video.muted = true
  video.playsInline = true
  video.crossOrigin = 'use-credentials'
  video.src = objektUrl ?? (quelle as string)

  try {
    return await new Promise<Blob>((resolve, reject) => {
      const uhr = window.setTimeout(() => {
        abbrechen()
        reject(new VorschaubildFehler('Das Video ließ sich nicht rechtzeitig auswerten.'))
      }, ZEITGRENZE_MS)

      function abbrechen() {
        window.clearTimeout(uhr)
        video.removeAttribute('src')
        video.load()
      }

      video.addEventListener('error', () => {
        abbrechen()
        reject(new VorschaubildFehler('Das Video ließ sich im Browser nicht öffnen.'))
      })

      video.addEventListener('loadedmetadata', () => {
        /*
         * Bei einem kurzen Video liegt Sekunde 3 hinter dem Ende — dann käme
         * gar kein Bild. Die Mitte ist in dem Fall die sinnvollste Stelle.
         */
        const dauer = Number.isFinite(video.duration) ? video.duration : 0
        video.currentTime = dauer > sekunde ? sekunde : Math.max(0, dauer / 2)
      })

      video.addEventListener('seeked', () => {
        try {
          const breite = BREITE
          const hoehe = Math.round((video.videoHeight / video.videoWidth) * breite) || 450

          const canvas = document.createElement('canvas')
          canvas.width = breite
          canvas.height = hoehe

          const kontext = canvas.getContext('2d')
          if (!kontext) throw new VorschaubildFehler('Canvas nicht verfügbar.')
          kontext.drawImage(video, 0, 0, breite, hoehe)

          canvas.toBlob(
            (blob) => {
              abbrechen()
              if (blob) resolve(blob)
              else reject(new VorschaubildFehler('Das Bild ließ sich nicht erzeugen.'))
            },
            'image/jpeg',
            0.82,
          )
        } catch (cause) {
          abbrechen()
          reject(
            cause instanceof VorschaubildFehler
              ? cause
              : new VorschaubildFehler('Das Bild ließ sich nicht erzeugen.'),
          )
        }
      })
    })
  } finally {
    if (objektUrl) URL.revokeObjectURL(objektUrl)
  }
}

/**
 * Nimmt ein selbst gewähltes Bild und macht daraus ein Vorschaubild.
 *
 * Umgerechnet wird immer: der Server nimmt nur JPEG an, und ein Foto direkt
 * aus der Kamera hätte einige Megabyte — als Kachelbild wäre das Verschwendung
 * bei jedem Seitenaufruf. PNG, WebP und JPEG gehen damit gleichermaßen.
 */
export async function bildAlsVorschaubild(datei: File): Promise<Blob> {
  const objektUrl = URL.createObjectURL(datei)

  try {
    const bild = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () =>
        reject(new VorschaubildFehler('Diese Datei ließ sich nicht als Bild öffnen.'))
      element.src = objektUrl
    })

    // Kleinere Bilder werden nicht hochgerechnet — das brächte nur Dateigröße.
    const breite = Math.min(BREITE, bild.naturalWidth || BREITE)
    const hoehe = Math.round((bild.naturalHeight / bild.naturalWidth) * breite) || 450

    const canvas = document.createElement('canvas')
    canvas.width = breite
    canvas.height = hoehe

    const kontext = canvas.getContext('2d')
    if (!kontext) throw new VorschaubildFehler('Canvas nicht verfügbar.')
    kontext.drawImage(bild, 0, 0, breite, hoehe)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new VorschaubildFehler('Das Bild ließ sich nicht umwandeln.')),
        'image/jpeg',
        0.82,
      )
    })
  } finally {
    URL.revokeObjectURL(objektUrl)
  }
}
