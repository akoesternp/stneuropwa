<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import NeuroWert from '@/components/NeuroWert.vue'
import DataTable from '@/components/ui/DataTable.vue'
import GButton from '@/components/ui/GButton.vue'
import GCard from '@/components/ui/GCard.vue'
import GField from '@/components/ui/GField.vue'
import { api, ApiError } from '@/api/client'
import type { Aktion, Column } from '@/types'

/**
 * Aktionszeiträume fürs Startguthaben.
 *
 * Wer sich innerhalb des Fensters registriert, bekommt den hinterlegten Betrag
 * statt des Grundguthabens aus START_CREDITS. Laufende Aktionen stehen oben —
 * nur die wirken gerade.
 */
const rows = ref<Aktion[]>([])
const busy = ref(false)
const notice = ref<string | null>(null)
const error = ref<string | null>(null)

const datum = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' })

const columns: Column[] = [
  { label: 'Aktion', width: 'minmax(180px,1fr)' },
  { label: 'Betrag', align: 'right', width: '110px' },
  { label: 'Beginn', width: '140px' },
  { label: 'Ende', width: '140px' },
  { label: 'Eingelöst', align: 'right', width: '110px' },
  { label: 'Zustand', width: '120px' },
  { width: '210px' },
]

interface Editor {
  id: number | null
  name: string
  credits: string
  /** `datetime-local` liefert und erwartet "2026-09-10T14:30" — Ortszeit. */
  beginn: string
  ende: string
  aktiv: boolean
  maxEinloesungen: string
}

const editing = ref<Editor | null>(null)
const isNew = computed(() => editing.value !== null && editing.value.id === null)

/**
 * Zwischen Millisekunden und dem Format des Eingabefelds.
 *
 * `toISOString` wäre falsch: das rechnet nach UTC um, und der Betreiber gäbe
 * dann im Sommer eine Stunde daneben ein. Der Umweg über die Zeitzonenversatz
 * hält die Anzeige bei der Ortszeit.
 */
function alsFeld(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

function ausFeld(text: string): number {
  const ms = new Date(text).getTime()
  return Number.isFinite(ms) ? ms : 0
}

/** Läuft diese Aktion gerade? Dieselbe Regel wie im Server. */
function laeuft(row: Aktion): boolean {
  const jetzt = Date.now()
  const platzFrei = row.maxEinloesungen === 0 || row.einloesungen < row.maxEinloesungen
  return row.aktiv && row.beginn <= jetzt && jetzt < row.ende && platzFrei
}

function zustand(row: Aktion): string {
  if (!row.aktiv) return 'deaktiviert'
  const jetzt = Date.now()
  if (jetzt < row.beginn) return 'geplant'
  if (jetzt >= row.ende) return 'abgelaufen'
  if (row.maxEinloesungen > 0 && row.einloesungen >= row.maxEinloesungen) return 'ausgeschöpft'
  return 'läuft'
}

async function load() {
  try {
    rows.value = await api.get<Aktion[]>('/admin/aktionen')
    error.value = null
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : 'Laden fehlgeschlagen.'
  }
}

onMounted(load)

function startNew() {
  notice.value = null
  error.value = null

  // Von jetzt bis in vier Wochen — der häufigste Fall, änderbar bleibt es.
  const jetzt = Date.now()
  editing.value = {
    id: null,
    name: '',
    credits: '5',
    beginn: alsFeld(jetzt),
    ende: alsFeld(jetzt + 28 * 24 * 60 * 60 * 1000),
    aktiv: true,
    maxEinloesungen: '0',
  }
}

function startEdit(row: Aktion) {
  notice.value = null
  error.value = null
  editing.value = {
    id: row.id,
    name: row.name,
    credits: String(row.credits),
    beginn: alsFeld(row.beginn),
    ende: alsFeld(row.ende),
    aktiv: row.aktiv,
    maxEinloesungen: String(row.maxEinloesungen),
  }
}

async function save() {
  if (!editing.value) return

  if (!editing.value.name.trim()) {
    error.value = 'Der Name ist Pflicht.'
    return
  }
  const beginn = ausFeld(editing.value.beginn)
  const ende = ausFeld(editing.value.ende)
  if (!beginn || !ende) {
    error.value = 'Bitte Beginn und Ende angeben.'
    return
  }
  if (ende <= beginn) {
    error.value = 'Das Ende muss nach dem Beginn liegen.'
    return
  }

  busy.value = true
  error.value = null
  try {
    await api.put('/admin/aktionen', {
      id: editing.value.id,
      name: editing.value.name,
      credits: Math.max(0, Math.floor(Number(editing.value.credits)) || 0),
      beginn,
      ende,
      aktiv: editing.value.aktiv,
      maxEinloesungen: Math.max(0, Math.floor(Number(editing.value.maxEinloesungen)) || 0),
    })
    notice.value = `${editing.value.name} gespeichert.`
    editing.value = null
    await load()
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : 'Speichern fehlgeschlagen.'
  } finally {
    busy.value = false
  }
}

async function remove(row: Aktion) {
  if (!confirm(`Aktion „${row.name}" wirklich löschen?`)) return

  busy.value = true
  error.value = null
  try {
    await api.delete(`/admin/aktionen/${row.id}`)
    notice.value = `${row.name} gelöscht.`
    await load()
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
        <h2 class="t-h2">Aktionen</h2>
        <p class="t-subhead">
          Wer sich im Zeitraum registriert, bekommt den hinterlegten Betrag statt des
          Grundguthabens. Laufen mehrere gleichzeitig, gewinnt der höhere Betrag.
        </p>
      </div>
      <GButton @click="startNew">Neue Aktion</GButton>
    </header>

    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <GCard v-if="editing" class="editor">
      <h3 class="t-h3">{{ isNew ? 'Neue Aktion' : `Aktion ${editing.name}` }}</h3>

      <div class="fields">
        <GField v-model="editing.name" label="Name" compact />
        <GField v-model="editing.credits" label="Neuro je Registrierung" type="number" compact />
        <GField v-model="editing.beginn" label="Beginn" type="datetime-local" compact />
        <GField v-model="editing.ende" label="Ende (ausschließend)" type="datetime-local" compact />
        <!-- 0 heißt unbegrenzt. Eine Aktion ohne Deckel ist ein offener
             Scheck für jeden, der den Link weitergibt. -->
        <GField
          v-model="editing.maxEinloesungen"
          label="Höchstens so oft (0 = unbegrenzt)"
          type="number"
          compact
        />
      </div>

      <label class="aktiv">
        <input v-model="editing.aktiv" type="checkbox" />
        Aktion aktiv — ohne Haken greift sie auch im Zeitraum nicht
      </label>

      <div class="editor-actions">
        <GButton :disabled="busy" @click="save">Speichern</GButton>
        <GButton variant="outline" :disabled="busy" @click="editing = null">Abbrechen</GButton>
      </div>
    </GCard>

    <DataTable :columns="columns" :rows="rows" row-key="id" min-width="1000px">
      <template #row="{ row }">
        <span class="name t-truncate">{{ row.name }}</span>
        <span class="betrag"><NeuroWert :betrag="row.credits" /></span>
        <span class="muted">{{ datum.format(row.beginn) }}</span>
        <span class="muted">{{ datum.format(row.ende) }}</span>
        <span class="zahl">
          {{ row.einloesungen }}<template v-if="row.maxEinloesungen">
            / {{ row.maxEinloesungen }}</template
          >
        </span>
        <span :class="['zustand', laeuft(row) ? 'an' : 'aus']">{{ zustand(row) }}</span>
        <div class="row-actions">
          <GButton variant="ghost" size="sm" @click="startEdit(row)">Bearbeiten</GButton>
          <GButton variant="outline" size="sm" danger :disabled="busy" @click="remove(row)">
            Löschen
          </GButton>
        </div>
      </template>

      <template #empty>
        Noch keine Aktionen — über „Neue Aktion" die erste anlegen.
      </template>
    </DataTable>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 18px;
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
  gap: 8px;
  max-width: 70ch;
}

.notice {
  font-size: var(--fs-secondary);
  color: var(--c-action);
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
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
}

.aktiv {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--fs-secondary);
  cursor: pointer;
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
  font-size: var(--fs-secondary);
  font-weight: 500;
}

.betrag {
  display: flex;
  justify-content: flex-end;
  font-size: var(--fs-secondary);
  font-weight: 500;
}

.muted {
  font-size: var(--fs-secondary);
  color: var(--c-text-muted);
}

.zahl {
  font-size: var(--fs-secondary);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.zustand {
  font-size: var(--fs-secondary);
}

.zustand.an {
  color: var(--c-action);
  font-weight: 500;
}

.zustand.aus {
  color: var(--c-text-muted);
}

.row-actions {
  display: flex;
  gap: 8px;
}
</style>
