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
  const loaded = ref(false)
  const error = ref<string | null>(null)

  async function reload(): Promise<void> {
    try {
      const result = await api.get<{ videos: Video[]; bereiche: string[] }>('/portal/videos')
      videos.value = result.videos
      bereiche.value = result.bereiche ?? []
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

  return { videos, bereiche, loaded, error, reload, ensureLoaded }
})
