/**
 * Das PayPal-Skript nachladen — erst wenn es gebraucht wird.
 *
 * Bewusst nicht fest in index.html: die Startseite und der ganze Übungsteil
 * kommen ohne aus, und ein Skript von einer fremden Herkunft auf jeder Seite
 * mitzuschleppen kostet Ladezeit und verrät jedem Besucher, dass er hier
 * beobachtet werden könnte.
 *
 * Verwendet wird die etablierte Buttons-Fassung (v1) — das ist der klassische
 * „PayPal Express"-Knopf, für den es die meiste Erfahrung gibt.
 */

/** Nur, was wir tatsächlich aufrufen. */
export interface PaypalButtons {
  render(ziel: HTMLElement): Promise<void>
  close(): void
}

export interface PaypalSdk {
  Buttons(optionen: {
    style?: Record<string, string>
    createOrder: () => Promise<string>
    onApprove: (daten: { orderID: string }) => Promise<void>
    onCancel?: () => void
    onError?: (fehler: unknown) => void
  }): PaypalButtons
}

declare global {
  interface Window {
    paypal?: PaypalSdk
  }
}

/*
 * Ein einziges Versprechen je Sitzung: das Skript darf nur einmal in die Seite,
 * sonst registriert es sich mehrfach. Bei einem Fehlschlag wird es verworfen,
 * damit ein zweiter Anlauf möglich bleibt.
 */
let laden: Promise<PaypalSdk> | null = null

export function ladePaypal(clientId: string): Promise<PaypalSdk> {
  if (window.paypal) return Promise.resolve(window.paypal)
  if (laden) return laden

  laden = new Promise<PaypalSdk>((erfuellen, ablehnen) => {
    const skript = document.createElement('script')
    const parameter = new URLSearchParams({
      'client-id': clientId,
      currency: 'EUR',
      intent: 'capture',
      locale: 'de_DE',
      // Ohne das bietet PayPal auch Ratenzahlung und Karten an — hier soll
      // genau ein Knopf stehen, damit der Ablauf überschaubar bleibt.
      'disable-funding': 'card,sofort,giropay',
    })
    skript.src = `https://www.paypal.com/sdk/js?${parameter}`
    skript.async = true

    skript.onload = () => {
      if (window.paypal) erfuellen(window.paypal)
      else {
        laden = null
        ablehnen(new Error('PayPal-Skript geladen, aber nicht verfügbar.'))
      }
    }
    skript.onerror = () => {
      laden = null
      skript.remove()
      ablehnen(new Error('PayPal konnte nicht geladen werden.'))
    }

    document.head.appendChild(skript)
  })

  return laden
}
