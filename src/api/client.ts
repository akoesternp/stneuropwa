/**
 * Schlanker fetch-Wrapper für die Portal-API.
 *
 * Sitzungen sind httpOnly-Cookies, die der Server setzt — im Browser wird
 * nichts gespeichert, `credentials: 'include'` ist alles, was der Client tun
 * muss.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Wird gerufen, wenn der Server eine Anfrage als unangemeldet ablehnt.
 *
 * Eine Sitzung kann serverseitig enden (Zeitablauf, gelöschter Zugang),
 * während der Browser noch angemeldet aussieht. Ohne diesen Handler scheiterte
 * die nächste Aktion mit einem nackten „Nicht angemeldet" — stattdessen geht
 * es zur passenden Anmeldeseite.
 */
type UnauthorizedHandler = () => void
let onUnauthorized: UnauthorizedHandler | null = null

export function setUnauthorizedHandler(handler: UnauthorizedHandler): void {
  onUnauthorized = handler
}

/** Endpunkte, bei denen ein 401 eine normale Antwort ist, keine verlorene Sitzung. */
const EXPECTED_401 = ['/auth/me', '/auth/login', '/auth/admin/login']

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    headers:
      init?.body && typeof init.body === 'string' && !init.headers
        ? { 'Content-Type': 'application/json' }
        : undefined,
    ...init,
  })

  if (!response.ok) {
    if (response.status === 401 && !EXPECTED_401.some((route) => path.startsWith(route))) {
      onUnauthorized?.()
    }

    // Die API antwortet immer mit { error }; sonst der Statustext.
    const detail = await response.json().catch(() => null)
    throw new ApiError(detail?.error ?? response.statusText, response.status)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),

  /**
   * Lädt eine Datei roh hoch — der Rumpf der Anfrage IST die Datei.
   *
   * Bewusst XMLHttpRequest statt fetch: nur damit gibt es einen Fortschritt
   * beim Senden. Bei einer Videodatei ist eine Anzeige, die minutenlang
   * nichts sagt, kaum von einem Absturz zu unterscheiden.
   *
   * `onFortschritt` bekommt 0…1, oder null solange die Gesamtgröße unbekannt
   * ist. Der zurückgegebene `abbrechen`-Handgriff beendet die Übertragung.
   */
  upload<T>(
    path: string,
    file: File,
    onFortschritt?: (anteil: number | null) => void,
  ): { versprechen: Promise<T>; abbrechen: () => void } {
    const xhr = new XMLHttpRequest()

    const versprechen = new Promise<T>((resolve, reject) => {
      xhr.open('POST', `/api${path}`)
      xhr.withCredentials = true
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')

      xhr.upload.addEventListener('progress', (event) => {
        onFortschritt?.(event.lengthComputable ? event.loaded / event.total : null)
      })

      xhr.addEventListener('load', () => {
        let payload: { error?: string } | null = null
        try {
          payload = JSON.parse(xhr.responseText)
        } catch {
          // Kein JSON — dann bleibt es beim Statustext.
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(payload as T)
          return
        }
        if (xhr.status === 401) onUnauthorized?.()
        reject(new ApiError(payload?.error ?? xhr.statusText, xhr.status))
      })

      xhr.addEventListener('error', () =>
        reject(new ApiError('Die Verbindung wurde unterbrochen.', 0)),
      )
      xhr.addEventListener('abort', () => reject(new ApiError('Upload abgebrochen.', 0)))

      xhr.send(file)
    })

    return { versprechen, abbrechen: () => xhr.abort() }
  },
}
