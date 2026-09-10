import { ref } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/api/client'

/**
 * Die Adresse, an die sich jemand mit einem Problem wenden kann.
 *
 * Eine einzige Zeichenkette, aber sie steht an mehreren Stellen — in der
 * Fußzeile und bei den Bestellungen —, und sie kommt aus der Umgebung des
 * Servers. Deshalb ein Speicher und nicht je Ansicht ein eigener Aufruf.
 *
 * Bleibt sie leer, schweigt die Oberfläche: lieber kein Hinweis als einer auf
 * eine Adresse, die niemand liest.
 */
export const useKontaktStore = defineStore('kontakt', () => {
  const email = ref('')
  const geladen = ref(false)

  async function laden(): Promise<void> {
    if (geladen.value) return
    try {
      const antwort = await api.get<{ email: string }>('/portal/kontakt')
      email.value = antwort.email ?? ''
    } catch {
      // Ohne Auskunft bleibt das Feld leer — kein Grund, jemanden zu behelligen.
      email.value = ''
    } finally {
      geladen.value = true
    }
  }

  return { email, geladen, laden }
})
