/**
 * Legt einen Nutzer von der Kommandozeile an — für die Ersteinrichtung oder
 * wenn das Backend gerade nicht zur Hand ist.
 *
 *   npm run benutzer:anlegen -- max@example.de geheimes-passwort "Max Muster" 10
 *
 * Die letzte Angabe ist das Startguthaben in Credits (ohne Angabe: 0).
 *
 * Pakete werden hier bewusst nicht zugewiesen — das ist Sache der Verwaltung
 * im Backend (/admin), wo man sieht, welche Pakete es gibt.
 */
import { closeDb, findBenutzerByEmail, saveBenutzer } from '../server/db.js'
import { hashPassword } from '../server/passwords.js'

const [email = '', passwort = '', name = '', guthaben = '0'] = process.argv.slice(2)

if (!email.includes('@') || !passwort) {
  console.error('Aufruf: npm run benutzer:anlegen -- <email> <passwort> [name] [credits]')
  process.exit(1)
}

const credits = Math.max(0, Math.floor(Number(guthaben)) || 0)

const normalisiert = email.trim().toLowerCase()

if (await findBenutzerByEmail(normalisiert)) {
  console.error(`Es gibt bereits einen Nutzer mit der Adresse ${normalisiert}.`)
  await closeDb()
  process.exit(1)
}

const id = await saveBenutzer(null, {
  email: normalisiert,
  name,
  aktiv: true,
  passwortHash: await hashPassword(passwort),
  paketIds: [],
  videoIds: [],
  credits,
})

console.log(`Nutzer angelegt: ${normalisiert} (id ${id}, ${credits} Credits)`)
await closeDb()
