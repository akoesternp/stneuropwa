<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import DataTable from '@/components/ui/DataTable.vue'
import GButton from '@/components/ui/GButton.vue'
import GField from '@/components/ui/GField.vue'
import { api, ApiError } from '@/api/client'
import type { Column, Video } from '@/types'
import type { Bereich } from '@shared/types'

/**
 * Die Trainingsbereiche (Augen, Vestibulär …).
 *
 * In den Videos steht der Name, nicht eine ID — beim Umbenennen zieht der
 * Server die betroffenen Videos deshalb selbst nach. Gelöscht werden kann nur,
 * woran nichts mehr hängt.
 */
const rows = ref<Bereich[]>([])
const videos = ref<Video[]>([])

interface Editor {
  id: number | null
  name: string
  sortierung: string
}

const editing = ref<Editor | null>(null)
const busy = ref(false)

const dialogEl = ref<HTMLDialogElement | null>(null)

/*
 * Das <dialog>-Element führt seinen offen/zu-Zustand selbst — deshalb wird
 * es hier an `editing` angeglichen statt umgekehrt. `flush: post` sorgt
 * dafür, dass das Element schon steht, wenn showModal darauf trifft.
 *
 * Der Bildlauf der Seite wird angehalten: sonst scrollt hinter dem Dialog
 * die Liste, und beim Schließen ist man woanders als vorher.
 */
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

/** Zu, aber nicht mitten im Speichern. */
function schliessen() {
  if (busy.value) return
  editing.value = null
}

/** Escape darf nicht schließen, solange gespeichert wird. */
function onAbbruch(event: Event) {
  if (busy.value) event.preventDefault()
}

function onHintergrundKlick(event: MouseEvent) {
  if (event.target === dialogEl.value) schliessen()
}

/* Auch der Weg über die Escape-Taste soll den Bearbeitungsstand aufräumen. */
function onGeschlossen() {
  if (editing.value) editing.value = null
}
const notice = ref<string | null>(null)
const error = ref<string | null>(null)

const columns: Column[] = [
  { label: 'Bereich', width: 'minmax(180px,1fr)' },
  { label: 'Sortierung', width: '120px' },
  { label: 'Übungen', width: '120px' },
  { width: '210px' },
]

const isNew = computed(() => editing.value !== null && editing.value.id === null)

async function load() {
  ;[rows.value, videos.value] = await Promise.all([
    api.get<Bereich[]>('/admin/bereiche'),
    api.get<Video[]>('/admin/videos'),
  ])
}

onMounted(load)

/** Wie viele Übungen hängen an diesem Bereich? Bestimmt, ob Löschen geht. */
function anzahl(bereich: Bereich): number {
  return videos.value.filter((video) => video.bereich === bereich.name).length
}

function startNew() {
  notice.value = null
  error.value = null
  // Ans Ende einsortieren, damit ein neuer Bereich nicht vorne einbricht.
  const groesste = rows.value.reduce((max, bereich) => Math.max(max, bereich.sortierung), 0)
  editing.value = { id: null, name: '', sortierung: String(groesste + 1) }
}

function startEdit(row: Bereich) {
  notice.value = null
  error.value = null
  editing.value = { id: row.id, name: row.name, sortierung: String(row.sortierung) }
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
    await api.put('/admin/bereiche', {
      id: editing.value.id,
      name: editing.value.name,
      sortierung: Number(editing.value.sortierung) || 0,
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

async function remove(row: Bereich) {
  if (!confirm(`Bereich „${row.name}" wirklich löschen?`)) return
  busy.value = true
  error.value = null
  try {
    await api.delete(`/admin/bereiche/${row.id}`)
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
        <h2 class="t-h2">Trainingsbereiche</h2>
        <p class="t-subhead">
          Die Kategorien, nach denen im Portal gefiltert wird. Ein Umbenennen trägt der Server in
          allen betroffenen Übungen nach.
        </p>
      </div>
      <GButton @click="startNew">Neuer Bereich</GButton>
    </header>

    <!-- Solange der Dialog offen ist, gehören Meldungen hinein, nicht dahinter. -->
    <p v-if="notice && !editing" class="notice" role="status">{{ notice }}</p>
    <p v-if="error && !editing" class="error" role="alert">{{ error }}</p>

    <!--
      Bearbeitet wird im Dialog, nicht in einem Kasten über der Liste: der
      schob die Tabelle nach unten, und nach dem Klick musste man erst
      wieder suchen, wo man war.
    -->
    <dialog
      ref="dialogEl"
      class="dialog"
      @cancel="onAbbruch"
      @close="onGeschlossen"
      @click="onHintergrundKlick"
    >
      <div v-if="editing" class="dialog-inner">
        <header class="dialog-kopf">
          <h3 class="t-h3">{{ isNew ? 'Neuer Bereich' : `Bereich ${editing.name}` }}</h3>
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
            <GField v-model="editing.name" label="Name" placeholder="z. B. Augen" compact />
            <GField v-model="editing.sortierung" label="Sortierung" type="number" compact />
          </div>

          <p class="hint">
            Die Sortierung bestimmt die Reihenfolge der Filterknöpfe auf der Startseite.
          </p>

        </div>

        <footer class="dialog-fuss">
          <GButton :disabled="busy" @click="save">Speichern</GButton>
          <GButton variant="outline" :disabled="busy" @click="schliessen">Abbrechen</GButton>
        </footer>
      </div>
    </dialog>

    <DataTable :columns="columns" :rows="rows" row-key="id" min-width="700px">
      <template #row="{ row }">
        <span class="name">{{ row.name }}</span>
        <span class="muted">{{ row.sortierung }}</span>
        <span class="muted">{{ anzahl(row) }}</span>
        <div class="row-actions">
          <GButton variant="ghost" size="sm" @click="startEdit(row)">Bearbeiten</GButton>
          <!--
            Ein Bereich mit Übungen lässt sich nicht löschen — der Server weist
            es ohnehin ab; der ausgegraute Knopf erspart den Fehlversuch.
          -->
          <GButton
            variant="outline"
            size="sm"
            danger
            :disabled="anzahl(row) > 0"
            :title="anzahl(row) > 0 ? 'Erst die Übungen umtragen' : undefined"
            @click="remove(row)"
          >
            Löschen
          </GButton>
        </div>
      </template>

      <template #empty>Noch keine Bereiche angelegt.</template>
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

.row-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
