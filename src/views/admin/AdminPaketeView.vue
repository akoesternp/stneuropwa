<script setup lang="ts">
import { computed, onBeforeUnmount, ref, onMounted, watch } from 'vue'
import DataTable from '@/components/ui/DataTable.vue'
import GButton from '@/components/ui/GButton.vue'
import GField from '@/components/ui/GField.vue'
import { api, ApiError } from '@/api/client'
import type { Column, Video } from '@/types'
import type { Bereich, PaketEintrag } from '@shared/types'

/**
 * Pakete bündeln Videos und werden Nutzern zugewiesen.
 *
 * Die Zuordnung wird hier gepflegt, nicht am einzelnen Video: bei mehreren
 * hundert Übungen ist „welche gehören in dieses Paket" die Frage, die man
 * stellt — nicht „in welche Pakete gehört diese eine Übung".
 */
const rows = ref<PaketEintrag[]>([])
const videos = ref<Video[]>([])
const bereiche = ref<Bereich[]>([])

interface Editor {
  id: number | null
  name: string
  beschreibung: string
  sortierung: string
  aktiv: boolean
  videoIds: number[]
}

const editing = ref<Editor | null>(null)
const busy = ref(false)
const notice = ref<string | null>(null)
const error = ref<string | null>(null)

/* ── Auswahlliste ────────────────────────────────────────────────────────
 * Auf Hunderte Videos ausgelegt: ohne Suche findet man darin nichts, und
 * ohne „nur ausgewählte" sieht man nicht, was schon drin ist.
 */
const suche = ref('')
const bereichFilter = ref('')
const nurAusgewaehlte = ref(false)

/** Mehr Zeilen auf einmal hilft niemandem — dann lieber die Suche verfeinern. */
const MAX_ZEILEN = 150

const columns: Column[] = [
  { label: 'Name', width: 'minmax(180px,1fr)' },
  { label: 'Beschreibung', width: 'minmax(240px,1.4fr)' },
  { label: 'Übungen', width: '110px' },
  { label: 'Sortierung', width: '110px' },
  { label: 'Status', width: '100px' },
  { width: '210px' },
]

const isNew = computed(() => editing.value !== null && editing.value.id === null)

async function load() {
  ;[rows.value, videos.value, bereiche.value] = await Promise.all([
    api.get<PaketEintrag[]>('/admin/pakete'),
    api.get<Video[]>('/admin/videos'),
    api.get<Bereich[]>('/admin/bereiche'),
  ])
}

onMounted(load)

const bereichOptions = computed<readonly [string, string][]>(() => [
  ['', 'Alle Bereiche'],
  ...bereiche.value.map((bereich): [string, string] => [bereich.name, bereich.name]),
])

/** Die Videos, die nach Suche und Filter zur Anzeige kommen. */
const gefiltert = computed(() => {
  const begriff = suche.value.trim().toLowerCase()
  const gewaehlt = new Set(editing.value?.videoIds ?? [])

  return videos.value.filter((video) => {
    if (nurAusgewaehlte.value && !gewaehlt.has(video.id)) return false
    if (bereichFilter.value && video.bereich !== bereichFilter.value) return false
    if (!begriff) return true

    return [video.titel, video.untertitel, video.bereich, video.hilfsmittel]
      .join(' ')
      .toLowerCase()
      .includes(begriff)
  })
})

const sichtbar = computed(() => gefiltert.value.slice(0, MAX_ZEILEN))
const verborgen = computed(() => Math.max(0, gefiltert.value.length - MAX_ZEILEN))

function toggleVideo(id: number) {
  if (!editing.value) return
  const index = editing.value.videoIds.indexOf(id)
  if (index === -1) editing.value.videoIds.push(id)
  else editing.value.videoIds.splice(index, 1)
}

/** Nimmt alle gerade sichtbaren auf bzw. heraus — spart bei einem Filter viele Klicks. */
function alleSichtbaren(aufnehmen: boolean) {
  if (!editing.value) return
  const ids = new Set(editing.value.videoIds)
  for (const video of gefiltert.value) {
    if (aufnehmen) ids.add(video.id)
    else ids.delete(video.id)
  }
  editing.value.videoIds = [...ids]
}

/** In welchen ANDEREN Paketen liegt dieses Video? Verhindert stille Doppelungen. */
function anderePakete(video: Video): string {
  return video.paketNamen.filter((name) => name !== editing.value?.name).join(', ')
}

/* ── Maske als Overlay ───────────────────────────────────────────────── */
const dialogEl = ref<HTMLDialogElement | null>(null)

watch(
  editing,
  (wert) => {
    const dialog = dialogEl.value
    if (!dialog) return
    if (wert && !dialog.open) dialog.showModal()
    if (!wert && dialog.open) dialog.close()
    document.body.style.overflow = wert ? 'hidden' : ''
  },
  { flush: 'post' },
)

onBeforeUnmount(() => {
  document.body.style.overflow = ''
})

function schliessen() {
  if (busy.value) return
  editing.value = null
}

function onAbbruch(event: Event) {
  if (busy.value) event.preventDefault()
}

function onHintergrundKlick(event: MouseEvent) {
  if (event.target === dialogEl.value) schliessen()
}

function onGeschlossen() {
  if (editing.value) editing.value = null
}

function ruecksetzenFilter() {
  suche.value = ''
  bereichFilter.value = ''
  nurAusgewaehlte.value = false
}

function startNew() {
  notice.value = null
  error.value = null
  ruecksetzenFilter()
  const groesste = rows.value.reduce((max, paket) => Math.max(max, paket.sortierung), 0)
  editing.value = {
    id: null,
    name: '',
    beschreibung: '',
    sortierung: String(groesste + 1),
    aktiv: true,
    videoIds: [],
  }
}

function startEdit(row: PaketEintrag) {
  notice.value = null
  error.value = null
  ruecksetzenFilter()
  editing.value = {
    id: row.id,
    name: row.name,
    beschreibung: row.beschreibung,
    sortierung: String(row.sortierung),
    aktiv: row.aktiv,
    videoIds: [...row.videoIds],
  }
}

async function save() {
  if (!editing.value) return
  if (!editing.value.name.trim()) {
    error.value = 'Der Paketname ist Pflicht.'
    return
  }

  busy.value = true
  error.value = null
  try {
    await api.put('/admin/pakete', {
      id: editing.value.id,
      name: editing.value.name,
      beschreibung: editing.value.beschreibung,
      sortierung: Number(editing.value.sortierung) || 0,
      aktiv: editing.value.aktiv,
      videoIds: editing.value.videoIds,
    })
    const name = editing.value.name
    const anzahl = editing.value.videoIds.length
    await load()
    notice.value = `${name} gespeichert — ${anzahl} ${anzahl === 1 ? 'Übung' : 'Übungen'} zugeordnet.`
    editing.value = null
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : 'Speichern fehlgeschlagen.'
  } finally {
    busy.value = false
  }
}

async function remove(row: PaketEintrag) {
  if (!confirm(`Paket „${row.name}" wirklich löschen?`)) return
  busy.value = true
  error.value = null
  try {
    await api.delete(`/admin/pakete/${row.id}`)
    await load()
    notice.value = `${row.name} gelöscht.`
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : 'Löschen fehlgeschlagen.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="page">
    <header class="head">
      <div class="titles">
        <h2 class="t-h2">Pakete</h2>
        <p class="t-subhead">
          Bündeln Übungen und werden Nutzern zugewiesen. Welche Übungen enthalten sind, wird hier
          gepflegt — nicht am einzelnen Video.
        </p>
      </div>
      <GButton @click="startNew">Neues Paket</GButton>
    </header>

    <p v-if="notice && !editing" class="notice" role="status">{{ notice }}</p>
    <p v-if="error && !editing" class="error" role="alert">{{ error }}</p>

    <dialog
      ref="dialogEl"
      class="dialog"
      @cancel="onAbbruch"
      @close="onGeschlossen"
      @click="onHintergrundKlick"
    >
      <div v-if="editing" class="dialog-inner">
        <header class="dialog-kopf">
          <h3 class="t-h3">{{ isNew ? 'Neues Paket' : `Paket ${editing.name}` }}</h3>
          <button
            type="button"
            class="schliessen"
            :disabled="busy"
            aria-label="Schließen"
            @click="schliessen"
          >
            ×
          </button>
        </header>

        <div class="dialog-inhalt">
          <p v-if="error" class="error" role="alert">{{ error }}</p>

          <div class="fields">
            <GField v-model="editing.name" label="Name" compact />
            <GField v-model="editing.sortierung" label="Sortierung" type="number" compact />
            <GField
              v-model="editing.beschreibung"
              as="textarea"
              label="Beschreibung"
              compact
              class="wide"
            />
          </div>

          <label class="aktiv">
            <input v-model="editing.aktiv" type="checkbox" />
            Paket aktiv
          </label>

          <!--
            Die Auswahl ist auf Hunderte Übungen ausgelegt: Suche und
            Bereichsfilter sind der eigentliche Zugang, die Liste zeigt nur
            eine begrenzte Zahl Zeilen. „Nur ausgewählte" beantwortet die
            Gegenfrage — was ist eigentlich schon drin.
          -->
          <div class="auswahl">
            <div class="auswahl-kopf">
              <span class="t-eyebrow">Übungen im Paket</span>
              <span class="zaehler t-meta">
                {{ editing.videoIds.length }} von {{ videos.length }} ausgewählt
              </span>
            </div>

            <div class="werkzeuge">
              <label class="suchfeld">
                <span class="visually-hidden">Übungen durchsuchen</span>
                <span class="lupe" aria-hidden="true">⌕</span>
                <input v-model="suche" type="search" placeholder="Titel, Bereich, Hilfsmittel …" />
              </label>

              <GField
                v-model="bereichFilter"
                as="select"
                :options="bereichOptions"
                compact
                class="bereich"
              />

              <label class="nur">
                <input v-model="nurAusgewaehlte" type="checkbox" />
                nur ausgewählte
              </label>
            </div>

            <div class="stapel-aktionen">
              <GButton variant="text" @click="alleSichtbaren(true)">
                Alle {{ gefiltert.length }} aufnehmen
              </GButton>
              <GButton variant="text" @click="alleSichtbaren(false)">Auswahl entfernen</GButton>
            </div>

            <div class="liste">
              <label v-for="video in sichtbar" :key="video.id" class="zeile">
                <input
                  type="checkbox"
                  :checked="editing.videoIds.includes(video.id)"
                  @change="toggleVideo(video.id)"
                />
                <span class="zeile-text">
                  <span class="zeile-titel t-truncate">
                    {{ video.titel }}
                    <span v-if="!video.aktiv" class="marke inaktiv">inaktiv</span>
                    <span v-if="video.oeffentlich" class="marke frei">öffentlich</span>
                  </span>
                  <span class="zeile-meta t-meta">
                    {{ [video.bereich, video.schwierigkeit, video.dauer].filter(Boolean).join(' · ') || 'ohne Merkmale' }}
                    <template v-if="anderePakete(video)">
                      · auch in: {{ anderePakete(video) }}
                    </template>
                  </span>
                </span>
              </label>

              <p v-if="!gefiltert.length" class="leer t-meta">
                Keine Übung passt zu Suche und Filter.
              </p>
            </div>

            <p v-if="verborgen" class="hint">
              {{ verborgen }} weitere Treffer nicht angezeigt — bitte die Suche verfeinern.
              „Alle aufnehmen" wirkt trotzdem auf alle {{ gefiltert.length }}.
            </p>
          </div>
        </div>

        <footer class="dialog-fuss">
          <GButton :disabled="busy" @click="save">Speichern</GButton>
          <GButton variant="outline" :disabled="busy" @click="schliessen">Abbrechen</GButton>
        </footer>
      </div>
    </dialog>

    <DataTable :columns="columns" :rows="rows" row-key="id" min-width="960px">
      <template #row="{ row }">
        <span class="name t-truncate">{{ row.name }}</span>
        <span class="muted t-truncate">{{ row.beschreibung || '—' }}</span>
        <span class="muted">{{ row.videoIds.length }}</span>
        <span class="muted">{{ row.sortierung }}</span>
        <span :class="row.aktiv ? 'ok' : 'flag'">{{ row.aktiv ? 'aktiv' : 'inaktiv' }}</span>
        <div class="row-actions">
          <GButton variant="ghost" size="sm" @click="startEdit(row)">Bearbeiten</GButton>
          <GButton variant="outline" size="sm" danger @click="remove(row)">Löschen</GButton>
        </div>
      </template>

      <template #empty>Noch keine Pakete angelegt.</template>
    </DataTable>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
}

.titles {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 70ch;
}

.notice {
  font-size: var(--fs-secondary);
  color: var(--c-positive);
}

.error {
  font-size: var(--fs-secondary);
  color: var(--c-red);
}

/* ── Maske ─────────────────────────────────────────────────────────── */
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

.dialog-inner {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 64px);
}

.dialog-kopf {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px var(--card-pad);
  border-bottom: 1px solid var(--c-hairline);
}

.dialog-inhalt {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--card-pad);
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.dialog-fuss {
  display: flex;
  gap: 12px;
  padding: 16px var(--card-pad);
  border-top: 1px solid var(--c-hairline);
  background: var(--c-surface-2);
}

.schliessen {
  flex: none;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  background: var(--c-surface);
  color: var(--c-text-muted);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.schliessen:hover:not(:disabled) {
  background: var(--c-dark);
  color: var(--c-white);
}

.fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}

.wide {
  grid-column: 1 / -1;
}

.aktiv,
.nur {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  font-size: var(--fs-secondary);
  white-space: nowrap;
}

.aktiv input,
.nur input,
.zeile input {
  width: 16px;
  height: 16px;
  accent-color: var(--c-action);
}

/* ── Videoauswahl ──────────────────────────────────────────────────── */
.auswahl {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 6px;
  border-top: 1px solid var(--c-hairline-2);
}

.auswahl-kopf {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.werkzeuge {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.suchfeld {
  flex: 1 1 220px;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-radius: var(--r-nav);
  background: var(--c-surface);
}

.suchfeld:focus-within {
  outline: 2px solid var(--c-focus);
  outline-offset: 1px;
}

.lupe {
  color: var(--c-text-muted);
}

.suchfeld input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  font-size: var(--fs-secondary);
}

.suchfeld input:focus {
  outline: 0;
}

.bereich {
  width: 180px;
  flex: none;
}

.stapel-aktionen {
  display: flex;
  gap: 18px;
}

/*
 * Feste Höhe mit eigenem Bildlauf: die Liste darf die Maske nicht sprengen,
 * und Kopf wie Fuß sollen stehen bleiben.
 */
.liste {
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid var(--c-hairline);
  border-radius: var(--r-card);
}

.zeile {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--c-hairline-3);
  cursor: pointer;
}

.zeile:last-child {
  border-bottom: 0;
}

.zeile:hover {
  background: var(--c-surface-2);
}

.zeile-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.zeile-titel {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-secondary);
  font-weight: 500;
}

.marke {
  padding: 1px 8px;
  border-radius: var(--r-pill);
  font-family: var(--font-num);
  font-size: var(--fs-meta);
  font-weight: 400;
}

.marke.inaktiv {
  background: var(--c-orange);
  color: var(--c-white);
}

.marke.frei {
  background: var(--c-tint);
  color: var(--c-action);
}

.leer {
  padding: 20px 14px;
}

.hint {
  font-size: var(--fs-secondary);
  color: var(--c-text-muted);
}

.name {
  font-size: var(--fs-body);
  font-weight: 500;
}

.muted {
  font-size: var(--fs-secondary);
  color: var(--c-text-muted);
}

.ok {
  font-size: var(--fs-secondary);
  color: var(--c-positive);
}

.flag {
  font-size: var(--fs-secondary);
  color: var(--c-orange);
}

.row-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
