import { Router } from 'express'
import type { Request } from 'express'
import type { Benutzer } from '../../shared/types.js'
import {
  findAdmin,
  findBenutzerByEmail,
  findBenutzerById,
  paketNamenFuer,
  saveBenutzer,
} from '../db.js'
import { hashPassword, verifyPassword } from '../passwords.js'
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

/**
 * Selbstregistrierung.
 *
 * Ein neues Konto bekommt weder Pakete noch Einzelfreischaltungen — es sieht
 * damit genau das, was auch ohne Anmeldung sichtbar ist. Der Gewinn liegt
 * woanders: das Portal merkt sich ab jetzt den Trainingsfortschritt, und der
 * Betreiber kann dem Konto später Pakete zuweisen.
 *
 * Abschaltbar über REGISTRIERUNG=0 — falls Zugänge doch nur persönlich
 * vergeben werden sollen.
 */
const REGISTRIERUNG_OFFEN = process.env.REGISTRIERUNG !== '0'

/** Kürzer ergibt bei einem Zugang, der Inhalte freischaltet, keinen Sinn. */
const MIN_PASSWORT_LAENGE = 8

/*
 * Grobe Bremse gegen das Vollschreiben der Benutzertabelle. Bewusst im
 * Speicher: bei einem einzelnen Prozess genügt das, und eine Tabelle dafür
 * wäre mehr Pflege als Nutzen. Ein Neustart setzt die Zähler zurück — das ist
 * hinnehmbar, hier geht es um Fluten, nicht um Feinsteuerung.
 */
const VERSUCHE_JE_STUNDE = 5
const FENSTER_MS = 60 * 60 * 1000
const versuche = new Map<string, { anzahl: number; bis: number }>()

function zuVieleVersuche(req: Request): boolean {
  const schluessel = req.ip ?? 'unbekannt'
  const jetzt = Date.now()
  const eintrag = versuche.get(schluessel)

  if (!eintrag || eintrag.bis <= jetzt) {
    versuche.set(schluessel, { anzahl: 1, bis: jetzt + FENSTER_MS })
    // Abgelaufene Einträge nebenbei wegräumen, damit die Karte nicht wächst.
    for (const [key, wert] of versuche) if (wert.bis <= jetzt) versuche.delete(key)
    return false
  }

  eintrag.anzahl += 1
  return eintrag.anzahl > VERSUCHE_JE_STUNDE
}

authRouter.post('/registrieren', async (req, res) => {
  if (!REGISTRIERUNG_OFFEN) {
    res.status(403).json({ error: 'Zugänge werden derzeit nur persönlich vergeben.' })
    return
  }

  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const passwort = String(req.body?.passwort ?? '')
  const name = String(req.body?.name ?? '').trim().slice(0, 255)

  // Bewusst keine strenge Prüfung: Adressen sind vielgestaltiger, als jede
  // Regel abbildet. Was zählt, ist die Eindeutigkeit in der Datenbank.
  if (!email.includes('@') || email.length < 5) {
    res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' })
    return
  }
  if (passwort.length < MIN_PASSWORT_LAENGE) {
    res.status(400).json({
      error: `Das Passwort braucht mindestens ${MIN_PASSWORT_LAENGE} Zeichen.`,
    })
    return
  }

  if (zuVieleVersuche(req)) {
    res.status(429).json({ error: 'Zu viele Versuche. Bitte später erneut probieren.' })
    return
  }

  /*
   * Dass eine belegte Adresse als solche gemeldet wird, verrät, wer hier ein
   * Konto hat. Die Alternative wäre eine Bestätigungsmail — die es ohne
   * Postfach nicht gibt. Bis dahin ist die verständliche Meldung die bessere
   * Wahl als ein Formular, das ohne Erklärung nicht weitergeht.
   */
  if (await findBenutzerByEmail(email)) {
    res.status(409).json({
      error: 'Für diese E-Mail-Adresse gibt es bereits einen Zugang. Bitte anmelden.',
    })
    return
  }

  const id = await saveBenutzer(null, {
    email,
    name,
    aktiv: true,
    passwortHash: await hashPassword(passwort),
    // Ohne Zuordnung: die Freischaltung bleibt Sache des Betreibers.
    paketIds: [],
    videoIds: [],
  })

  console.log(`[Auth] Neues Konto registriert: ${email}`)

  // Gleich angemeldet — ein Formular, nach dem man sich noch einmal anmelden
  // muss, ist eine überflüssige Hürde.
  createSession(res, 'user', String(id), false)
  res.json({ user: { id, email, name, pakete: [] } })
})

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
