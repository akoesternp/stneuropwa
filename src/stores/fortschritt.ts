import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/api/client'
import type { Fortschritt } from '@shared/types'

/**
 * Der Trainingsfortschritt des angemeldeten Nutzers.
 *
 * Gehalten wird er als Karte über die Video-ID, weil jede Kachel danach fragt.
 * Ohne Anmeldung bleibt sie leer — der Server gäbe ohnehin nichts heraus.
 */
export const useFortschrittStore = defineStore('fortschritt', () => {
  const stand = ref(new Map<number, Fortschritt>())
  const loaded = ref(false)

  /** Nach Zeit absteigend — die Reihenfolge für „Weiterschauen". */
  const zuletzt = computed(() =>
    [...stand.value.values()].sort((a, b) => b.aktualisiertAm - a.aktualisiertAm),
  )

  function fuer(videoId: number): Fortschritt | undefined {
    return stand.value.get(videoId)
  }

  async function reload(): Promise<void> {
    try {
      const antwort = await api.get<{ fortschritt: Fortschritt[] }>('/portal/fortschritt')
      stand.value = new Map(antwort.fortschritt.map((eintrag) => [eintrag.videoId, eintrag]))
    } catch {
      // Nicht angemeldet oder Server nicht erreichbar — dann gibt es keinen Stand.
      stand.value = new Map()
    } finally {
      loaded.value = true
    }
  }

  function verwerfen(): void {
    stand.value = new Map()
    loaded.value = false
  }

  /**
   * Meldet den Stand an den Server und hält ihn zugleich lokal fest, damit
   * die Kacheln nicht erst nach einem Neuladen aufholen.
   *
   * Fehler bleiben stumm: ein verlorener Zwischenstand ist ärgerlich, aber
   * kein Grund, jemanden beim Üben mit einer Meldung zu unterbrechen.
   */
  async function melden(videoId: number, position: number, erledigt: boolean): Promise<void> {
    const eintrag: Fortschritt = {
      videoId,
      position: Math.max(0, Math.round(position)),
      erledigt,
      aktualisiertAm: Date.now(),
    }

    // Neue Karte, damit Vue die Änderung bemerkt.
    stand.value = new Map(stand.value).set(videoId, eintrag)

    try {
      await api.put(`/portal/fortschritt/${videoId}`, {
        position: eintrag.position,
        erledigt: eintrag.erledigt,
      })
    } catch {
      /* stumm — siehe oben */
    }
  }

  return { stand, loaded, zuletzt, fuer, reload, verwerfen, melden }
})
