<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import DataTable from '@/components/ui/DataTable.vue'
import GButton from '@/components/ui/GButton.vue'
import GCard from '@/components/ui/GCard.vue'
import GField from '@/components/ui/GField.vue'
import { api, ApiError } from '@/api/client'
import type { BenutzerEintrag, Column, Paket, Video } from '@/types'

/**
 * Die Nutzerverwaltung: Zugänge anlegen, Pakete und einzelne Videos zuweisen,
 * sperren, löschen. Passwörter sind nur setzbar, nie lesbar — ein leeres Feld
 * beim Speichern lässt das bestehende unangetastet.
 */
const rows = ref<BenutzerEintrag[]>([])
const pakete = ref<Paket[]>([])
const videos = ref<Video[]>([])

interface Editor {
  id: number | null
  email: string
  name: string
  aktiv: boolean
  paketIds: number[]
  videoIds: number[]
}

const editing = ref<Editor | null>(null)
const newPassword = ref('')
const repeatPassword = ref('')
const busy = ref(false)
const notice = ref<string | null>(null)
const error = ref<string | null>(null)

const columns: Column[] = [
  { label: 'E-Mail', width: 'minmax(220px,1fr)' },
  { label: 'Name', width: 'minmax(160px,1fr)' },
  { label: 'Pakete', width: 'minmax(180px,1fr)' },
  { label: 'Status', width: '110px' },
  { width: '210px' },
]

const isNew = computed(() => editing.value !== null && editing.value.id === null)

async function load() {
  ;[rows.value, pakete.value, videos.value] = await Promise.all([
    api.get<BenutzerEintrag[]>('/admin/benutzer'),
    api.get<Paket[]>('/admin/pakete'),
    api.get<Video[]>('/admin/videos'),
  ])
}

/** Für Einzelfreischaltungen nur sinnvoll: Videos, die hinter einem Paket liegen. */
const paketVideos = computed(() => videos.value.filter((video) => video.paketIds.length > 0))

onMounted(load)

function paketNamen(row: BenutzerEintrag): string {
  const namen = row.paketIds
    .map((id) => pakete.value.find((paket) => paket.id === id)?.name)
    .filter(Boolean)
  if (row.videoIds.length) {
    namen.push(`${row.videoIds.length} Video${row.videoIds.length === 1 ? '' : 's'} einzeln`)
  }
  return namen.length ? namen.join(', ') : '—'
}

function startNew() {
  notice.value = null
  error.value = null
  newPassword.value = ''
  repeatPassword.value = ''
  editing.value = { id: null, email: '', name: '', aktiv: true, paketIds: [], videoIds: [] }
}

function startEdit(row: BenutzerEintrag) {
  notice.value = null
  error.value = null
  newPassword.value = ''
  repeatPassword.value = ''
  editing.value = { ...row, paketIds: [...row.paketIds], videoIds: [...row.videoIds] }
}

function togglePaket(id: number) {
  if (!editing.value) return
  const index = editing.value.paketIds.indexOf(id)
  if (index === -1) editing.value.paketIds.push(id)
  else editing.value.paketIds.splice(index, 1)
}

function toggleVideo(id: number) {
  if (!editing.value) return
  const index = editing.value.videoIds.indexOf(id)
  if (index === -1) editing.value.videoIds.push(id)
  else editing.value.videoIds.splice(index, 1)
}

async function save() {
  if (!editing.value) return

  if (!editing.value.email.trim()) {
    error.value = 'Die E-Mail-Adresse ist Pflicht.'
    return
  }
  if (isNew.value && !newPassword.value) {
    error.value = 'Für einen neuen Nutzer wird ein Passwort benötigt.'
    return
  }
  // Tippfehler in einem Nur-Schreiben-Feld fallen sonst erst bei der nächsten Anmeldung auf.
  if (newPassword.value && newPassword.value !== repeatPassword.value) {
    error.value = 'Die beiden Passwörter stimmen nicht überein.'
    return
  }

  busy.value = true
  error.value = null
  try {
    await api.put('/admin/benutzer', {
      id: editing.value.id,
      email: editing.value.email,
      name: editing.value.name,
      aktiv: editing.value.aktiv,
      passwort: newPassword.value,
      paketIds: editing.value.paketIds,
      videoIds: editing.value.videoIds,
    })
    await load()
    notice.value = `${editing.value.email} gespeichert.`
    editing.value = null
    newPassword.value = ''
    repeatPassword.value = ''
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : 'Speichern fehlgeschlagen.'
  } finally {
    busy.value = false
  }
}

async function remove(row: BenutzerEintrag) {
  if (!confirm(`Nutzer „${row.email}" wirklich löschen?`)) return
  busy.value = true
  error.value = null
  try {
    await api.delete(`/admin/benutzer/${row.id}`)
    await load()
    notice.value = `${row.email} gelöscht.`
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
        <h2 class="t-h2">Nutzer</h2>
        <p class="t-subhead">
          Wer sich am Portal anmelden darf — und welche Pakete er sieht.
        </p>
      </div>
      <GButton @click="startNew">Neuer Nutzer</GButton>
    </header>

    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <GCard v-if="editing" class="editor">
      <h3 class="t-h3">{{ isNew ? 'Neuer Nutzer' : `Nutzer ${editing.email}` }}</h3>

      <div class="fields">
        <GField v-model="editing.email" label="E-Mail-Adresse" type="email" compact />
        <GField v-model="editing.name" label="Name" compact />
        <GField
          v-model="newPassword"
          label="Neues Passwort"
          type="password"
          autocomplete="new-password"
          compact
          :placeholder="isNew ? 'Pflicht' : 'leer lassen = unverändert'"
        />
        <GField
          v-model="repeatPassword"
          label="Passwort wiederholen"
          type="password"
          autocomplete="new-password"
          compact
        />
      </div>

      <div class="assign">
        <span class="t-eyebrow">Pakete</span>
        <p v-if="!pakete.length" class="hint">
          Es gibt noch keine Pakete — zuerst unter „Pakete" anlegen.
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
      </div>

      <!--
        Einzelfreischaltungen wirken ZUSÄTZLICH zu den Paketen — für den Fall,
        dass jemand genau ein Video bekommen soll, ohne das ganze Paket.
        Öffentliche Videos stehen nicht zur Wahl, die sieht ohnehin jeder.
      -->
      <div class="assign">
        <span class="t-eyebrow">Einzelne Videos (zusätzlich zu den Paketen)</span>
        <p v-if="!paketVideos.length" class="hint">
          Es gibt noch keine Videos in Paketen.
        </p>
        <div v-else class="paket-list">
          <label v-for="video in paketVideos" :key="video.id" class="paket">
            <input
              type="checkbox"
              :checked="editing.videoIds.includes(video.id)"
              @change="toggleVideo(video.id)"
            />
            {{ video.titel }}
            <span class="t-meta">({{ video.paketNamen.join(', ') }})</span>
          </label>
        </div>
      </div>

      <label class="aktiv">
        <input v-model="editing.aktiv" type="checkbox" />
        Zugang aktiv — ohne Haken ist die Anmeldung gesperrt
      </label>

      <div class="editor-actions">
        <GButton :disabled="busy" @click="save">Speichern</GButton>
        <GButton variant="outline" :disabled="busy" @click="editing = null">Abbrechen</GButton>
      </div>
    </GCard>

    <DataTable :columns="columns" :rows="rows" row-key="id" min-width="900px">
      <template #row="{ row }">
        <span class="mail t-truncate">{{ row.email }}</span>
        <span class="muted t-truncate">{{ row.name || '—' }}</span>
        <span class="muted t-truncate">{{ paketNamen(row) }}</span>
        <span :class="row.aktiv ? 'ok' : 'flag'">{{ row.aktiv ? 'aktiv' : 'gesperrt' }}</span>
        <div class="row-actions">
          <GButton variant="ghost" size="sm" @click="startEdit(row)">Bearbeiten</GButton>
          <GButton variant="outline" size="sm" danger @click="remove(row)">Löschen</GButton>
        </div>
      </template>

      <template #empty>
        Noch keine Nutzer — über „Neuer Nutzer" den ersten Zugang anlegen.
      </template>
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

.mail {
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
