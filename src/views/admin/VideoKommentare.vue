<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import GButton from '@/components/ui/GButton.vue'
import { api, ApiError } from '@/api/client'
import { KOMMENTAR_MAX_ZEICHEN } from '@shared/types'
import type { KommentarEintrag } from '@/types'

/**
 * Der Kommentarstrang einer Übung — der Arbeitsplatz des Betreibers.
 *
 * Hier steht alles zu dieser Übung beieinander: offene, freigegebene und
 * abgelehnte Beiträge. Antworten schreibt der Betreiber ebenfalls hier, wo er
 * den Zusammenhang sieht, statt in einer Liste ohne ihn. Im Portal selbst hat
 * er nichts zu tun — dort schreiben Nutzer, hier entscheidet er.
 */
const props = defineProps<{
  offen: boolean
  videoId: number | null
  videoTitel: string
}>()

const emit = defineEmits<{ schliessen: []; geaendert: [] }>()

const rows = ref<KommentarEintrag[]>([])
const laedt = ref(false)
const busy = ref(false)
const fehler = ref<string | null>(null)

const text = ref('')
const antwortAuf = ref<number | null>(null)
const antwortText = ref('')

const datum = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' })

const beitraege = computed(() => rows.value.filter((eintrag) => eintrag.elternId === null))
const offeneAnzahl = computed(() => rows.value.filter((e) => e.status === 'offen').length)

function antwortenAuf(elternId: number): KommentarEintrag[] {
  return rows.value.filter((eintrag) => eintrag.elternId === elternId)
}

async function laden(): Promise<void> {
  if (props.videoId === null) return
  laedt.value = true
  try {
    rows.value = await api.get<KommentarEintrag[]>(`/admin/videos/${props.videoId}/kommentare`)
    fehler.value = null
  } catch (cause) {
    rows.value = []
    fehler.value = cause instanceof ApiError ? cause.message : 'Laden fehlgeschlagen.'
  } finally {
    laedt.value = false
  }
}

const dialogEl = ref<HTMLDialogElement | null>(null)

watch(
  () => props.offen,
  (offen) => {
    const dialog = dialogEl.value
    if (!dialog) return
    if (offen && !dialog.open) dialog.showModal()
    if (!offen && dialog.open) dialog.close()
    document.body.style.overflow = offen ? 'hidden' : ''

    if (offen) {
      text.value = ''
      antwortAuf.value = null
      antwortText.value = ''
      void laden()
    }
  },
  { flush: 'post' },
)

onBeforeUnmount(() => {
  document.body.style.overflow = ''
})

function schliessen(): void {
  if (busy.value) return
  emit('schliessen')
}

/** Ein Klick daneben trifft das dialog-Element selbst, nicht seinen Inhalt. */
function onHintergrundKlick(event: MouseEvent): void {
  if (event.target === dialogEl.value) schliessen()
}

async function pruefen(id: number, was: 'freigeben' | 'ablehnen'): Promise<void> {
  busy.value = true
  fehler.value = null
  try {
    await api.post(`/admin/kommentare/${id}/${was}`)
    await laden()
    emit('geaendert')
  } catch (cause) {
    fehler.value = cause instanceof ApiError ? cause.message : 'Das ging nicht durch.'
  } finally {
    busy.value = false
  }
}

async function loeschen(id: number): Promise<void> {
  if (!confirm('Diesen Beitrag löschen? Antworten darauf verschwinden mit.')) return

  busy.value = true
  fehler.value = null
  try {
    await api.delete(`/admin/kommentare/${id}`)
    await laden()
    emit('geaendert')
  } catch (cause) {
    fehler.value = cause instanceof ApiError ? cause.message : 'Löschen fehlgeschlagen.'
  } finally {
    busy.value = false
  }
}

/** Als Betreiber schreiben — ohne Verfasser, sofort sichtbar. */
async function senden(inhalt: string, elternId: number | null): Promise<void> {
  if (!inhalt.trim() || props.videoId === null) return

  busy.value = true
  fehler.value = null
  try {
    await api.post(`/admin/videos/${props.videoId}/kommentare`, {
      text: inhalt.trim(),
      elternId,
    })
    text.value = ''
    antwortText.value = ''
    antwortAuf.value = null
    await laden()
    emit('geaendert')
  } catch (cause) {
    fehler.value = cause instanceof ApiError ? cause.message : 'Der Beitrag ging nicht durch.'
  } finally {
    busy.value = false
  }
}

function verfasser(eintrag: KommentarEintrag): string {
  if (eintrag.vomTeam) return 'Sie (Betreiber)'
  return eintrag.email
}

function statusText(eintrag: KommentarEintrag): string {
  if (eintrag.status === 'freigegeben') return 'sichtbar'
  if (eintrag.status === 'abgelehnt') return 'abgelehnt'
  return 'wartet auf Freigabe'
}
</script>

<template>
  <dialog ref="dialogEl" class="dialog" @cancel.prevent="schliessen" @click="onHintergrundKlick">
    <div class="inner">
      <header class="kopf">
        <div class="titles">
          <span class="t-eyebrow">Beiträge zur Übung</span>
          <h2 class="t-h3">{{ videoTitel }}</h2>
          <p class="zaehler t-meta">
            {{ rows.length }} {{ rows.length === 1 ? 'Beitrag' : 'Beiträge' }}<template
              v-if="offeneAnzahl"
            >
              · {{ offeneAnzahl }} wartet auf Freigabe</template
            >
          </p>
        </div>
        <GButton variant="ghost" size="sm" @click="schliessen">Schließen</GButton>
      </header>

      <p v-if="fehler" class="fehler" role="alert">{{ fehler }}</p>

      <div class="inhalt">
        <p v-if="laedt" class="state">Beiträge werden geladen …</p>

        <ol v-else-if="beitraege.length" class="liste">
          <li v-for="beitrag in beitraege" :key="beitrag.id" class="strang">
            <article class="karte" :class="beitrag.status">
              <header class="beitrag-kopf">
                <span class="wer" :class="{ team: beitrag.vomTeam }">{{ verfasser(beitrag) }}</span>
                <span class="wann t-meta">{{ datum.format(beitrag.angelegtAm) }}</span>
                <span class="marke" :class="beitrag.status">{{ statusText(beitrag) }}</span>
              </header>
              <p class="text">{{ beitrag.text }}</p>

              <div class="aktionen">
                <GButton
                  v-if="beitrag.status !== 'freigegeben'"
                  size="sm"
                  :disabled="busy"
                  @click="pruefen(beitrag.id, 'freigeben')"
                >
                  Freigeben
                </GButton>
                <GButton
                  v-if="beitrag.status === 'offen'"
                  variant="outline"
                  size="sm"
                  :disabled="busy"
                  @click="pruefen(beitrag.id, 'ablehnen')"
                >
                  Ablehnen
                </GButton>
                <GButton
                  variant="ghost"
                  size="sm"
                  @click="antwortAuf = antwortAuf === beitrag.id ? null : beitrag.id"
                >
                  {{ antwortAuf === beitrag.id ? 'Abbrechen' : 'Antworten' }}
                </GButton>
                <GButton
                  variant="outline"
                  size="sm"
                  danger
                  :disabled="busy"
                  @click="loeschen(beitrag.id)"
                >
                  Löschen
                </GButton>
              </div>
            </article>

            <!-- Antworten, eine Ebene tief — tiefer hängt der Server um. -->
            <ol v-if="antwortenAuf(beitrag.id).length" class="antworten">
              <li v-for="antwort in antwortenAuf(beitrag.id)" :key="antwort.id">
                <article class="karte" :class="antwort.status">
                  <header class="beitrag-kopf">
                    <span class="wer" :class="{ team: antwort.vomTeam }">
                      {{ verfasser(antwort) }}
                    </span>
                    <span class="wann t-meta">{{ datum.format(antwort.angelegtAm) }}</span>
                    <span class="marke" :class="antwort.status">{{ statusText(antwort) }}</span>
                  </header>
                  <p class="text">{{ antwort.text }}</p>
                  <div class="aktionen">
                    <GButton
                      v-if="antwort.status !== 'freigegeben'"
                      size="sm"
                      :disabled="busy"
                      @click="pruefen(antwort.id, 'freigeben')"
                    >
                      Freigeben
                    </GButton>
                    <GButton
                      variant="outline"
                      size="sm"
                      danger
                      :disabled="busy"
                      @click="loeschen(antwort.id)"
                    >
                      Löschen
                    </GButton>
                  </div>
                </article>
              </li>
            </ol>

            <form
              v-if="antwortAuf === beitrag.id"
              class="formular antwort"
              @submit.prevent="senden(antwortText, beitrag.id)"
            >
              <textarea
                v-model="antwortText"
                class="feld"
                rows="3"
                :maxlength="KOMMENTAR_MAX_ZEICHEN"
                placeholder="Als Betreiber antworten …"
              />
              <GButton type="submit" size="sm" :disabled="busy || !antwortText.trim()">
                Antwort senden
              </GButton>
            </form>
          </li>
        </ol>

        <p v-else class="state">Zu dieser Übung gibt es noch keine Beiträge.</p>
      </div>

      <!-- Ein eigener Beitrag ohne Bezug — etwa ein Hinweis zur Ausführung. -->
      <form class="formular fuss" @submit.prevent="senden(text, null)">
        <textarea
          v-model="text"
          class="feld"
          rows="2"
          :maxlength="KOMMENTAR_MAX_ZEICHEN"
          placeholder="Als Betreiber einen Hinweis schreiben …"
        />
        <GButton type="submit" size="sm" :disabled="busy || !text.trim()">Senden</GButton>
      </form>
    </div>
  </dialog>
</template>

<style scoped>
.dialog {
  width: min(820px, calc(100vw - 32px));
  max-height: calc(100vh - 64px);
  padding: 0;
  border: 0;
  border-radius: var(--r-card);
  background: var(--c-white);
  color: var(--c-text);
  overflow: hidden;
}

.dialog::backdrop {
  background: rgba(10, 12, 20, 0.55);
}

.inner {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 64px);
}

.kopf {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 24px 26px 18px;
  border-bottom: 1px solid var(--c-hairline);
}

.titles {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.zaehler {
  color: var(--c-text-muted);
}

.fehler {
  padding: 12px 26px 0;
  font-size: var(--fs-secondary);
  color: var(--c-red);
}

/* Der Strang scrollt, Kopf und Schreibfeld bleiben stehen. */
.inhalt {
  flex: 1;
  overflow-y: auto;
  padding: 18px 26px;
}

.state {
  font-size: var(--fs-secondary);
  color: var(--c-text-muted);
}

.liste,
.antworten {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.strang {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.strang + .strang {
  margin-top: 6px;
}

/* Antworten eingerückt mit Leitlinie — die Zugehörigkeit soll man sehen. */
.antworten {
  margin-left: 22px;
  padding-left: 18px;
  border-left: 2px solid var(--c-hairline-2);
}

.karte {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 18px;
  border: 1px solid var(--c-hairline);
  border-radius: var(--r-card);
  background: var(--c-white);
}

/* Was noch wartet, soll ohne Lesen auffallen. */
.karte.offen {
  border-style: dashed;
  background: var(--c-surface);
}

.karte.abgelehnt {
  opacity: 0.6;
}

.beitrag-kopf {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}

.wer {
  font-size: var(--fs-secondary);
  font-weight: 600;
}

.wer.team {
  color: var(--c-action);
}

.wann {
  color: var(--c-text-muted);
}

.marke {
  margin-left: auto;
  padding: 2px 10px;
  border-radius: var(--r-pill);
  font-family: var(--font-num);
  font-size: var(--fs-meta);
  background: var(--c-surface);
  color: var(--c-text-muted);
}

.marke.offen {
  background: var(--c-tint);
  color: var(--c-action);
}

.text {
  font-size: var(--fs-secondary);
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.aktionen {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.formular {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-start;
}

.formular.antwort {
  margin-left: 22px;
}

.formular.fuss {
  padding: 18px 26px 24px;
  border-top: 1px solid var(--c-hairline);
  background: var(--c-surface);
}

.feld {
  width: 100%;
  padding: 12px 16px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-card);
  background: var(--c-white);
  font-family: inherit;
  font-size: var(--fs-secondary);
  line-height: 1.6;
  resize: vertical;
}

.feld:focus-visible {
  outline: 2px solid var(--c-focus);
  outline-offset: 1px;
}
</style>
