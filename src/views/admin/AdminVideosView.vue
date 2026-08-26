<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import DataTable from '@/components/ui/DataTable.vue'
import GButton from '@/components/ui/GButton.vue'
import GCard from '@/components/ui/GCard.vue'
import GField from '@/components/ui/GField.vue'
import { api, ApiError } from '@/api/client'
import type { Column, Paket, Video } from '@/types'

/**
 * Die Kacheln des Portals. Videodateien lassen sich hier hochladen oder per
 * SFTP in die Ablage legen; Titel, Dauer und Paketzuordnung werden hier
 * gepflegt. Die Dauer liest der Server aus der Datei — eingetippt werden muss
 * sie nur, wenn sich der Dateikopf nicht lesen lässt.
 */
interface Datei {
  name: string
  dauer: string
}

const rows = ref<Video[]>([])
const pakete = ref<Paket[]>([])
const dateien = ref<Datei[]>([])

interface Editor {
  id: number | null
  titel: string
  untertitel: string
  dauer: string
  paketIds: number[]
  datei: string
  sortierung: string
  aktiv: boolean
}

const editing = ref<Editor | null>(null)
const busy = ref(false)
const notice = ref<string | null>(null)
const error = ref<string | null>(null)

/** Läuft gerade ein Upload? Anteil 0…1, null solange die Größe unbekannt ist. */
const uploadName = ref<string | null>(null)
const uploadAnteil = ref<number | null>(0)
let uploadAbbrechen: (() => void) | null = null

const columns: Column[] = [
  { label: 'Titel', width: 'minmax(180px,1fr)' },
  { label: 'Untertitel', width: 'minmax(150px,0.9fr)' },
  { label: 'Dauer', width: '80px' },
  { label: 'Pakete', width: 'minmax(150px,0.9fr)' },
  { label: 'Datei', width: 'minmax(150px,0.8fr)' },
  { label: 'Status', width: '90px' },
  { width: '210px' },
]

const isNew = computed(() => editing.value !== null && editing.value.id === null)

/**
 * Bereits anderweitig verknüpfte Dateien bleiben wählbar (zwei Kacheln auf
 * dieselbe Datei sind erlaubt), werden aber gekennzeichnet — sonst verknüpft
 * man versehentlich doppelt.
 */
const dateiOptions = computed<readonly [string, string][]>(() => {
  const belegt = new Map<string, string>()
  for (const video of rows.value) {
    if (video.datei && video.id !== editing.value?.id) belegt.set(video.datei, video.titel)
  }

  return [
    ['', 'Keine Datei (Kachel zeigt „Demnächst")'],
    ...dateien.value.map((datei): [string, string] => [
      datei.name,
      belegt.has(datei.name)
        ? `${datei.name} — verknüpft mit „${belegt.get(datei.name)}"`
        : datei.name,
    ]),
  ]
})

async function load() {
  ;[rows.value, pakete.value, dateien.value] = await Promise.all([
    api.get<Video[]>('/admin/videos'),
    api.get<Paket[]>('/admin/pakete'),
    api.get<{ dateien: Datei[] }>('/admin/video-dateien').then((r) => r.dateien),
  ])
}

onMounted(load)

function startNew() {
  notice.value = null
  error.value = null
  editing.value = {
    id: null,
    titel: '',
    untertitel: '',
    dauer: '',
    paketIds: [],
    datei: '',
    sortierung: '0',
    aktiv: true,
  }
}

function startEdit(row: Video) {
  notice.value = null
  error.value = null
  editing.value = {
    id: row.id,
    titel: row.titel,
    untertitel: row.untertitel,
    dauer: row.dauer,
    paketIds: [...row.paketIds],
    datei: row.datei,
    sortierung: String(row.sortierung),
    aktiv: row.aktiv,
  }
}

function togglePaket(id: number) {
  if (!editing.value) return
  const index = editing.value.paketIds.indexOf(id)
  if (index === -1) editing.value.paketIds.push(id)
  else editing.value.paketIds.splice(index, 1)
}

/**
 * Übernimmt die Dauer der gewählten Datei, sobald das Feld leer ist — ein
 * von Hand eingetragener Wert wird nie überschrieben.
 */
function onDateiGewaehlt() {
  if (!editing.value) return
  const treffer = dateien.value.find((datei) => datei.name === editing.value!.datei)
  if (treffer?.dauer && !editing.value.dauer) editing.value.dauer = treffer.dauer
}

/**
 * Lädt die gewählte Datei hoch und verknüpft sie gleich mit dem offenen
 * Formular. Titel und Dauer werden vorbelegt, soweit sie noch leer sind:
 * beim ersten Anlegen spart das jedes Tippen außer der Paketzuordnung.
 */
async function onUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // damit dieselbe Datei erneut gewählt werden kann
  if (!file || !editing.value) return

  notice.value = null
  error.value = null
  uploadName.value = file.name
  uploadAnteil.value = 0

  try {
    const { versprechen, abbrechen } = api.upload<{ datei: string; dauer: string; groesse: number }>(
      `/admin/upload?name=${encodeURIComponent(file.name)}`,
      file,
      (anteil) => {
        uploadAnteil.value = anteil
      },
    )
    uploadAbbrechen = abbrechen

    const ergebnis = await versprechen

    editing.value.datei = ergebnis.datei
    if (!editing.value.dauer) editing.value.dauer = ergebnis.dauer
    if (!editing.value.titel) {
      // Dateiname ohne Endung als Vorschlag — Bindestriche werden zu Leerzeichen.
      editing.value.titel = ergebnis.datei.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')
    }

    dateien.value = await api
      .get<{ dateien: Datei[] }>('/admin/video-dateien')
      .then((r) => r.dateien)

    notice.value = ergebnis.dauer
      ? `${ergebnis.datei} hochgeladen (${ergebnis.dauer}). Noch speichern nicht vergessen.`
      : `${ergebnis.datei} hochgeladen. Die Dauer ließ sich nicht auslesen — bitte eintragen.`
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : 'Der Upload ist fehlgeschlagen.'
  } finally {
    uploadName.value = null
    uploadAbbrechen = null
  }
}

function abbrechenUpload() {
  uploadAbbrechen?.()
}

async function save() {
  if (!editing.value) return
  if (!editing.value.titel.trim()) {
    error.value = 'Der Titel ist Pflicht.'
    return
  }

  busy.value = true
  error.value = null
  try {
    await api.put('/admin/videos', {
      id: editing.value.id,
      titel: editing.value.titel,
      untertitel: editing.value.untertitel,
      dauer: editing.value.dauer,
      paketIds: editing.value.paketIds,
      datei: editing.value.datei,
      sortierung: Number(editing.value.sortierung) || 0,
      aktiv: editing.value.aktiv,
    })
    await load()
    notice.value = `${editing.value.titel} gespeichert.`
    editing.value = null
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : 'Speichern fehlgeschlagen.'
  } finally {
    busy.value = false
  }
}

async function remove(row: Video) {
  if (!confirm(`Video „${row.titel}" wirklich löschen?`)) return
  busy.value = true
  error.value = null
  try {
    await api.delete(`/admin/videos/${row.id}`)
    await load()
    notice.value = `${row.titel} gelöscht. Die Videodatei bleibt in der Ablage.`
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
        <h2 class="t-h2">Videos</h2>
        <p class="t-subhead">
          Ohne Paket ist eine Kachel öffentlich sichtbar; mehrere Pakete sind möglich. Die Dauer
          liest der Server aus der Datei.
        </p>
      </div>
      <GButton @click="startNew">Neues Video</GButton>
    </header>

    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <GCard v-if="editing" class="editor">
      <h3 class="t-h3">{{ isNew ? 'Neues Video' : `Video ${editing.titel}` }}</h3>

      <!-- Upload zuerst: bei einem neuen Video füllt er Titel und Dauer gleich mit. -->
      <div class="upload">
        <div class="upload-kopf">
          <span class="t-eyebrow">Videodatei hochladen</span>
          <span class="t-meta">MP4, M4V, MOV oder WebM</span>
        </div>

        <template v-if="uploadName">
          <div class="fortschritt">
            <div
              class="balken"
              :class="{ unbestimmt: uploadAnteil === null }"
              :style="uploadAnteil !== null ? { width: `${Math.round(uploadAnteil * 100)}%` } : undefined"
            />
          </div>
          <div class="upload-zeile">
            <span class="t-meta">
              {{ uploadName }} —
              {{ uploadAnteil === null ? 'wird übertragen …' : `${Math.round(uploadAnteil * 100)} %` }}
            </span>
            <GButton variant="outline" size="sm" danger @click="abbrechenUpload">Abbrechen</GButton>
          </div>
        </template>

        <template v-else>
          <input type="file" accept="video/*,.mp4,.m4v,.mov,.webm" @change="onUpload" />
          <p class="hint">
            Sehr große Dateien gehen zuverlässiger per SFTP in die Ablage — sie erscheinen dann
            unten in der Auswahl.
          </p>
        </template>
      </div>

      <div class="fields">
        <GField v-model="editing.titel" label="Titel" compact />
        <GField v-model="editing.untertitel" label="Untertitel" compact />
        <GField
          v-model="editing.datei"
          as="select"
          label="Videodatei"
          :options="dateiOptions"
          compact
          @update:model-value="onDateiGewaehlt"
        />
        <GField
          v-model="editing.dauer"
          label="Dauer"
          placeholder="wird aus der Datei gelesen"
          compact
        />
        <GField v-model="editing.sortierung" label="Sortierung" type="number" compact />
      </div>

      <div class="assign">
        <span class="t-eyebrow">Pakete</span>
        <p v-if="!pakete.length" class="hint">
          Es gibt noch keine Pakete — ohne Zuordnung ist das Video öffentlich sichtbar.
        </p>
        <div v-else class="paket-list">
          <label v-for="paket in pakete" :key="paket.id" class="paket">
            <input
              type="checkbox"
              :checked="editing.paketIds.includes(paket.id)"
              @change="togglePaket(paket.id)"
            />
            {{ paket.name }}
            <span v-if="!paket.aktiv" class="t-meta">(inaktiv)</span>
          </label>
        </div>
        <p class="hint">
          Ohne Haken ist das Video für alle sichtbar — auch ohne Anmeldung.
        </p>
      </div>

      <label class="aktiv">
        <input v-model="editing.aktiv" type="checkbox" />
        Video aktiv — ohne Haken taucht die Kachel nirgends auf
      </label>

      <div class="editor-actions">
        <GButton :disabled="busy || !!uploadName" @click="save">Speichern</GButton>
        <GButton variant="outline" :disabled="busy" @click="editing = null">Abbrechen</GButton>
      </div>
    </GCard>

    <DataTable :columns="columns" :rows="rows" row-key="id" min-width="1200px">
      <template #row="{ row }">
        <span class="name t-truncate">{{ row.titel }}</span>
        <span class="muted t-truncate">{{ row.untertitel || '—' }}</span>
        <span class="muted">{{ row.dauer || '—' }}</span>
        <span class="muted t-truncate">
          {{ row.paketNamen.length ? row.paketNamen.join(', ') : 'Öffentlich' }}
        </span>
        <span :class="row.datei ? 'muted' : 'flag'" class="t-truncate">
          {{ row.datei || 'keine Datei' }}
        </span>
        <span :class="row.aktiv ? 'ok' : 'flag'">{{ row.aktiv ? 'aktiv' : 'inaktiv' }}</span>
        <div class="row-actions">
          <GButton variant="ghost" size="sm" @click="startEdit(row)">Bearbeiten</GButton>
          <GButton variant="outline" size="sm" danger @click="remove(row)">Löschen</GButton>
        </div>
      </template>

      <template #empty>Noch keine Videos angelegt.</template>
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
}

.notice {
  font-size: var(--fs-secondary);
  color: var(--c-positive);
}

.error {
  font-size: var(--fs-secondary);
  color: var(--c-red);
}

.editor {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* ── Upload ────────────────────────────────────────────────────────── */
.upload {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px 20px;
  border: 1px dashed var(--c-border);
  border-radius: var(--r-card);
  background: var(--c-surface-2);
}

.upload-kopf {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.upload input[type='file'] {
  font-size: var(--fs-secondary);
}

.fortschritt {
  height: 8px;
  border-radius: var(--r-pill);
  background: var(--c-hairline);
  overflow: hidden;
}

.balken {
  height: 100%;
  background: var(--c-action);
  transition: width 0.2s ease;
}

/* Ohne bekannte Gesamtgröße: volle Breite statt einer erfundenen Zahl. */
.balken.unbestimmt {
  width: 100%;
  opacity: 0.5;
}

.upload-zeile {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}

.assign {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hint {
  font-size: var(--fs-secondary);
  color: var(--c-text-muted);
}

.paket-list {
  display: flex;
  gap: 10px 22px;
  flex-wrap: wrap;
}

.paket,
.aktiv {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  font-size: var(--fs-secondary);
}

.paket input,
.aktiv input {
  width: 16px;
  height: 16px;
  accent-color: var(--c-action);
}

.editor-actions {
  display: flex;
  gap: 12px;
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
