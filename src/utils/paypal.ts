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
    /** Beschränkt den Aufbau auf genau eine Zahlungsquelle. */
    fundingSource?: 'paypal'
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
      /*
       * Spart das Nachladen dessen, was ohnehin nicht angeboten wird. Die
       * Beschränkung selbst hängt aber NICHT hieran: eine Ausschlussliste
       * ist beim nächsten Zahlungsverfahren, das PayPal aufnimmt, wieder
       * unvollständig — so kam die Lastschrift zu ihrem eigenen Knopf.
       * Verbindlich ist fundingSource beim Aufbau des Knopfes.
       */
      'disable-funding': 'card,credit,paylater,sepa,bancontact,blik,eps,ideal,mybank,p24,venmo',
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
