<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import DataTable from '@/components/ui/DataTable.vue'
import GButton from '@/components/ui/GButton.vue'
import GField from '@/components/ui/GField.vue'
import { api, ApiError } from '@/api/client'
import type { Column, Video } from '@/types'
import type { Bereich, PaketEintrag, ZielgruppeEintrag } from '@shared/types'

/**
 * Zielgruppen — die oberste Ebene der Gliederung. Sie fassen ganze Pakete und
 * einzelne Übungen zusammen.
 *
 * Sie steuern bewusst KEINE Berechtigung: was jemand sehen darf, entscheiden
 * weiterhin „öffentlich", die zugewiesenen Pakete und die Einzelfreischaltung.
 * Eine Zielgruppe sagt nur, für wen etwas gedacht ist — und ist damit im
 * Portal ein Filter, kein Schloss.
 */
const rows = ref<ZielgruppeEintrag[]>([])
const pakete = ref<PaketEintrag[]>([])
const videos = ref<Video[]>([])
const bereiche = ref<Bereich[]>([])

interface Editor {
  id: number | null
  name: string
  beschreibung: string
  sortierung: string
  aktiv: boolean
  paketIds: number[]
  videoIds: number[]
}

const editing = ref<Editor | null>(null)
const busy = ref(false)
const notice = ref<string | null>(null)
const error = ref<string | null>(null)

/** Auf Hunderte Übungen ausgelegt — ohne Suche findet man darin nichts. */
const suche = ref('')
const bereichFilter = ref('')
const nurAusgewaehlte = ref(false)
const MAX_ZEILEN = 150

const columns: Column[] = [
  { label: 'Zielgruppe', width: 'minmax(180px,1fr)' },
  { label: 'Beschreibung', width: 'minmax(220px,1.3fr)' },
  { label: 'Pakete', width: '90px' },
  { label: 'Übungen', width: '90px' },
  { label: 'Sortierung', width: '110px' },
  { label: 'Status', width: '100px' },
  { width: '210px' },
]

const isNew = computed(() => editing.value !== null && editing.value.id === null)

async function load() {
  ;[rows.value, pakete.value, videos.value, bereiche.value] = await Promise.all([
    api.get<ZielgruppeEintrag[]>('/admin/zielgruppen'),
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

/* ── Enthaltene Pakete ───────────────────────────────────────────────── */

const enthaltenePakete = computed(() =>
  (editing.value?.paketIds ?? [])
    .map((id) => pakete.value.find((paket) => paket.id === id))
    .filter((paket): paket is PaketEintrag => Boolean(paket)),
)

function togglePaket(id: number) {
  if (!editing.value) return
  const index = editing.value.paketIds.indexOf(id)
  if (index === -1) editing.value.paketIds.push(id)
  else editing.value.paketIds.splice(index, 1)
}

/* ── Enthaltene Videos ───────────────────────────────────────────────── */

const enthalteneVideos = computed(() =>
  (editing.value?.videoIds ?? [])
    .map((id) => videos.value.find((video) => video.id === id))
    .filter((video): video is Video => Boolean(video)),
)

/**
 * Die Videos, die schon über ein Paket dieser Zielgruppe drin sind. Sie
 * einzeln zusätzlich aufzunehmen wäre wirkungslos — der Hinweis erspart die
 * Doppelarbeit.
 */
const ueberPaket = computed(() => {
  const paketIds = new Set(editing.value?.paketIds ?? [])
  const ids = new Set<number>()
  for (const video of videos.value) {
    if (video.paketIds.some((id) => paketIds.has(id))) ids.add(video.id)
  }
  return ids
})

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

function alleSichtbaren(aufnehmen: boolean) {
  if (!editing.value) return
  const ids = new Set(editing.value.videoIds)
  for (const video of gefiltert.value) {
    if (aufnehmen) ids.add(video.id)
    else ids.delete(video.id)
  }
  editing.value.videoIds = [...ids]
}

/** Verschiebt einen Eintrag an eine neue Stelle (1-basiert, wie angezeigt). */
function verschiebe(liste: number[], von: number, nachAnzeige: number) {
  const nach = Math.min(Math.max(1, Math.round(nachAnzeige)), liste.length) - 1
  if (nach === von) return
  const [eintrag] = liste.splice(von, 1)
  if (eintrag !== undefined) liste.splice(nach, 0, eintrag)
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
  const groesste = rows.value.reduce((max, zielgruppe) => Math.max(max, zielgruppe.sortierung), 0)
  editing.value = {
    id: null,
    name: '',
    beschreibung: '',
    sortierung: String(groesste + 1),
    aktiv: true,
    paketIds: [],
    videoIds: [],
  }
}

function startEdit(row: ZielgruppeEintrag) {
  notice.value = null
  error.value = null
  ruecksetzenFilter()
  editing.value = {
    id: row.id,
    name: row.name,
    beschreibung: row.beschreibung,
    sortierung: String(row.sortierung),
    aktiv: row.aktiv,
    paketIds: [...row.paketIds],
    videoIds: [...row.videoIds],
  }
}

async function save() {
  if (!editing.value) return
  if (!editing.value.name.trim()) {
    error.value = 'Der Name ist Pflicht.'
    return
  }

  busy.value = true
  error.value = null
  try {
    await api.put('/admin/zielgruppen', {
      id: editing.value.id,
      name: editing.value.name,
      beschreibung: editing.value.beschreibung,
      sortierung: Number(editing.value.sortierung) || 0,
      aktiv: editing.value.aktiv,
      paketIds: editing.value.paketIds,
      videoIds: editing.value.videoIds,
    })
    const name = editing.value.name
    await load()
    notice.value = `${name} gespeichert.`
    editing.value = null
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : 'Speichern fehlgeschlagen.'
  } finally {
    busy.value = false
  }
}

async function remove(row: ZielgruppeEintrag) {
  if (!confirm(`Zielgruppe „${row.name}" wirklich löschen?`)) return
  busy.value = true
  error.value = null
  try {
    await api.delete(`/admin/zielgruppen/${row.id}`)
    await load()
    notice.value = `${row.name} gelöscht. Pakete und Übungen bleiben unberührt.`
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
        <h2 class="t-h2">Zielgruppen</h2>
        <p class="t-subhead">
          Fassen ganze Pakete und einzelne Übungen zusammen und dienen im Portal als Filter. Sie
          schalten nichts frei — dafür bleiben Pakete und Einzelfreischaltungen zuständig.
        </p>
      </div>
      <GButton @click="startNew">Neue Zielgruppe</GButton>
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
          <h3 class="t-h3">{{ isNew ? 'Neue Zielgruppe' : `Zielgruppe ${editing.name}` }}</h3>
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
            <GField v-model="editing.name" label="Name" placeholder="z. B. Reha" compact />
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
            Zielgruppe aktiv — ohne Haken erscheint sie im Portal nicht als Filter
          </label>

          <!-- ── Pakete ────────────────────────────────────────────── -->
          <div class="block">
            <div class="block-kopf">
              <span class="t-eyebrow">Enthaltene Pakete — Reihenfolge im Portal</span>
              <span class="zaehler t-meta">{{ enthaltenePakete.length }} von {{ pakete.length }}</span>
            </div>

            <ol v-if="enthaltenePakete.length" class="reihe">
              <li v-for="(paket, index) in enthaltenePakete" :key="paket.id" class="reihe-zeile">
                <input
                  class="nummer"
                  type="number"
                  min="1"
                  :max="enthaltenePakete.length"
                  :value="index + 1"
                  :aria-label="`Position von ${paket.name}`"
                  @change="
                    verschiebe(
                      editing.paketIds,
                      index,
                      Number(($event.target as HTMLInputElement).value),
                    )
                  "
                />
                <span class="zeile-text">
                  <span class="zeile-titel t-truncate">
                    {{ paket.name }}
                    <span v-if="!paket.aktiv" class="marke inaktiv">inaktiv</span>
                  </span>
                  <span class="zeile-meta t-meta">
                    {{ paket.videoIds.length }} {{ paket.videoIds.length === 1 ? 'Übung' : 'Übungen' }}
                  </span>
                </span>
                <span class="reihe-knoepfe">
                  <button type="button" class="weg" aria-label="Entfernen" @click="togglePaket(paket.id)">
                    ×
                  </button>
                </span>
              </li>
            </ol>

            <p v-else class="hint">Noch kein Paket zugeordnet.</p>

            <div class="paket-wahl">
              <label v-for="paket in pakete" :key="paket.id" class="wahl">
                <input
                  type="checkbox"
                  :checked="editing.paketIds.includes(paket.id)"
                  @change="togglePaket(paket.id)"
                />
                {{ paket.name }}
                <span v-if="!paket.aktiv" class="t-meta">(inaktiv)</span>
              </label>
            </div>
          </div>

          <!-- ── Einzelne Übungen ──────────────────────────────────── -->
          <div class="block">
            <div class="block-kopf">
              <span class="t-eyebrow">Einzelne Übungen — zusätzlich zu den Paketen</span>
              <span class="zaehler t-meta">
                {{ enthalteneVideos.length }} von {{ videos.length }}
              </span>
            </div>

            <ol v-if="enthalteneVideos.length" class="reihe">
              <li v-for="(video, index) in enthalteneVideos" :key="video.id" class="reihe-zeile">
                <input
                  class="nummer"
                  type="number"
                  min="1"
                  :max="enthalteneVideos.length"
                  :value="index + 1"
                  :aria-label="`Position von ${video.titel}`"
                  @change="
                    verschiebe(
                      editing.videoIds,
                      index,
                      Number(($event.target as HTMLInputElement).value),
                    )
                  "
                />
                <span class="zeile-text">
                  <span class="zeile-titel t-truncate">
                    {{ video.titel }}
                    <span v-if="!video.aktiv" class="marke inaktiv">inaktiv</span>
                    <span v-if="ueberPaket.has(video.id)" class="marke doppelt">schon im Paket</span>
                  </span>
                  <span class="zeile-meta t-meta">
                    {{
                      [video.bereich, video.schwierigkeit, video.dauer].filter(Boolean).join(' · ') ||
                      'ohne Merkmale'
                    }}
                  </span>
                </span>
                <span class="reihe-knoepfe">
                  <button type="button" class="weg" aria-label="Entfernen" @click="toggleVideo(video.id)">
                    ×
                  </button>
                </span>
              </li>
            </ol>

            <p v-else class="hint">
              Noch keine einzelne Übung zugeordnet — die Übungen der Pakete oben sind ohnehin drin.
            </p>

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

              <label class="wahl">
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
                    <span v-if="ueberPaket.has(video.id)" class="marke doppelt">schon im Paket</span>
                  </span>
                  <span class="zeile-meta t-meta">
                    {{
                      [video.bereich, video.schwierigkeit, video.dauer].filter(Boolean).join(' · ') ||
                      'ohne Merkmale'
                    }}
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

    <DataTable :columns="columns" :rows="rows" row-key="id" min-width="1020px">
      <template #row="{ row }">
        <span class="name t-truncate">{{ row.name }}</span>
        <span class="muted t-truncate">{{ row.beschreibung || '—' }}</span>
        <span class="muted">{{ row.paketIds.length }}</span>
        <span class="muted">{{ row.videoIds.length }}</span>
        <span class="muted">{{ row.sortierung }}</span>
        <span :class="row.aktiv ? 'ok' : 'flag'">{{ row.aktiv ? 'aktiv' : 'inaktiv' }}</span>
        <div class="row-actions">
          <GButton variant="ghost" size="sm" @click="startEdit(row)">Bearbeiten</GButton>
          <GButton variant="outline" size="sm" danger @click="remove(row)">Löschen</GButton>
        </div>
      </template>

      <template #empty>Noch keine Zielgruppen angelegt.</template>
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
  width: min(860px, calc(100vw - 32px));
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
.wahl {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  font-size: var(--fs-secondary);
  white-space: nowrap;
}

.aktiv input,
.wahl input,
.zeile input {
  width: 16px;
  height: 16px;
  accent-color: var(--c-action);
}

/* ── Blöcke ────────────────────────────────────────────────────────── */
.block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--c-hairline-2);
}

.block-kopf {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.reihe {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid var(--c-hairline);
  border-radius: var(--r-card);
}

.reihe-zeile {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--c-hairline-3);
}

.reihe-zeile:last-child {
  border-bottom: 0;
}

.nummer {
  flex: none;
  width: 56px;
  padding: 5px 8px;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  background: var(--c-white);
  font-family: var(--font-num);
  font-size: var(--fs-secondary);
  text-align: center;
}

.reihe-knoepfe {
  margin-left: auto;
  flex: none;
}

.reihe-knoepfe button {
  width: 28px;
  height: 28px;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  background: var(--c-white);
  color: var(--c-text-dark);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.reihe-knoepfe .weg:hover {
  border-color: var(--c-red);
  color: var(--c-red);
}

.paket-wahl {
  display: flex;
  gap: 10px 22px;
  flex-wrap: wrap;
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

.liste {
  max-height: 300px;
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

/* Wirkungslos, aber nicht falsch — deshalb nur ein Hinweis, keine Warnung. */
.marke.doppelt {
  background: var(--c-surface);
  color: var(--c-text-muted);
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
