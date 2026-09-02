import { ref } from 'vue'
import { defineStore } from 'pinia'
import { api, ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import type { Bestellung, Zahlweg } from '@/types'

/** Was der Server über die Zahlwege verrät — Bankverbindung und PayPal-Kennung. */
export interface ZahlungsKonfig {
  paypal: { aktiv: boolean; clientId: string; umgebung: 'sandbox' | 'live' }
  vorkasse: {
    aktiv: boolean
    empfaenger: string
    iban: string
    bic: string
    bank: string
    dauer: string
  }
}

/**
 * Bestellungen über Credits.
 *
 * Beide Zahlwege laufen über dieselben Endpunkte; der Unterschied liegt allein
 * darin, wer die Zahlung bestätigt — bei Vorkasse ein Mensch im Backend, bei
 * PayPal der Erfassungsaufruf des Servers.
 */
export const useBestellungenStore = defineStore('bestellungen', () => {
  const konfig = ref<ZahlungsKonfig | null>(null)
  const eigene = ref<Bestellung[]>([])
  const busy = ref(false)
  const fehler = ref<string | null>(null)

  async function ladeKonfig(): Promise<void> {
    try {
      konfig.value = await api.get<ZahlungsKonfig>('/portal/zahlung/konfig')
    } catch {
      konfig.value = null
    }
  }

  async function ladeEigene(): Promise<void> {
    const auth = useAuthStore()
    if (!auth.isAuthenticated) {
      eigene.value = []
      return
    }
    try {
      eigene.value = (await api.get<{ bestellungen: Bestellung[] }>('/portal/bestellungen'))
        .bestellungen
    } catch {
      eigene.value = []
    }
  }

  /**
   * Legt eine Bestellung an. Gebucht wird dabei nichts — bei Vorkasse wartet
   * sie auf den Zahlungseingang, bei PayPal auf die Erfassung.
   */
  async function anlegen(
    paketId: string,
    zahlweg: Zahlweg,
  ): Promise<{ bestellung: Bestellung; paypalVorgang?: string } | null> {
    busy.value = true
    fehler.value = null
    try {
      const ergebnis = await api.post<{ bestellung: Bestellung; paypalVorgang?: string }>(
        '/portal/bestellungen',
        // Die Zustimmung zur sofortigen Ausführung wird hier immer mitgeschickt:
        // die Oberfläche lässt den Knopf ohne gesetzten Haken gar nicht zu.
        { paket: paketId, zahlweg, sofortAusfuehren: true },
      )
      await ladeEigene()
      return ergebnis
    } catch (cause) {
      fehler.value = melde(cause, 'Die Bestellung konnte nicht angelegt werden.')
      return null
    } finally {
      busy.value = false
    }
  }

  /**
   * Schließt eine PayPal-Zahlung ab.
   *
   * Der Server zieht selbst bei PayPal ein und prüft den Betrag; von hier geht
   * nur die Bestellnummer mit. Eine bereits gebuchte Bestellung ist kein
   * Fehler — dann war der zweite Aufruf schlicht überflüssig.
   */
  async function erfassePaypal(bestellungId: number): Promise<boolean> {
    const auth = useAuthStore()
    busy.value = true
    fehler.value = null
    try {
      await api.post(`/portal/bestellungen/${bestellungId}/paypal`)
      await Promise.all([auth.restore(), ladeEigene()])
      return true
    } catch (cause) {
      fehler.value = melde(cause, 'Die Zahlung konnte nicht abgeschlossen werden.')
      return false
    } finally {
      busy.value = false
    }
  }

  /** Nach einem Abbruch im PayPal-Fenster — die Bestellung soll nicht offen bleiben. */
  async function abbrechen(bestellungId: number): Promise<void> {
    try {
      await api.post(`/portal/bestellungen/${bestellungId}/abbrechen`)
      await ladeEigene()
    } catch {
      // Ein misslungener Abbruch ist folgenlos: die Bestellung bleibt offen
      // und lässt sich später bestätigen oder verfällt.
    }
  }

  function melde(cause: unknown, ersatz: string): string {
    return cause instanceof ApiError ? cause.message : ersatz
  }

  function zuruecksetzen(): void {
    fehler.value = null
  }

  return {
    konfig,
    eigene,
    busy,
    fehler,
    ladeKonfig,
    ladeEigene,
    anlegen,
    erfassePaypal,
    abbrechen,
    zuruecksetzen,
  }
})
