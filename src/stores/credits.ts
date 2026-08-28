import { ref } from 'vue'
import { defineStore } from 'pinia'
import { api, ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { usePaketeStore } from '@/stores/pakete'
import { useVideosStore } from '@/stores/videos'

/**
 * Selbst freischalten gegen Credits.
 *
 * An einer Stelle statt in jeder Ansicht, weil ein Kauf mehr anfasst als die
 * Schaltfläche, die ihn auslöst: das Guthaben, die zugewiesenen Pakete, der
 * Katalog und die Paketübersicht ändern sich gleichzeitig. Wird das irgendwo
 * vergessen, steht die Übung nach dem Kauf weiter als gesperrt da.
 *
 * Den Preis nennt der Server; die Oberfläche rechnet ihn nur zur Anzeige nach
 * (siehe `paketPreis` in shared/types).
 */
export const useCreditsStore = defineStore('credits', () => {
  const busy = ref(false)
  const fehler = ref<string | null>(null)
  /** Meldung nach einem gelungenen Kauf — die Ansicht blendet sie kurz ein. */
  const hinweis = ref<string | null>(null)

  async function kaufe(art: 'video' | 'paket', id: number): Promise<boolean> {
    const auth = useAuthStore()
    const videos = useVideosStore()
    const pakete = usePaketeStore()

    busy.value = true
    fehler.value = null
    hinweis.value = null

    try {
      const ergebnis = await api.post<{ kosten: number; credits: number }>(
        `/portal/freischalten/${art}/${id}`,
      )

      /*
       * `restore()` statt bloß das Guthaben zu überschreiben: mit einem Paket
       * ändert sich auch die Paketliste des Nutzers, an der die Karten
       * „Freigeschaltet" ablesen.
       */
      await Promise.all([auth.restore(), videos.reload(), pakete.reload()])

      hinweis.value =
        `Freigeschaltet für ${ergebnis.kosten} ${ergebnis.kosten === 1 ? 'Credit' : 'Credits'}. ` +
        `Ihr Guthaben: ${ergebnis.credits}.`
      return true
    } catch (cause) {
      fehler.value =
        cause instanceof ApiError
          ? cause.message
          : 'Freischalten derzeit nicht möglich. Bitte später erneut versuchen.'
      return false
    } finally {
      busy.value = false
    }
  }

  /** Beim Verlassen einer Ansicht — sonst hängt die Meldung an der nächsten. */
  function zuruecksetzen(): void {
    fehler.value = null
    hinweis.value = null
  }

  return { busy, fehler, hinweis, kaufe, zuruecksetzen }
})
