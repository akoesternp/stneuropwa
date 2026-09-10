import { createTransport } from 'nodemailer'
import type { Transporter } from 'nodemailer'
import type { Bestellung } from '../shared/types.js'

/**
 * Der Postausgang.
 *
 * Gebraucht wird er für genau eine Sache, die aber nicht verhandelbar ist: die
 * Bestellbestätigung auf einem dauerhaften Datenträger. Ohne sie erlischt das
 * Widerrufsrecht bei digitalen Inhalten nicht (§ 356 Abs. 6 Nr. 2 Buchst. d
 * BGB verweist auf § 312f) — der Haken beim Kauf allein genügt nicht.
 *
 * Eine Bibliothek dafür, obwohl das Projekt sonst sparsam damit ist: SMTP mit
 * STARTTLS, Anmeldung und der Kodierung von Kopfzeilen ist nichts, was man
 * nebenbei richtig hinbekommt. Ein stiller Fehler dort heißt, dass Post im
 * Spam landet — und das merkt man erst, wenn sich jemand beschwert.
 *
 * Ohne SMTP_HOST bleibt der Versand aus. Dann wird beim Start einmal gewarnt,
 * statt bei jeder Bestellung zu scheitern.
 */
const HOST = (process.env.SMTP_HOST ?? '').trim()
const PORT = Number(process.env.SMTP_PORT ?? 587)
const BENUTZER = process.env.SMTP_USER ?? ''
const PASSWORT = process.env.SMTP_PASSWORT ?? ''

/** Woher die Post kommt. Ohne Angabe der SMTP-Benutzer — meist dieselbe Adresse. */
const ABSENDER = process.env.MAIL_ABSENDER ?? BENUTZER

/** Was im Absender und in den Texten als Name steht. */
const BETREIBER = process.env.MAIL_BETREIBER ?? 'stneuro'

export function mailAktiv(): boolean {
  return HOST !== '' && ABSENDER !== ''
}

let post: Transporter | null = null

function versand(): Transporter {
  if (post) return post
  post = createTransport({
    host: HOST,
    port: PORT,
    // 465 ist von Anfang an verschlüsselt, 587 handelt STARTTLS aus.
    secure: PORT === 465,
    auth: BENUTZER ? { user: BENUTZER, pass: PASSWORT } : undefined,
  })
  return post
}

const geld = (cent: number) => `${(cent / 100).toFixed(2).replace('.', ',')} €`

const datum = (zeit: number) =>
  new Intl.DateTimeFormat('de-DE', { dateStyle: 'long', timeStyle: 'short' }).format(zeit)

/**
 * Die Bestellbestätigung.
 *
 * Der Wortlaut ist nicht Schmuck: § 312f Abs. 3 verlangt ausdrücklich, dass
 * die Bestätigung festhält, dass der Käufer der sofortigen Ausführung
 * zugestimmt und die Kenntnis vom Erlöschen des Widerrufsrechts bestätigt hat.
 * Beide Sätze stehen deshalb wörtlich drin und sollten nicht gekürzt werden,
 * ohne jemanden zu fragen, der das beurteilen kann.
 */
function bestellText(bestellung: Bestellung, name: string): string {
  const anrede = name.trim() ? `Hallo ${name.trim()},` : 'Hallo,'
  const weg = bestellung.zahlweg === 'paypal' ? 'PayPal' : 'Überweisung (Vorkasse)'

  return [
    anrede,
    '',
    'vielen Dank — Ihr Guthaben ist gutgeschrieben.',
    '',
    `Bestellnummer:   ${bestellung.referenz}`,
    `Gekauft:         ${bestellung.credits} Neuro`,
    `Betrag:          ${geld(bestellung.betragCent)} (inkl. Umsatzsteuer)`,
    `Zahlweg:         ${weg}`,
    `Bestellt am:     ${datum(bestellung.angelegtAm)}`,
    bestellung.bezahltAm ? `Gutgeschrieben:  ${datum(bestellung.bezahltAm)}` : null,
    '',
    'Zum Widerrufsrecht',
    '',
    'Sie haben beim Kauf ausdrücklich zugestimmt, dass wir mit der Ausführung',
    'des Vertrags vor Ablauf der Widerrufsfrist beginnen, und Sie haben Ihre',
    'Kenntnis davon bestätigt, dass Sie durch diese Zustimmung mit Beginn der',
    'Ausführung Ihr Widerrufsrecht verlieren.',
    '',
    'Unabhängig davon: Solange Sie von diesem Kauf noch kein Neuro ausgegeben',
    'haben, nehmen wir ihn auf Wunsch zurück. Schreiben Sie uns einfach.',
    '',
    `Ihr ${BETREIBER}`,
  ]
    // Nur die bedingte Zeile faellt weg — die Leerzeilen sind der Absatzbau.
    .filter((zeile) => zeile !== null)
    .join('\n')
}

/**
 * Verschickt die Bestätigung. Scheitert sie, ist die Bestellung trotzdem
 * gültig — deshalb wirft diese Funktion nicht, sondern meldet nur.
 *
 * Das ist bewusst so: eine bezahlte Bestellung wegen eines klemmenden
 * Postausgangs zurückzuweisen wäre der schlimmere Fehler. Im Log steht dann,
 * was fehlt, und die Bestätigung lässt sich nachschicken.
 */
export async function sendeBestellbestaetigung(
  bestellung: Bestellung,
  empfaenger: string,
  name: string,
): Promise<boolean> {
  if (!mailAktiv()) {
    console.warn(
      `[Post] Keine Bestätigung für ${bestellung.referenz} — SMTP ist nicht eingerichtet. ` +
        'Ohne Bestätigung auf dauerhaftem Datenträger erlischt das Widerrufsrecht nicht.',
    )
    return false
  }
  if (!empfaenger.includes('@')) return false

  try {
    await versand().sendMail({
      from: `${BETREIBER} <${ABSENDER}>`,
      to: empfaenger,
      subject: `Ihre Bestellung ${bestellung.referenz}`,
      text: bestellText(bestellung, name),
    })
    console.log(`[Post] Bestätigung ${bestellung.referenz} an ${empfaenger}`)
    return true
  } catch (cause) {
    console.error(`[Post] Bestätigung ${bestellung.referenz} nicht zugestellt:`, cause)
    return false
  }
}
