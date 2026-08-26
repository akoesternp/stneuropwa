/**
 * Legt einen Nutzer von der Kommandozeile an — für die Ersteinrichtung oder
 * wenn das Backend gerade nicht zur Hand ist.
 *
 *   npm run benutzer:anlegen -- max@example.de geheimes-passwort "Max Muster"
 *
 * Pakete werden hier bewusst nicht zugewiesen — das ist Sache der Verwaltung
 * im Backend (/admin), wo man sieht, welche Pakete es gibt.
 */
import { closeDb, findBenutzerByEmail, saveBenutzer } from '../server/db.js'
import { hashPassword } from '../server/passwords.js'

const [email = '', passwort = '', name = ''] = process.argv.slice(2)

if (!email.includes('@') || !passwort) {
  console.error('Aufruf: npm run benutzer:anlegen -- <email> <passwort> [name]')
  process.exit(1)
}

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
})

console.log(`Nutzer angelegt: ${normalisiert} (id ${id})`)
await closeDb()
