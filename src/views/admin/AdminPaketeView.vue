<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import DataTable from '@/components/ui/DataTable.vue'
import GButton from '@/components/ui/GButton.vue'
import GCard from '@/components/ui/GCard.vue'
import GField from '@/components/ui/GField.vue'
import { api, ApiError } from '@/api/client'
import type { Column, Paket } from '@/types'

/**
 * Pakete bündeln Videos und werden Nutzern zugewiesen. Löschen geht nur,
 * wenn weder Videos noch Zuweisungen daran hängen — der Server lehnt sonst
 * mit einer Erklärung ab.
 */
const rows = ref<Paket[]>([])

interface Editor {
  id: number | null
  name: string
  beschreibung: string
  sortierung: string
  aktiv: boolean
}

const editing = ref<Editor | null>(null)
const busy = ref(false)
const notice = ref<string | null>(null)
const error = ref<string | null>(null)

const columns: Column[] = [
  { label: 'Name', width: 'minmax(180px,1fr)' },
  { label: 'Beschreibung', width: 'minmax(240px,1.4fr)' },
  { label: 'Sortierung', width: '110px' },
  { label: 'Status', width: '100px' },
  { width: '210px' },
]

const isNew = computed(() => editing.value !== null && editing.value.id === null)

async function load() {
  rows.value = await api.get<Paket[]>('/admin/pakete')
}

onMounted(load)

function startNew() {
  notice.value = null
  error.value = null
  editing.value = { id: null, name: '', beschreibung: '', sortierung: '0', aktiv: true }
}

function startEdit(row: Paket) {
  notice.value = null
  error.value = null
  editing.value = {
    id: row.id,
    name: row.name,
    beschreibung: row.beschreibung,
    sortierung: String(row.sortierung),
    aktiv: row.aktiv,
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
    })
    await load()
    notice.value = `${editing.value.name} gespeichert.`
    editing.value = null
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : 'Speichern fehlgeschlagen.'
  } finally {
    busy.value = false
  }
}

async function remove(row: Paket) {
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
          Bündeln Videos und werden Nutzern zugewiesen. Inaktive Pakete bleiben zugewiesen,
          ihre Videos verschwinden aber aus dem Portal.
        </p>
      </div>
      <GButton @click="startNew">Neues Paket</GButton>
    </header>

    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <GCard v-if="editing" class="editor">
      <h3 class="t-h3">{{ isNew ? 'Neues Paket' : `Paket ${editing.name}` }}</h3>

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

      <div class="editor-actions">
        <GButton :disabled="busy" @click="save">Speichern</GButton>
        <GButton variant="outline" :disabled="busy" @click="editing = null">Abbrechen</GButton>
      </div>
    </GCard>

    <DataTable :columns="columns" :rows="rows" row-key="id" min-width="880px">
      <template #row="{ row }">
        <span class="name t-truncate">{{ row.name }}</span>
        <span class="muted t-truncate">{{ row.beschreibung || '—' }}</span>
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

.wide {
  grid-column: 1 / -1;
}

.aktiv {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  font-size: var(--fs-secondary);
}

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
