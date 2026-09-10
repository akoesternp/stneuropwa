import { anbieterReferenzVon, bucheBestellung } from './db.js'
import { erfassePaypalZahlung } from './paypal.js'
import type { Bestellung } from '../shared/types.js'

/**
 * Das Einziehen einer PayPal-Zahlung — an einer Stelle, für beide Aufrufer.
 *
 * Zwei Wege führen hierher: der Käufer kommt nach der Zahlung ins Portal
 * zurück, oder der Betreiber fasst im Backend nach, weil eine Bestellung
 * freigegeben aber nicht abgeschlossen wurde (Reiter zu früh geschlossen).
 * Beide müssen dieselben Prüfungen durchlaufen — der Betrag gegen die eigene
 * Bestellung, die Buchung genau einmal —, deshalb steht das hier und nicht
 * zweimal in den Routen.
 */
export type EinzugErgebnis =
  | { status: 'gebucht'; gutgeschrieben: number; credits: number }
  | { status: 'schon-gebucht' }
  | { status: 'noch-nicht' }
  | { status: 'kein-vorgang' }
  | { status: 'betrag-weicht-ab'; erwartet: number; erhalten: number }
  | { status: 'nicht-buchbar' }
  | { status: 'fehlgeschlagen'; grund: string }

export async function ziehePaypalEin(bestellung: Bestellung): Promise<EinzugErgebnis> {
  /*
   * Die Vorgangsnummer kommt aus UNSERER Bestellung, nie aus der Anfrage.
   * Würde man einer mitgeschickten folgen, ließe sich eine fremde Zahlung auf
   * das eigene Konto buchen.
   */
  const vorgangId = await anbieterReferenzVon(bestellung.id)
  if (!vorgangId) return { status: 'kein-vorgang' }

  const ergebnis = await erfassePaypalZahlung(vorgangId)

  if (ergebnis.status === 'offen') return { status: 'noch-nicht' }
  if (ergebnis.status === 'fehlgeschlagen') {
    console.error(`[Zahlung] Erfassung fehlgeschlagen (Bestellung ${bestellung.id}): ${ergebnis.grund}`)
    return { status: 'fehlgeschlagen', grund: ergebnis.grund }
  }

  /*
   * Gezahlt werden muss, was bestellt wurde. Weicht es ab, wird NICHT gebucht
   * — lieber ein Fall für die Hand als eine falsche Gutschrift.
   */
  if (ergebnis.betragCent !== bestellung.betragCent) {
    console.error(
      `[Zahlung] Betrag weicht ab (Bestellung ${bestellung.id}): ` +
        `erwartet ${bestellung.betragCent}, erhalten ${ergebnis.betragCent}`,
    )
    return {
      status: 'betrag-weicht-ab',
      erwartet: bestellung.betragCent,
      erhalten: ergebnis.betragCent,
    }
  }

  const gebucht = await bucheBestellung(bestellung.id)

  if (gebucht.status === 'nicht-gefunden' || gebucht.status === 'storniert') {
    return { status: 'nicht-buchbar' }
  }
  if (gebucht.status === 'schon-gebucht') return { status: 'schon-gebucht' }

  console.log(
    `[Zahlung] PayPal ${bestellung.referenz}: +${bestellung.credits} Credits, ` +
      `neuer Stand ${gebucht.credits}`,
  )
  return { status: 'gebucht', gutgeschrieben: bestellung.credits, credits: gebucht.credits }
}
