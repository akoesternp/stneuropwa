import { Router } from 'express'
import type { Benutzer } from '../../shared/types.js'
import { findAdmin, findBenutzerByEmail, findBenutzerById, paketNamenFuer } from '../db.js'
import { verifyPassword } from '../passwords.js'
import { createSession, currentSession, destroySession } from '../sessions.js'

export const authRouter: Router = Router()

/** Die Form, in der ein Nutzer die Oberfläche erreicht — ohne Passwort-Hash. */
async function toBenutzer(row: { id: number; email: string; name: string }): Promise<Benutzer> {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    pakete: await paketNamenFuer(row.id),
  }
}

authRouter.post('/login', async (req, res) => {
  const { email = '', password = '', remember = false } = req.body ?? {}
  const needle = String(email).trim().toLowerCase()

  const match = needle ? await findBenutzerByEmail(needle) : null

  // Immer dieselbe Meldung — nie verraten, ob es das Konto gibt.
  if (!match || !(await verifyPassword(String(password), match.passwort))) {
    res.status(401).json({ error: 'E-Mail oder Passwort ist nicht korrekt.' })
    return
  }

  /*
   * Deaktiviert heißt: gesperrt, aber nicht gelöscht — etwa weil ein Zugang
   * ruht. Die Meldung darf das sagen; das Konto zu kennen ist hier kein
   * Geheimnis mehr, das richtige Passwort wurde ja gerade vorgelegt.
   */
  if (!match.aktiv) {
    res.status(403).json({ error: 'Dieser Zugang ist deaktiviert.' })
    return
  }

  // Immer ein Boolescher Wert, damit nie der Vorgabefall des Backends greift.
  createSession(res, 'user', String(match.id), remember === true)
  res.json({ user: await toBenutzer(match) })
})

authRouter.post('/logout', (req, res) => {
  destroySession(req, res, 'user')
  res.json({ ok: true })
})

authRouter.post('/admin/login', async (req, res) => {
  const { user = '', password = '' } = req.body ?? {}
  const needle = String(user).trim().toLowerCase()

  const match = needle ? await findAdmin(needle) : null

  if (!match || !(await verifyPassword(String(password), match.passwort))) {
    res.status(401).json({ error: 'Benutzer oder Passwort ist nicht korrekt.' })
    return
  }

  createSession(res, 'admin', match.benutzer)
  res.json({ user: match.benutzer, name: match.name || match.benutzer })
})

authRouter.post('/admin/logout', (req, res) => {
  destroySession(req, res, 'admin')
  res.json({ ok: true })
})

/**
 * Stellt die Sitzungen nach einem Neuladen wieder her, ohne dass die
 * Oberfläche selbst etwas speichern müsste.
 *
 * Antwortet immer mit 200 und meldet beide Rollen einzeln — Nutzer und Admin
 * können gleichzeitig angemeldet sein, jeweils mit eigenem Cookie.
 */
authRouter.get('/me', async (req, res) => {
  const userSession = currentSession(req, 'user')
  const adminSession = currentSession(req, 'admin')

  let user: Benutzer | null = null
  if (userSession) {
    const match = await findBenutzerById(Number(userSession.subject))
    if (match && match.aktiv) user = await toBenutzer(match)
    // Konto zwischenzeitlich gelöscht oder deaktiviert — Sitzung mit aufräumen.
    else destroySession(req, res, 'user')
  }

  let admin: string | null = null
  let adminName: string | null = null
  if (adminSession) {
    const account = await findAdmin(adminSession.subject)
    if (account) {
      admin = account.benutzer
      adminName = account.name || account.benutzer
    }
    // Zugang zwischenzeitlich gelöscht — Sitzung mit aufräumen.
    else destroySession(req, res, 'admin')
  }

  res.json({ user, admin, adminName })
})
