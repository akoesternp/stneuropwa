import type { Bestellung } from '../shared/types.js'

/**
 * Der Zugang zu PayPal — Orders API v2.
 *
 * Beide Schritte laufen HIER, nicht im Browser: der Betrag darf nie aus der
 * Anfrage stammen, sonst könnte sich jeder seinen Preis selbst setzen. Der
 * Browser bekommt nur eine Vorgangsnummer zu sehen und meldet zurück, dass der
 * Käufer zugestimmt hat; ob wirklich Geld geflossen ist, erfährt der Server
 * ausschließlich aus der Antwort auf seinen eigenen Erfassungsaufruf.
 *
 * Zugangsdaten kommen wie alles andere aus der Umgebung — PAYPAL_CLIENT_ID
 * und PAYPAL_SECRET; ohne sie bleibt der Zahlweg schlicht aus.
 */
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID ?? ''
const SECRET = process.env.PAYPAL_SECRET ?? ''

/**
 * `sandbox` (Vorgabe) oder `live`. Bewusst die Vorgabe: wer die Umgebung
 * vergisst, testet — statt versehentlich echtes Geld einzuziehen.
 */
const UMGEBUNG = process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox'

/** Übersteuerbar, damit sich der Ablauf gegen einen Prüfstand testen lässt. */
const BASIS =
  process.env.PAYPAL_API_BASIS ??
  (UMGEBUNG === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com')

export function paypalAktiv(): boolean {
  return CLIENT_ID !== '' && SECRET !== ''
}

export function paypalClientId(): string {
  return CLIENT_ID
}

export function paypalUmgebung(): 'sandbox' | 'live' {
  return UMGEBUNG
}

/*
 * Das Zugangstoken gilt mehrere Stunden. Es je Bestellung neu zu holen wäre
 * ein zusätzlicher Netzweg vor jedem Kauf — gehalten wird es nur im Speicher,
 * ein Neustart holt es einfach wieder.
 */
let token: { wert: string; bis: number } | null = null

async function zugangstoken(): Promise<string> {
  if (token && token.bis > Date.now() + 60_000) return token.wert

  const antwort = await fetch(`${BASIS}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${SECRET}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  if (!antwort.ok) {
    throw new Error(`PayPal-Anmeldung fehlgeschlagen (${antwort.status}): ${await antwort.text()}`)
  }

  const daten = (await antwort.json()) as { access_token: string; expires_in: number }
  token = {
    wert: daten.access_token,
    bis: Date.now() + (Number(daten.expires_in) || 3600) * 1000,
  }
  return token.wert
}

/** Cent als Dezimalbetrag, wie PayPal ihn erwartet: "13.50". */
function alsBetrag(cent: number): string {
  return (cent / 100).toFixed(2)
}

/**
 * Legt den Vorgang bei PayPal an und gibt dessen Nummer zurück.
 *
 * `custom_id` und `invoice_id` tragen unsere eigene Bestellung mit: taucht
 * später im PayPal-Konto eine Zahlung auf, die hier nicht ankam, lässt sie
 * sich daran zuordnen. `invoice_id` ist bei PayPal je Konto eindeutig und
 * verhindert nebenbei, dass dieselbe Bestellung zweimal bezahlt wird.
 */
export async function erzeugePaypalVorgang(bestellung: Bestellung): Promise<string> {
  const antwort = await fetch(`${BASIS}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await zugangstoken()}`,
      'content-type': 'application/json',
      // Ein wiederholter Aufruf mit derselben Kennung erzeugt keinen zweiten
      // Vorgang, sondern liefert den ersten zurück.
      'paypal-request-id': `stneuro-${bestellung.id}`,
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: bestellung.referenz,
          custom_id: String(bestellung.id),
          invoice_id: bestellung.referenz,
          description: `${bestellung.credits} Credits für stneuro`,
          amount: { currency_code: 'EUR', value: alsBetrag(bestellung.betragCent) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'stneuro',
            locale: 'de-DE',
            user_action: 'PAY_NOW',
            shipping_preference: 'NO_SHIPPING',
          },
        },
      },
    }),
  })

  if (!antwort.ok) {
    throw new Error(`PayPal-Vorgang fehlgeschlagen (${antwort.status}): ${await antwort.text()}`)
  }

  const daten = (await antwort.json()) as { id?: string }
  if (!daten.id) throw new Error('PayPal lieferte keine Vorgangsnummer.')
  return daten.id
}

export type ErfassungsErgebnis =
  | { status: 'bezahlt'; betragCent: number; zahlungId: string }
  | { status: 'offen' }
  | { status: 'fehlgeschlagen'; grund: string }

/**
 * Zieht das Geld ein und liest aus der Antwort, was tatsächlich passiert ist.
 *
 * Der zurückgemeldete Betrag wird ausgelesen und vom Aufrufer gegen die
 * Bestellung geprüft — verlassen wird sich auf nichts, was der Browser gesagt
 * hat. Ein bereits erfasster Vorgang ist kein Fehler: dann galt die Zahlung
 * schon, und die Buchung fängt die Wiederholung ohnehin ab.
 */
export async function erfassePaypalZahlung(vorgangId: string): Promise<ErfassungsErgebnis> {
  const antwort = await fetch(`${BASIS}/v2/checkout/orders/${encodeURIComponent(vorgangId)}/capture`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await zugangstoken()}`,
      'content-type': 'application/json',
      'paypal-request-id': `erfassen-${vorgangId}`,
      // Ohne das antwortet PayPal bei einer Wiederholung mit 422 statt mit
      // dem bestehenden Vorgang.
      prefer: 'return=representation',
    },
  })

  const rohtext = await antwort.text()

  if (!antwort.ok) {
    /*
     * Doppelte Erfassung: der Vorgang ist schon bezahlt. Das ist kein
     * Zahlungsfehler, sondern der zweite Klick — wir fragen den Stand ab und
     * antworten danach.
     */
    if (rohtext.includes('ORDER_ALREADY_CAPTURED')) return leseVorgang(vorgangId)
    return { status: 'fehlgeschlagen', grund: `${antwort.status}: ${rohtext.slice(0, 300)}` }
  }

  return werteVorgangAus(JSON.parse(rohtext))
}

/** Fragt den Stand eines Vorgangs ab, ohne etwas zu verändern. */
export async function leseVorgang(vorgangId: string): Promise<ErfassungsErgebnis> {
  const antwort = await fetch(`${BASIS}/v2/checkout/orders/${encodeURIComponent(vorgangId)}`, {
    headers: { authorization: `Bearer ${await zugangstoken()}` },
  })

  if (!antwort.ok) {
    return { status: 'fehlgeschlagen', grund: `${antwort.status}: ${await antwort.text()}` }
  }

  return werteVorgangAus((await antwort.json()) as PaypalVorgang)
}

interface PaypalVorgang {
  status?: string
  purchase_units?: {
    payments?: {
      captures?: { id?: string; status?: string; amount?: { value?: string; currency_code?: string } }[]
    }
  }[]
}

function werteVorgangAus(daten: PaypalVorgang): ErfassungsErgebnis {
  if (daten.status !== 'COMPLETED') return { status: 'offen' }

  const erfassung = daten.purchase_units?.[0]?.payments?.captures?.[0]
  if (!erfassung || erfassung.status !== 'COMPLETED') return { status: 'offen' }

  if (erfassung.amount?.currency_code !== 'EUR') {
    return { status: 'fehlgeschlagen', grund: `Fremde Währung: ${erfassung.amount?.currency_code}` }
  }

  // Über Cent gerechnet, nicht über Kommazahlen: 13.50 * 100 ergibt in
  // Fließkomma nicht zuverlässig 1350.
  const betragCent = Math.round(Number(erfassung.amount?.value) * 100)
  if (!Number.isFinite(betragCent) || betragCent <= 0) {
    return { status: 'fehlgeschlagen', grund: 'Unlesbarer Betrag.' }
  }

  return { status: 'bezahlt', betragCent, zahlungId: String(erfassung.id ?? '') }
}
