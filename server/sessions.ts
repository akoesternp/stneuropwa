import { randomBytes } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { readSessions, writeSessions } from './db.js'

/**
 * Sitzungen hinter einem httpOnly-Cookie.
 *
 * Bewusst keine JWTs: eine Sitzung muss sich serverseitig beenden lassen, etwa
 * wenn ein Zugang gelöscht wird. Läuft das Portal je auf mehreren Prozessen,
 * braucht es einen gemeinsamen Speicher (Redis) statt der Map hier.
 */
export type Role = 'user' | 'admin'

export interface Session {
  role: Role
  /** Benutzer-ID (als Zeichenkette) für Nutzer, Anmeldename für Admins. */
  subject: string
  createdAt: number
  /** Zeitpunkt, ab dem die Sitzung nicht mehr gilt. */
  expiresAt: number
}

/**
 * Ein Cookie je Rolle. Mit einem gemeinsamen Namen überschriebe die Anmeldung
 * im Backend die des Nutzers und umgekehrt — man könnte nie in beidem
 * gleichzeitig angemeldet sein, auch nicht in getrennten Fenstern, da sich
 * die Cookies innerhalb eines Browserprofils teilen.
 */
const COOKIES: Record<Role, string> = {
  user: 'stneuro.sid',
  admin: 'stneuro.admin.sid',
}

/** Ohne „Angemeldet bleiben": ein Arbeitstag. */
const TTL_MS = 12 * 60 * 60 * 1000

/** Mit „Angemeldet bleiben": ein Monat. */
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000

const sessions = new Map<string, Session>()

/**
 * Die Sitzungen liegen in der Datenbank, nicht nur im Speicher — sonst meldete
 * jeder Neustart (also jedes Deployment) alle Nutzer mitten in der Arbeit ab.
 *
 * Die Tabelle enthält gültige Sitzungskennungen: wer sie lesen kann, kann sich
 * ausgeben — sie ist so schützenswert wie die Passwort-Hashes. Wer alle
 * Anmeldungen zurücksetzen will, leert die Tabelle und startet den Dienst neu.
 *
 * Gearbeitet wird auf der Map im Speicher (die Prüfungen je Request bleiben
 * synchron und kostenlos); die Datenbank hält den Stand für den Neustart.
 */
export async function initSessions(): Promise<void> {
  const now = Date.now()
  for (const entry of await readSessions()) {
    // Abgelaufenes gar nicht erst aufnehmen; die Rolle muss eine bekannte sein.
    if (entry.expiresAt <= now) continue
    if (entry.role !== 'user' && entry.role !== 'admin') continue

    sessions.set(entry.id, {
      role: entry.role,
      subject: entry.subject,
      createdAt: entry.createdAt || now,
      expiresAt: entry.expiresAt,
    })
  }
}

/** Serialisiert, damit zwei Anmeldungen kurz hintereinander sich nicht überschreiben. */
let writing: Promise<unknown> = Promise.resolve()

function save(): void {
  writing = writing.then(persist, persist)
}

async function persist(): Promise<void> {
  try {
    await writeSessions([...sessions].map(([id, session]) => ({ id, ...session })))
  } catch {
    // Sitzungen sind kein Grund, den Betrieb anzuhalten.
  }
}

function sweep() {
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id)
  }
}

/**
 * `remember` bildet den Haken „Angemeldet bleiben" ab:
 *
 *   true       30 Tage, dauerhaftes Cookie — der Haken ist gesetzt.
 *   false      12 Stunden, reines Sitzungscookie: es verschwindet mit dem
 *              Browserfenster — am geteilten Rechner genau der Sinn der Sache.
 *   undefined  12 Stunden, dauerhaftes Cookie — für Anmeldungen ohne diesen
 *              Haken, also das Backend.
 */
export function createSession(
  res: Response,
  role: Role,
  subject: string,
  remember?: boolean,
): string {
  sweep()

  const id = randomBytes(24).toString('hex')
  const lifetime = remember === true ? REMEMBER_MS : TTL_MS
  const now = Date.now()
  sessions.set(id, {
    role,
    subject,
    createdAt: now,
    expiresAt: now + lifetime,
  })

  res.cookie(COOKIES[role], id, {
    httpOnly: true,
    sameSite: 'lax',
    // Im Betrieb hinter HTTPS: SECURE_COOKIES=1 setzen.
    secure: process.env.SECURE_COOKIES === '1',
    path: '/',
    // Ohne maxAge ein reines Sitzungscookie.
    ...(remember === false ? {} : { maxAge: lifetime }),
  })

  save()
  return id
}

/**
 * Beendet alle Sitzungen eines Kontos — nach einem gesetzten Passwort oder
 * einem gelöschten Zugang soll niemand mit der alten Anmeldung weiterarbeiten.
 */
export function destroySessionsFor(role: Role, subject: string): void {
  let entfernt = false
  for (const [id, session] of sessions) {
    if (session.role === role && session.subject === subject) {
      sessions.delete(id)
      entfernt = true
    }
  }
  if (entfernt) save()
}

/** Beendet nur die Sitzung dieser Rolle — die andere bleibt bestehen. */
export function destroySession(req: Request, res: Response, role: Role): void {
  const id = req.cookies?.[COOKIES[role]]
  if (id && sessions.delete(id)) save()

  res.clearCookie(COOKIES[role], { path: '/' })
}

export function currentSession(req: Request, role: Role): Session | null {
  const id = req.cookies?.[COOKIES[role]]
  if (!id) return null

  const session = sessions.get(id)
  if (!session) return null

  // Ein Cookie darf nur für die Rolle gelten, für die es ausgestellt wurde.
  if (session.role !== role) return null

  if (session.expiresAt <= Date.now()) {
    sessions.delete(id)
    save()
    return null
  }

  return session
}

/** Minimales Cookie-Parsen — erspart eine Abhängigkeit für eine Kopfzeile. */
export function cookieParser(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.cookie
  const jar: Record<string, string> = {}

  if (header) {
    for (const part of header.split(';')) {
      const index = part.indexOf('=')
      if (index === -1) continue
      jar[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
    }
  }

  req.cookies = jar
  next()
}

function guard(role: Role) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const session = currentSession(req, role)
    if (!session) {
      res.status(401).json({ error: 'Nicht angemeldet.' })
      return
    }
    req.session = session
    next()
  }
}

export const requireUser = guard('user')
export const requireAdmin = guard('admin')

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      cookies?: Record<string, string>
      session?: Session
    }
  }
}
