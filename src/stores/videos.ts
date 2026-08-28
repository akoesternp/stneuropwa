import { ref } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/api/client'
import type { Video } from '@/types'

/**
 * Die sichtbaren Kacheln. Welche das sind, entscheidet der Server anhand der
 * Sitzung — nach An- oder Abmeldung genügt deshalb ein `reload()`.
 */
export const useVideosStore = defineStore('videos', () => {
  const videos = ref<Video[]>([])
  /** Die gepflegten Trainingsbereiche — Reihenfolge wie im Backend. */
  const bereiche = ref<string[]>([])
/** Aktive Zielgruppen — die oberste Gliederungsebene im Portal. */
  const zielgruppen = ref<{ name: string; beschreibung: string }[]>([])
  const loaded = ref(false)
  const error = ref<string | null>(null)

  async function reload(): Promise<void> {
    try {
      const result = await api.get<{
        videos: Video[]
        bereiche: string[]
        zielgruppen: { name: string; beschreibung: string }[]
      }>('/portal/videos')
      videos.value = result.videos
      bereiche.value = result.bereiche ?? []
      zielgruppen.value = result.zielgruppen ?? []
      error.value = null
    } catch {
      error.value = 'Die Inhalte konnten nicht geladen werden. Bitte später erneut versuchen.'
    } finally {
      loaded.value = true
    }
  }

  async function ensureLoaded(): Promise<void> {
    if (!loaded.value) await reload()
  }

  return { videos, bereiche, zielgruppen, loaded, error, reload, ensureLoaded }
})
