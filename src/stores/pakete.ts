import { ref } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/api/client'
import type { PaketInhalt } from '@/types'

/**
 * Die öffentliche Paketübersicht samt Inhaltsverzeichnis.
 *
 * Auch ohne Anmeldung abrufbar; ob ein Eintrag abspielbar ist, sagt dessen
 * `freigeschaltet` — das entscheidet der Server anhand der Sitzung, weshalb
 * nach An- und Abmeldung neu geladen werden muss.
 */
export const usePaketeStore = defineStore('pakete', () => {
  const pakete = ref<PaketInhalt[]>([])
  const loaded = ref(false)
  const error = ref<string | null>(null)

  async function reload(): Promise<void> {
    try {
      const result = await api.get<{ pakete: PaketInhalt[] }>('/portal/pakete')
      pakete.value = result.pakete
      error.value = null
    } catch {
      error.value = 'Die Pakete konnten nicht geladen werden. Bitte später erneut versuchen.'
    } finally {
      loaded.value = true
    }
  }

  async function ensureLoaded(): Promise<void> {
    if (!loaded.value) await reload()
  }

  return { pakete, loaded, error, reload, ensureLoaded }
})
